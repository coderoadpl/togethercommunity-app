import {
  sendVerificationEmailMutation,
  requestPasswordResetMutation,
  changePasswordMutation,
  registerPasskeyMutation,
  removePasskeyMutation,
  enableTwoFactorMutation,
  verifyTotpMutation,
  disableTwoFactorMutation,
  regenerateBackupCodesMutation,
} from '#core/client/index.js';
import { z } from 'zod';
import { createApiClient, type ApiClient, type AuthClientPort } from '#core/client/index.js';
import { abortVisualMutation } from '../../../../scripts/visual-request-policy.js';
import { canonicalJson, fixtureKey, fixtureSchema, type Fixture } from './fixture-key.js';

let active: Fixture | undefined;
export const fixtureCalls = new Set<string>();
export const fixturePendingCalls = new Set<string>();
export const fixtureErrors = new Set<string>();
export const fixtureExpectationErrors = (): string[] => active === undefined ? ['No fixture selected'] : [
  ...active.pending.map((entry) => entry.call).filter((key) => !fixturePendingCalls.has(key)),
  ...Object.keys(active.expectedErrors).filter((key) => !fixtureCalls.has(key)),
].map((key) => `Unused fixture expectation ${key}`);

export const fixtureQueriesReady = (fetchingKeys: readonly (readonly unknown[])[]): boolean => fetchingKeys.every((key) =>
  active?.pending.some((entry) => fixturePendingCalls.has(entry.call) && entry.queryKeys.some((pendingKey) => canonicalJson(pendingKey) === canonicalJson(key))) === true);
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
    if (active.pending.some((entry) => entry.call === key)) {
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

const unavailableAuthPreview = () => Promise.resolve({ ok: false, error: { code: 'internal', message: 'This operation is available in the focused account previews.' } } as const);
export const fixtureAuth = {
  signUp: unavailableAuthPreview,
  signIn: unavailableAuthPreview,
  requestMagicLink: unavailableAuthPreview,
  resetPassword: unavailableAuthPreview,
  signOut: unavailableAuthPreview,
  signInWithPasskey: unavailableAuthPreview,
  verifyBackupCode: unavailableAuthPreview,
  signInWithGoogle: unavailableAuthPreview,
  promptGoogleOneTap: unavailableAuthPreview,

  sendVerificationEmail: unavailableAuthPreview,
  requestPasswordReset: unavailableAuthPreview,
  changePassword: unavailableAuthPreview,
  registerPasskey: unavailableAuthPreview,
  removePasskey: unavailableAuthPreview,
  verifyTotp: unavailableAuthPreview,
  disableTwoFactor: unavailableAuthPreview,
  regenerateBackupCodes: unavailableAuthPreview,
  enableTwoFactor: () => active?.scenario === 'SecurityTwoFactorSetup'
    ? Promise.resolve({ ok: true, value: { totpURI: 'otpauth://totp/Together:demo@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Together', backupCodes: ['demo-once-1111', 'demo-once-2222'] } })
    : unavailableAuthPreview(),
  listPasskeys: () => {
    const key = fixtureKey('listPasskeys', []);
    fixtureCalls.add(key);
    if (active === undefined || !Object.hasOwn(active.calls, key)) {
      const message = `Missing fixture call ${key} in ${active?.scenario ?? 'unselected scenario'}`;
      fixtureErrors.add(message);
      throw new Error(message);
    }
    if (active.pending.some((entry) => entry.call === key)) {
      fixturePendingCalls.add(key);
      return new Promise<never>(() => undefined);
    }
    const result = z.object({ ok: z.literal(true), value: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string() })) }).parse(active?.calls[key]);
    return Promise.resolve(result);
  },
} satisfies AuthClientPort;

export const fixtureAuthActions = {
  sendVerificationEmail: sendVerificationEmailMutation(fixtureAuth),
  requestPasswordReset: requestPasswordResetMutation(fixtureAuth),
  changePassword: changePasswordMutation(fixtureAuth),
  registerPasskey: registerPasskeyMutation(fixtureAuth),
  removePasskey: removePasskeyMutation(fixtureAuth),
  enableTwoFactor: enableTwoFactorMutation(fixtureAuth),
  verifyTotp: verifyTotpMutation(fixtureAuth),
  disableTwoFactor: disableTwoFactorMutation(fixtureAuth),
  regenerateBackupCodes: regenerateBackupCodesMutation(fixtureAuth),
};
