import {
  CHANGE_PROPOSAL_SETTINGS_LABEL,
  changeProposalKeyState,
  isChangeProposalReference,
  type ChangeProposal,
  type ChangeProposalOwnerFacts,
} from '#core/domain/index.js';

import { keyNamed } from './change-proposal-access.js';
import type {
  AccountIdentityReader,
  ChangeProposalGroupRepository,
  ChangeProposalTargetLabelReader,
  ChangeProposalTargetLabelRequest,
  ShopManagementKeyRepository,
  TenantAccessReader,
} from './ports.js';

export interface ChangeProposalOwnerViewDeps {
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'listByIds'>;
  changeProposalTargetLabels: ChangeProposalTargetLabelReader;
  accountIdentities: Pick<AccountIdentityReader, 'findById'>;
  tenantAccess: Pick<TenantAccessReader, 'findStaffGrant'>;
}

export interface ChangeProposalPerson {
  email: string | null;
  verifiedOwner: boolean;
}

type FactsSubject = Pick<
  ChangeProposal,
  'operation' | 'target' | 'status' | 'appliedResourceId' | 'groupId' | 'proposedByKeyId' | 'proposedByIssuerUserId' | 'decidedByUserId'
>;

const labelRequest = (proposal: FactsSubject): ChangeProposalTargetLabelRequest | null => {
  const { kind, id } = proposal.target;
  if (kind === 'settings') return null;
  if (id !== null && !isChangeProposalReference(id)) return { kind, id };
  const appliedIsTheTarget = proposal.operation !== 'price.create';
  if (proposal.status !== 'applied' || proposal.appliedResourceId === null || !appliedIsTheTarget) return null;
  return { kind, id: proposal.appliedResourceId };
};

const labelKey = ({ kind, id }: ChangeProposalTargetLabelRequest): string => `${kind}:${id}`;

const distinct = (values: ReadonlyArray<string | null>): string[] =>
  [...new Set(values.filter((value): value is string => value !== null))];

export const changeProposalPeople = async (
  tenantId: string,
  issuers: ReadonlyArray<string | null>,
  deciders: ReadonlyArray<string | null>,
  deps: Pick<ChangeProposalOwnerViewDeps, 'accountIdentities' | 'tenantAccess'>,
): Promise<(userId: string | null) => ChangeProposalPerson> => {
  const issuerIds = new Set(distinct(issuers));
  const people = new Map<string, ChangeProposalPerson>();
  await Promise.all(distinct([...issuers, ...deciders]).map(async (userId) => {
    const account = await deps.accountIdentities.findById(userId);
    const grant = issuerIds.has(userId) && account?.emailVerified === true
      ? await deps.tenantAccess.findStaffGrant(userId, { tenantId })
      : null;
    people.set(userId, {
      email: account?.email ?? null,
      verifiedOwner: grant?.staffRole === 'owner' && grant.tenant.id === tenantId,
    });
  }));
  return (userId) => (userId === null ? undefined : people.get(userId)) ?? { email: null, verifiedOwner: false };
};

export const changeProposalOwnerFacts = async (
  tenantId: string,
  proposals: readonly FactsSubject[],
  deps: ChangeProposalOwnerViewDeps,
  now: string,
): Promise<(proposal: FactsSubject) => ChangeProposalOwnerFacts> => {
  const keys = await deps.shopManagementKeys.listByTenant(tenantId);
  const groups = await deps.changeProposalGroups.listByIds(tenantId, distinct(proposals.map((proposal) => proposal.groupId)));
  const requests = new Map<string, ChangeProposalTargetLabelRequest>();
  for (const proposal of proposals) {
    const request = labelRequest(proposal);
    if (request !== null) requests.set(labelKey(request), request);
  }
  const labels = new Map((requests.size === 0 ? [] : await deps.changeProposalTargetLabels.labels(tenantId, [...requests.values()]))
    .map((entry) => [labelKey(entry), entry.label]));
  const person = await changeProposalPeople(
    tenantId,
    proposals.map((proposal) => proposal.proposedByIssuerUserId),
    proposals.map((proposal) => proposal.decidedByUserId),
    deps,
  );
  return (proposal) => {
    const request = labelRequest(proposal);
    const issuer = person(proposal.proposedByIssuerUserId);
    return {
      keyState: changeProposalKeyState(keyNamed(keys, proposal.proposedByKeyId), now),
      groupTitle: groups.find((group) => group.id === proposal.groupId)?.title ?? null,
      issuer: { issuerEmail: issuer.email, issuerIsVerifiedOwner: issuer.verifiedOwner },
      decidedByEmail: person(proposal.decidedByUserId).email,
      targetLabel: proposal.target.kind === 'settings'
        ? CHANGE_PROPOSAL_SETTINGS_LABEL
        : request === null ? null : labels.get(labelKey(request)) ?? null,
    };
  };
};
