import { describe, expect, it } from 'vitest';

import { AUTH_POLICY, createAuth } from '#adapters/auth/create-auth.js';
import { createDb } from '#adapters/db/client.js';
import { createEmailOutboxRepository } from '#adapters/db/email-outbox.js';
import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

const db = createDb('node-postgres', 'postgresql://probe:probe@localhost:1/probe');
const auth = createAuth(db, {
  secret: 'auth-policy-probe-secret-at-least-32-characters',
  baseUrl: 'http://localhost:48730',
  baseDomain: 'localhost',
  trustedOrigins: ['http://localhost:48730'],
  secureCookies: false,
  exposeMagicLinks: false,
  emailOutbox: createEmailOutboxRepository(db),
  ids: { nextId: () => crypto.randomUUID() },
  clock: { nowIso: () => new Date(0).toISOString() },
  dispatchEmail: () => undefined,
  defaultTenantName: 'Together',
  google: null,
  singleTenantMode: false,
});
type AuthPlugin = (typeof auth.options.plugins)[number];
type TwoFactorPlugin = Extract<AuthPlugin, { id: 'two-factor' }>;
const isTwoFactorPlugin = (plugin: AuthPlugin): plugin is TwoFactorPlugin =>
  plugin.id === 'two-factor';
const twoFactorPlugin = auth.options.plugins.find(isTwoFactorPlugin);

describe('composed auth policy', () => {
  it('pins the 7-day session expiry and 1-day activity refresh', () => {
    expect(AUTH_POLICY.sessionExpiresInSeconds).toBe(60 * 60 * 24 * 7);
    expect(AUTH_POLICY.sessionUpdateAgeSeconds).toBe(60 * 60 * 24);
    expect(auth.options.session?.expiresIn).toBe(AUTH_POLICY.sessionExpiresInSeconds);
    expect(auth.options.session?.updateAge).toBe(AUTH_POLICY.sessionUpdateAgeSeconds);
    expect(AUTH_POLICY.sessionUpdateAgeSeconds).toBeLessThan(AUTH_POLICY.sessionExpiresInSeconds);
  });

  it('hands the provider ten backup codes and 6-digit TOTP on a 30-second period', () => {
    expect(AUTH_POLICY.twoFactorBackupCodeCount).toBe(10);
    expect(AUTH_POLICY.totpDigits).toBe(6);
    expect(AUTH_POLICY.totpPeriodSeconds).toBe(30);
    expect(twoFactorPlugin?.options.backupCodeOptions?.amount).toBe(
      AUTH_POLICY.twoFactorBackupCodeCount,
    );
    expect(twoFactorPlugin?.options.totpOptions?.digits).toBe(AUTH_POLICY.totpDigits);
    expect(twoFactorPlugin?.options.totpOptions?.period).toBe(AUTH_POLICY.totpPeriodSeconds);
  });

  it('hands the provider the shared fifteen-character password floor', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(15);
    expect(auth.options.emailAndPassword?.minPasswordLength).toBe(PASSWORD_MIN_LENGTH);
  });
});
