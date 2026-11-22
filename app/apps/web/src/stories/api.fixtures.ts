import { bindActions } from '../api.js';
import { fixtureClient, fixtureAuth, fixtureAuthActions, fixtureProposalImagePath, goneProposalFile, STORY_PROPOSAL_GONE_FILE_ID } from './fixture-client.js';

const bound = bindActions(fixtureClient, fixtureAuth);

export const actions = {
  ...bound,
  ...fixtureAuthActions,
  changeProposalImagePath: fixtureProposalImagePath(bound.changeProposalImagePath),
  changeProposalFileLink: (input: { id: string; fileId: string }) => input.fileId === STORY_PROPOSAL_GONE_FILE_ID
    ? { ...bound.changeProposalFileLink(input), queryFn: goneProposalFile }
    : bound.changeProposalFileLink(input),
};
