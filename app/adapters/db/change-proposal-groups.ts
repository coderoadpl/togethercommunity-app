import { and, asc, count, eq, gt, inArray, lte, ne, or, sql } from 'drizzle-orm';

import {
  CHANGE_PROPOSAL_GROUP_LIMITS,
  changeProposalEffectWithinLimit,
  changeProposalGroupOpen,
  changeProposalGroupSchema,
  changeProposalLifetimeStart,
  changeProposalSchema,
  type ChangeProposal,
  type ChangeProposalGroup,
} from '#core/domain/index.js';
import type {
  ChangeProposalGroupCreation,
  ChangeProposalGroupItemAddition,
  ChangeProposalGroupRepository,
  ChangeProposalGroupWithItems,
  ChangeProposalTransitionGuard,
} from '#core/server/index.js';

import { busyAfterRollback, CHANGE_PROPOSAL_BOUNDS, type ChangeProposalBounds } from './change-proposal-bounds.js';
import {
  boundedWrite,
  countCapReached,
  insertProposal,
  keyAcceptsProposals,
  lockWorkspaceProposals,
  parseProposal,
  recordProposalExpiry,
  updateProposalStatus,
} from './change-proposals.js';
import type { Db } from './client.js';
import { changeProposalGroups, changeProposals } from './schema.js';

type ChangeProposalGroupRow = typeof changeProposalGroups.$inferSelect;

const parseGroup = (row: ChangeProposalGroupRow): ChangeProposalGroup => changeProposalGroupSchema.parse({
  id: row.id,
  tenantId: row.tenantId,
  title: row.title,
  proposedByKeyId: row.proposedByKeyId,
  createdAt: row.createdAt,
});

const groupRow = (tenantId: string, id: string, keyId?: string) => and(
  eq(changeProposalGroups.tenantId, tenantId),
  eq(changeProposalGroups.id, id),
  ...(keyId === undefined ? [] : [eq(changeProposalGroups.proposedByKeyId, keyId)]),
);

const itemsOf = async (executor: Db, tenantId: string, groupId: string): Promise<ChangeProposal[]> =>
  (await executor
    .select()
    .from(changeProposals)
    .where(and(eq(changeProposals.tenantId, tenantId), eq(changeProposals.groupId, groupId)))
    .orderBy(asc(changeProposals.groupPosition))).map(parseProposal);

const findGroup = async (executor: Db, tenantId: string, id: string, keyId?: string): Promise<ChangeProposalGroupWithItems | null> => {
  const [row] = await executor.select().from(changeProposalGroups).where(groupRow(tenantId, id, keyId)).limit(1);
  if (row === undefined) return null;
  return { group: parseGroup(row), items: await itemsOf(executor, tenantId, row.id) };
};

const lockGroup = async (executor: Db, tenantId: string, id: string, keyId?: string): Promise<ChangeProposalGroupWithItems | null> => {
  const [row] = await executor.select().from(changeProposalGroups).where(groupRow(tenantId, id, keyId)).for('update');
  if (row === undefined) return null;
  // Key revocation locks a key's pending proposals by creation time and id; taking the items in that order never deadlocks with it.
  await executor
    .select({ id: changeProposals.id })
    .from(changeProposals)
    .where(and(eq(changeProposals.tenantId, tenantId), eq(changeProposals.groupId, row.id)))
    .orderBy(asc(changeProposals.createdAt), asc(changeProposals.id))
    .for('update');
  return { group: parseGroup(row), items: await itemsOf(executor, tenantId, row.id) };
};

const countOpenGroups = async (executor: Db, tenantId: string, keyId: string, now: string): Promise<number> => {
  const items = and(eq(changeProposals.tenantId, changeProposalGroups.tenantId), eq(changeProposals.groupId, changeProposalGroups.id));
  const [row] = await executor
    .select({ total: count() })
    .from(changeProposalGroups)
    .where(and(
      eq(changeProposalGroups.tenantId, tenantId),
      eq(changeProposalGroups.proposedByKeyId, keyId),
      sql`not exists (${executor.select({ id: changeProposals.id }).from(changeProposals)
        .where(and(items, or(ne(changeProposals.status, 'pending'), lte(changeProposals.expiresAt, now))))})`,
      or(
        sql`exists (${executor.select({ id: changeProposals.id }).from(changeProposals).where(items)})`,
        gt(changeProposalGroups.createdAt, changeProposalLifetimeStart(now)),
      ),
    ));
  return row?.total ?? 0;
};

