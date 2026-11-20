import {
  appError,
  approveChangeProposalGroupInputSchema,
  CHANGE_PROPOSAL_GROUP_LIMITS,
  changeProposalCapExceeded,
  changeProposalExpiresAt,
  changeProposalGroupCapExceeded,
  changeProposalGroupConflict,
  changeProposalGroupItemNote,
  changeProposalGroupOpen,
  changeProposalGroupStatus,
  changeProposalIdInputSchema,
  changeProposalKeyState,
  changeProposalsBusy,
  checkChangeProposalReferences,
  createChangeProposalGroupInputSchema,
  err,
  forbidden,
  notFound,
  ok,
  rejectChangeProposalInputSchema,
  resolveChangeProposalReferences,
  submitGroupedChangeProposalInputSchema,
  toChangeProposalGroupKeyReceipt,
  toChangeProposalGroupOwnerView,
  toChangeProposalKeyReceipt,
  toChangeProposalOwnerDetail,
  type AppError,
  type ApproveChangeProposalGroupInput,
  type ChangeProposal,
  type ChangeProposalEffect,
  type ChangeProposalGroup,
  type ChangeProposalGroupKeyReceipt,
  type ChangeProposalGroupOwnerView,
  type ChangeProposalIdInput,
  type CreateChangeProposalGroupInput,
  type RejectChangeProposalInput,
  type Result,
  type SubmitGroupedChangeProposalInput,
  validation,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import {
  bothAuthorized,
  invalid,
  keyNamed,
  outcomeFields,
  ownerSession,
  proposingKey,
  type DecidedOutcome,
} from '../change-proposal-access.js';
import type { Ctx } from '../context.js';
import type {
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalGroupItemTransition,
  ChangeProposalGroupRepository,
  ChangeProposalGroupWithItems,
  ChangeProposalRepository,
  ChangeProposalTransaction,
  ChangeProposalTransition,
  ChangeProposalTransitionGuard,
  Clock,
  IdGenerator,
  ShopManagementKeyRepository,
} from '../ports.js';
import { applyLockedProposal, changeProposalGroupReferences, previewChangeProposal } from './change-proposal-apply.js';
import { CHANGE_PROPOSAL_OPERATIONS, type ChangeProposalRunDeps } from './change-proposal-operations.js';

export interface ChangeProposalGroupCreateDeps {
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'create'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  ids: IdGenerator;
  clock: Clock;
}

export interface ChangeProposalGroupSubmitDeps extends ChangeProposalRunDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  changeProposals: Pick<ChangeProposalRepository, 'countCapReached'>;
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findByKey' | 'addItem'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
}

export interface ChangeProposalGroupKeyDeps {
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findByKey' | 'transition' | 'recordExpiry' | 'deleteEmpty'>;
  ids: IdGenerator;
  clock: Clock;
}

export interface ChangeProposalGroupOwnerReadDeps {
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findById'>;
  changeProposalEvents: ChangeProposalEventRepository;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  clock: Clock;
}

export interface ChangeProposalGroupDecisionDeps extends ChangeProposalGroupOwnerReadDeps {
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findById' | 'transition' | 'recordExpiry'>;
  ids: IdGenerator;
}

export interface ChangeProposalGroupApprovalDeps extends ChangeProposalRunDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findById' | 'recordExpiry'>;
  changeProposalEvents: ChangeProposalEventRepository;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
}

const keyGroupMissing = (id: string): AppError => notFound(`No change proposal group "${id}" for this key`);

const ownerGroupMissing = (id: string): AppError => notFound(`No change proposal group "${id}" in this workspace`);

const keyReceipt = ({ group, items }: ChangeProposalGroupWithItems, now: string): ChangeProposalGroupKeyReceipt =>
  toChangeProposalGroupKeyReceipt(group, items, items.map((item) => toChangeProposalKeyReceipt(item, now)), now);

const ownerView = async (
  { group, items }: ChangeProposalGroupWithItems,
  deps: Pick<ChangeProposalGroupOwnerReadDeps, 'changeProposalEvents' | 'shopManagementKeys'>,
  now: string,
): Promise<ChangeProposalGroupOwnerView> => {
  const key = keyNamed(await deps.shopManagementKeys.listByTenant(group.tenantId), group.proposedByKeyId);
  const keyState = changeProposalKeyState(key, now);
  const first = items[0];
  const details = [];
  for (const item of items) {
    const events = await deps.changeProposalEvents.listByProposal(group.tenantId, item.id);
    details.push(toChangeProposalOwnerDetail(item, keyState, group.title, events, now));
  }
  return toChangeProposalGroupOwnerView(group, items, {
    keyName: key?.name ?? first?.proposedByKeyName ?? null,
    issuerUserId: key?.issuedByUserId ?? first?.proposedByIssuerUserId ?? null,
    keyState,
  }, details, now);
};

