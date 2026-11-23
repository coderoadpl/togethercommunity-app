import {
  changeProposalFileMissingNote,
  changeProposalFileUnavailable,
  changeProposalImageMissingNote,
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
  type ChangeProposalSummary,
  type RejectChangeProposalInput,
  type Result,
  type SubmitChangeProposalInput,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import {
  type ApprovalOutcome,
  bothAuthorized,
  invalid,
  keyNamed,
  outcomeFields,
  ownerSession,
  proposingKey,
  settledConflict,
} from '../change-proposal-access.js';
import { notifyOwnersOfProposal, type ChangeProposalNotifyDeps } from '../change-proposal-notifications.js';
import { changeProposalOwnerFacts, type ChangeProposalOwnerViewDeps } from '../change-proposal-owner-facts.js';
import type { Ctx } from '../context.js';
import type { KeyDownloadFileRepository } from '../key-download-ports.js';
import type {
  ChangeProposalDecision,
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalListQuery,
  ChangeProposalRepository,
  ChangeProposalTransaction,
  ChangeProposalTransition,
  Clock,
  IdGenerator,
  QuarantinedImageRepository,
  ShopManagementKeyRepository,
} from '../ports.js';
import { applyLockedProposal, previewChangeProposal } from './change-proposal-apply.js';
import {
  checkApprovalFiles,
  checkProposedFiles,
  fileRefusalAfterDryRun,
  prepareApprovalFiles,
  releaseFilesOfProposals,
  type ChangeProposalFileApprovalDeps,
  type ChangeProposalFileReleaseDeps,
  type ProposedFileCheckDeps,
} from './change-proposal-files.js';
import {
  changeProposalImageGone,
  checkProposedImages,
  prepareApprovalImages,
  noApprovalImageWrites,
  publishApprovalImages,
  recordApprovalPublications,
  releaseImagesOfProposals,
  withdrawPublishedImages,
  type ChangeProposalImagePublishDeps,
  type ChangeProposalImageReleaseDeps,
  type ProposedImageCheckDeps,
} from './change-proposal-images.js';
import { CHANGE_PROPOSAL_OPERATIONS, type ChangeProposalRunDeps } from './change-proposal-operations.js';

export interface ChangeProposalSubmitDeps extends ChangeProposalRunDeps, ChangeProposalNotifyDeps, ProposedImageCheckDeps, ProposedFileCheckDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  changeProposals: Pick<ChangeProposalRepository, 'create' | 'countCapReached'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
}

export interface ChangeProposalKeyDeps {
  changeProposals: Pick<ChangeProposalRepository, 'findByKey' | 'listByKey' | 'decide'>;
  ids: IdGenerator;
  clock: Clock;
}

export type ChangeProposalWithdrawDeps = ChangeProposalKeyDeps & ChangeProposalImageReleaseDeps & ChangeProposalFileReleaseDeps;

export interface ChangeProposalOwnerReadDeps extends ChangeProposalOwnerViewDeps {
  changeProposals: Pick<ChangeProposalRepository, 'findById' | 'list'>;
  changeProposalEvents: ChangeProposalEventRepository;
  clock: Clock;
}

export interface ChangeProposalDecisionDeps extends ChangeProposalOwnerViewDeps, ChangeProposalImageReleaseDeps, ChangeProposalFileReleaseDeps {
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'listProposed' | 'release' | 'finishDeletion'>;
  changeProposals: Pick<ChangeProposalRepository, 'findById' | 'decide'>;
  ids: IdGenerator;
  clock: Clock;
}

export interface ChangeProposalApprovalDeps
  extends ChangeProposalRunDeps, ChangeProposalOwnerViewDeps, ChangeProposalImageReleaseDeps, ChangeProposalImagePublishDeps,
  ChangeProposalFileApprovalDeps, ChangeProposalFileReleaseDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'listProposed' | 'findStaged' | 'release' | 'finishDeletion'>;
  quarantinedImages: Pick<QuarantinedImageRepository, 'release' | 'finishRelease' | 'markReleaseAttempted' | 'recordPublications'>;
  changeProposals: Pick<ChangeProposalRepository, 'findById' | 'recordExpiry'>;
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

const decideSingleProposal = (
  locked: ChangeProposal,
  deps: { ids: IdGenerator; clock: Clock },
  actor: { actorUserId: string | null; apiKeyId: string | null },
  transition: (at: string) => ChangeProposalTransition,
): ChangeProposalDecision => {
  const at = deps.clock.nowIso();
  if (locked.status !== 'pending' || locked.groupId !== null) return { kind: 'refuse', at };
  if (changeProposalExpired(locked, at)) return { kind: 'record_expiry', at, event: { id: deps.ids.nextId(), ...actor, note: null, at } };
  return { kind: 'move', at, transition: transition(at) };
};

const ownerViewOf = async (tenantId: string, proposal: ChangeProposal, deps: ChangeProposalOwnerViewDeps, now: string): Promise<ChangeProposalOwnerView> =>
  toChangeProposalOwnerView(proposal, (await changeProposalOwnerFacts(tenantId, [proposal], deps, now)).factsOf(proposal), now);

