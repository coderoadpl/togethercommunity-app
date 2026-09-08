import { bindActions } from '../api.js';
import { fixtureClient, fixtureAuth } from './fixture-client.js';

export const actions = bindActions(fixtureClient, fixtureAuth);
