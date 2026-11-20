import {
  changeProposalCapExceeded,
  changeProposalExpired,
  changeProposalExpiresAt,
  changeProposalIdInputSchema,
  changeProposalListInputSchema,
  changeProposalsBusy,
  err,
  forbidden,
  groupedChangeProposalDecisionRefused,
  notFound,
  ok,
  rejectChangeProposalInputSchema,
  submitChangeProposalInputSchema,
  toChangeProposalKeyReceipt,
  toChangeProposalOwnerDetail,
  toChangeProposalOwnerView,
  type AppError,
  type ChangeProposal,
  type ChangeProposalEffect,
  type ChangeProposalIdInput,
  type ChangeProposalKeyReceipt,
  type ChangeProposalKeyReceiptPage,
  type ChangeProposalListInput,
  type ChangeProposalOwnerDetail,
  type ChangeProposalOwnerPage,
  type ChangeProposalOwnerView,
  type RejectChangeProposalInput,
  type Result,
  type SubmitChangeProposalInput,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import {
  bothAuthorized,
  groupTitles,
  invalid,
  keyNamed,
  keyStates,
  outcomeFields,
  ownerSession,
  proposingKey,
  settledConflict,
} from '../change-proposal-access.js';
import type { Ctx } from '../context.js';
import type {
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalGroupRepository,
  ChangeProposalListQuery,
  ChangeProposalRepository,
  ChangeProposalTransaction,
  Clock,
  IdGenerator,
  ShopManagementKeyRepository,
} from '../ports.js';
import { applyLockedProposal, previewChangeProposal } from './change-proposal-apply.js';
import { CHANGE_PROPOSAL_OPERATIONS, type ChangeProposalRunDeps } from './change-proposal-operations.js';

export interface ChangeProposalSubmitDeps extends ChangeProposalRunDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  changeProposals: Pick<ChangeProposalRepository, 'create' | 'countCapReached'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
}

export interface ChangeProposalKeyDeps {
  changeProposals: Pick<ChangeProposalRepository, 'findByKey' | 'listByKey' | 'transition' | 'recordExpiry'>;
  ids: IdGenerator;
  clock: Clock;
}

export interface ChangeProposalOwnerReadDeps {
  changeProposals: Pick<ChangeProposalRepository, 'findById' | 'list'>;
  changeProposalEvents: ChangeProposalEventRepository;
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'listByIds'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  clock: Clock;
}

export interface ChangeProposalDecisionDeps {
  changeProposals: Pick<ChangeProposalRepository, 'findById' | 'transition' | 'recordExpiry'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  ids: IdGenerator;
  clock: Clock;
}

export interface ChangeProposalApprovalDeps extends ChangeProposalRunDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  changeProposals: Pick<ChangeProposalRepository, 'findById' | 'recordExpiry'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
}

const changeProposalListQuery = (input: ChangeProposalListInput, now: string): Result<ChangeProposalListQuery, AppError> => {
  const parsed = changeProposalListInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal list query', parsed.error);
  return ok({
    limit: parsed.data.limit,
    now,
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    ...(parsed.data.groupId === undefined ? {} : { groupId: parsed.data.groupId }),
  });
};

interface DryRunOutcome {
  effect: ChangeProposalEffect;
}