const everyItem = (
  items: readonly ChangeProposal[],
  transition: (item: ChangeProposal) => ChangeProposalTransition,
): ChangeProposalGroupItemTransition[] => items.map((item) => ({ id: item.id, transition: transition(item) }));

const expiryEvent = (ids: IdGenerator, at: string, actor: { actorUserId: string | null; apiKeyId: string | null }) =>
  (): ChangeProposalEventDraft => ({ id: ids.nextId(), ...actor, note: null, at });

export const createChangeProposalGroup = async (
  ctx: Ctx,
  input: CreateChangeProposalGroupInput,
  deps: ChangeProposalGroupCreateDeps,
): Promise<Result<ChangeProposalGroupKeyReceipt, AppError>> => {
  const key = proposingKey(ctx, authorizeTenant(ctx, 'proposal:own:manage'));
  if (!key.ok) return key;
  const parsed = createChangeProposalGroupInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal group', parsed.error);
  const { tenantId, keyId } = key.value;
  if (keyNamed(await deps.shopManagementKeys.listByTenant(tenantId), keyId) === null) {
    return err(forbidden('This shop management key can no longer propose changes'));
  }
  const now = deps.clock.nowIso();
  const group: ChangeProposalGroup = { id: deps.ids.nextId(), tenantId, title: parsed.data.title, proposedByKeyId: keyId, createdAt: now };
  const created = await deps.changeProposalGroups.create(tenantId, group, now);
  if (created.kind === 'cap_exceeded') return err(changeProposalGroupCapExceeded('key_open_groups'));
  if (created.kind === 'key_inactive') return err(forbidden('This shop management key can no longer propose changes'));
  if (created.kind === 'busy') return err(changeProposalsBusy());
  return ok(keyReceipt({ group: created.group, items: [] }, now));
};

const earlierItemNoLongerApplies = (item: ChangeProposal): AppError => appError(
  'conflict',
  `Item ${String(item.groupPosition ?? 0)} of this group no longer applies to the live state, so the group can no longer be applied as recorded; nothing was stored`,
  { changeProposalGroupItem: item.id },
);

const groupChanged = (): AppError =>
  appError('conflict', 'Another proposal joined this group meanwhile; nothing was stored, submit again');

