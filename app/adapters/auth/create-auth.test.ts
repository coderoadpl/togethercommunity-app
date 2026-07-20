import { describe, expect, it } from 'vitest';

import { err, normalizeEmail, ok, validation } from '@core/domain/index.js';
import { createDb } from '@adapters/db/client.js';
import { createDevEmailPort } from '@adapters/email/dev.js';
import { createDevEmailReader, createDevMagicLinkReader } from '@adapters/db/repositories.js';

import { createAuth, createAuthPort } from './create-auth.js';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

let signUpIpSuffix = 1;

const buildAuth = (options: { consentRequired?: boolean; recordedEmails?: string[] } = {}) => {
  const db = createDb('node-postgres', connectionString);
  const consentRequired = options.consentRequired ?? false;
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
    validateSignUpConsent: async ({ accepted }) =>
      consentRequired && accepted !== true
        ? err(validation('Accepting the terms and privacy policy is required'))
        : ok({ required: consentRequired }),
    recordSignUpConsent: async ({ email }) => {
      if (!consentRequired) return ok({ recorded: false });
      options.recordedEmails?.push(email);
      return ok({ recorded: true });
    },
  });
  return {
    auth,
    authPort: createAuthPort(auth),
    magicLinks: createDevMagicLinkReader(db),
    emails: createDevEmailReader(db),
  };
};

const signUp = (
  auth: ReturnType<typeof buildAuth>['auth'],
  email: string,
  options: { termsAccepted?: unknown; password?: string } = {},
) =>
  auth.handler(
    new Request('http://studio.localhost:48730/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'studio.localhost:48730',
        origin: 'http://studio.localhost:48730',
        'x-forwarded-for': `198.51.100.${signUpIpSuffix++}`,
      },
      body: JSON.stringify({
        name: 'Ada',
        email,
        password: options.password ?? 'secret12',
        ...(options.termsAccepted === undefined ? {} : { termsAccepted: options.termsAccepted }),
      }),
    }),
  );

describe('email sign-up consent', () => {
  it('rejects signup before account creation when configured legal terms are not accepted', async () => {
    const recordedEmails: string[] = [];
    const { auth } = buildAuth({ consentRequired: true, recordedEmails });
    const email = `signup-no-consent-${Date.now()}@together.dev`;

    const response = await signUp(auth, email);
    const { internalAdapter } = await auth.$context;

    expect(response.status).toBe(400);
    expect(await internalAdapter.findUserByEmail(email)).toBeNull();
    expect(recordedEmails).toEqual([]);
  });

  it.each([999, 'yes', null])('rejects malformed consent %j before account creation', async (termsAccepted) => {
    const recordedEmails: string[] = [];
    const { auth } = buildAuth({ consentRequired: true, recordedEmails });
    const email = `signup-malformed-consent-${String(termsAccepted)}-${Date.now()}@together.dev`;

    const response = await signUp(auth, email, { termsAccepted });
    const { internalAdapter } = await auth.$context;

    expect(response.status).toBe(400);
    expect(await internalAdapter.findUserByEmail(email)).toBeNull();
    expect(recordedEmails).toEqual([]);
  });

  it('does not record consent when account validation fails downstream', async () => {
    const recordedEmails: string[] = [];
    const { auth } = buildAuth({ consentRequired: true, recordedEmails });
    const email = `signup-short-password-${Date.now()}@together.dev`;

    const response = await signUp(auth, email, { termsAccepted: true, password: 'x' });
    const { internalAdapter } = await auth.$context;

    expect(response.status).toBe(400);
    expect(await internalAdapter.findUserByEmail(email)).toBeNull();
    expect(recordedEmails).toEqual([]);
  });

  it('records accepted consent once after creating the account on a configured tenant', async () => {
    const recordedEmails: string[] = [];
    const { auth } = buildAuth({ consentRequired: true, recordedEmails });
    const email = `signup-consent-${Date.now()}@together.dev`;

    const response = await signUp(auth, email, { termsAccepted: true });
    const { internalAdapter } = await auth.$context;

    expect(response.status).toBe(200);
    expect(recordedEmails).toEqual([email]);
    expect(await internalAdapter.findUserByEmail(email)).not.toBeNull();
  });

  it('keeps signup unchanged when the tenant has no configured legal URLs', async () => {
    const { auth } = buildAuth();
    const email = `signup-no-legal-${Date.now()}@together.dev`;

    const response = await signUp(auth, email);
    const { internalAdapter } = await auth.$context;

    expect(response.status).toBe(200);
    expect(await internalAdapter.findUserByEmail(email)).not.toBeNull();
  });
});

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

describe('createAuthPort.createEnrollmentMagicLink', () => {
  it('rebases the captured enrollment link onto the tenant host', async () => {
    const { authPort } = buildAuth();
    const email = `enrollment-${Date.now()}@together.dev`;

    const created = await authPort.createEnrollmentMagicLink({
      email,
      callbackURL: 'http://studio.localhost:48730/',
      baseUrl: 'http://studio.localhost:48730',
      tenantName: 'Studio',
      language: 'en',
    });

    expect(new URL(created.url).host).toBe('studio.localhost:48730');
    expect(new URL(created.url).host).not.toBe('localhost:48730');
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

describe('email-endpoint rate limiting', () => {
  it('returns 429 once the magic-link window limit is exceeded and stays available below it', async () => {
    const { auth } = buildAuth();
    const email = `rate-limit-${Date.now()}@together.dev`;
    const hammer = () =>
      auth.handler(
        new Request('http://localhost:48730/api/auth/sign-in/magic-link', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:48730' },
          body: JSON.stringify({ email, callbackURL: '/my' }),
        }),
      );

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt += 1) statuses.push((await hammer()).status);

    expect(statuses[0]).not.toBe(429);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });
});
