import { and, asc, count, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';

import {
  CHANGE_PROPOSAL_DECIDED_FILTER,
  CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS,
  CHANGE_PROPOSAL_LIMITS,
  CHANGE_PROPOSAL_WITHDRAWAL_NOTES,
  changeProposalEffectWithinLimit,
  changeProposalEventSchema,
  changeProposalSchema,
  changeProposalTargetPriceSchema,
  computeCourseModuleName,
  type ChangeProposal,
  type ChangeProposalCountCap,
  type ChangeProposalEvent,
  type ChangeProposalEventKind,
} from '#core/domain/index.js';
import type {
  ChangeProposalCreation,
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalListQuery,
  ChangeProposalPage,
  ChangeProposalRepository,
  ChangeProposalTargetLabelReader,
  ChangeProposalTargetLabelRequest,
  ChangeProposalTargetLocks,
  ChangeProposalTransition,
  ChangeProposalTransitionGuard,
  ChangeProposalWithdrawal,
  ChangeProposalWrite,
} from '#core/server/index.js';

import {
  boundLockWait,
  busyAfterRollback,
  changeProposalBounds,
  lockWorkspaceProposals,
  type ChangeProposalBoundOptions,
  type ChangeProposalBounds,
} from './change-proposal-bounds.js';
import { quarantinedImagesPresent } from './change-proposal-images.js';
import type { Db } from './client.js';
import { lockActiveCourses } from './course-reference-lock.js';
import { holdProposedFiles, linkProposedFiles, lockProductFiles } from './key-download-files.js';
import {
  changeProposalEvents,
  changeProposals,
  courseLessons,
  courseModules,
  courses,
  productDownloadAssets,
  productPrices,
  products,
  productStock,
  salesLinks,
  shopManagementKeys,
  tenants,
} from './schema.js';

type ChangeProposalRow = typeof changeProposals.$inferSelect;

export const parseProposal = (row: ChangeProposalRow): ChangeProposal => changeProposalSchema.parse({
  id: row.id,
  tenantId: row.tenantId,
  groupId: row.groupId,
  groupPosition: row.groupPosition,
  operation: row.operation,
  input: row.input,
  effect: row.effect,
  target: { kind: row.targetKind, id: row.targetId },
  status: row.status,
  proposedByKeyId: row.proposedByKeyId,
  proposedByKeyName: row.proposedByKeyName,
  proposedByIssuerUserId: row.proposedByIssuerUserId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  decidedByUserId: row.decidedByUserId,
  decidedAt: row.decidedAt,
  decisionNote: row.decisionNote,
  appliedResourceId: row.appliedResourceId,
  failureCode: row.failureCode,
  failureMessage: row.failureMessage,
});

const parseEvent = (event: ChangeProposalEvent): ChangeProposalEvent => changeProposalEventSchema.parse(event);

export const boundedWrite = <T>(db: Db, bounds: ChangeProposalBounds, work: (tx: Db) => Promise<T>): Promise<ChangeProposalWrite<T>> =>
  busyAfterRollback(() => db.transaction(async (tx): Promise<ChangeProposalWrite<T>> => {
    await boundLockWait(tx, bounds);
    return { kind: 'written', value: await work(tx) };
  }), { kind: 'busy' } as const);

const appendChangeProposalEvent = async (
  executor: Db,
  tenantId: string,
  proposalId: string,
  kind: ChangeProposalEventKind,
  draft: ChangeProposalEventDraft,
): Promise<void> => {
  const [last] = await executor
    .select({ sequence: sql<number>`coalesce(max(${changeProposalEvents.sequence}), 0)::int` })
    .from(changeProposalEvents)
    .where(and(eq(changeProposalEvents.tenantId, tenantId), eq(changeProposalEvents.proposalId, proposalId)));
  const event = parseEvent({
    id: draft.id,
    tenantId,
    proposalId,
    sequence: (last?.sequence ?? 0) + 1,
    kind,
    actorUserId: draft.actorUserId,
    apiKeyId: draft.apiKeyId,
    note: draft.note,
    at: draft.at,
  });
  await executor.insert(changeProposalEvents).values(event);
};

const pendingAt = (now: string): SQL | undefined =>
  and(eq(changeProposals.status, 'pending'), gt(changeProposals.expiresAt, now));

const statusFilter = (query: ChangeProposalListQuery): SQL | undefined => {
  if (query.status === undefined) return undefined;
  if (query.status === 'pending') return pendingAt(query.now);
  if (query.status === CHANGE_PROPOSAL_DECIDED_FILTER) return or(ne(changeProposals.status, 'pending'), lte(changeProposals.expiresAt, query.now));
  if (query.status === 'expired') return and(eq(changeProposals.status, 'pending'), lte(changeProposals.expiresAt, query.now));
  return eq(changeProposals.status, query.status);
};

const guardFilter = (guard: ChangeProposalTransitionGuard): SQL[] => [
  ...(guard.keyId === undefined ? [] : [eq(changeProposals.proposedByKeyId, guard.keyId)]),
  ...(guard.unexpiredAt === undefined ? [] : [gt(changeProposals.expiresAt, guard.unexpiredAt)]),
];

const listPage = async (executor: Db, scope: SQL | undefined, query: ChangeProposalListQuery): Promise<ChangeProposalPage> => {
  const filtered = and(scope, statusFilter(query), query.groupId === undefined ? undefined : eq(changeProposals.groupId, query.groupId));
  const boundary = query.cursor === undefined
    ? undefined
    : (await executor
        .select({ id: changeProposals.id, createdAt: changeProposals.createdAt })
        .from(changeProposals)
        .where(and(scope, eq(changeProposals.id, query.cursor)))
        .limit(1))[0] ?? null;
  if (boundary === null) return { proposals: [], nextCursor: null };
  const rows = await executor
    .select()
    .from(changeProposals)
    .where(and(
      filtered,
      ...(boundary === undefined ? [] : [or(
        lt(changeProposals.createdAt, boundary.createdAt),
        and(eq(changeProposals.createdAt, boundary.createdAt), lt(changeProposals.id, boundary.id)),
      )]),
    ))
    .orderBy(desc(changeProposals.createdAt), desc(changeProposals.id))
    .limit(query.limit + 1);
  const proposals = rows.slice(0, query.limit).map(parseProposal);
  return { proposals, nextCursor: rows.length > query.limit ? proposals.at(-1)?.id ?? null : null };
};

const countProposals = async (executor: Db, where: SQL | undefined): Promise<number> => {
  const [row] = await executor.select({ total: count() }).from(changeProposals).where(where);
  return row?.total ?? 0;
};

export const keyAcceptsProposals = async (executor: Db, tenantId: string, keyId: string, now: string): Promise<boolean> => {
  const [key] = await executor
    .select({ id: shopManagementKeys.id })
    .from(shopManagementKeys)
    .where(and(
      eq(shopManagementKeys.tenantId, tenantId),
      eq(shopManagementKeys.id, keyId),
      eq(shopManagementKeys.mode, 'propose'),
      sql`${shopManagementKeys.revokedAt} is null`,
      gt(shopManagementKeys.expiresAt, now),
    ))
    .for('share');
  return key !== undefined;
};

const creationWindowStart = (now: string): string =>
  new Date(Date.parse(now) - CHANGE_PROPOSAL_LIMITS.creationWindowMs).toISOString();

export const countCapReached = async (executor: Db, tenantId: string, keyId: string, now: string): Promise<ChangeProposalCountCap | null> => {
  const workspace = eq(changeProposals.tenantId, tenantId);
  const byKey = and(workspace, eq(changeProposals.proposedByKeyId, keyId));
  if (await countProposals(executor, and(byKey, pendingAt(now))) >= CHANGE_PROPOSAL_LIMITS.pendingPerKey) return 'key_pending';
  if (await countProposals(executor, and(workspace, pendingAt(now))) >= CHANGE_PROPOSAL_LIMITS.pendingPerWorkspace) return 'workspace_pending';
  if (await countProposals(executor, and(byKey, gt(changeProposals.createdAt, creationWindowStart(now)))) >= CHANGE_PROPOSAL_LIMITS.createdPerKeyPerWindow) {
    return 'key_daily';
  }
  return null;
};

const lockPendingRow = async (
  executor: Db,
  tenantId: string,
  id: string,
  guard: ChangeProposalTransitionGuard,
): Promise<ChangeProposal | null> => {
  const [row] = await executor
    .select()
    .from(changeProposals)
    .where(and(
      eq(changeProposals.tenantId, tenantId),
      eq(changeProposals.id, id),
      eq(changeProposals.status, 'pending'),
      ...guardFilter(guard),
    ))
    .for('update');
  return row === undefined ? null : parseProposal(row);
};

export const insertProposal = async (
  executor: Db,
  tenantId: string,
  parsed: ChangeProposal,
  event: ChangeProposalEventDraft,
): Promise<ChangeProposal> => {
  const [row] = await executor.insert(changeProposals).values({
    id: parsed.id,
    tenantId,
    groupId: parsed.groupId,
    groupPosition: parsed.groupPosition,
    operation: parsed.operation,
    input: parsed.input,
    effect: parsed.effect,
    targetKind: parsed.target.kind,
    targetId: parsed.target.id,
    status: parsed.status,
    proposedByKeyId: parsed.proposedByKeyId,
    proposedByKeyName: parsed.proposedByKeyName,
    proposedByIssuerUserId: parsed.proposedByIssuerUserId,
    createdAt: parsed.createdAt,
    expiresAt: parsed.expiresAt,
    decidedByUserId: parsed.decidedByUserId,
    decidedAt: parsed.decidedAt,
    decisionNote: parsed.decisionNote,
    appliedResourceId: parsed.appliedResourceId,
    failureCode: parsed.failureCode,
    failureMessage: parsed.failureMessage,
  }).returning();
  if (row === undefined) throw new Error('Change proposal insert returned no row');
  await appendChangeProposalEvent(executor, tenantId, parsed.id, 'proposed', event);
  return parseProposal(row);
};

export const updateProposalStatus = async (
  executor: Db,
  tenantId: string,
  id: string,
  transition: ChangeProposalTransition,
): Promise<ChangeProposal | null> => {
  const [row] = await executor
    .update(changeProposals)
    .set({
      status: transition.status,
      decidedByUserId: transition.decidedByUserId,
      decidedAt: transition.decidedAt,
      decisionNote: transition.decisionNote,
      appliedResourceId: transition.appliedResourceId,
      failureCode: transition.failureCode,
      failureMessage: transition.failureMessage,
    })
    .where(and(eq(changeProposals.tenantId, tenantId), eq(changeProposals.id, id)))
    .returning();
  if (row === undefined) return null;
  const updated = parseProposal(row);
  await appendChangeProposalEvent(executor, tenantId, id, CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS[transition.status], transition.event);
  return updated;
};

export const recordProposalExpiry = async (
  executor: Db,
  tenantId: string,
  id: string,
  event: ChangeProposalEventDraft,
): Promise<boolean> => {
  const [row] = await executor
    .select({ id: changeProposals.id })
    .from(changeProposals)
    .where(and(
      eq(changeProposals.tenantId, tenantId),
      eq(changeProposals.id, id),
      eq(changeProposals.status, 'pending'),
      lte(changeProposals.expiresAt, event.at),
    ))
    .for('update');
  if (row === undefined) return false;
  const [recorded] = await executor
    .select({ id: changeProposalEvents.id })
    .from(changeProposalEvents)
    .where(and(
      eq(changeProposalEvents.tenantId, tenantId),
      eq(changeProposalEvents.proposalId, id),
      eq(changeProposalEvents.kind, 'expired'),
    ))
    .limit(1);
  if (recorded !== undefined) return false;
  await appendChangeProposalEvent(executor, tenantId, id, 'expired', event);
  return true;
};

export const withdrawPendingChangeProposalsOfKey = async (
  executor: Db,
  tenantId: string,
  keyId: string,
  reason: keyof typeof CHANGE_PROPOSAL_WITHDRAWAL_NOTES,
  withdrawal: ChangeProposalWithdrawal,
): Promise<void> => {
  const pending = await executor
    .select({ id: changeProposals.id })
    .from(changeProposals)
    .where(and(
      eq(changeProposals.tenantId, tenantId),
      eq(changeProposals.proposedByKeyId, keyId),
      pendingAt(withdrawal.at),
    ))
    .orderBy(asc(changeProposals.createdAt), asc(changeProposals.id))
    .for('update');
  for (const { id } of pending) {
    await executor
      .update(changeProposals)
      .set({ status: 'withdrawn', decidedByUserId: withdrawal.actorUserId, decidedAt: withdrawal.at })
      .where(and(eq(changeProposals.tenantId, tenantId), eq(changeProposals.id, id)));
    await appendChangeProposalEvent(executor, tenantId, id, 'withdrawn', {
      id: withdrawal.nextEventId(),
      actorUserId: withdrawal.actorUserId,
      apiKeyId: keyId,
      note: CHANGE_PROPOSAL_WITHDRAWAL_NOTES[reason],
      at: withdrawal.at,
    });
  }
};

const changeProposalRepositoryOver = (db: Db, bounds: ChangeProposalBounds): ChangeProposalRepository => ({
  create: async (tenantId, proposal, event, now, images = [], files = []) => {
    const parsed = changeProposalSchema.parse(proposal);
    if (parsed.tenantId !== tenantId) throw new Error('Change proposal belongs to another tenant');
    if (parsed.status !== 'pending') throw new Error('A new change proposal must be pending');
    if (!changeProposalEffectWithinLimit(parsed.effect)) return { kind: 'cap_exceeded', cap: 'effect_size' };
    return busyAfterRollback(() => db.transaction(async (tx): Promise<ChangeProposalCreation> => {
      if (!await lockWorkspaceProposals(tx, tenantId, bounds)) return { kind: 'busy' };
      if (!await keyAcceptsProposals(tx, tenantId, parsed.proposedByKeyId, now)) return { kind: 'key_inactive' };
      if (!await quarantinedImagesPresent(tx, tenantId, parsed.proposedByKeyId, images)) return { kind: 'image_missing' };
      if (!await holdProposedFiles(tx, tenantId, parsed.proposedByKeyId, files)) return { kind: 'file_unavailable' };
      const cap = await countCapReached(tx, tenantId, parsed.proposedByKeyId, now);
      if (cap !== null) return { kind: 'cap_exceeded', cap };
      const created = await insertProposal(tx, tenantId, parsed, event);
      await linkProposedFiles(tx, tenantId, parsed.proposedByKeyId, files, created.id);
      return { kind: 'created', proposal: created };
    }), { kind: 'busy' } as const);
  },
  countCapReached: (tenantId, keyId, now) => countCapReached(db, tenantId, keyId, now),
  findById: async (tenantId, id) => {
    const [row] = await db
      .select()
      .from(changeProposals)
      .where(and(eq(changeProposals.tenantId, tenantId), eq(changeProposals.id, id)))
      .limit(1);
    return row === undefined ? null : parseProposal(row);
  },
  list: (tenantId, query) => listPage(db, eq(changeProposals.tenantId, tenantId), query),
  findByKey: async (tenantId, keyId, id) => {
    const [row] = await db
      .select()
      .from(changeProposals)
      .where(and(
        eq(changeProposals.tenantId, tenantId),
        eq(changeProposals.proposedByKeyId, keyId),
        eq(changeProposals.id, id),
      ))
      .limit(1);
    return row === undefined ? null : parseProposal(row);
  },
  listByKey: (tenantId, keyId, query) =>
    listPage(db, and(eq(changeProposals.tenantId, tenantId), eq(changeProposals.proposedByKeyId, keyId)), query),
  lockPending: (tenantId, id, guard = {}) => db.transaction((tx) => lockPendingRow(tx, tenantId, id, guard)),
  transition: (tenantId, id, transition, guard = {}) => boundedWrite(db, bounds, async (tx) => {
    const locked = await lockPendingRow(tx, tenantId, id, guard);
    if (locked === null) return null;
    return updateProposalStatus(tx, tenantId, id, transition);
  }),
  decide: async (tenantId, id, guard, decide) => {
    const outcome = await boundedWrite(db, bounds, async (tx) => {
      const [row] = await tx
        .select()
        .from(changeProposals)
        .where(and(eq(changeProposals.tenantId, tenantId), eq(changeProposals.id, id), ...guardFilter(guard)))
        .for('update');
      if (row === undefined) return null;
      const locked = parseProposal(row);
      const decision = decide(locked);
      if (decision.kind === 'refuse') return { decision, proposal: locked };
      if (decision.kind === 'record_expiry') {
        await recordProposalExpiry(tx, tenantId, id, decision.event);
        return { decision, proposal: locked };
      }
      if (locked.status !== 'pending') throw new Error(`A decision moved change proposal ${id}, which is no longer pending`);
      const moved = await updateProposalStatus(tx, tenantId, id, decision.transition);
      if (moved === null) throw new Error(`Change proposal ${id} vanished while its row was locked`);
      return { decision, proposal: moved };
    });
    if (outcome.kind === 'busy') return outcome;
    return outcome.value === null ? { kind: 'not_found' } : { kind: 'decided', ...outcome.value };
  },
  recordExpiry: (tenantId, id, event) => boundedWrite(db, bounds, (tx) => recordProposalExpiry(tx, tenantId, id, event)),
  countPending: async (tenantId, now) => {
    const [row] = await db
      .select({
        proposals: count(),
        groups: sql<number>`count(distinct ${changeProposals.groupId})::int`,
      })
      .from(changeProposals)
      .where(and(eq(changeProposals.tenantId, tenantId), pendingAt(now)));
    return { proposals: row?.proposals ?? 0, groups: row?.groups ?? 0 };
  },
  hasAny: async (tenantId) => {
    const rows = await db
      .select({ id: changeProposals.id })
      .from(changeProposals)
      .where(eq(changeProposals.tenantId, tenantId))
      .limit(1);
    return rows.length > 0;
  },
});

export const createChangeProposalRepository = (db: Db, options: ChangeProposalBoundOptions = {}): ChangeProposalRepository =>
  changeProposalRepositoryOver(db, changeProposalBounds(options));

export const createChangeProposalEventRepository = (db: Db): ChangeProposalEventRepository => ({
  listByProposal: async (tenantId, proposalId) =>
    (await db
      .select()
      .from(changeProposalEvents)
      .where(and(eq(changeProposalEvents.tenantId, tenantId), eq(changeProposalEvents.proposalId, proposalId)))
      .orderBy(asc(changeProposalEvents.sequence))).map(parseEvent),
});

const idsOfKind = (targets: readonly ChangeProposalTargetLabelRequest[], kind: ChangeProposalTargetLabelRequest['kind']): string[] =>
  [...new Set(targets.filter((target) => target.kind === kind).map((target) => target.id))];

// Postgres binds at most 65,535 parameters per statement; a page of proposals can name more ids than that.
const IDS_PER_TITLE_QUERY = 10_000;

const inIdChunks = async <T>(ids: readonly string[], read: (chunk: string[]) => PromiseLike<T[]>): Promise<T[]> => {
  const found: T[] = [];
  for (let start = 0; start < ids.length; start += IDS_PER_TITLE_QUERY) found.push(...await read(ids.slice(start, start + IDS_PER_TITLE_QUERY)));
  return found;
};

export const createChangeProposalTargetLabelReader = (db: Db): ChangeProposalTargetLabelReader => ({
  labels: async (tenantId, targets) => {
    const productIds = idsOfKind(targets, 'product');
    const priceIds = idsOfKind(targets, 'price');
    const salesLinkIds = idsOfKind(targets, 'sales-link');
    const productRows = productIds.length === 0 ? [] : await db
      .select({ id: products.id, label: products.title })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)));
    const priceRows = priceIds.length === 0 ? [] : await db
      .select({
        id: productPrices.id,
        label: products.title,
        kind: productPrices.kind,
        interval: productPrices.interval,
        intervalCount: productPrices.intervalCount,
        amountCents: productPrices.amountCents,
        currency: productPrices.currency,
      })
      .from(productPrices)
      .innerJoin(products, and(eq(products.tenantId, productPrices.tenantId), eq(products.id, productPrices.productId)))
      .where(and(eq(productPrices.tenantId, tenantId), inArray(productPrices.id, priceIds)));
    const salesLinkRows = salesLinkIds.length === 0 ? [] : await db
      .select({ id: salesLinks.id, label: salesLinks.title })
      .from(salesLinks)
      .where(and(eq(salesLinks.tenantId, tenantId), inArray(salesLinks.id, salesLinkIds), isNull(salesLinks.deletedAt)));
    return [
      ...productRows.map((row) => ({ kind: 'product' as const, ...row, price: null })),
      ...priceRows.map(({ id, label, ...price }) => ({ kind: 'price' as const, id, label, price: changeProposalTargetPriceSchema.parse(price) })),
      ...salesLinkRows.map((row) => ({ kind: 'sales-link' as const, ...row, price: null })),
    ];
  },
  accessTitles: async (tenantId, ids) => ({
    courses: (await inIdChunks(ids.courseIds, (chunk) => db.select({ id: courses.id, title: courses.name, archivedAt: courses.archivedAt }).from(courses)
      .where(and(eq(courses.tenantId, tenantId), inArray(courses.id, chunk)))))
      .map((row) => ({ id: row.id, title: row.title, archived: row.archivedAt !== null })),
    modules: (await inIdChunks(ids.moduleIds, (chunk) => db.select({ id: courseModules.id, prefix: courseModules.prefix, title: courseModules.title })
      .from(courseModules)
      .where(and(eq(courseModules.tenantId, tenantId), inArray(courseModules.id, chunk)))))
      .map((row) => ({ id: row.id, title: computeCourseModuleName(row.prefix, row.title) })),
    lessons: await inIdChunks(ids.lessonIds, (chunk) => db.select({ id: courseLessons.id, title: courseLessons.name }).from(courseLessons)
      .where(and(eq(courseLessons.tenantId, tenantId), inArray(courseLessons.id, chunk)))),
  }),
});