const refusedDecision = (proposal: ChangeProposal, at: string): AppError =>
  proposal.groupId === null ? settledConflict(proposal, at) : groupedChangeProposalDecisionRefused(proposal);

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

  const checkFiles = () => checkProposedFiles(tenantId, keyId, parsedRequest.data.operation, input, operation.invalidInputMessage, deps);
  const files = await checkFiles();
  if (!files.ok) return files;

  const dryRun = await fileRefusalAfterDryRun(await deps.changeProposalTransaction.dryRun<DryRunOutcome>(tenantId, async (scope) => {
    const effect = await previewChangeProposal(prepared.value, tenantId, ownerEquivalent, scope, deps, null, { keyId });
    return effect.ok ? ok({ effect: effect.value }) : effect;
  }), files.value, checkFiles);
  if (!dryRun.ok) return dryRun;
  const images = await checkProposedImages(tenantId, keyId, parsedRequest.data.operation, dryRun.value.effect, operation.invalidInputMessage, deps);
  if (!images.ok) return images;

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
  const created = await deps.changeProposals.create(tenantId, proposal, event, now, images.value, files.value);
  if (created.kind === 'cap_exceeded') return err(changeProposalCapExceeded(created.cap));
  if (created.kind === 'key_inactive') return err(forbidden('This shop management key can no longer propose changes'));
  if (created.kind === 'image_missing') return err(changeProposalImageGone(operation.invalidInputMessage));
  if (created.kind === 'file_unavailable') return err(changeProposalFileUnavailable(operation.invalidInputMessage));
  if (created.kind === 'busy') return err(changeProposalsBusy());
  await notifyOwnersOfProposal(deps, { tenantId, keyId, keyName: proposingKeyRow.name, group: null, notice: 'raise' });
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
  deps: ChangeProposalWithdrawDeps,
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
  const actor = { actorUserId: null, apiKeyId: keyId };
  const decided = await deps.changeProposals.decide(tenantId, id, { keyId }, (locked) =>
    decideSingleProposal(locked, deps, actor, (at) => ({
      status: 'withdrawn',
      decidedByUserId: null,
      decidedAt: at,
      decisionNote: null,
      appliedResourceId: null,
      failureCode: null,
      failureMessage: null,
      event: { id: deps.ids.nextId(), ...actor, note: null, at },
    })));
  if (decided.kind === 'busy') return err(changeProposalsBusy());
  if (decided.kind === 'not_found') return err(missing);
  const { decision, proposal: current } = decided;
  if (decision.kind !== 'refuse') {
    await releaseImagesOfProposals(tenantId, [current], deps);
    await releaseFilesOfProposals(tenantId, [current], deps);
  }
  if (decision.kind === 'move') return ok(toChangeProposalKeyReceipt(current, decision.at));
  return err(refusedDecision(current, decision.at));
};

export const listChangeProposals = async (
  ctx: Ctx,
  input: ChangeProposalListInput,
  deps: Omit<ChangeProposalOwnerReadDeps, 'changeProposalEvents'>,
): Promise<Result<ChangeProposalOwnerPage, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:read'));
  if (!tenant.ok) return tenant;
  const now = deps.clock.nowIso();
  const query = changeProposalListQuery(input, now);
  if (!query.ok) return query;
  const page = await deps.changeProposals.list(tenant.value, query.value);
  const { factsOf } = await changeProposalOwnerFacts(tenant.value, page.proposals, deps, now);
  const proposals: ChangeProposalOwnerView[] = page.proposals.map((proposal) => toChangeProposalOwnerView(proposal, factsOf(proposal), now));
  return ok({ proposals, nextCursor: page.nextCursor, hasMore: page.nextCursor !== null });
};

export interface ChangeProposalSummaryDeps {
  changeProposals: Pick<ChangeProposalRepository, 'countPending' | 'hasAny'>;
  clock: Clock;
}

