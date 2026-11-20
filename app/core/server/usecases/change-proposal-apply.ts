import {
  appError,
  changeProposalCreatedKind,
  changeProposalExpired,
  changeProposalReference,
  checkChangeProposalReferences,
  err,
  knownChangeProposalOperation,
  mapChangeProposalSnapshotStrings,
  ok,
  resolveChangeProposalReferences,
  unknownChangeProposalOperationNote,
  type AppError,
  type ChangeProposal,
  type ChangeProposalEffect,
  type ChangeProposalInput,
  type ChangeProposalOperation,
  type Result,
} from '#core/domain/index.js';

import { sameTarget, type ApprovalOutcome } from '../change-proposal-access.js';
import type { Ctx } from '../context.js';
import type { ChangeProposalTransactionScope } from '../ports.js';
import {
  CHANGE_PROPOSAL_OPERATIONS,
  changeProposalTouchedFieldsMoved,
  sameChangeProposalEffect,
  type ChangeProposalRunDeps,
  type PreparedChangeProposalOperation,
} from './change-proposal-operations.js';

export const changeProposalGroupReferences = () => {
  const createdBy = new Map<string, string>();
  const referenceOf = new Map<string, string>();
  return {
    idOf: (proposalId: string): string | null => createdBy.get(proposalId) ?? null,
    record: (proposalId: string, resourceId: string): void => {
      createdBy.set(proposalId, resourceId);
      referenceOf.set(resourceId, changeProposalReference(proposalId));
    },
    referenceForm: (snapshot: ChangeProposalInput): ChangeProposalInput =>
      mapChangeProposalSnapshotStrings(snapshot, (text) => referenceOf.get(text) ?? text),
  };
};

type ChangeProposalGroupReferences = ReturnType<typeof changeProposalGroupReferences>;

interface GroupItemContext {
  proposalId: string;
  operation: ChangeProposalOperation;
  references: ChangeProposalGroupReferences;
}

const storedForm = (
  operation: PreparedChangeProposalOperation,
  group: GroupItemContext | null,
  snapshot: ChangeProposalInput,
): ChangeProposalInput => operation.canonical(group === null ? snapshot : group.references.referenceForm(snapshot));

const recordCreated = (group: GroupItemContext | null, resourceId: string | null): void => {
  if (group === null || resourceId === null || changeProposalCreatedKind(group.operation) === null) return;
  group.references.record(group.proposalId, resourceId);
};

export const previewChangeProposal = async (
  operation: PreparedChangeProposalOperation,
  tenantId: string,
  ctx: Ctx,
  scope: ChangeProposalTransactionScope,
  deps: ChangeProposalRunDeps,
  group: GroupItemContext | null,
): Promise<Result<ChangeProposalEffect, AppError>> => {
  await scope.repositories.targets.lock(tenantId, operation.target, operation.lockPurpose);
  const before = storedForm(operation, group, await operation.snapshot(scope.repositories, tenantId, operation.target.id));
  const ran = await operation.run(ctx, scope, deps);
  if (!ran.ok) return ran;
  recordCreated(group, ran.value);
  const after = storedForm(operation, group, await operation.snapshot(scope.repositories, tenantId, ran.value ?? operation.target.id));
  return ok(operation.effect(before, after));
};

interface GroupContext {
  earlier: readonly ChangeProposal[];
  references: ChangeProposalGroupReferences;
}

const runnableOperation = (
  proposal: ChangeProposal,
  known: ChangeProposalOperation,
  group: GroupContext | null,
): PreparedChangeProposalOperation | null => {
  if (group !== null && !checkChangeProposalReferences(known, proposal.input, group.earlier).ok) return null;
  const stored = CHANGE_PROPOSAL_OPERATIONS[known].prepare(proposal.input);
  if (!stored.ok || !sameTarget(stored.value.target, proposal.target)) return null;
  if (group === null) return stored.value;
  const resolved = resolveChangeProposalReferences(known, stored.value.input, group.references.idOf);
  if (resolved === null) return null;
  const prepared = CHANGE_PROPOSAL_OPERATIONS[known].prepare(resolved);
  return prepared.ok ? prepared.value : null;
};

export const applyLockedProposal = async (
  proposal: ChangeProposal,
  ctx: Ctx,
  scope: ChangeProposalTransactionScope,
  deps: ChangeProposalRunDeps,
  group: GroupContext | null = null,
): Promise<ApprovalOutcome> => {
  const afterProposalLock = deps.clock.nowIso();
  if (changeProposalExpired(proposal, afterProposalLock)) return { status: 'expired', at: afterProposalLock };
  const known = knownChangeProposalOperation(proposal.operation);
  if (known === null) return { status: 'stale', note: unknownChangeProposalOperationNote(proposal.operation), at: afterProposalLock };
  const operation = runnableOperation(proposal, known, group);
  if (operation === null) return { status: 'stale', note: null, at: afterProposalLock };
  const itemContext = group === null ? null : { proposalId: proposal.id, operation: known, references: group.references };
  const { tenantId } = proposal;
  await scope.repositories.targets.lock(tenantId, operation.target, operation.lockPurpose);
  const at = deps.clock.nowIso();
  if (changeProposalExpired(proposal, at)) return { status: 'expired', at };
  const before = storedForm(operation, itemContext, await operation.snapshot(scope.repositories, tenantId, operation.target.id));
  if (changeProposalTouchedFieldsMoved(proposal.effect, before)) return { status: 'stale', note: null, at };
  const effectChanged = appError('conflict', 'The live state changed since this change was proposed');
  const applied = await scope.savepoint(async (nested) => {
    const ran = await operation.run(ctx, nested, deps);
    if (!ran.ok) return ran;
    recordCreated(itemContext, ran.value);
    const after = storedForm(operation, itemContext, await operation.snapshot(nested.repositories, tenantId, ran.value ?? operation.target.id));
    return sameChangeProposalEffect(operation.effect(before, after), proposal.effect) ? ran : err(effectChanged);
  });
  if (applied.ok) return { status: 'applied', appliedResourceId: applied.value, at };
  return applied.error === effectChanged ? { status: 'stale', note: null, at } : { status: 'failed', error: applied.error, at };
};