export const submitChangeProposal = async (
  ctx: Ctx,
  request: SubmitChangeProposalInput,
  deps: ChangeProposalSubmitDeps,
): Promise<Result<ChangeProposalKeyReceipt, AppError>> => {
  const parsedRequest = submitChangeProposalInputSchema.safeParse(request);
  if (!parsedRequest.success) return invalid('Invalid change proposal', parsedRequest.error);
  const operation = CHANGE_PROPOSAL_OPERATIONS[parsedRequest.data.operation];
  const key = proposingKey(ctx, operation.capability === 'proposal:submit:catalog'
    ? bothAuthorized(authorizeTenant(ctx, 'proposal:submit:catalog'), authorizeTenant(ctx, 'product:read'))
    : bothAuthorized(authorizeTenant(ctx, 'proposal:submit:settings'), authorizeTenant(ctx, 'tenant:settings:read')));
  if (!key.ok) return key;
  const { tenantId, keyId } = key.value;

  const prepared = operation.prepare(parsedRequest.data.input);
  if (!prepared.ok) return prepared;
  const { input, target } = prepared.value;
  const proposingKeyRow = keyNamed(await deps.shopManagementKeys.listByTenant(tenantId), keyId);
  if (proposingKeyRow === null) return err(forbidden('This shop management key can no longer propose changes'));
  const reachedCap = await deps.changeProposals.countCapReached(tenantId, keyId, deps.clock.nowIso());
  if (reachedCap !== null) return err(changeProposalCapExceeded(reachedCap));
  const ownerEquivalent: Ctx = { identity: ctx.identity };

  const dryRun = await deps.changeProposalTransaction.dryRun<DryRunOutcome>(tenantId, async (scope) => {
    const effect = await previewChangeProposal(prepared.value, tenantId, ownerEquivalent, scope, deps, null);
    return effect.ok ? ok({ effect: effect.value }) : effect;
  });
  if (!dryRun.ok) return dryRun;

  const now = deps.clock.nowIso();
  const proposal: ChangeProposal = {
    id: deps.ids.nextId(),
    tenantId,
    groupId: null,
    groupPosition: null,
    operation: parsedRequest.data.operation,
    input,
    effect: dryRun.value.effect,
    target,
    status: 'pending',
    proposedByKeyId: keyId,
    proposedByKeyName: proposingKeyRow.name,
    proposedByIssuerUserId: proposingKeyRow.issuedByUserId,
    createdAt: now,
    expiresAt: changeProposalExpiresAt(now),
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    appliedResourceId: null,
    failureCode: null,
    failureMessage: null,
  };
  const event: ChangeProposalEventDraft = { id: deps.ids.nextId(), actorUserId: null, apiKeyId: keyId, note: null, at: now };
  const created = await deps.changeProposals.create(tenantId, proposal, event, now);
  if (created.kind === 'cap_exceeded') return err(changeProposalCapExceeded(created.cap));
  if (created.kind === 'key_inactive') return err(forbidden('This shop management key can no longer propose changes'));
  if (created.kind === 'busy') return err(changeProposalsBusy());
  return ok(toChangeProposalKeyReceipt(created.proposal, now));
};

export const listOwnChangeProposals = async (
  ctx: Ctx,
  input: ChangeProposalListInput,
  deps: Pick<ChangeProposalKeyDeps, 'changeProposals' | 'clock'>,
): Promise<Result<ChangeProposalKeyReceiptPage, AppError>> => {
  const key = proposingKey(ctx, authorizeTenant(ctx, 'proposal:own:manage'));
  if (!key.ok) return key;
  const now = deps.clock.nowIso();
  const query = changeProposalListQuery(input, now);
  if (!query.ok) return query;
  const page = await deps.changeProposals.listByKey(key.value.tenantId, key.value.keyId, query.value);
  return ok({
    proposals: page.proposals.map((proposal) => toChangeProposalKeyReceipt(proposal, now)),
    nextCursor: page.nextCursor,
  });
};

export const getOwnChangeProposal = async (
  ctx: Ctx,
  input: ChangeProposalIdInput,
  deps: Pick<ChangeProposalKeyDeps, 'changeProposals' | 'clock'>,
): Promise<Result<ChangeProposalKeyReceipt, AppError>> => {
  const key = proposingKey(ctx, authorizeTenant(ctx, 'proposal:own:manage'));
  if (!key.ok) return key;
  const parsed = changeProposalIdInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal id', parsed.error);
  const proposal = await deps.changeProposals.findByKey(key.value.tenantId, key.value.keyId, parsed.data.id);
  if (proposal === null) return err(notFound(`No change proposal "${parsed.data.id}" for this key`));
  return ok(toChangeProposalKeyReceipt(proposal, deps.clock.nowIso()));
};

