import {
  changeProposalKeyState,
  changeProposalStagedFileId,
  isChangeProposalReference,
  type ChangeProposal,
  type ChangeProposalOwnerFacts,
  type ChangeProposalProposedFile,
  type ChangeProposalTargetPrice,
} from '#core/domain/index.js';

import { keyNamed } from './change-proposal-access.js';
import type { KeyDownloadFileRepository } from './key-download-ports.js';
import type {
  ChangeProposalGroupRepository,
  ChangeProposalPeopleReader,
  ChangeProposalTargetLabelReader,
  ChangeProposalTargetLabelRequest,
  ShopManagementKeyRepository,
} from './ports.js';

export interface ChangeProposalOwnerViewDeps {
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'listByTenant'>;
  changeProposalGroups: Pick<ChangeProposalGroupRepository, 'listByIds'>;
  changeProposalTargetLabels: ChangeProposalTargetLabelReader;
  changeProposalPeople: ChangeProposalPeopleReader;
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'listProposed'>;
}

export interface ChangeProposalPersonFacts {
  email: string | null;
  verifiedOwner: boolean;
  formerTeamMember: boolean;
}

type FactsSubject = Pick<
  ChangeProposal,
  'id' | 'operation' | 'input' | 'target' | 'status' | 'appliedResourceId' | 'groupId' | 'proposedByKeyId' | 'proposedByIssuerUserId' | 'decidedByUserId'
>;

const labelRequest = (proposal: FactsSubject): ChangeProposalTargetLabelRequest | null => {
  const { kind, id } = proposal.target;
  if (kind === 'settings') return null;
  const applied = proposal.status === 'applied' ? proposal.appliedResourceId : null;
  if (proposal.operation === 'price.create' && applied !== null) return { kind: 'price', id: applied };
  if (id !== null && !isChangeProposalReference(id)) return { kind, id };
  if (proposal.operation === 'price.create' || applied === null || changeProposalStagedFileId(proposal.operation, proposal.input) !== null) return null;
  return { kind, id: applied };
};

type ProposedFileSubject = Pick<ChangeProposal, 'id' | 'operation' | 'input' | 'proposedByKeyId'>;

/** Display facts read at view time; `available` says whether the proposal still holds its staged file, not whether the storage has it. */
const readProposedFiles = async (
  tenantId: string,
  proposals: readonly ProposedFileSubject[],
  deps: Pick<ChangeProposalOwnerViewDeps, 'keyDownloadFiles'>,
): Promise<(proposal: ProposedFileSubject) => ChangeProposalProposedFile[]> => {
  const ids = proposals.flatMap((proposal) => {
    const id = changeProposalStagedFileId(proposal.operation, proposal.input);
    return id === null ? [] : [id];
  });
  const rows = ids.length === 0 ? [] : await deps.keyDownloadFiles.listProposed(tenantId, ids);
  return (proposal) => {
    const id = changeProposalStagedFileId(proposal.operation, proposal.input);
    if (id === null) return [];
    const row = rows.find((candidate) => candidate.file.id === id && candidate.file.apiKeyId === proposal.proposedByKeyId);
    const source = row?.file.copiedFrom ?? null;
    return [{
      id,
      available: row?.file.proposalId === proposal.id,
      copiedFrom: source === null || row === undefined
        ? null
        : { productId: source.productId, productTitle: row.copiedFromTitle, versionNumber: source.versionNumber },
    }];
  };
};

const labelKey = ({ kind, id }: ChangeProposalTargetLabelRequest): string => `${kind}:${id}`;

const distinct = (values: ReadonlyArray<string | null>): string[] =>
  [...new Set(values.filter((value): value is string => value !== null))];

const FORMER_OR_UNKNOWN: ChangeProposalPersonFacts = { email: null, verifiedOwner: false, formerTeamMember: true };

const readChangeProposalPeople = async (
  tenantId: string,
  userIds: ReadonlyArray<string | null>,
  deps: Pick<ChangeProposalOwnerViewDeps, 'changeProposalPeople'>,
): Promise<(userId: string | null) => ChangeProposalPersonFacts> => {
  const ids = distinct(userIds);
  const records = ids.length === 0 ? [] : await deps.changeProposalPeople.read(tenantId, ids);
  const people = new Map(records.map((person): [string, ChangeProposalPersonFacts] => [person.userId, person.staffRole === null
    ? FORMER_OR_UNKNOWN
    : { email: person.email, verifiedOwner: person.staffRole === 'owner' && person.emailVerified, formerTeamMember: false }]));
  return (userId) => (userId === null ? undefined : people.get(userId)) ?? FORMER_OR_UNKNOWN;
};

export const changeProposalOwnerFacts = async (
  tenantId: string,
  proposals: readonly FactsSubject[],
  deps: ChangeProposalOwnerViewDeps,
  now: string,
  otherPeople: ReadonlyArray<string | null> = [],
): Promise<{
  factsOf: (proposal: FactsSubject) => ChangeProposalOwnerFacts;
  person: (userId: string | null) => ChangeProposalPersonFacts;
}> => {
  const keys = await deps.shopManagementKeys.listByTenant(tenantId);
  const groups = await deps.changeProposalGroups.listByIds(tenantId, distinct(proposals.map((proposal) => proposal.groupId)));
  const requests = new Map<string, ChangeProposalTargetLabelRequest>();
  for (const proposal of proposals) {
    const request = labelRequest(proposal);
    if (request !== null) requests.set(labelKey(request), request);
  }
  const labels = new Map<string, { label: string; price: ChangeProposalTargetPrice | null }>(
    (requests.size === 0 ? [] : await deps.changeProposalTargetLabels.labels(tenantId, [...requests.values()]))
      .map((entry) => [labelKey(entry), { label: entry.label, price: entry.price }]),
  );
  const proposedFilesOf = await readProposedFiles(tenantId, proposals, deps);
  const person = await readChangeProposalPeople(
    tenantId,
    [...proposals.flatMap((proposal) => [proposal.proposedByIssuerUserId, proposal.decidedByUserId]), ...otherPeople],
    deps,
  );
  const factsOf = (proposal: FactsSubject): ChangeProposalOwnerFacts => {
    const request = labelRequest(proposal);
    const label = request === null ? undefined : labels.get(labelKey(request));
    const issuer = person(proposal.proposedByIssuerUserId);
    const decider = person(proposal.decidedByUserId);
    return {
      keyState: changeProposalKeyState(keyNamed(keys, proposal.proposedByKeyId), now),
      groupTitle: groups.find((group) => group.id === proposal.groupId)?.title ?? null,
      issuer: { issuerEmail: issuer.email, issuerIsVerifiedOwner: issuer.verifiedOwner, issuerIsFormerTeamMember: issuer.formerTeamMember },
      decidedBy: { email: decider.email, formerTeamMember: decider.formerTeamMember },
      targetLabel: label?.label ?? null,
      targetPrice: label?.price ?? null,
      proposedFiles: proposedFilesOf(proposal),
    };
  };
  return { factsOf, person };
};
