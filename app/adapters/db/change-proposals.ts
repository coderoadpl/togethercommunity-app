import { and, asc, count, desc, eq, gt, lt, lte, or, sql, type SQL } from 'drizzle-orm';

import {
  CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS,
  CHANGE_PROPOSAL_LIMITS,
  CHANGE_PROPOSAL_WITHDRAWAL_NOTES,
  changeProposalEffectWithinLimit,
  changeProposalEventSchema,
  changeProposalSchema,
  type ChangeProposal,
  type ChangeProposalEvent,
  type ChangeProposalEventKind,
} from '#core/domain/index.js';
import type {
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalListQuery,
  ChangeProposalPage,
  ChangeProposalRepository,
  ChangeProposalTargetLocks,
  ChangeProposalTransitionGuard,
  ChangeProposalWithdrawalEvent,
} from '#core/server/index.js';

import type { Db } from './client.js';
import {
  changeProposalEvents,
  changeProposals,
  productPrices,
  products,
  productStock,
  salesLinks,
  shopManagementKeys,
  tenants,
} from './schema.js';

type ChangeProposalRow = typeof changeProposals.$inferSelect;

const parseProposal = (row: ChangeProposalRow): ChangeProposal => changeProposalSchema.parse({
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

const lockWorkspaceProposals = async (executor: Db, tenantId: string): Promise<void> => {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`change-proposals:${tenantId}`}, 0))`);
};

const appendEvent = async (
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
  if (query.status === 'expired') return and(eq(changeProposals.status, 'pending'), lte(changeProposals.expiresAt, query.now));
  return eq(changeProposals.status, query.status);
};

const guardFilter = (guard: ChangeProposalTransitionGuard): SQL[] => [
  ...(guard.keyId === undefined ? [] : [eq(changeProposals.proposedByKeyId, guard.keyId)]),
  ...(guard.unexpiredAt === undefined ? [] : [gt(changeProposals.expiresAt, guard.unexpiredAt)]),
];

const listPage = async (executor: Db, scope: SQL | undefined, query: ChangeProposalListQuery): Promise<ChangeProposalPage> => {
  const filtered = and(scope, statusFilter(query));
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

const keyAcceptsProposals = async (executor: Db, tenantId: string, keyId: string, now: string): Promise<boolean> => {
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

export const withdrawPendingChangeProposalsOfKey = async (
  executor: Db,
  tenantId: string,
  keyId: string,
  reason: keyof typeof CHANGE_PROPOSAL_WITHDRAWAL_NOTES,
  event: ChangeProposalWithdrawalEvent,
): Promise<void> => {
  const pending = await executor
    .select({ id: changeProposals.id })
    .from(changeProposals)
    .where(and(
      eq(changeProposals.tenantId, tenantId),
      eq(changeProposals.proposedByKeyId, keyId),
      eq(changeProposals.status, 'pending'),
    ))
    .orderBy(asc(changeProposals.createdAt), asc(changeProposals.id))
    .for('update');
  for (const { id } of pending) {
    const draft = event(id);
    await executor
      .update(changeProposals)
      .set({ status: 'withdrawn', decidedByUserId: draft.actorUserId, decidedAt: draft.at })
      .where(and(eq(changeProposals.tenantId, tenantId), eq(changeProposals.id, id)));
    await appendEvent(executor, tenantId, id, 'withdrawn', {
      id: draft.id,
      actorUserId: draft.actorUserId,
      apiKeyId: keyId,
      note: CHANGE_PROPOSAL_WITHDRAWAL_NOTES[reason],
      at: draft.at,
    });
  }
};

export const createChangeProposalRepository = (db: Db): ChangeProposalRepository => ({
  create: async (tenantId, proposal, event, now) => {
    const parsed = changeProposalSchema.parse(proposal);
    if (parsed.tenantId !== tenantId) throw new Error('Change proposal belongs to another tenant');
    if (parsed.status !== 'pending') throw new Error('A new change proposal must be pending');
    if (!changeProposalEffectWithinLimit(parsed.effect)) return { kind: 'cap_exceeded', cap: 'effect_size' };
    return db.transaction(async (tx) => {
      await lockWorkspaceProposals(tx, tenantId);
      if (!await keyAcceptsProposals(tx, tenantId, parsed.proposedByKeyId, now)) return { kind: 'key_inactive' };
      const workspace = eq(changeProposals.tenantId, tenantId);
      const byKey = and(workspace, eq(changeProposals.proposedByKeyId, parsed.proposedByKeyId));
      if (await countProposals(tx, and(byKey, pendingAt(now))) >= CHANGE_PROPOSAL_LIMITS.pendingPerKey) {
        return { kind: 'cap_exceeded', cap: 'key_pending' };
      }
      if (await countProposals(tx, and(workspace, pendingAt(now))) >= CHANGE_PROPOSAL_LIMITS.pendingPerWorkspace) {
        return { kind: 'cap_exceeded', cap: 'workspace_pending' };
      }
      if (await countProposals(tx, and(byKey, gt(changeProposals.createdAt, creationWindowStart(now)))) >= CHANGE_PROPOSAL_LIMITS.createdPerKeyPerWindow) {
        return { kind: 'cap_exceeded', cap: 'key_daily' };
      }
      const [row] = await tx.insert(changeProposals).values({
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
      await appendEvent(tx, tenantId, parsed.id, 'proposed', event);
      return { kind: 'created', proposal: parseProposal(row) };
    });
  },
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
  transition: (tenantId, id, transition, guard = {}) => db.transaction(async (tx) => {
    const locked = await lockPendingRow(tx, tenantId, id, guard);
    if (locked === null) return null;
    const [row] = await tx
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
    await appendEvent(tx, tenantId, id, CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS[transition.status], transition.event);
    return updated;
  }),
  recordExpiry: (tenantId, id, event) => db.transaction(async (tx) => {
    const [row] = await tx
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
    const [recorded] = await tx
      .select({ id: changeProposalEvents.id })
      .from(changeProposalEvents)
      .where(and(
        eq(changeProposalEvents.tenantId, tenantId),
        eq(changeProposalEvents.proposalId, id),
        eq(changeProposalEvents.kind, 'expired'),
      ))
      .limit(1);
    if (recorded !== undefined) return false;
    await appendEvent(tx, tenantId, id, 'expired', event);
    return true;
  }),
});

export const createChangeProposalEventRepository = (db: Db): ChangeProposalEventRepository => ({
  listByProposal: async (tenantId, proposalId) =>
    (await db
      .select()
      .from(changeProposalEvents)
      .where(and(eq(changeProposalEvents.tenantId, tenantId), eq(changeProposalEvents.proposalId, proposalId)))
      .orderBy(asc(changeProposalEvents.sequence))).map(parseEvent),
});

const lockedRowExists = async (rows: PromiseLike<readonly unknown[]>): Promise<boolean> => (await rows).length > 0;

export const createChangeProposalTargetLocks = (db: Db): ChangeProposalTargetLocks => ({
  lock: async (tenantId, target) => {
    switch (target.kind) {
      case 'settings':
        return lockedRowExists(db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for('update'));
      case 'product': {
        if (target.id === null) return true;
        const found = await lockedRowExists(db.select({ id: products.id }).from(products)
          .where(and(eq(products.tenantId, tenantId), eq(products.id, target.id))).for('update'));
        if (found) {
          await db.select({ productId: productStock.productId }).from(productStock)
            .where(and(eq(productStock.tenantId, tenantId), eq(productStock.productId, target.id))).for('update');
        }
        return found;
      }
      case 'price':
        if (target.id === null) return false;
        return lockedRowExists(db.select({ id: productPrices.id }).from(productPrices)
          .where(and(eq(productPrices.tenantId, tenantId), eq(productPrices.id, target.id))).for('update'));
      case 'sales-link':
        if (target.id === null) return true;
        return lockedRowExists(db.select({ id: salesLinks.id }).from(salesLinks)
          .where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.id, target.id))).for('update'));
    }
  },
});
