import { describe, expect, it } from 'vitest';

import { normalizeEmail } from '@core/domain/index.js';
import { createDb } from '@adapters/db/client.js';
import { createDevEmailPort } from '@adapters/email/dev.js';
import { createDevEmailReader, createDevMagicLinkReader } from '@adapters/db/repositories.js';

import { createAuth, createAuthPort } from './create-auth.js';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const buildAuth = () => {
  const db = createDb('node-postgres', connectionString);
  const auth = createAuth(db, {
    secret: 'create-auth-test-secret-at-least-32-characters',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    trustedOrigins: ['http://localhost:48730', 'http://studio.localhost:48730'],
    secureCookies: false,
    exposeMagicLinks: true,
    email: createDevEmailPort(db),
    defaultTenantName: 'Together',
    google: null,
  });
  return {
    auth,
    authPort: createAuthPort(auth),
    magicLinks: createDevMagicLinkReader(db),
    emails: createDevEmailReader(db),
  };
};

describe('createAuthPort.ensureUser', () => {
  it('creates a passwordless account once and is idempotent on the same email', async () => {
    const { authPort } = buildAuth();
    const email = `ensure-${Date.now()}@together.dev`;

    const first = await authPort.ensureUser(email);
    expect(first.created).toBe(true);
    expect(first.userId.length).toBeGreaterThan(0);

    const second = await authPort.ensureUser(email.toUpperCase());
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
  });
});

describe('createAuthPort.requestMagicLink', () => {
  it('rebases the verify link onto the requesting tenant host and sends an English email', async () => {
    const { authPort, magicLinks, emails } = buildAuth();
    const email = `magic-en-${Date.now()}@together.dev`;

    await authPort.requestMagicLink({
      email,
      callbackURL: 'http://studio.localhost:48730/my',
      tenantName: 'Studio',
      language: 'en',
      baseUrl: 'http://studio.localhost:48730',
    });

    const link = await magicLinks.findByEmail(normalizeEmail(email));
    expect(link).not.toBeNull();
    expect(new URL(link?.url ?? '').host).toBe('studio.localhost:48730');
    expect(link?.url).toContain('/api/auth/magic-link/verify');

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Sign in to Studio');
    expect(message?.html).toContain('studio.localhost:48730');
  });

  it('sends a Polish email when the requested language is pl', async () => {
    const { authPort, emails } = buildAuth();
    const email = `magic-pl-${Date.now()}@together.dev`;

    await authPort.requestMagicLink({
      email,
      callbackURL: 'http://studio.localhost:48730/my',
      tenantName: 'Studio',
      language: 'pl',
      baseUrl: 'http://studio.localhost:48730',
    });

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Zaloguj się do Studio');
  });

  it('keeps the base host when no tenant base URL is supplied', async () => {
    const { authPort, magicLinks } = buildAuth();
    const email = `magic-base-${Date.now()}@together.dev`;

    await authPort.requestMagicLink({ email, callbackURL: 'http://localhost:48730/my' });

    const link = await magicLinks.findByEmail(normalizeEmail(email));
    expect(new URL(link?.url ?? '').host).toBe('localhost:48730');
  });
});

describe('reset password email', () => {
  it('rebases the reset link onto the requesting host and sends an English email', async () => {
    const { auth, authPort, emails } = buildAuth();
    const email = `reset-en-${Date.now()}@together.dev`;
    await authPort.ensureUser(email);

    auth.setResetPasswordDeliveryContext(email, {
      language: 'en',
      baseUrl: 'http://studio.localhost:48730',
    });
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: '/reset-password' },
      headers: new Headers(),
    });

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Reset your password');
    expect(message?.html).toContain('http://studio.localhost:48730/reset-password?token=');
  });

  it('sends a Polish email when the requested language is pl', async () => {
    const { auth, authPort, emails } = buildAuth();
    const email = `reset-pl-${Date.now()}@together.dev`;
    await authPort.ensureUser(email);

    auth.setResetPasswordDeliveryContext(email, {
      language: 'pl',
      baseUrl: 'http://studio.localhost:48730',
    });
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: '/reset-password' },
      headers: new Headers(),
    });

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Zresetuj hasło');
    expect(message?.html).toContain('/reset-password?token=');
  });
});