const sameItems = (items: readonly ChangeProposal[], ids: readonly string[]): boolean =>
  items.length === ids.length && items.every((item, index) => item.id === ids[index]);

const transitionable = (items: readonly ChangeProposal[], guard: ChangeProposalTransitionGuard): boolean =>
  items.every((item) => item.status === 'pending' && (guard.unexpiredAt === undefined || item.expiresAt > guard.unexpiredAt));

export const deleteEmptyGroupsOfKey = async (executor: Db, tenantId: string, keyId: string): Promise<void> => {
  const empty = await executor
    .select({ id: changeProposalGroups.id })
    .from(changeProposalGroups)
    .where(and(
      eq(changeProposalGroups.tenantId, tenantId),
      eq(changeProposalGroups.proposedByKeyId, keyId),
      sql`not exists (${executor.select({ id: changeProposals.id }).from(changeProposals)
        .where(and(eq(changeProposals.tenantId, changeProposalGroups.tenantId), eq(changeProposals.groupId, changeProposalGroups.id)))})`,
    ))
    .orderBy(asc(changeProposalGroups.createdAt), asc(changeProposalGroups.id))
    .for('update');
  if (empty.length === 0) return;
  await executor.delete(changeProposalGroups).where(and(
    eq(changeProposalGroups.tenantId, tenantId),
    inArray(changeProposalGroups.id, empty.map((group) => group.id)),
  ));
};

