import {
  appError,
  approveChangeProposalGroupInputSchema,
  changeProposalExpired,
  changeProposalFileMissingNote,
  changeProposalFileUnavailable,
  changeProposalImageMissingNote,
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
import { notifyOwnersOfProposal, type ChangeProposalNotifyDeps } from '../change-proposal-notifications.js';
import { changeProposalOwnerFacts, type ChangeProposalOwnerViewDeps } from '../change-proposal-owner-facts.js';
import type { Ctx } from '../context.js';
import type { KeyDownloadFileRepository } from '../key-download-ports.js';
import type {
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalGroupDecision,
  ChangeProposalGroupItemTransition,
  ChangeProposalGroupRepository,
  ChangeProposalGroupWithItems,
  ChangeProposalRepository,
  ChangeProposalTransaction,
  ChangeProposalTransition,
  Clock,
  IdGenerator,
  QuarantinedImageRepository,
  ShopManagementKeyRepository,
} from '../ports.js';
import { applyLockedProposal, changeProposalGroupReferences, lockGroupCourses, previewChangeProposal } from './change-proposal-apply.js';
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

export interface ChangeProposalGroupCreateDeps {
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'create'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  ids: IdGenerator;
  clock: Clock;
}

export interface ChangeProposalGroupSubmitDeps extends ChangeProposalRunDeps, ChangeProposalNotifyDeps, ProposedImageCheckDeps, ProposedFileCheckDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  changeProposals: Pick<ChangeProposalRepository, 'countCapReached'>;
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findByKey' | 'addItem'>;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
}

export interface ChangeProposalGroupKeyDeps {
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findByKey' | 'decide' | 'deleteEmpty'>;
  ids: IdGenerator;
  clock: Clock;
}

export type ChangeProposalGroupWithdrawDeps = ChangeProposalGroupKeyDeps & ChangeProposalImageReleaseDeps & ChangeProposalFileReleaseDeps;

export interface ChangeProposalGroupOwnerReadDeps extends ChangeProposalOwnerViewDeps {
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findById' | 'listByIds'>;
  changeProposalEvents: ChangeProposalEventRepository;
  clock: Clock;
}

export interface ChangeProposalGroupDecisionDeps extends ChangeProposalGroupOwnerReadDeps, ChangeProposalImageReleaseDeps, ChangeProposalFileReleaseDeps {
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'listProposed' | 'release' | 'finishDeletion'>;
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findById' | 'listByIds' | 'decide'>;
  ids: IdGenerator;
}

export interface ChangeProposalGroupApprovalDeps
  extends ChangeProposalRunDeps, ChangeProposalOwnerViewDeps, ChangeProposalImageReleaseDeps, ChangeProposalImagePublishDeps,
  ChangeProposalFileApprovalDeps, ChangeProposalFileReleaseDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'listProposed' | 'findStaged' | 'release' | 'finishDeletion'>;
  quarantinedImages: Pick<QuarantinedImageRepository, 'release' | 'finishRelease' | 'recordPublications'>;
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'findById' | 'listByIds' | 'recordExpiry'>;
  changeProposalEvents: ChangeProposalEventRepository;
}

const keyGroupMissing = (id: string): AppError => notFound(`No change proposal group "${id}" for this key`);

const ownerGroupMissing = (id: string): AppError => notFound(`No change proposal group "${id}" in this workspace`);

const keyReceipt = ({ group, items }: ChangeProposalGroupWithItems, now: string): ChangeProposalGroupKeyReceipt =>
  toChangeProposalGroupKeyReceipt(group, items, items.map((item) => toChangeProposalKeyReceipt(item, now)), now);