export const withdrawOwnChangeProposal = async (
  ctx: Ctx,
  input: ChangeProposalIdInput,
  deps: ChangeProposalKeyDeps,
): Promise<Result<ChangeProposalKeyReceipt, AppError>> => {
  const key = proposingKey(ctx, authorizeTenant(ctx, 'proposal:own:manage'));
  if (!key.ok) return key;
  const parsed = changeProposalIdInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal id', parsed.error);
  const { tenantId, keyId } = key.value;
  const id = parsed.data.id;
  const missing = notFound(`No change proposal "${id}" for this key`);
  const proposal = await deps.changeProposals.findByKey(tenantId, keyId, id);
  if (proposal === null) return err(missing);
  if (proposal.groupId !== null) return err(groupedChangeProposalDecisionRefused(proposal));
  const now = deps.clock.nowIso();
  if (proposal.status !== 'pending') return err(settledConflict(proposal, now));
  if (changeProposalExpired(proposal, now)) {
    await deps.changeProposals.recordExpiry(tenantId, id, { id: deps.ids.nextId(), actorUserId: null, apiKeyId: keyId, note: null, at: now });
    return err(settledConflict(proposal, now));
  }
  const withdrawn = await deps.changeProposals.transition(tenantId, id, {
    status: 'withdrawn',
    decidedByUserId: null,
    decidedAt: now,
    decisionNote: null,
    appliedResourceId: null,
    failureCode: null,
    failureMessage: null,
    event: { id: deps.ids.nextId(), actorUserId: null, apiKeyId: keyId, note: null, at: now },
  }, { keyId, unexpiredAt: now });
  if (withdrawn !== null) return ok(toChangeProposalKeyReceipt(withdrawn, now));
  const current = await deps.changeProposals.findByKey(tenantId, keyId, id);
  return err(current === null ? missing : settledConflict(current, now));
};

export const listChangeProposals = async (
  ctx: Ctx,
  input: ChangeProposalListInput,
  deps: Pick<ChangeProposalOwnerReadDeps, 'changeProposals' | 'changeProposalGroups' | 'shopManagementKeys' | 'clock'>,
): Promise<Result<ChangeProposalOwnerPage, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:read'));
  if (!tenant.ok) return tenant;
  const now = deps.clock.nowIso();
  const query = changeProposalListQuery(input, now);
  if (!query.ok) return query;
  const page = await deps.changeProposals.list(tenant.value, query.value);
  const stateOf = await keyStates(tenant.value, deps, now);
  const titleOf = await groupTitles(tenant.value, page.proposals, deps);
  const proposals: ChangeProposalOwnerView[] = page.proposals.map((proposal) => toChangeProposalOwnerView(proposal, stateOf(proposal), titleOf(proposal), now));
  return ok({ proposals, nextCursor: page.nextCursor });
};

export const getChangeProposal = async (
  ctx: Ctx,
  input: ChangeProposalIdInput,
  deps: ChangeProposalOwnerReadDeps,
): Promise<Result<ChangeProposalOwnerDetail, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:read'));
  if (!tenant.ok) return tenant;
  const parsed = changeProposalIdInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal id', parsed.error);
  const proposal = await deps.changeProposals.findById(tenant.value, parsed.data.id);
  if (proposal === null) return err(notFound(`No change proposal "${parsed.data.id}" in this workspace`));
  const now = deps.clock.nowIso();
  const stateOf = await keyStates(tenant.value, deps, now);
  const titleOf = await groupTitles(tenant.value, [proposal], deps);
  const events = await deps.changeProposalEvents.listByProposal(tenant.value, proposal.id);
  return ok(toChangeProposalOwnerDetail(proposal, stateOf(proposal), titleOf(proposal), events, now));
};

