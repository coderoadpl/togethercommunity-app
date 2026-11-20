import {
  appError,
  CHANGE_PROPOSAL_LIMITS,
  changeProposalDisplayStatus,
  changeProposalKeyState,
  err,
  forbidden,
  ok,
  validation,
  type AppError,
  type ChangeProposal,
  type ChangeProposalKeyState,
  type ChangeProposalTerminalStatus,
  type Result,
  type ShopManagementKey,
} from '#core/domain/index.js';

import type { Ctx } from './context.js';
import { ownerSessionTenant } from './owner-session.js';
import type { ChangeProposalGroupRepository, ShopManagementKeyRepository } from './ports.js';

export interface ProposingKey {
  tenantId: string;
  keyId: string;
}

export const proposingKey = (ctx: Ctx, tenant: Result<string, AppError>): Result<ProposingKey, AppError> => {
  if (!tenant.ok) return tenant;
  const actor = ctx.machineActor;
  if (actor?.kind !== 'shop_management_key' || actor.mode !== 'propose' || ctx.capabilities === undefined || ctx.impersonation !== undefined) {
    return err(forbidden('Change proposals are made only with a propose-mode shop management key'));
  }
  return ok({ tenantId: tenant.value, keyId: actor.apiKeyId });
};

export const bothAuthorized = (submit: Result<string, AppError>, read: Result<string, AppError>): Result<string, AppError> =>
  submit.ok ? read : submit;

export const ownerSession = (ctx: Ctx, tenant: Result<string, AppError>): Result<string, AppError> =>
  ownerSessionTenant(ctx, tenant, 'Change proposals are decided only by a verified owner in their own session');

export const invalid = (message: string, error: { flatten(): unknown }): Result<never, AppError> =>
  err(validation(message, error.flatten()));

export const settledConflict = (proposal: ChangeProposal, now: string): AppError => {
  const status = changeProposalDisplayStatus(proposal, now);
  return appError('conflict', 'This change proposal is no longer pending', { changeProposalStatus: status });
};

export const keyNamed = (keys: readonly ShopManagementKey[], keyId: string): ShopManagementKey | null =>
  keys.find((key) => key.id === keyId) ?? null;

export const keyStates = async (
  tenantId: string,
  deps: { shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'> },
  now: string,
): Promise<(proposal: Pick<ChangeProposal, 'proposedByKeyId'>) => ChangeProposalKeyState> => {
  const keys = await deps.shopManagementKeys.listByTenant(tenantId);
  return (proposal) => changeProposalKeyState(keyNamed(keys, proposal.proposedByKeyId), now);
};

export const groupTitles = async (
  tenantId: string,
  proposals: readonly Pick<ChangeProposal, 'groupId'>[],
  deps: { changeProposalGroups: Pick<ChangeProposalGroupRepository, 'listByIds'> },
): Promise<(proposal: Pick<ChangeProposal, 'groupId'>) => string | null> => {
  const ids = [...new Set(proposals.flatMap((proposal) => proposal.groupId === null ? [] : [proposal.groupId]))];
  const groups = await deps.changeProposalGroups.listByIds(tenantId, ids);
  return (proposal) => groups.find((group) => group.id === proposal.groupId)?.title ?? null;
};

export type ApprovalOutcome =
  | { status: 'applied'; appliedResourceId: string | null; at: string }
  | { status: 'stale'; note: string | null; at: string }
  | { status: 'failed'; error: AppError; at: string }
  | { status: 'expired'; at: string };

export type DecidedOutcome = Exclude<ApprovalOutcome, { status: 'expired' }>;

export const outcomeFields = (outcome: DecidedOutcome): {
  status: ChangeProposalTerminalStatus;
  appliedResourceId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
} => {
  switch (outcome.status) {
    case 'applied':
      return { status: 'applied', appliedResourceId: outcome.appliedResourceId, failureCode: null, failureMessage: null };
    case 'stale':
      return { status: 'stale', appliedResourceId: null, failureCode: null, failureMessage: null };
    case 'failed':
      return {
        status: 'failed',
        appliedResourceId: null,
        failureCode: outcome.error.code.slice(0, CHANGE_PROPOSAL_LIMITS.failureCodeMaxLength),
        failureMessage: outcome.error.message.slice(0, CHANGE_PROPOSAL_LIMITS.failureMessageMaxLength),
      };
  }
};

export const sameTarget = (left: ChangeProposal['target'], right: ChangeProposal['target']): boolean =>
  left.kind === right.kind && left.id === right.id;
