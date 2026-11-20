import {
  appError,
  changeProposalCapExceeded,
  changeProposalDisplayStatus,
  changeProposalExpired,
  changeProposalExpiresAt,
  changeProposalIdInputSchema,
  changeProposalKeyState,
  changeProposalListInputSchema,
  err,
  forbidden,
  notFound,
  ok,
  rejectChangeProposalInputSchema,
  submitChangeProposalInputSchema,
  toChangeProposalKeyReceipt,
  toChangeProposalOwnerDetail,
  toChangeProposalOwnerView,
  validation,
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
  type ShopManagementKey,
  type SubmitChangeProposalInput,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { ownerSessionTenant } from '../owner-session.js';
import type {
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalListQuery,
  ChangeProposalRepository,
  ChangeProposalTransaction,
  Clock,
  IdGenerator,
  ShopManagementKeyRepository,
} from '../ports.js';
import { CHANGE_PROPOSAL_OPERATIONS, type ChangeProposalRunDeps } from './change-proposal-operations.js';

export interface ChangeProposalSubmitDeps extends ChangeProposalRunDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  changeProposals: Pick<ChangeProposalRepository, 'create'>;
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
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  clock: Clock;
}

export interface ChangeProposalDecisionDeps {
  changeProposals: Pick<ChangeProposalRepository, 'findById' | 'transition' | 'recordExpiry'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  ids: IdGenerator;
  clock: Clock;
}

interface ProposingKey {
  tenantId: string;
  keyId: string;
}

const proposingKey = (ctx: Ctx, tenant: Result<string, AppError>): Result<ProposingKey, AppError> => {
  if (!tenant.ok) return tenant;
  const actor = ctx.machineActor;
  if (actor?.kind !== 'shop_management_key' || actor.mode !== 'propose' || ctx.capabilities === undefined || ctx.impersonation !== undefined) {
    return err(forbidden('Change proposals are made only with a propose-mode shop management key'));
  }
  return ok({ tenantId: tenant.value, keyId: actor.apiKeyId });
};

const ownerSession = (ctx: Ctx, tenant: Result<string, AppError>): Result<string, AppError> =>
  ownerSessionTenant(ctx, tenant, 'Change proposals are decided only by a verified owner in their own session');

const invalid = (message: string, error: { flatten(): unknown }): Result<never, AppError> =>
  err(validation(message, error.flatten()));

const settledConflict = (proposal: ChangeProposal, now: string): AppError => {
  const status = changeProposalDisplayStatus(proposal, now);
  return appError('conflict', `This change proposal is ${status}, not pending`, { changeProposalStatus: status });
};

const listQuery = (input: ChangeProposalListInput, now: string): Result<ChangeProposalListQuery, AppError> => {
  const parsed = changeProposalListInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal list query', parsed.error);
  return ok({
    limit: parsed.data.limit,
    now,
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
};

const keyNamed = (keys: readonly ShopManagementKey[], keyId: string): ShopManagementKey | null =>
  keys.find((key) => key.id === keyId) ?? null;

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
    ? authorizeTenant(ctx, 'proposal:submit:catalog')
    : authorizeTenant(ctx, 'proposal:submit:settings'));
  if (!key.ok) return key;
  const { tenantId, keyId } = key.value;

  const prepared = operation.prepare(parsedRequest.data.input);
  if (!prepared.ok) return prepared;
  const { input, target } = prepared.value;
  const proposingKeyRow = keyNamed(await deps.shopManagementKeys.listByTenant(tenantId), keyId);
  if (proposingKeyRow === null) return err(forbidden('This shop management key can no longer propose changes'));
  const ownerEquivalent: Ctx = { identity: ctx.identity };

  const dryRun = await deps.changeProposalTransaction.dryRun<DryRunOutcome>(tenantId, async (scope) => {
    await scope.repositories.targets.lock(tenantId, target);
    const before = await prepared.value.snapshot(scope.repositories, tenantId, target.id);
    const ran = await prepared.value.run(ownerEquivalent, scope, deps);
    if (!ran.ok) return ran;
    const after = await prepared.value.snapshot(scope.repositories, tenantId, ran.value ?? target.id);
    return ok({ effect: prepared.value.effect(before, after) });
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
  const query = listQuery(input, now);
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

const keyStates = async (
  tenantId: string,
  deps: Pick<ChangeProposalOwnerReadDeps, 'shopManagementKeys'>,
  now: string,
): Promise<(proposal: ChangeProposal) => ReturnType<typeof changeProposalKeyState>> => {
  const keys = await deps.shopManagementKeys.listByTenant(tenantId);
  return (proposal) => changeProposalKeyState(keyNamed(keys, proposal.proposedByKeyId), now);
};

export const listChangeProposals = async (
  ctx: Ctx,
  input: ChangeProposalListInput,
  deps: Pick<ChangeProposalOwnerReadDeps, 'changeProposals' | 'shopManagementKeys' | 'clock'>,
): Promise<Result<ChangeProposalOwnerPage, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:read'));
  if (!tenant.ok) return tenant;
  const now = deps.clock.nowIso();
  const query = listQuery(input, now);
  if (!query.ok) return query;
  const page = await deps.changeProposals.list(tenant.value, query.value);
  const stateOf = await keyStates(tenant.value, deps, now);
  const proposals: ChangeProposalOwnerView[] = page.proposals.map((proposal) => toChangeProposalOwnerView(proposal, stateOf(proposal), now));
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
  const events = await deps.changeProposalEvents.listByProposal(tenant.value, proposal.id);
  return ok(toChangeProposalOwnerDetail(proposal, stateOf(proposal), events, now));
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
  if (rejected !== null) return ok(toChangeProposalOwnerView(rejected, (await keyStates(tenant.value, deps, now))(rejected), now));
  const current = await deps.changeProposals.findById(tenant.value, id);
  return err(current === null ? missing : settledConflict(current, now));
};