export const submitGroupedChangeProposal = async (
  ctx: Ctx,
  request: SubmitGroupedChangeProposalInput,
  deps: ChangeProposalGroupSubmitDeps,
): Promise<Result<ChangeProposalGroupKeyReceipt, AppError>> => {
  const parsedRequest = submitGroupedChangeProposalInputSchema.safeParse(request);
  if (!parsedRequest.success) return invalid('Invalid change proposal', parsedRequest.error);
  const operationName = parsedRequest.data.operation;
  const operation = CHANGE_PROPOSAL_OPERATIONS[operationName];
  const key = proposingKey(ctx, operation.capability === 'proposal:submit:catalog'
    ? bothAuthorized(authorizeTenant(ctx, 'proposal:submit:catalog'), authorizeTenant(ctx, 'product:read'))
    : bothAuthorized(authorizeTenant(ctx, 'proposal:submit:settings'), authorizeTenant(ctx, 'tenant:settings:read')));
  if (!key.ok) return key;
  const { tenantId, keyId } = key.value;
  const { groupId } = parsedRequest.data;

  const prepared = operation.prepare(parsedRequest.data.input);
  if (!prepared.ok) return prepared;
  const proposingKeyRow = keyNamed(await deps.shopManagementKeys.listByTenant(tenantId), keyId);
  if (proposingKeyRow === null) return err(forbidden('This shop management key can no longer propose changes'));
  const current = await deps.changeProposalGroups.findByKey(tenantId, keyId, groupId);
  if (current === null) return err(keyGroupMissing(groupId));
  const earlier = current.items;
  const startedAt = deps.clock.nowIso();
  if (!changeProposalGroupOpen(current.group, earlier, startedAt)) return err(changeProposalGroupConflict(current.group, earlier, startedAt));
  if (earlier.length >= CHANGE_PROPOSAL_GROUP_LIMITS.itemsPerGroup) return err(changeProposalGroupCapExceeded('group_items'));
  const referencesChecked = checkChangeProposalReferences(operationName, parsedRequest.data.input, earlier);
  if (!referencesChecked.ok) return referencesChecked;
  const storedReferencesChecked = checkChangeProposalReferences(operationName, prepared.value.input, earlier);
  if (!storedReferencesChecked.ok) return storedReferencesChecked;
  const reachedCap = await deps.changeProposals.countCapReached(tenantId, keyId, startedAt);
  if (reachedCap !== null) return err(changeProposalCapExceeded(reachedCap));

  const proposalId = deps.ids.nextId();
  const ownerEquivalent: Ctx = { identity: ctx.identity };
  const dryRun = await deps.changeProposalTransaction.dryRun<ChangeProposalEffect>(tenantId, async (scope) => {
    const references = changeProposalGroupReferences();
    for (const [index, item] of earlier.entries()) {
      const outcome = await applyLockedProposal(item, ownerEquivalent, scope, deps, { earlier: earlier.slice(0, index), references });
      if (outcome.status !== 'applied') return err(earlierItemNoLongerApplies(item));
    }
    const resolved = resolveChangeProposalReferences(operationName, prepared.value.input, references.idOf);
    if (resolved === null) return err(validation('A proposal reference names an item that created nothing'));
    const runnable = operation.prepare(resolved);
    if (!runnable.ok) return runnable;
    return previewChangeProposal(runnable.value, tenantId, ownerEquivalent, scope, deps, { proposalId, operation: operationName, references });
  });
  if (!dryRun.ok) return dryRun;

  const now = deps.clock.nowIso();
  const proposal: ChangeProposal = {
    id: proposalId,
    tenantId,
    groupId,
    groupPosition: earlier.length + 1,
    operation: operationName,
    input: prepared.value.input,
    effect: dryRun.value,
    target: prepared.value.target,
    status: 'pending',
    proposedByKeyId: keyId,
    proposedByKeyName: proposingKeyRow.name,
    proposedByIssuerUserId: proposingKeyRow.issuedByUserId,
    createdAt: now,
    expiresAt: earlier[0]?.expiresAt ?? changeProposalExpiresAt(now),
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    appliedResourceId: null,
    failureCode: null,
    failureMessage: null,
  };
  const event: ChangeProposalEventDraft = { id: deps.ids.nextId(), actorUserId: null, apiKeyId: keyId, note: null, at: now };
  const added = await deps.changeProposalGroups.addItem(tenantId, proposal, event, now);
  switch (added.kind) {
    case 'created':
      return ok(keyReceipt({ group: current.group, items: [...earlier, added.proposal] }, now));
    case 'cap_exceeded':
      return err(changeProposalCapExceeded(added.cap));
    case 'key_inactive':
      return err(forbidden('This shop management key can no longer propose changes'));
    case 'busy':
      return err(changeProposalsBusy());
    case 'not_found':
      return err(keyGroupMissing(groupId));
    case 'group_closed':
      return err(changeProposalGroupConflict(added.current.group, added.current.items, now));
    case 'group_full':
      return err(changeProposalGroupCapExceeded('group_items'));
    case 'group_changed':
      return err(groupChanged());
  }
};

export const getOwnChangeProposalGroup = async (
  ctx: Ctx,
  input: ChangeProposalIdInput,
  deps: Pick<ChangeProposalGroupKeyDeps, 'changeProposalGroups' | 'clock'>,
): Promise<Result<ChangeProposalGroupKeyReceipt, AppError>> => {
  const key = proposingKey(ctx, authorizeTenant(ctx, 'proposal:own:manage'));
  if (!key.ok) return key;
  const parsed = changeProposalIdInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal group id', parsed.error);
  const found = await deps.changeProposalGroups.findByKey(key.value.tenantId, key.value.keyId, parsed.data.id);
  if (found === null) return err(keyGroupMissing(parsed.data.id));
  return ok(keyReceipt(found, deps.clock.nowIso()));
};

