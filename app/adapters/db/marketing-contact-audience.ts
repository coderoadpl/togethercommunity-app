import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { appError, deriveConsentState, deriveMarketingEligibility, err, ok, validation, marketingAudienceContactSchema, marketingAudienceSnapshotSchema, marketingCanonicalJson, marketingContactSchema, marketingConsentSchema, type ContactCampaignAudience, type MarketingAudienceContact, type MarketingList } from '#core/domain/index.js';
import type { MarketingContactAudienceRepository } from '#core/server/index.js';

import { createMarketingMemberSyncRepository } from './marketing-member-sync.js';
import type { Db } from './client.js';
import { campaigns, marketingContacts as contacts, marketingConsents as consents, marketingCampaignAudienceSnapshots as snapshots, marketingCampaignAudienceContacts as recipients } from './schema.js';
import { createMarketingListRepository, marketingListRuleSql, type DirectoryRepositoryDeps } from './marketing-contact-repositories.js';
import { createConsentDefinitionRepository } from './marketing-repositories.js';

const contactColumn = (name: string) => sql`${contacts}.${sql.identifier(name)}`;
const listPredicate = (tenantId: string, list: MarketingList, asOf: string): SQL => list.rule === null
  ? sql`EXISTS (SELECT 1 FROM marketing_list_memberships mm WHERE mm.tenant_id = ${tenantId} AND mm.list_id = ${list.id} AND mm.contact_id = ${contactColumn('id')} AND mm.removed_at IS NULL)`
  : marketingListRuleSql(tenantId, list.rule, asOf);
const union = (predicates: SQL[]): SQL => predicates.length === 0 ? sql`false` : sql`(${sql.join(predicates, sql` OR `)})`;

const resolveAudience = async (db: Db, deps: DirectoryRepositoryDeps, tenantId: string, input: { audience: ContactCampaignAudience; consentDefinitionId: string; asOf: string }) => {
  const definitions = createConsentDefinitionRepository(db);
  const definition = await definitions.findById(tenantId, input.consentDefinitionId);
  const version = (await definitions.listVersions(tenantId, input.consentDefinitionId)).at(-1);
  if (definition === null || definition.status !== 'active' || definition.kind !== 'optional_marketing' || version === undefined) return err(validation('An active marketing consent definition with wording is required'));
  const lists = createMarketingListRepository(db, deps);
  const selectedLists: MarketingList[] = [];
  for (const id of [...new Set([...input.audience.includeLists, ...input.audience.excludeLists])]) {
    const list = await lists.findById(tenantId, id);
    if (list === null || list.archivedAt !== null) return err(validation('Audience lists must exist and be active in this tenant'));
    selectedLists.push(list);
  }
  if (input.audience.excludeProductIds.length > 0 && !await lists.validateRule(tenantId, { kind: 'product_grant', state: 'ever', productIds: input.audience.excludeProductIds })) return err(validation('Excluded products must exist in this tenant'));
  if ((input.audience.includeMembersWithConsent || input.audience.excludeProductIds.length > 0 || selectedLists.some((list) => list.rule?.kind === 'product_grant')) && await createMarketingMemberSyncRepository(db).next(tenantId, input.asOf) !== null) return err(appError('conflict', 'Directory synchronization in progress; retry the audience preview or schedule'));
  const included = selectedLists.filter((list) => input.audience.includeLists.includes(list.id)).map((list) => listPredicate(tenantId, list, input.asOf));
  if (input.audience.includeMembersWithConsent) included.push(sql`EXISTS (SELECT 1 FROM members m WHERE m.tenant_id = ${tenantId} AND m.id = ${contactColumn('member_id')} AND m.deleted_at IS NULL)`);
  const excluded = selectedLists.filter((list) => input.audience.excludeLists.includes(list.id)).map((list) => listPredicate(tenantId, list, input.asOf));
  excluded.push(sql`${contacts.archivedAt} IS NOT NULL`);
  if (input.audience.excludeProductIds.length > 0) excluded.push(sql`EXISTS (SELECT 1 FROM product_grants pg WHERE pg.tenant_id = ${tenantId} AND pg.member_id = ${contactColumn('member_id')} AND pg.product_id IN (${sql.join(input.audience.excludeProductIds.map((id) => sql`${id}`), sql`, `)}))`);
  const rows = await db.select({ contact: contacts, excluded: union(excluded), fromList: union(selectedLists.filter((list) => input.audience.includeLists.includes(list.id)).map((list) => listPredicate(tenantId, list, input.asOf))), suppressed: sql<boolean>`EXISTS (SELECT 1 FROM suppressions s WHERE s.tenant_id = ${tenantId} AND s.email_hmac = ${contactColumn('email_hmac')} AND s.lifted_at IS NULL)` }).from(contacts).where(and(eq(contacts.tenantId, tenantId), union(included))).orderBy(sql`${contacts.id} COLLATE "C"`);
  const history = new Map<string, ReturnType<typeof marketingConsentSchema.parse>[]>();
  for (let offset = 0; offset < rows.length; offset += 500) {
    const emails = rows.slice(offset, offset + 500).map((row) => row.contact.email);
    const evidence = await db.select().from(consents).where(and(eq(consents.tenantId, tenantId), eq(consents.definitionId, definition.id), inArray(consents.email, emails))).orderBy(consents.occurredAt, consents.id);
    for (const row of evidence) {
      const consent = marketingConsentSchema.parse({ ...row, occurredAt: new Date(row.occurredAt).toISOString() });
      const values = history.get(row.email) ?? [];
      values.push(consent);
      history.set(row.email, values);
    }
  }
  const candidates: MarketingAudienceContact[] = [];
  const skipped = { suppressed: 0, withdrawn: 0, pendingConfirmation: 0, noConsent: 0 };
  let excludedCount = 0;
  for (const row of rows) {
    const contact = marketingContactSchema.parse(row.contact);
    const state = deriveConsentState(history.get(contact.email) ?? [], definition);
    if (!row.fromList && !state.active) continue;
    if (row.excluded) { excludedCount += 1; continue; }
    const eligibility = deriveMarketingEligibility({ consent: state, suppressed: row.suppressed });
    if (!eligibility.eligible) {
      const key = eligibility.reason === 'suppressed' ? 'suppressed' : eligibility.reason === 'unsubscribed' ? 'withdrawn' : eligibility.reason === 'pending_confirmation' ? 'pendingConfirmation' : 'noConsent';
      skipped[key] += 1;
    }
    candidates.push({ tenantId, snapshotId: '', contactId: contact.id, email: contact.email, emailHmac: contact.emailHmac, memberIdSnapshot: contact.memberId, displayNameSnapshot: contact.displayName, firstNameSnapshot: contact.firstName, consentRowId: state.row?.id ?? null, eligibilityAtSnapshot: eligibility.eligible, skipReason: eligibility.eligible ? null : eligibility.reason, createdAt: input.asOf });
  }
  const eligible = candidates.filter((contact) => contact.eligibilityAtSnapshot);
  return ok({ candidates, version, listRevisionSnapshots: selectedLists.map(({ id, revision }) => ({ id, revision })), preview: {
    count: eligible.length, candidateCount: candidates.length, excludedCount, skipped,
    sample: eligible.slice(0, 20).map((contact) => ({ contactId: contact.contactId, email: contact.email, displayName: contact.displayNameSnapshot, memberId: contact.memberIdSnapshot })),
    computedAt: input.asOf, audienceHash: deps.contentHash.sha256(marketingCanonicalJson({ audience: input.audience, consentDefinitionId: definition.id, definitionVersion: version.version })),
  } });
};

