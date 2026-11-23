import {
  appError,
  changeProposalCreatedKind,
  changeProposalExpired,
  changeProposalReference,
  checkChangeProposalReferences,
  describesTheRequest,
  err,
  mapChangeProposalSnapshotStrings,
  ok,
  registeredChangeProposalOperation,
  resolveChangeProposalReferences,
  unknownChangeProposalOperationNote,
  validation,
  type AppError,
  type ChangeProposal,
  type ChangeProposalEffect,
  type ChangeProposalInput,
  type RegisteredChangeProposalOperation,
  type Result,
} from '#core/domain/index.js';

import { sameTarget, type ApprovalOutcome } from '../change-proposal-access.js';
import type { Ctx } from '../context.js';
import type { ChangeProposalTransactionScope } from '../ports.js';
import {
  CHANGE_PROPOSAL_OPERATIONS,
  changeProposalTouchedFieldsMoved,
  sameChangeProposalEffect,
  type ChangeProposalProposer,
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
  operation: RegisteredChangeProposalOperation;
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

const lockTarget = async (operation: PreparedChangeProposalOperation, tenantId: string, scope: ChangeProposalTransactionScope): Promise<void> => {
  if (operation.lockedCourseIds.length > 0) await scope.repositories.targets.lockCourses(tenantId, operation.lockedCourseIds);
  await scope.repositories.targets.lock(tenantId, operation.target, operation.lockPurpose);
};

const coursesLockedBy = (item: Pick<ChangeProposal, 'operation' | 'input'>): readonly string[] => {
  const known = registeredChangeProposalOperation(item.operation);
  if (known === null) return [];
  const prepared = CHANGE_PROPOSAL_OPERATIONS[known].prepare(item.input);
  return prepared.ok ? prepared.value.lockedCourseIds : [];
};

// The live write of a product's access items locks its courses before the product row; taking the courses of every
// item before any item locks a product keeps that order, so a group never waits on it in a cycle.
export const lockGroupCourses = async (
  tenantId: string,
  items: ReadonlyArray<Pick<ChangeProposal, 'operation' | 'input'>>,
  scope: ChangeProposalTransactionScope,
): Promise<void> => {
  const courseIds = [...new Set(items.flatMap(coursesLockedBy))].sort();
  if (courseIds.length > 0) await scope.repositories.targets.lockCourses(tenantId, courseIds);
};

export const previewChangeProposal = async (
  operation: PreparedChangeProposalOperation,
  tenantId: string,
  ctx: Ctx,
  scope: ChangeProposalTransactionScope,
  deps: ChangeProposalRunDeps,
  group: GroupItemContext | null,
  proposer: ChangeProposalProposer,
): Promise<Result<ChangeProposalEffect, AppError>> => {
  await lockTarget(operation, tenantId, scope);
  const before = storedForm(operation, group, await operation.snapshot(scope.repositories, tenantId, operation.target.id));
  const ran = await operation.run(ctx, scope, deps, proposer);
  if (!ran.ok) return ran;
  recordCreated(group, ran.value);
  const after = storedForm(operation, group, await operation.snapshot(scope.repositories, tenantId, ran.value ?? operation.target.id));
  const effect = operation.effect(before, after);
  if (operation.refusesEmptyEffect && Object.keys(effect).length === 0) {
    return err(validation(`${operation.invalidInputMessage}: it would change nothing the owner can see`));
  }
  return ok(effect);
};

interface GroupContext {
  earlier: readonly ChangeProposal[];
  references: ChangeProposalGroupReferences;
}

const runnableOperation = (
  proposal: ChangeProposal,
  known: RegisteredChangeProposalOperation,
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
  const known = registeredChangeProposalOperation(proposal.operation);
  if (known === null) return { status: 'stale', note: unknownChangeProposalOperationNote(proposal.operation), at: afterProposalLock };
  const operation = runnableOperation(proposal, known, group);
  if (operation === null) return { status: 'stale', note: null, at: afterProposalLock };
  const itemContext = group === null ? null : { proposalId: proposal.id, operation: known, references: group.references };
  const { tenantId } = proposal;
  await lockTarget(operation, tenantId, scope);
  const at = deps.clock.nowIso();
  if (changeProposalExpired(proposal, at)) return { status: 'expired', at };
  const before = storedForm(operation, itemContext, await operation.snapshot(scope.repositories, tenantId, operation.target.id));
  if (changeProposalTouchedFieldsMoved(proposal.effect, before, operation.comparable)) return { status: 'stale', note: null, at };
  const effectChanged = appError('conflict', 'The live state changed since this change was proposed');
  const applied = await scope.savepoint(async (nested) => {
    const ran = await operation.run(ctx, nested, deps, { keyId: proposal.proposedByKeyId });
    if (!ran.ok) return ran;
    recordCreated(itemContext, ran.value);
    const after = storedForm(operation, itemContext, await operation.snapshot(nested.repositories, tenantId, ran.value ?? operation.target.id));
    return sameChangeProposalEffect(operation.effect(before, after), proposal.effect, operation.comparable) ? ran : err(effectChanged);
  });
  if (applied.ok) return { status: 'applied', appliedResourceId: applied.value, at };
  if (applied.error === effectChanged) return { status: 'stale', note: null, at };
  return describesTheRequest(applied.error) ? { status: 'failed', error: applied.error, at } : { status: 'aborted', error: applied.error };
};