export const withdrawOwnChangeProposalGroup = async (
  ctx: Ctx,
  input: ChangeProposalIdInput,
  deps: ChangeProposalGroupKeyDeps,
): Promise<Result<ChangeProposalGroupKeyReceipt, AppError>> => {
  const key = proposingKey(ctx, authorizeTenant(ctx, 'proposal:own:manage'));
  if (!key.ok) return key;
  const parsed = changeProposalIdInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal group id', parsed.error);
  const { tenantId, keyId } = key.value;
  const { id } = parsed.data;
  const found = await deps.changeProposalGroups.findByKey(tenantId, keyId, id);
  if (found === null) return err(keyGroupMissing(id));
  const now = deps.clock.nowIso();
  if (found.items.length === 0) {
    if (!await deps.changeProposalGroups.deleteEmpty(tenantId, keyId, id)) return err(changeProposalGroupConflict(found.group, found.items, now));
    return ok({ ...keyReceipt(found, now), status: 'withdrawn' });
  }
  if (changeProposalGroupStatus(found.group, found.items, now) === 'expired') {
    await deps.changeProposalGroups.recordExpiry(tenantId, id, expiryEvent(deps.ids, now, { actorUserId: null, apiKeyId: keyId }));
  }
  if (!changeProposalGroupOpen(found.group, found.items, now)) return err(changeProposalGroupConflict(found.group, found.items, now));
  const guard: ChangeProposalTransitionGuard = { keyId, unexpiredAt: now };
  const withdrawn = await deps.changeProposalGroups.transition(tenantId, id, everyItem(found.items, () => ({
    status: 'withdrawn',
    decidedByUserId: null,
    decidedAt: now,
    decisionNote: null,
    appliedResourceId: null,
    failureCode: null,
    failureMessage: null,
    event: { id: deps.ids.nextId(), actorUserId: null, apiKeyId: keyId, note: null, at: now },
  })), guard);
  if (withdrawn !== null) return ok(keyReceipt({ group: found.group, items: withdrawn }, now));
  const current = await deps.changeProposalGroups.findByKey(tenantId, keyId, id);
  return err(current === null ? keyGroupMissing(id) : changeProposalGroupConflict(current.group, current.items, now));
};

export const getChangeProposalGroup = async (
  ctx: Ctx,
  input: ChangeProposalIdInput,
  deps: ChangeProposalGroupOwnerReadDeps,
): Promise<Result<ChangeProposalGroupOwnerView, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:read'));
  if (!tenant.ok) return tenant;
  const parsed = changeProposalIdInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal group id', parsed.error);
  const found = await deps.changeProposalGroups.findById(tenant.value, parsed.data.id);
  if (found === null) return err(ownerGroupMissing(parsed.data.id));
  return ok(await ownerView(found, deps, deps.clock.nowIso()));
};

export const rejectChangeProposalGroup = async (
  ctx: Ctx,
  input: RejectChangeProposalInput,
  deps: ChangeProposalGroupDecisionDeps,
): Promise<Result<ChangeProposalGroupOwnerView, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:decide'));
  if (!tenant.ok) return tenant;
  const parsed = rejectChangeProposalInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal group rejection', parsed.error);
  const tenantId = tenant.value;
  const { id, note } = parsed.data;
  const found = await deps.changeProposalGroups.findById(tenantId, id);
  if (found === null) return err(ownerGroupMissing(id));
  const now = deps.clock.nowIso();
  const owner = ctx.identity.userId;
  if (changeProposalGroupStatus(found.group, found.items, now) === 'expired') {
    await deps.changeProposalGroups.recordExpiry(tenantId, id, expiryEvent(deps.ids, now, { actorUserId: owner, apiKeyId: null }));
  }
  if (found.items.length === 0 || !changeProposalGroupOpen(found.group, found.items, now)) {
    return err(changeProposalGroupConflict(found.group, found.items, now));
  }
  const rejected = await deps.changeProposalGroups.transition(tenantId, id, everyItem(found.items, () => ({
    status: 'rejected',
    decidedByUserId: owner,
    decidedAt: now,
    decisionNote: note,
    appliedResourceId: null,
    failureCode: null,
    failureMessage: null,
    event: { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note, at: now },
  })), { unexpiredAt: now });
  if (rejected !== null) return ok(await ownerView({ group: found.group, items: rejected }, deps, now));
  const current = await deps.changeProposalGroups.findById(tenantId, id);
  return err(current === null ? ownerGroupMissing(id) : changeProposalGroupConflict(current.group, current.items, now));
};

const shownItemsDiffer = (items: readonly ChangeProposal[], itemIds: readonly string[]): boolean =>
  items.length !== itemIds.length || items.some((item, index) => item.id !== itemIds[index]);

const itemsChangedSinceShown = (items: readonly ChangeProposal[]): AppError => appError(
  'conflict',
  'The items of this group differ from the ones you were shown; nothing was applied, read the group again',
  { changeProposalGroupItemIds: items.map((item) => item.id) },
);

type GroupApprovalDecision =
  | { kind: 'decided'; items: ChangeProposal[]; at: string }
  | { kind: 'expired'; at: string };

interface GroupHalt {
  item: ChangeProposal;
  outcome: Exclude<Awaited<ReturnType<typeof applyLockedProposal>>, { status: 'applied' }>;
}

const decidedTransition = (outcome: DecidedOutcome, owner: string, at: string, note: string | null, eventId: string): ChangeProposalTransition => ({
  ...outcomeFields(outcome),
  decidedByUserId: owner,
  decidedAt: at,
  decisionNote: null,
  event: { id: eventId, actorUserId: owner, apiKeyId: null, note, at },
});

