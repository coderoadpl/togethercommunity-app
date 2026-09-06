import { bindActions } from '../api.js';
import { fixtureClient } from './fixture-client.js';

export const actions = bindActions(fixtureClient);
