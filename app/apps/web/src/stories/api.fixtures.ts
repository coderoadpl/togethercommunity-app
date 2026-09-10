import { bindActions } from '../api.js';
import { fixtureClient, fixtureAuth, fixtureAuthActions } from './fixture-client.js';

export const actions = {
  ...bindActions(fixtureClient, fixtureAuth),
  ...fixtureAuthActions,
};
