import { bindActions } from '../api.js';
import { fixtureClient, fixtureAuth, fixtureAuthActions, fixtureProposalImagePath } from './fixture-client.js';

const bound = bindActions(fixtureClient, fixtureAuth);

export const actions = {
  ...bound,
  ...fixtureAuthActions,
  changeProposalImagePath: fixtureProposalImagePath(bound.changeProposalImagePath),
};
