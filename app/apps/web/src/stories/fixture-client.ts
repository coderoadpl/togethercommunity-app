import { z } from 'zod';
import { createApiClient, type ApiClient, type AuthClientPort } from '#core/client/index.js';
import { abortVisualMutation } from '../../../../scripts/visual-request-policy.js';
import { fixtureKey, fixtureSchema, type Fixture } from './fixture-key.js';

let active: Fixture | undefined;
export const fixtureCalls = new Set<string>();
export const fixturePendingCalls = new Set<string>();
export const fixtureErrors = new Set<string>();
export const selectFixture = (input: unknown): Fixture => {
  active = fixtureSchema.parse(input);
  fixtureCalls.clear();
  fixturePendingCalls.clear();
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
    if (active.pending.includes(key)) {
      fixturePendingCalls.add(key);
      return new Promise<never>(() => undefined);
    }
    if (abortVisualMutation(String(property))) {
      const method: unknown = Reflect.get(target, property);
      if (typeof method !== 'function') throw new Error(`Invalid fixture method ${String(property)}`);
      return Reflect.apply(method, target, args);
    }
    return Promise.resolve(structuredClone(active.calls[key]));
  },
});

export const fixtureAuth: Pick<AuthClientPort, 'listPasskeys'> = {
  listPasskeys: () => {
    const key = fixtureKey('listPasskeys', []);
    fixtureCalls.add(key);
    if (active === undefined || !Object.hasOwn(active.calls, key)) {
      const message = `Missing fixture call ${key} in ${active?.scenario ?? 'unselected scenario'}`;
      fixtureErrors.add(message);
      throw new Error(message);
    }
    const result = z.object({ ok: z.literal(true), value: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string() })) }).parse(active?.calls[key]);
    return Promise.resolve(result);
  },
};