export const approveChangeProposalGroup = async (
  ctx: Ctx,
  input: ApproveChangeProposalGroupInput,
  deps: ChangeProposalGroupApprovalDeps,
): Promise<Result<ChangeProposalGroupOwnerView, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:decide'));
  if (!tenant.ok) return tenant;
  const parsed = approveChangeProposalGroupInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal group approval', parsed.error);
  const tenantId = tenant.value;
  const { id, itemIds } = parsed.data;
  const owner = ctx.identity.userId;
  const found = await deps.changeProposalGroups.findById(tenantId, id);
  if (found === null) return err(ownerGroupMissing(id));
  const now = deps.clock.nowIso();
  if (changeProposalGroupStatus(found.group, found.items, now) === 'expired') {
    await deps.changeProposalGroups.recordExpiry(tenantId, id, expiryEvent(deps.ids, now, { actorUserId: owner, apiKeyId: null }));
  }
  if (found.items.length === 0 || !changeProposalGroupOpen(found.group, found.items, now)) {
    return err(changeProposalGroupConflict(found.group, found.items, now));
  }
  if (shownItemsDiffer(found.items, itemIds)) return err(itemsChangedSinceShown(found.items));

  const decided = await deps.changeProposalTransaction.run(tenantId, async (scope): Promise<Result<GroupApprovalDecision, AppError>> => {
    const groups = scope.repositories.changeProposalGroups;
    const locked = await groups.lock(tenantId, id);
    if (locked === null) return err(ownerGroupMissing(id));
    const afterLock = deps.clock.nowIso();
    if (locked.items.some((item) => item.status !== 'pending')) return err(changeProposalGroupConflict(locked.group, locked.items, afterLock));
    if (shownItemsDiffer(locked.items, itemIds)) return err(itemsChangedSinceShown(locked.items));
    const references = changeProposalGroupReferences();
    const halted = appError('conflict', 'An item of the group did not apply');
    const halt: { current: GroupHalt | null } = { current: null };
    const applied = await scope.savepoint(async (nested) => {
      const outcomes: Array<{ item: ChangeProposal; appliedResourceId: string | null; at: string }> = [];
      for (const [index, item] of locked.items.entries()) {
        const outcome = await applyLockedProposal(item, ctx, nested, deps, { earlier: locked.items.slice(0, index), references });
        if (outcome.status !== 'applied') {
          halt.current = { item, outcome };
          return err(halted);
        }
        outcomes.push({ item, appliedResourceId: outcome.appliedResourceId, at: outcome.at });
      }
      return ok(outcomes);
    });
    if (!applied.ok && halt.current === null) return applied;
    const stop = halt.current;
    if (stop !== null && stop.outcome.status === 'expired') {
      await groups.recordExpiry(tenantId, id, expiryEvent(deps.ids, stop.outcome.at, { actorUserId: owner, apiKeyId: null }));
      return ok({ kind: 'expired', at: stop.outcome.at });
    }
    const transitions: ChangeProposalGroupItemTransition[] = [];
    let at = afterLock;
    if (applied.ok) {
      at = applied.value.at(-1)?.at ?? afterLock;
      for (const outcome of applied.value) {
        transitions.push({
          id: outcome.item.id,
          transition: decidedTransition({ status: 'applied', appliedResourceId: outcome.appliedResourceId, at }, owner, at, null, deps.ids.nextId()),
        });
      }
    } else if (stop !== null && stop.outcome.status !== 'expired') {
      const offending = stop.outcome;
      at = offending.at;
      for (const item of locked.items) {
        transitions.push({
          id: item.id,
          transition: item.id === stop.item.id
            ? decidedTransition(offending, owner, at, offending.status === 'stale' ? offending.note : null, deps.ids.nextId())
            : decidedTransition({ status: 'stale', note: null, at }, owner, at, changeProposalGroupItemNote(stop.item), deps.ids.nextId()),
        });
      }
    }
    const moved = await groups.transition(tenantId, id, transitions, { unexpiredAt: at });
    if (moved === null) throw new Error(`Change proposal group ${id} left pending while its rows were locked`);
    return ok({ kind: 'decided', items: moved, at });
  });
  if (!decided.ok) return decided;
  if (decided.value.kind === 'expired') {
    const current = await deps.changeProposalGroups.findById(tenantId, id);
    return err(changeProposalGroupConflict(found.group, current?.items ?? found.items, decided.value.at));
  }
  return ok(await ownerView({ group: found.group, items: decided.value.items }, deps, decided.value.at));
};