const ownerView = async (
  { group, items }: ChangeProposalGroupWithItems,
  deps: ChangeProposalOwnerViewDeps & Pick<ChangeProposalGroupOwnerReadDeps, 'changeProposalEvents'>,
  now: string,
): Promise<ChangeProposalGroupOwnerView> => {
  const key = keyNamed(await deps.shopManagementKeys.listByTenant(group.tenantId), group.proposedByKeyId);
  const first = items[0];
  const issuerUserId = key?.issuedByUserId ?? first?.proposedByIssuerUserId ?? null;
  const { factsOf, person } = await changeProposalOwnerFacts(group.tenantId, items, deps, now, [issuerUserId]);
  const issuer = person(issuerUserId);
  const details = [];
  for (const item of items) {
    const events = await deps.changeProposalEvents.listByProposal(group.tenantId, item.id);
    details.push(toChangeProposalOwnerDetail(item, factsOf(item), events, now));
  }
  return toChangeProposalGroupOwnerView(group, items, {
    keyName: key?.name ?? first?.proposedByKeyName ?? null,
    issuerUserId,
    issuerEmail: issuer.email,
    issuerIsVerifiedOwner: issuer.verifiedOwner,
    issuerIsFormerTeamMember: issuer.formerTeamMember,
    keyState: changeProposalKeyState(key, now),
  }, details, now);
};

const everyItem = (
  items: readonly ChangeProposal[],
  transition: (item: ChangeProposal) => ChangeProposalTransition,
): ChangeProposalGroupItemTransition[] => items.map((item) => ({ id: item.id, transition: transition(item) }));

const expiryEvent = (ids: IdGenerator, at: string, actor: { actorUserId: string | null; apiKeyId: string | null }) =>
  (): ChangeProposalEventDraft => ({ id: ids.nextId(), ...actor, note: null, at });

type GroupActor = { actorUserId: string | null; apiKeyId: string | null };

const decideOpenGroup = (
  locked: ChangeProposalGroupWithItems,
  clock: Clock,
  ids: IdGenerator,
  actor: GroupActor,
  transition: (item: ChangeProposal, at: string) => ChangeProposalTransition,
): ChangeProposalGroupDecision => {
  const at = clock.nowIso();
  const status = changeProposalGroupStatus(locked.group, locked.items, at);
  if (locked.items.length > 0 && status === 'expired') return { kind: 'record_expiry', at, event: expiryEvent(ids, at, actor) };
  if (locked.items.length === 0 || status !== 'open') return { kind: 'refuse', at };
  return { kind: 'move', at, transitions: everyItem(locked.items, (item) => transition(item, at)) };
};

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

const GROUP_CHANGED_MESSAGE = 'Another proposal joined this group meanwhile; nothing was stored, submit again';

const groupChanged = (): AppError => appError('conflict', GROUP_CHANGED_MESSAGE);

