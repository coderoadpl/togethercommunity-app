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
import { ApiError, createApiClient, type ApiClient, type AuthClientPort } from '#core/client/index.js';
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

const PREVIEWABLE_PROPOSAL_IMAGE = `data:image/svg+xml,${encodeURIComponent([
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">',
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d4e89"/><stop offset="0.55" stop-color="#00b2ca"/><stop offset="1" stop-color="#f7c548"/></linearGradient></defs>',
  '<rect width="320" height="180" fill="url(#g)"/><rect x="40" y="60" width="150" height="14" rx="3" fill="#ffffff"/><rect x="40" y="86" width="100" height="10" rx="3" fill="#ffffff" opacity="0.7"/>',
  '<circle cx="250" cy="120" r="24" fill="#ffffff" opacity="0.85"/></svg>',
].join(''))}`;

export const STORY_PROPOSAL_IMAGE_DIGESTS = {
  previewable: '4f1d0c2b9a8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c',
  unreadable: '0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
} as const;

export const fixtureProposalImagePath = (realPath: (proposalId: string, digest: string) => string) => (proposalId: string, digest: string): string => {
  if (digest === STORY_PROPOSAL_IMAGE_DIGESTS.previewable) return PREVIEWABLE_PROPOSAL_IMAGE;
  if (digest === STORY_PROPOSAL_IMAGE_DIGESTS.unreadable) return 'data:image/png;base64,';
  return realPath(proposalId, digest);
};

export const STORY_PROPOSAL_GONE_FILE_ID = 'staged-file-discarded-workbook';

export const goneProposalFile = (): Promise<never> =>
  Promise.reject(new ApiError({ code: 'not_found', message: 'The proposed file is no longer available' }));

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