export const getChangeProposalSummary = async (
  ctx: Ctx,
  deps: ChangeProposalSummaryDeps,
): Promise<Result<ChangeProposalSummary, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:read'));
  if (!tenant.ok) return tenant;
  const [counted, hasProposals] = await Promise.all([
    deps.changeProposals.countPending(tenant.value, deps.clock.nowIso()),
    deps.changeProposals.hasAny(tenant.value),
  ]);
  return ok({ pending: counted.proposals, pendingGroups: counted.groups, hasProposals });
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
  const { factsOf } = await changeProposalOwnerFacts(tenant.value, [proposal], deps, now);
  const events = await deps.changeProposalEvents.listByProposal(tenant.value, proposal.id);
  return ok(toChangeProposalOwnerDetail(proposal, factsOf(proposal), events, now));
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
  const owner = ctx.identity.userId;
  const actor = { actorUserId: owner, apiKeyId: null };
  const decided = await deps.changeProposals.decide(tenant.value, id, {}, (locked) =>
    decideSingleProposal(locked, deps, actor, (at) => ({
      status: 'rejected',
      decidedByUserId: owner,
      decidedAt: at,
      decisionNote: note,
      appliedResourceId: null,
      failureCode: null,
      failureMessage: null,
      event: { id: deps.ids.nextId(), ...actor, note, at },
    })));
  if (decided.kind === 'busy') return err(changeProposalsBusy());
  if (decided.kind === 'not_found') return err(missing);
  const { decision, proposal: current } = decided;
  if (decision.kind !== 'refuse') {
    await releaseImagesOfProposals(tenant.value, [current], deps);
    await releaseFilesOfProposals(tenant.value, [current], deps);
  }
  if (decision.kind !== 'move') return err(refusedDecision(current, decision.at));
  return ok(await ownerViewOf(tenant.value, current, deps, decision.at));
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
    const recorded = await deps.changeProposals.recordExpiry(tenantId, id, { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note: null, at: now });
    if (recorded.kind !== 'busy') {
      await releaseImagesOfProposals(tenantId, [proposal], deps);
      await releaseFilesOfProposals(tenantId, [proposal], deps);
    }
    return err(recorded.kind === 'busy' ? changeProposalsBusy() : settledConflict(proposal, now));
  }
  const fileChecks = await checkApprovalFiles(tenantId, [proposal], deps);
  if (!fileChecks.ok) return fileChecks;
  const publication = await recordApprovalPublications(tenantId, [proposal], deps);
  if (!publication.ok) return publication;
  const writes = noApprovalImageWrites();
  const approve = () => deps.changeProposalTransaction.run(tenantId, async (scope): Promise<Result<ApprovalDecision, AppError>> => {
    const proposals = scope.repositories.changeProposals;
    const locked = await proposals.lockPending(tenantId, id, { unexpiredAt: now });
    if (locked === null) {
      const current = await proposals.findById(tenantId, id);
      return err(current === null ? missing : settledConflict(current, deps.clock.nowIso()));
    }
    if (locked.groupId !== null) return err(groupedChangeProposalDecisionRefused(locked));
    const expired = changeProposalExpired(locked, deps.clock.nowIso());
    const images = expired
      ? { kind: 'ready' as const, images: [], configuration: null }
      : await prepareApprovalImages(tenantId, [locked], publication.value, scope, deps);
    if (images.kind === 'failed') return err(images.error);
    const files = expired || images.kind === 'missing'
      ? { kind: 'ready' as const }
      : await prepareApprovalFiles(tenantId, [locked], fileChecks.value, scope);
    const outcome: ApprovalOutcome = images.kind === 'missing'
      ? { status: 'stale', note: changeProposalImageMissingNote(images.image), at: deps.clock.nowIso() }
      : files.kind === 'missing'
        ? { status: 'stale', note: changeProposalFileMissingNote(files.fileId), at: deps.clock.nowIso() }
        : await applyLockedProposal(locked, ctx, scope, deps);
    if (outcome.status === 'aborted') return err(outcome.error);
    if (outcome.status === 'expired') {
      const recorded = await proposals.recordExpiry(tenantId, id, { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note: null, at: outcome.at });
      if (recorded.kind === 'busy') return err(changeProposalsBusy());
      return ok({ kind: 'expired', proposal: locked, at: outcome.at });
    }
    if (outcome.status === 'applied' && images.kind === 'ready') {
      const published = await publishApprovalImages(tenantId, images, publication.value, scope, deps, writes);
      if (!published.ok) return published;
    }
    const transitioned = await proposals.transition(tenantId, id, {
      ...outcomeFields(outcome),
      decidedByUserId: owner,
      decidedAt: outcome.at,
      decisionNote: null,
      event: { id: deps.ids.nextId(), actorUserId: owner, apiKeyId: null, note: outcome.status === 'stale' ? outcome.note : null, at: outcome.at },
    }, { unexpiredAt: outcome.at });
    if (transitioned.kind === 'busy') return err(changeProposalsBusy());
    if (transitioned.value === null) throw new Error(`Change proposal ${id} left pending while its row was locked`);
    return ok({ kind: 'decided', proposal: transitioned.value, at: outcome.at });
  });
  const decided = await approve().catch(async (cause: unknown) => {
    await withdrawPublishedImages(tenantId, publication.value, writes, deps);
    throw cause;
  });
  if (!decided.ok || decided.value.kind !== 'decided' || decided.value.proposal.status !== 'applied') {
    await withdrawPublishedImages(tenantId, publication.value, writes, deps);
  }
  if (!decided.ok) return decided;
  await releaseImagesOfProposals(tenantId, [decided.value.proposal], deps);
  await releaseFilesOfProposals(tenantId, [decided.value.proposal], deps);
  if (decided.value.kind === 'expired') return err(settledConflict(decided.value.proposal, decided.value.at));
  const { proposal: decidedProposal, at } = decided.value;
  return ok(await ownerViewOf(tenantId, decidedProposal, deps, at));
};