const sameItemIds = (left: readonly ChangeProposal[], right: readonly ChangeProposal[]): boolean =>
  left.length === right.length && left.every((item, index) => item.id === right[index]?.id);

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
  const checkFiles = () => checkProposedFiles(tenantId, keyId, operationName, prepared.value.input, operation.invalidInputMessage, deps);
  const files = await checkFiles();
  if (!files.ok) return files;

  const proposalId = deps.ids.nextId();
  const ownerEquivalent: Ctx = { identity: ctx.identity };
  const dryRun = await fileRefusalAfterDryRun(await deps.changeProposalTransaction.dryRun<ChangeProposalEffect>(tenantId, async (scope) => {
    const inside = await scope.repositories.changeProposalGroups.findByKey(tenantId, keyId, groupId);
    if (inside === null) return err(keyGroupMissing(groupId));
    const readAt = deps.clock.nowIso();
    if (!changeProposalGroupOpen(inside.group, inside.items, readAt)) return err(changeProposalGroupConflict(inside.group, inside.items, readAt));
    if (!sameItemIds(inside.items, earlier)) return err(changeProposalGroupConflict(inside.group, inside.items, readAt, GROUP_CHANGED_MESSAGE));
    const references = changeProposalGroupReferences();
    await lockGroupCourses(tenantId, [...earlier, { operation: operationName, input: prepared.value.input }], scope);
    for (const [index, item] of earlier.entries()) {
      const outcome = await applyLockedProposal(item, ownerEquivalent, scope, deps, { earlier: earlier.slice(0, index), references });
      if (outcome.status === 'aborted') return err(outcome.error);
      if (outcome.status !== 'applied') return err(earlierItemNoLongerApplies(item));
    }
    const resolved = resolveChangeProposalReferences(operationName, prepared.value.input, references.idOf);
    if (resolved === null) return err(validation('A proposal reference names an item that created nothing'));
    const runnable = operation.prepare(resolved);
    if (!runnable.ok) return runnable;
    return previewChangeProposal(runnable.value, tenantId, ownerEquivalent, scope, deps, { proposalId, operation: operationName, references }, { keyId });
  }, { groupId }), files.value, checkFiles);
  if (!dryRun.ok) return dryRun;
  const images = await checkProposedImages(tenantId, keyId, operationName, dryRun.value, operation.invalidInputMessage, deps);
  if (!images.ok) return images;

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
  const added = await deps.changeProposalGroups.addItem(tenantId, proposal, event, deps.clock, images.value, files.value);
  switch (added.kind) {
    case 'created':
      await notifyOwnersOfProposal(deps, {
        tenantId,
        keyId,
        keyName: proposingKeyRow.name,
        group: { id: groupId, title: current.group.title },
        notice: added.proposal.groupPosition === 1 ? 'raise' : 'signal',
      });
      return ok(keyReceipt({ group: current.group, items: [...earlier, added.proposal] }, now));
    case 'cap_exceeded':
      return err(changeProposalCapExceeded(added.cap));
    case 'key_inactive':
      return err(forbidden('This shop management key can no longer propose changes'));
    case 'image_missing':
      return err(changeProposalImageGone(operation.invalidInputMessage));
    case 'file_unavailable':
      return err(changeProposalFileUnavailable(operation.invalidInputMessage));
    case 'busy':
      return err(changeProposalsBusy());
    case 'not_found':
      return err(keyGroupMissing(groupId));
    case 'group_closed':
      return err(changeProposalGroupConflict(added.current.group, added.current.items, added.at));
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
  deps: ChangeProposalGroupWithdrawDeps,
): Promise<Result<ChangeProposalGroupKeyReceipt, AppError>> => {
  const key = proposingKey(ctx, authorizeTenant(ctx, 'proposal:own:manage'));
  if (!key.ok) return key;
  const parsed = changeProposalIdInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal group id', parsed.error);
  const { tenantId, keyId } = key.value;
  const { id } = parsed.data;
  const found = await deps.changeProposalGroups.findByKey(tenantId, keyId, id);
  if (found === null) return err(keyGroupMissing(id));
  if (found.items.length === 0) {
    const deleted = await deps.changeProposalGroups.deleteEmpty(tenantId, keyId, id);
    const now = deps.clock.nowIso();
    if (deleted.kind === 'busy') return err(changeProposalsBusy());
    if (!deleted.value) return err(changeProposalGroupConflict(found.group, found.items, now));
    return ok({ ...keyReceipt(found, now), status: 'withdrawn' });
  }
  const actor: GroupActor = { actorUserId: null, apiKeyId: keyId };
  const decided = await deps.changeProposalGroups.decide(tenantId, id, { keyId }, (locked) =>
    decideOpenGroup(locked, deps.clock, deps.ids, actor, (_item, at) => ({
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
  if (decided.kind === 'not_found') return err(keyGroupMissing(id));
  const { decision, group, items } = decided;
  if (decision.kind !== 'refuse') {
    await releaseImagesOfProposals(tenantId, items, deps);
    await releaseFilesOfProposals(tenantId, items, deps);
  }
  if (decision.kind === 'move') return ok(keyReceipt({ group, items }, decision.at));
  return err(changeProposalGroupConflict(group, items, decision.at));
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
  const owner = ctx.identity.userId;
  if (found.items.length === 0) return err(changeProposalGroupConflict(found.group, found.items, deps.clock.nowIso()));
  const actor: GroupActor = { actorUserId: owner, apiKeyId: null };
  const decided = await deps.changeProposalGroups.decide(tenantId, id, {}, (locked) =>
    decideOpenGroup(locked, deps.clock, deps.ids, actor, (_item, at) => ({
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
  if (decided.kind === 'not_found') return err(ownerGroupMissing(id));
  const { decision, group, items } = decided;
  if (decision.kind !== 'refuse') {
    await releaseImagesOfProposals(tenantId, items, deps);
    await releaseFilesOfProposals(tenantId, items, deps);
  }
  if (decision.kind === 'move') return ok(await ownerView({ group, items }, deps, decision.at));
  return err(changeProposalGroupConflict(group, items, decision.at));
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
    const recorded = await deps.changeProposalGroups.recordExpiry(tenantId, id, expiryEvent(deps.ids, now, { actorUserId: owner, apiKeyId: null }));
    if (recorded.kind === 'busy') return err(changeProposalsBusy());
    await releaseImagesOfProposals(tenantId, found.items, deps);
    await releaseFilesOfProposals(tenantId, found.items, deps);
  }
  if (found.items.length === 0 || !changeProposalGroupOpen(found.group, found.items, now)) {
    return err(changeProposalGroupConflict(found.group, found.items, now));
  }
  if (shownItemsDiffer(found.items, itemIds)) return err(itemsChangedSinceShown(found.items));

  const fileChecks = await checkApprovalFiles(tenantId, found.items, deps);
  if (!fileChecks.ok) return fileChecks;
  const publication = await recordApprovalPublications(tenantId, found.items, deps);
  if (!publication.ok) return publication;
  const writes = noApprovalImageWrites();
  const approve = () => deps.changeProposalTransaction.run(tenantId, async (scope): Promise<Result<GroupApprovalDecision, AppError>> => {
    const groups = scope.repositories.changeProposalGroups;
    const locked = await groups.lock(tenantId, id);
    if (locked === null) return err(ownerGroupMissing(id));
    const afterLock = deps.clock.nowIso();
    if (locked.items.some((item) => item.status !== 'pending')) return err(changeProposalGroupConflict(locked.group, locked.items, afterLock));
    if (shownItemsDiffer(locked.items, itemIds)) return err(itemsChangedSinceShown(locked.items));
    await lockGroupCourses(tenantId, locked.items, scope);
    const references = changeProposalGroupReferences();
    const halted = appError('conflict', 'An item of the group did not apply');
    const halt: { current: GroupHalt | null } = { current: null };
    const expired = locked.items.some((item) => changeProposalExpired(item, deps.clock.nowIso()));
    const images = expired
      ? { kind: 'ready' as const, images: [], configuration: null }
      : await prepareApprovalImages(tenantId, locked.items, scope, deps);
    if (images.kind === 'failed') return err(images.error);
    if (images.kind === 'missing') {
      halt.current = { item: images.proposal, outcome: { status: 'stale', note: changeProposalImageMissingNote(images.image), at: deps.clock.nowIso() } };
    }
    const files = expired || images.kind === 'missing'
      ? { kind: 'ready' as const }
      : await prepareApprovalFiles(tenantId, locked.items, fileChecks.value, scope);
    if (files.kind === 'missing') {
      halt.current = { item: files.proposal, outcome: { status: 'stale', note: changeProposalFileMissingNote(files.fileId), at: deps.clock.nowIso() } };
    }
    const applied = images.kind === 'missing' || files.kind === 'missing' ? err(halted) : await scope.savepoint(async (nested) => {
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
    if (stop !== null && stop.outcome.status === 'aborted') return err(stop.outcome.error);
    if (stop !== null && stop.outcome.status === 'expired') {
      const recorded = await groups.recordExpiry(tenantId, id, expiryEvent(deps.ids, stop.outcome.at, { actorUserId: owner, apiKeyId: null }));
      if (recorded.kind === 'busy') return err(changeProposalsBusy());
      return ok({ kind: 'expired', at: stop.outcome.at });
    }
    if (applied.ok && images.kind === 'ready') {
      const published = await publishApprovalImages(tenantId, images, publication.value, scope, deps, writes);
      if (!published.ok) return published;
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
    } else if (stop !== null && stop.outcome.status !== 'expired' && stop.outcome.status !== 'aborted') {
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
  const decided = await approve().catch(async (cause: unknown) => {
    await withdrawPublishedImages(tenantId, publication.value, writes, deps);
    throw cause;
  });
  if (!decided.ok || decided.value.kind !== 'decided' || decided.value.items.some((item) => item.status !== 'applied')) {
    await withdrawPublishedImages(tenantId, publication.value, writes, deps);
  }
  if (!decided.ok) return decided;
  await releaseImagesOfProposals(tenantId, found.items, deps);
  await releaseFilesOfProposals(tenantId, decided.value.kind === 'decided' ? decided.value.items : found.items, deps);
  if (decided.value.kind === 'expired') {
    const current = await deps.changeProposalGroups.findById(tenantId, id);
    return err(changeProposalGroupConflict(found.group, current?.items ?? found.items, decided.value.at));
  }
  return ok(await ownerView({ group: found.group, items: decided.value.items }, deps, decided.value.at));
};