const lockedRowExists = async (rows: PromiseLike<readonly unknown[]>): Promise<boolean> => (await rows).length > 0;

const lockProductForDeletion = async (db: Db, tenantId: string, productId: string): Promise<boolean> => {
  const product = and(eq(products.tenantId, tenantId), eq(products.id, productId));
  // Live stock writers lock the stock row before their event's foreign key takes a key-share lock on the product, while
  // live draft deletion and download writes lock the product first: a key-share-compatible product lock, then the stock
  // row, then the delete-strength product lock, then the rows those writers lock after the product follows both orders.
  const found = await lockedRowExists(db.select({ id: products.id }).from(products).where(product).for('no key update'));
  if (!found) return false;
  await db.select({ productId: productStock.productId }).from(productStock)
    .where(and(eq(productStock.tenantId, tenantId), eq(productStock.productId, productId))).for('update');
  await db.select({ id: products.id }).from(products).where(product).for('update');
  await db.select({ id: productPrices.id }).from(productPrices)
    .where(and(eq(productPrices.tenantId, tenantId), eq(productPrices.productId, productId))).for('update');
  await db.select({ id: productDownloadAssets.id }).from(productDownloadAssets)
    .where(and(eq(productDownloadAssets.tenantId, tenantId), eq(productDownloadAssets.productId, productId))).for('update');
  return true;
};

