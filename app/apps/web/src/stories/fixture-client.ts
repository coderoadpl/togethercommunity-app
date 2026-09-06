import { createApiClient, type ApiClient } from '#core/client/index.js';
import { abortVisualMutation } from '../../../../scripts/visual-request-policy.js';
import { fixtureKey, fixtureSchema, type Fixture } from './fixture-key.js';

let active: Fixture | undefined;
export const fixtureCalls = new Set<string>();
export const fixtureErrors = new Set<string>();
export const selectFixture = (input: unknown): Fixture => {
  active = fixtureSchema.parse(input);
  fixtureCalls.clear();
  fixtureErrors.clear();
  return active;
};

export const fixtureClient: ApiClient = new Proxy(createApiClient({ baseUrl: '', fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) }), {
  get: (target, property) => (...args: unknown[]) => {
    const key = fixtureKey(String(property), args);
    fixtureCalls.add(key);
    if (active === undefined || !Object.hasOwn(active.calls, key)) {
      const message = `Missing fixture call ${key} in ${active?.scenario ?? 'unselected scenario'}`;
      fixtureErrors.add(message);
      throw new Error(message);
    }
    if (abortVisualMutation(String(property))) {
      const method: unknown = Reflect.get(target, property);
      if (typeof method !== 'function') throw new Error(`Invalid fixture method ${String(property)}`);
      return Reflect.apply(method, target, args);
    }
    return Promise.resolve(structuredClone(active.calls[key]));
  },
});