export const createMarketingContactAudienceRepository = (db: Db, deps: DirectoryRepositoryDeps): MarketingContactAudienceRepository => ({
  preview: async (tenantId, input) => db.transaction(async (tx) => {
    const resolved = await resolveAudience(tx, deps, tenantId, input);
    return resolved.ok ? ok(resolved.value.preview) : resolved;
  }, { isolationLevel: 'repeatable read' }),
  createSnapshot: async (tenantId, input) => db.transaction(async (tx) => {
    await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, input.campaignId))).for('update');
    const resolved = await resolveAudience(tx, deps, tenantId, input);
    if (!resolved.ok) return resolved;
    const [previous] = await tx.select({ revision: sql<number>`coalesce(max(${snapshots.revision}), 0)::int` }).from(snapshots).where(and(eq(snapshots.tenantId, tenantId), eq(snapshots.campaignId, input.campaignId)));
    const snapshot = marketingAudienceSnapshotSchema.parse({ id: deps.ids.nextId(), tenantId, campaignId: input.campaignId, revision: (previous?.revision ?? 0) + 1, audienceJson: input.audience, listRevisionSnapshots: resolved.value.listRevisionSnapshots, consentDefinitionId: input.consentDefinitionId, definitionVersion: resolved.value.version.version, candidateCount: resolved.value.preview.candidateCount, eligibleCount: resolved.value.preview.count, skippedCounts: resolved.value.preview.skipped, createdAt: input.asOf, maxContactId: resolved.value.candidates.at(-1)?.contactId ?? null });
    await tx.insert(snapshots).values(snapshot);
    for (let offset = 0; offset < resolved.value.candidates.length; offset += 500) await tx.insert(recipients).values(resolved.value.candidates.slice(offset, offset + 500).map((row) => ({ ...row, snapshotId: snapshot.id })));
    return ok(snapshot);
  }, { isolationLevel: 'repeatable read' }),
  fetchSnapshotPage: async (tenantId, input) => (await db.select().from(recipients).where(and(eq(recipients.tenantId, tenantId), eq(recipients.snapshotId, input.snapshotId), input.afterContactId === null ? undefined : sql`${recipients.contactId} COLLATE "C" > ${input.afterContactId} COLLATE "C"`, sql`${recipients.contactId} COLLATE "C" <= ${input.maxContactId} COLLATE "C"`)).orderBy(sql`${recipients.contactId} COLLATE "C"`).limit(input.limit)).map((row) => marketingAudienceContactSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
});