export const createChangeProposalGroupRepository = (db: Db, bounds: ChangeProposalBounds = CHANGE_PROPOSAL_BOUNDS): ChangeProposalGroupRepository => ({
  create: async (tenantId, group, now) => {
    const parsed = changeProposalGroupSchema.parse(group);
    if (parsed.tenantId !== tenantId) throw new Error('Change proposal group belongs to another tenant');
    return busyAfterRollback(() => db.transaction(async (tx): Promise<ChangeProposalGroupCreation> => {
      if (!await lockWorkspaceProposals(tx, tenantId, bounds)) return { kind: 'busy' };
      if (!await keyAcceptsProposals(tx, tenantId, parsed.proposedByKeyId, now)) return { kind: 'key_inactive' };
      if (await countOpenGroups(tx, tenantId, parsed.proposedByKeyId, now) >= CHANGE_PROPOSAL_GROUP_LIMITS.openGroupsPerKey) {
        return { kind: 'cap_exceeded' };
      }
      const [row] = await tx.insert(changeProposalGroups).values(parsed).returning();
      if (row === undefined) throw new Error('Change proposal group insert returned no row');
      return { kind: 'created', group: parseGroup(row) };
    }), { kind: 'busy' } as const);
  },
  findById: (tenantId, id) => findGroup(db, tenantId, id),
  findByKey: (tenantId, keyId, id) => findGroup(db, tenantId, id, keyId),
  listByIds: async (tenantId, ids) => ids.length === 0
    ? []
    : (await db.select().from(changeProposalGroups)
        .where(and(eq(changeProposalGroups.tenantId, tenantId), inArray(changeProposalGroups.id, [...ids])))).map(parseGroup),
  addItem: async (tenantId, proposal, event, clock) => {
    const parsed = changeProposalSchema.parse(proposal);
    if (parsed.tenantId !== tenantId) throw new Error('Change proposal belongs to another tenant');
    if (parsed.status !== 'pending') throw new Error('A new change proposal must be pending');
    if (parsed.groupId === null || parsed.groupPosition === null) throw new Error('A grouped change proposal needs its group and position');
    const { groupId, groupPosition } = parsed;
    if (!changeProposalEffectWithinLimit(parsed.effect)) return { kind: 'cap_exceeded', cap: 'effect_size' };
    return busyAfterRollback(() => db.transaction(async (tx): Promise<ChangeProposalGroupItemAddition> => {
      if (!await lockWorkspaceProposals(tx, tenantId, bounds)) return { kind: 'busy' };
      if (!await keyAcceptsProposals(tx, tenantId, parsed.proposedByKeyId, clock.nowIso())) return { kind: 'key_inactive' };
      const current = await lockGroup(tx, tenantId, groupId, parsed.proposedByKeyId);
      if (current === null) return { kind: 'not_found' };
      const now = clock.nowIso();
      if (!changeProposalGroupOpen(current.group, current.items, now)) return { kind: 'group_closed', current, at: now };
      if (current.items.length >= CHANGE_PROPOSAL_GROUP_LIMITS.itemsPerGroup) return { kind: 'group_full' };
      const first = current.items[0];
      if (current.items.length + 1 !== groupPosition || (first !== undefined && first.expiresAt !== parsed.expiresAt)) {
        return { kind: 'group_changed' };
      }
      const cap = await countCapReached(tx, tenantId, parsed.proposedByKeyId, now);
      if (cap !== null) return { kind: 'cap_exceeded', cap };
      return { kind: 'created', proposal: await insertProposal(tx, tenantId, parsed, event) };
    }), { kind: 'busy' } as const);
  },
  lock: (tenantId, id) => lockGroup(db, tenantId, id),
  decide: async (tenantId, id, guard, decide) => {
    const outcome = await boundedWrite(db, bounds, async (tx) => {
      const locked = await lockGroup(tx, tenantId, id, guard.keyId);
      if (locked === null) return null;
      const decision = decide(locked);
      if (decision.kind === 'refuse') return { decision, ...locked };
      if (decision.kind === 'record_expiry') {
        for (const item of locked.items) await recordProposalExpiry(tx, tenantId, item.id, decision.event(item.id));
        return { decision, ...locked };
      }
      if (!sameItems(locked.items, decision.transitions.map((entry) => entry.id))) {
        throw new Error(`A decision on change proposal group ${id} named other items than the locked ones`);
      }
      const items: ChangeProposal[] = [];
      for (const { id: proposalId, transition } of decision.transitions) {
        const moved = await updateProposalStatus(tx, tenantId, proposalId, transition);
        if (moved === null) throw new Error(`Change proposal ${proposalId} vanished while its group was locked`);
        items.push(moved);
      }
      return { decision, group: locked.group, items };
    });
    if (outcome.kind === 'busy') return outcome;
    return outcome.value === null ? { kind: 'not_found' } : { kind: 'decided', ...outcome.value };
  },
  transition: (tenantId, id, transitions, guard = {}) => db.transaction(async (tx) => {
    const locked = await lockGroup(tx, tenantId, id, guard.keyId);
    if (locked === null || locked.items.length === 0) return null;
    if (!sameItems(locked.items, transitions.map((entry) => entry.id)) || !transitionable(locked.items, guard)) return null;
    const updated: ChangeProposal[] = [];
    for (const { id: proposalId, transition } of transitions) {
      const moved = await updateProposalStatus(tx, tenantId, proposalId, transition);
      if (moved === null) throw new Error(`Change proposal ${proposalId} vanished while its group was locked`);
      updated.push(moved);
    }
    return updated;
  }),
  recordExpiry: (tenantId, id, event) => boundedWrite(db, bounds, async (tx) => {
    const locked = await lockGroup(tx, tenantId, id);
    if (locked === null) return false;
    let recorded = false;
    for (const item of locked.items) {
      if (await recordProposalExpiry(tx, tenantId, item.id, event(item.id))) recorded = true;
    }
    return recorded;
  }),
  deleteEmpty: (tenantId, keyId, id) => boundedWrite(db, bounds, async (tx) => {
    const locked = await lockGroup(tx, tenantId, id, keyId);
    if (locked === null || locked.items.length > 0) return false;
    const deleted = await tx.delete(changeProposalGroups).where(groupRow(tenantId, id, keyId)).returning({ id: changeProposalGroups.id });
    return deleted.length > 0;
  }),
});