export const createChangeProposalTargetLocks = (db: Db): ChangeProposalTargetLocks => ({
  lock: async (tenantId, target, purpose = 'change') => {
    switch (target.kind) {
      case 'settings':
        return lockedRowExists(db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for('no key update'));
      case 'product': {
        if (target.id === null) return true;
        if (purpose === 'delete') return lockProductForDeletion(db, tenantId, target.id);
        if (purpose === 'files') return await lockProductFiles(db, tenantId, target.id) !== null;
        const found = await lockedRowExists(db.select({ id: products.id }).from(products)
          .where(and(eq(products.tenantId, tenantId), eq(products.id, target.id))).for('no key update'));
        if (found) {
          await db.select({ productId: productStock.productId }).from(productStock)
            .where(and(eq(productStock.tenantId, tenantId), eq(productStock.productId, target.id))).for('update');
        }
        return found;
      }
      case 'price':
        if (target.id === null) return false;
        return lockedRowExists(db.select({ id: productPrices.id }).from(productPrices)
          .where(and(eq(productPrices.tenantId, tenantId), eq(productPrices.id, target.id))).for('no key update'));
      case 'sales-link':
        // Sales-link writes take this workspace lock before their row lock; taking it first here keeps that order.
        await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`sales-links:${tenantId}`}, 0))`);
        if (target.id === null) return true;
        return lockedRowExists(db.select({ id: salesLinks.id }).from(salesLinks)
          .where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.id, target.id), isNull(salesLinks.deletedAt))).for('no key update'));
    }
  },
  lockCourses: async (tenantId, courseIds) => {
    await lockActiveCourses(db, tenantId, [...courseIds]);
  },
});