export const rejectChangeProposal = async (
  ctx: Ctx,
  input: RejectChangeProposalInput,
  deps: ChangeProposalDecisionDeps,
): Promise<Result<ChangeProposalOwnerView, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:decide'));
  if (!tenant.ok) return tenant;
  const parsed = rejectChangeProposalInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal rejection', parsed.error);
  const { id, note } = parsed.data;
  const missing = notFound(`No change proposal "${id}" in this workspace`);
  const proposal = await deps.changeProposals.findById(tenant.value, id);
  if (proposal === null) return err(missing);
  if (proposal.groupId !== null) return err(groupedChangeProposalDecisionRefused(proposal));
  const now = deps.clock.nowIso();
  const owner = ctx.identity.userId;
  if (proposal.status !== 'pending') return err(settledConflict(proposal, now));
  if (changeProposalExpired(proposal, now)) {
    await deps.changeProposals.recordExpiry(tenant.value, id, { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note: null, at: now });
    return err(settledConflict(proposal, now));
  }
  const rejected = await deps.changeProposals.transition(tenant.value, id, {
    status: 'rejected',
    decidedByUserId: owner,
    decidedAt: now,
    decisionNote: note,
    appliedResourceId: null,
    failureCode: null,
    failureMessage: null,
    event: { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note, at: now },
  }, { unexpiredAt: now });
  if (rejected !== null) return ok(toChangeProposalOwnerView(rejected, (await keyStates(tenant.value, deps, now))(rejected), null, now));
  const current = await deps.changeProposals.findById(tenant.value, id);
  return err(current === null ? missing : settledConflict(current, now));
};

type ApprovalDecision =
  | { kind: 'decided'; proposal: ChangeProposal; at: string }
  | { kind: 'expired'; proposal: ChangeProposal; at: string };

export const approveChangeProposal = async (
  ctx: Ctx,
  input: ChangeProposalIdInput,
  deps: ChangeProposalApprovalDeps,
): Promise<Result<ChangeProposalOwnerView, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:decide'));
  if (!tenant.ok) return tenant;
  const parsed = changeProposalIdInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal id', parsed.error);
  const tenantId = tenant.value;
  const { id } = parsed.data;
  const missing = notFound(`No change proposal "${id}" in this workspace`);
  const proposal = await deps.changeProposals.findById(tenantId, id);
  if (proposal === null) return err(missing);
  if (proposal.groupId !== null) return err(groupedChangeProposalDecisionRefused(proposal));
  const now = deps.clock.nowIso();
  const owner = ctx.identity.userId;
  if (proposal.status !== 'pending') return err(settledConflict(proposal, now));
  if (changeProposalExpired(proposal, now)) {
    await deps.changeProposals.recordExpiry(tenantId, id, { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note: null, at: now });
    return err(settledConflict(proposal, now));
  }
  const decided = await deps.changeProposalTransaction.run(tenantId, async (scope): Promise<Result<ApprovalDecision, AppError>> => {
    const proposals = scope.repositories.changeProposals;
    const locked = await proposals.lockPending(tenantId, id, { unexpiredAt: now });
    if (locked === null) {
      const current = await proposals.findById(tenantId, id);
      return err(current === null ? missing : settledConflict(current, deps.clock.nowIso()));
    }
    if (locked.groupId !== null) return err(groupedChangeProposalDecisionRefused(locked));
    const outcome = await applyLockedProposal(locked, ctx, scope, deps);
    if (outcome.status === 'expired') {
      await proposals.recordExpiry(tenantId, id, { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note: null, at: outcome.at });
      return ok({ kind: 'expired', proposal: locked, at: outcome.at });
    }
    const transitioned = await proposals.transition(tenantId, id, {
      ...outcomeFields(outcome),
      decidedByUserId: owner,
      decidedAt: outcome.at,
      decisionNote: null,
      event: { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note: outcome.status === 'stale' ? outcome.note : null, at: outcome.at },
    }, { unexpiredAt: outcome.at });
    if (transitioned === null) throw new Error(`Change proposal ${id} left pending while its row was locked`);
    return ok({ kind: 'decided', proposal: transitioned, at: outcome.at });
  });
  if (!decided.ok) return decided;
  if (decided.value.kind === 'expired') return err(settledConflict(decided.value.proposal, decided.value.at));
  const { proposal: decidedProposal, at } = decided.value;
  return ok(toChangeProposalOwnerView(decidedProposal, (await keyStates(tenantId, deps, at))(decidedProposal), null, at));
};
