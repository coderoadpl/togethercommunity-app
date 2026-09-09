import { and, eq, gt, inArray, isNull, isNotNull, or, sql, type SQL } from 'drizzle-orm';

import { appError, err, ok, marketingContactSchema, marketingContactViewSchema, marketingListSchema, marketingDirectoryEventSchema, marketingCanonicalJson, type MarketingContactListQuery, type MarketingListRule, type MarketingDirectoryEvent } from '#core/domain/index.js';
import type { MarketingContactRepository, MarketingListRepository, MarketingDirectoryEventRepository, ContentHash, Clock, IdGenerator, EmailHmac } from '#core/server/index.js';

import type { Db } from './client.js';
import { marketingContacts as contacts, marketingLists as lists, marketingListMemberships as memberships, marketingDirectoryEvents as events, members, products, consentDefinitions } from './schema.js';

export type DirectoryRepositoryDeps = { clock: Clock; ids: IdGenerator; hmac: EmailHmac; contentHash: ContentHash };
export const lockMarketingAddress = async (db: Db, tenantId: string, email: string): Promise<void> => {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + email}, 0))`);
};
export const createMarketingDirectoryEventRepository = (db: Db): MarketingDirectoryEventRepository => ({
  append: async (tenantId, input) => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + input.subjectKind + ':' + input.subjectId}, 1))`);
    const [last] = await db.select({ sequence: sql<number>`coalesce(max(${events.sequence}), 0)` }).from(events).where(and(eq(events.tenantId, tenantId), eq(events.subjectKind, input.subjectKind), eq(events.subjectId, input.subjectId)));
    await db.insert(events).values(marketingDirectoryEventSchema.parse({ ...input, tenantId, sequence: (last?.sequence ?? 0) + 1 }));
  },
  list: async (tenantId, kind, id) => (await db.select().from(events).where(and(eq(events.tenantId, tenantId), eq(events.subjectKind, kind), eq(events.subjectId, id))).orderBy(events.sequence)).map((row) => marketingDirectoryEventSchema.parse(row)),
});
const append = async (db: Db, deps: DirectoryRepositoryDeps, tenantId: string, subjectKind: MarketingDirectoryEvent['subjectKind'], subjectId: string, type: MarketingDirectoryEvent['type']) => {
  await createMarketingDirectoryEventRepository(db).append(tenantId, { id: deps.ids.nextId(), tenantId, subjectKind, subjectId, type, actor: 'directory', importId: null, payload: {}, occurredAt: deps.clock.nowIso(), createdAt: deps.clock.nowIso() });
};
// Drizzle removes column qualifiers in single-table projections; nested references must remain correlated.
const contactReference = (column: 'id' | 'email' | 'email_hmac') => sql`${contacts}.${sql.identifier(column)}`;
const consentStateSql = (tenantId: string, definitionId: string): SQL<string> => sql<string>`coalesce((
  SELECT CASE WHEN mc.status = 'withdrawn' THEN 'withdrawn' WHEN mc.status = 'confirmed' OR NOT cd.double_opt_in THEN 'active' ELSE 'pending_confirmation' END
  FROM marketing_consents mc JOIN consent_definitions cd ON cd.tenant_id = mc.tenant_id AND cd.id = mc.definition_id
  WHERE mc.tenant_id = ${tenantId} AND mc.email = ${contactReference('email')} AND mc.definition_id = ${definitionId}
  ORDER BY mc.occurred_at DESC, mc.id DESC LIMIT 1
), 'none')`;
const suppressionSql = (tenantId: string): SQL<string | null> => sql<string | null>`(SELECT s.reason FROM suppressions s WHERE s.tenant_id = ${tenantId} AND s.email_hmac = ${contactReference('email_hmac')} AND s.lifted_at IS NULL LIMIT 1)`;
const ruleSql = (tenantId: string, rule: MarketingListRule, asOf: string): SQL => {
  if (rule.kind === 'tag') return rule.match === 'all'
    ? sql`${contacts.tags} @> ${JSON.stringify(rule.tags)}::jsonb`
    : sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${contacts.tags}) tag WHERE tag IN (${sql.join(rule.tags.map((tag) => sql`${tag}`), sql`, `)}))`;
  if (rule.kind === 'consent_definition') return sql`${consentStateSql(tenantId, rule.definitionId)} = 'active'`;
  return sql`EXISTS (SELECT 1 FROM product_grants pg WHERE pg.tenant_id = ${tenantId} AND pg.member_id = ${contacts.memberId}
    AND pg.product_id IN (${sql.join(rule.productIds.map((id) => sql`${id}`), sql`, `)})
    ${rule.state === 'active' ? sql`AND pg.starts_at::timestamptz <= ${asOf}::timestamptz AND (pg.expires_at IS NULL OR pg.expires_at::timestamptz > ${asOf}::timestamptz)` : sql``})`;
};
const contactFilters = async (db: Db, tenantId: string, query: MarketingContactListQuery, asOf: string): Promise<SQL[]> => {
  const filters: SQL[] = [eq(contacts.tenantId, tenantId), query.archived === true ? isNotNull(contacts.archivedAt) : isNull(contacts.archivedAt)];
  if (query.id !== undefined) filters.push(eq(contacts.id, query.id));
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    filters.push(sql`(${contacts.email} ILIKE ${pattern} OR ${contacts.displayName} ILIKE ${pattern} OR ${contacts.firstName} ILIKE ${pattern} OR ${contacts.lastName} ILIKE ${pattern})`);
  }
  if (query.tags?.length) filters.push(sql`${contacts.tags} @> ${JSON.stringify(query.tags)}::jsonb`);
  if (query.linkedMember !== undefined) filters.push(query.linkedMember ? isNotNull(contacts.memberId) : isNull(contacts.memberId));
  if (query.suppressed !== undefined) filters.push(query.suppressed ? sql`${suppressionSql(tenantId)} IS NOT NULL` : sql`${suppressionSql(tenantId)} IS NULL`);
  if (query.consentDefinitionId !== undefined && query.consentState !== undefined) filters.push(sql`${consentStateSql(tenantId, query.consentDefinitionId)} = ${query.consentState}`);
  if (query.listId !== undefined) {
    const [list] = await db.select().from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.id, query.listId), isNull(lists.archivedAt)));
    if (list === undefined) filters.push(sql`false`);
    else if (list.rule !== null) filters.push(ruleSql(tenantId, marketingListSchema.parse(list).rule ?? list.rule, asOf));
    else filters.push(sql`EXISTS (SELECT 1 FROM marketing_list_memberships mm WHERE mm.tenant_id = ${tenantId} AND mm.list_id = ${list.id} AND mm.contact_id = ${contactReference('id')} AND mm.removed_at IS NULL)`);
  }
  return filters;
};
export const createMarketingContactRepository = (db: Db, deps: DirectoryRepositoryDeps): MarketingContactRepository => ({
  lockAddress: (tenantId, email) => lockMarketingAddress(db, tenantId, email),
  findById: async (tenantId, contactId) => {
    const [row] = await db.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
    return row === undefined ? null : marketingContactSchema.parse(row);
  },
  findByEmail: async (tenantId, email) => {
    const [row] = await db.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), or(eq(contacts.email, email), eq(contacts.emailHmac, deps.hmac.compute(tenantId, email)))));
    return row === undefined ? null : marketingContactSchema.parse(row);
  },
  listPage: async (tenantId, query, asOf = deps.clock.nowIso()) => {
    const filters = await contactFilters(db, tenantId, query, asOf);
    if (query.cursor !== undefined) filters.push(sql`${contacts.id} COLLATE "C" > ${query.cursor.slice(query.cursor.indexOf(':') + 1)} COLLATE "C"`);
    const rows = await db.select({ contact: contacts,
      listKeys: sql<string[]>`ARRAY(SELECT ml.key FROM marketing_list_memberships mm JOIN marketing_lists ml ON ml.tenant_id = mm.tenant_id AND ml.id = mm.list_id WHERE mm.tenant_id = ${tenantId} AND mm.contact_id = ${contactReference('id')} AND mm.removed_at IS NULL AND ml.archived_at IS NULL ORDER BY ml.key COLLATE "C")`,
      consentState: query.consentDefinitionId === undefined ? sql<null>`NULL` : consentStateSql(tenantId, query.consentDefinitionId), suppressionReason: suppressionSql(tenantId),
    }).from(contacts).where(and(...filters)).orderBy(sql`${contacts.id} COLLATE "C"`).limit(query.limit + 1);
    const filterQuery = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'cursor'));
    const hash = deps.contentHash.sha256(marketingCanonicalJson(filterQuery));
    return { contacts: rows.slice(0, query.limit).map((row) => marketingContactViewSchema.parse({ ...row.contact, listKeys: row.listKeys, consentState: row.consentState, suppressionReason: row.suppressionReason })), nextCursor: rows.length > query.limit ? `${hash}:${rows[query.limit - 1]?.contact.id ?? ''}` : null };
  },
  upsertByEmail: async (tenantId, input) => db.transaction(async (tx) => {
    await lockMarketingAddress(tx, tenantId, input.email);
    const [existing] = await tx.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), or(eq(contacts.email, input.email), eq(contacts.emailHmac, deps.hmac.compute(tenantId, input.email))))).for('update');
    if (existing !== undefined && existing.email !== input.email) return { contact: marketingContactSchema.parse(existing), outcome: 'unchanged' };
    const [member] = await tx.select().from(members).where(and(eq(members.tenantId, tenantId), sql`lower(btrim(${members.email})) = ${input.email}`, isNull(members.deletedAt))).orderBy(members.id).limit(1);
    const firstName = input.firstName || existing?.firstName || null;
    const lastName = input.lastName || existing?.lastName || null;
    const names = [firstName, lastName].filter(Boolean).join(' ');
    const contact = marketingContactSchema.parse({
      id: existing?.id ?? deps.ids.nextId(), tenantId, email: input.email, emailHmac: deps.hmac.compute(tenantId, input.email),
      firstName, lastName, displayName: input.displayName || existing?.displayName || names || null,
      source: input.source || existing?.source || 'import', tags: [...new Set([...(existing?.tags ?? []), ...(input.tags ?? [])])],
      memberId: member?.id ?? null, createdAt: existing?.createdAt ?? deps.clock.nowIso(), updatedAt: existing?.updatedAt ?? deps.clock.nowIso(), archivedAt: existing?.archivedAt ?? null,
    });
    if (existing !== undefined && marketingCanonicalJson(contact) === marketingCanonicalJson(marketingContactSchema.parse(existing))) return { contact, outcome: 'unchanged' };
    contact.updatedAt = deps.clock.nowIso();
    await tx.insert(contacts).values(contact).onConflictDoUpdate({ target: [contacts.tenantId, contacts.email], set: contact });
    await append(tx, deps, tenantId, 'contact', contact.id, existing === undefined ? 'contact_created' : 'contact_updated');
    if (contact.memberId !== (existing?.memberId ?? null)) await append(tx, deps, tenantId, 'contact', contact.id, 'member_linked');
    return { contact, outcome: existing === undefined ? 'created' : 'updated' };
  }),
  update: async (tenantId, contactId, input) => db.transaction(async (tx) => {
    const [existing] = await tx.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId))).for('update');
    if (existing === undefined) return null;
    const contact = marketingContactSchema.parse({ ...existing, ...input, updatedAt: deps.clock.nowIso() });
    await tx.update(contacts).set(contact).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
    await append(tx, deps, tenantId, 'contact', contactId, 'contact_updated');
    return contact;
  }),
  archive: async (tenantId, input) => db.transaction(async (tx) => {
    const [row] = await tx.update(contacts).set({ archivedAt: input.archivedAt, updatedAt: deps.clock.nowIso() }).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, input.contactId))).returning();
    if (row === undefined) return null;
    await append(tx, deps, tenantId, 'contact', input.contactId, input.archivedAt === null ? 'contact_restored' : 'contact_archived');
    return marketingContactSchema.parse(row);
  }),
});
export const createMarketingListRepository = (db: Db, deps: DirectoryRepositoryDeps): MarketingListRepository => {
  const changeMembers = async (tenantId: string, input: { listId: string; contactIds: string[]; importId?: string }, remove: boolean) => db.transaction(async (tx) => {
    let changed = 0;
    for (const contactId of [...new Set(input.contactIds)].sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + input.listId + ':' + contactId}, 2))`);
      const [previous] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.listId, input.listId), eq(memberships.contactId, contactId)));
      if (remove ? previous === undefined || previous.removedAt !== null : previous?.removedAt === null) continue;
      if (remove) await tx.update(memberships).set({ removedAt: deps.clock.nowIso() }).where(and(eq(memberships.tenantId, tenantId), eq(memberships.listId, input.listId), eq(memberships.contactId, contactId)));
      else await tx.insert(memberships).values({ tenantId, listId: input.listId, contactId, createdAt: deps.clock.nowIso(), removedAt: null, importId: input.importId ?? null }).onConflictDoUpdate({ target: [memberships.tenantId, memberships.listId, memberships.contactId], set: { removedAt: null, importId: input.importId ?? null } });
      await append(tx, deps, tenantId, 'membership', `${input.listId}:${contactId}`, remove ? 'membership_removed' : 'membership_added');
      changed += 1;
    }
    return { changed };
  });
  return {
    findById: async (tenantId, listId) => {
      const [row] = await db.select().from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)));
      return row === undefined ? null : marketingListSchema.parse(row);
    },
    findByKey: async (tenantId, key) => {
      const [row] = await db.select().from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.key, key)));
      return row === undefined ? null : marketingListSchema.parse(row);
    },
    listPage: async (tenantId, query) => {
      const rows = await db.select().from(lists).where(and(eq(lists.tenantId, tenantId), query.archived ? isNotNull(lists.archivedAt) : isNull(lists.archivedAt), query.cursor === undefined ? undefined : gt(lists.id, query.cursor))).orderBy(lists.id).limit(query.limit + 1);
      return { lists: rows.slice(0, query.limit).map((row) => marketingListSchema.parse(row)), nextCursor: rows.length > query.limit ? rows[query.limit - 1]?.id ?? null : null };
    },
    save: async (tenantId, input) => db.transaction(async (tx) => {
      const list = marketingListSchema.parse({ ...input.list, tenantId });
      const [saved] = input.expectedRevision === null
        ? await tx.insert(lists).values(list).onConflictDoNothing().returning()
        : await tx.update(lists).set(list).where(and(eq(lists.tenantId, tenantId), eq(lists.id, list.id), eq(lists.revision, input.expectedRevision))).returning();
      if (saved === undefined) return err(appError('conflict', 'List key exists or revision changed'));
      await append(tx, deps, tenantId, 'list', list.id, input.expectedRevision === null ? 'list_created' : list.archivedAt === null ? 'list_updated' : 'list_archived');
      return ok(marketingListSchema.parse(saved));
    }),
    addMembers: (tenantId, input) => changeMembers(tenantId, input, false), removeMembers: (tenantId, input) => changeMembers(tenantId, input, true),
    validateRule: async (tenantId, rule) => {
      if (rule.kind === 'tag') return true;
      if (rule.kind === 'consent_definition') return (await db.select({ id: consentDefinitions.id }).from(consentDefinitions).where(and(eq(consentDefinitions.tenantId, tenantId), eq(consentDefinitions.id, rule.definitionId)))).length === 1;
      return (await db.select({ id: products.id }).from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, rule.productIds)))).length === new Set(rule.productIds).size;
    },
    counts: async (tenantId, listId, consentDefinitionId, asOf) => {
      const filters = await contactFilters(db, tenantId, { listId, limit: 100 }, asOf);
      const [row] = await db.select({ contactCount: sql<number>`count(*)::int`, suppressedCount: sql<number>`count(*) FILTER (WHERE ${suppressionSql(tenantId)} IS NOT NULL)::int`, eligibleCount: consentDefinitionId === null ? sql<null>`NULL` : sql<number>`count(*) FILTER (WHERE ${suppressionSql(tenantId)} IS NULL AND ${consentStateSql(tenantId, consentDefinitionId)} = 'active')::int` }).from(contacts).where(and(...filters));
      return { contactCount: row?.contactCount ?? 0, suppressedCount: row?.suppressedCount ?? 0, eligibleCount: row?.eligibleCount ?? null, consentDefinitionId, computedAt: asOf };
    },
  };
};
