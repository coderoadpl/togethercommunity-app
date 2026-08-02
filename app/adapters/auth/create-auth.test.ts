import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { err, normalizeEmail, ok, validation } from '#core/domain/index.js';
import { createDb } from '#adapters/db/client.js';
import { account, user, verification } from '#adapters/db/schema.js';
import { createDevEmailPort } from '#adapters/email/dev.js';
import { createDevEmailReader, createDevMagicLinkReader } from '#adapters/db/repositories.js';
import { createEmailOutboxRepository } from '#adapters/db/email-outbox.js';
import { createEmailEventRepository } from '#adapters/db/email-events.js';
import { dispatchEmailBatch } from '#core/server/index.js';
import { InMemorySchedulerRunRepository } from '#core/server/testing/marketing-fakes.js';

import {
  createAuth,
  createAuthPort,
  PASSWORD_RESET_TOKEN_EXPIRES_IN_SECONDS,
  RESET_PASSWORD_CONTEXT_MAX_ENTRIES,
} from './create-auth.js';
import { deriveLegacyPasswordHash } from './legacy-password.js';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

let signUpIpSuffix = 1;

const buildAuth = (options: { consentRequired?: boolean; recordedEmails?: string[] } = {}) => {
  const db = createDb('node-postgres', connectionString);
  const emailOutbox = createEmailOutboxRepository(db);
  const clock = { nowIso: () => new Date().toISOString() };
  const flushEmails = () =>
    dispatchEmailBatch({
      emailOutbox,
      events: createEmailEventRepository(db),
      email: {
        send: async (message) => {
          const sent = await createDevEmailPort(db).send(message);
          return sent.ok ? ok({ ...sent.value, transport: 'platform' as const }) : sent;
        },
      },
      clock,
      logger: console,
      batchSize: 100,
      attemptsCap: 5,
      backoffBaseMs: 1000,
      backoffCapMs: 900000,
      ids: { nextId: () => crypto.randomUUID() },
      runs: new InMemorySchedulerRunRepository(),
      trigger: 'manual',
    });
  const dispatchEmail = (): void => undefined;
  const consentRequired = options.consentRequired ?? false;
  const auth = createAuth(db, {
    secret: 'create-auth-test-secret-at-least-32-characters',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    trustedOrigins: ['http://localhost:48730', 'http://studio.localhost:48730'],
    secureCookies: false,
    exposeMagicLinks: true,
    emailOutbox,
    ids: { nextId: () => crypto.randomUUID() },
    clock,
    dispatchEmail,
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
    flushEmails,
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
    const { authPort, magicLinks, emails, flushEmails } = buildAuth();
    const email = `magic-en-${Date.now()}@together.dev`;

    await authPort.requestMagicLink({
      email,
      callbackURL: 'http://studio.localhost:48730/my',
      tenantName: 'Studio',
      language: 'en',
      baseUrl: 'http://studio.localhost:48730',
    });
    await flushEmails();

    const link = await magicLinks.findByEmail(normalizeEmail(email));
    expect(link).not.toBeNull();
    expect(new URL(link?.url ?? '').host).toBe('studio.localhost:48730');
    expect(link?.url).toContain('/api/auth/magic-link/verify');

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Sign in to Studio');
    expect(message?.html).toContain('studio.localhost:48730');
  });

  it('sends a Polish email when the requested language is pl', async () => {
    const { authPort, emails, flushEmails } = buildAuth();
    const email = `magic-pl-${Date.now()}@together.dev`;

    await authPort.requestMagicLink({
      email,
      callbackURL: 'http://studio.localhost:48730/my',
      tenantName: 'Studio',
      language: 'pl',
      baseUrl: 'http://studio.localhost:48730',
    });
    await flushEmails();

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
    const { auth, authPort, emails, flushEmails } = buildAuth();
    const email = `reset-en-${Date.now()}@together.dev`;
    await authPort.ensureUser(email);

    auth.setResetPasswordDeliveryContext(email, {
      language: 'en',
      baseUrl: 'http://studio.localhost:48730',
    });
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: 'http://studio.localhost:48730/reset-password' },
      headers: new Headers(),
    });
    await flushEmails();

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Reset your password');
    const actionUrl = message?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
    const parsedActionUrl = new URL(actionUrl);
    expect(parsedActionUrl.host).toBe('studio.localhost:48730');
    expect(parsedActionUrl.pathname).toMatch(/^\/api\/auth\/reset-password\/[^/]+$/);
    expect(parsedActionUrl.searchParams.get('callbackURL')).toBe(
      'http://studio.localhost:48730/reset-password',
    );
  });

  it('sends a Polish email when the requested language is pl', async () => {
    const { auth, authPort, emails, flushEmails } = buildAuth();
    const email = `reset-pl-${Date.now()}@together.dev`;
    await authPort.ensureUser(email);

    auth.setResetPasswordDeliveryContext(email, {
      language: 'pl',
      baseUrl: 'http://studio.localhost:48730',
    });
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: 'http://studio.localhost:48730/reset-password' },
      headers: new Headers(),
    });
    await flushEmails();

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Zresetuj hasło');
    expect(message?.html).toContain('/api/auth/reset-password/');
  });

  it('returns indistinguishable responses for known and unknown addresses and emails only the known one', async () => {
    const { auth, authPort, emails, flushEmails } = buildAuth();
    const knownEmail = `reset-known-${Date.now()}@together.dev`;
    const unknownEmail = `reset-unknown-${Date.now()}@together.dev`;
    await authPort.ensureUser(knownEmail);
    const request = (email: string, ip: string) => auth.handler(
      new Request('http://studio.localhost:48730/api/auth/request-password-reset', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({
          email,
          redirectTo: 'http://studio.localhost:48730/reset-password',
        }),
      }),
    );

    const knownResponse = await request(knownEmail, '198.51.100.220');
    const unknownResponse = await request(unknownEmail, '198.51.100.221');
    const knownBody = await knownResponse.json();
    const unknownBody = await unknownResponse.json();
    await flushEmails();

    expect(knownResponse.status).toBe(200);
    expect(unknownResponse.status).toBe(knownResponse.status);
    expect(unknownBody).toEqual(knownBody);
    expect(await emails.findByRecipient(normalizeEmail(knownEmail))).not.toBeNull();
    expect(await emails.findByRecipient(normalizeEmail(unknownEmail))).toBeNull();
  });

  it('caps pending delivery contexts created by address enumeration', async () => {
    const { auth, authPort, emails, flushEmails } = buildAuth();
    const email = `reset-context-cap-${Date.now()}@together.dev`;
    await authPort.ensureUser(email);
    auth.setResetPasswordDeliveryContext(email, {
      language: 'en',
      baseUrl: 'http://studio.localhost:48730',
    });
    for (let index = 0; index < RESET_PASSWORD_CONTEXT_MAX_ENTRIES; index += 1) {
      auth.setResetPasswordDeliveryContext(`enumerated-${index}@together.dev`, {
        language: 'en',
        baseUrl: 'http://studio.localhost:48730',
      });
    }

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: 'http://studio.localhost:48730/reset-password' },
      headers: new Headers(),
    });
    await flushEmails();

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Zresetuj hasło');
    const actionUrl = message?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
    expect(new URL(actionUrl).host).toBe('localhost:48730');
  });

  it('expires reset tokens after one hour and revokes existing sessions on one-time completion', async () => {
    const { auth } = buildAuth();
    const db = createDb('node-postgres', connectionString);
    const passwordOptions = (await auth.$context).options.emailAndPassword;
    expect(passwordOptions?.resetPasswordTokenExpiresIn).toBe(PASSWORD_RESET_TOKEN_EXPIRES_IN_SECONDS);
    expect(passwordOptions?.revokeSessionsOnPasswordReset).toBe(true);
    const email = `reset-session-${Date.now()}@together.dev`;
    const signedUp = await signUp(auth, email, { password: 'old-password' });
    const sessionToken = signedUp.headers.get('set-auth-token');
    const requestedAt = Date.now();
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: 'http://studio.localhost:48730/reset-password' },
      headers: new Headers(),
    });
    const users = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    const tokens = await db
      .select({ identifier: verification.identifier, expiresAt: verification.expiresAt })
      .from(verification)
      .where(eq(verification.value, users[0]?.id ?? ''));
    const resetToken = tokens.find((row) => row.identifier.startsWith('reset-password:'));
    const expiresIn = (resetToken?.expiresAt.getTime() ?? 0) - requestedAt;

    expect(expiresIn).toBeGreaterThanOrEqual(
      PASSWORD_RESET_TOKEN_EXPIRES_IN_SECONDS * 1000 - 2000,
    );
    expect(expiresIn).toBeLessThanOrEqual(
      PASSWORD_RESET_TOKEN_EXPIRES_IN_SECONDS * 1000 + 2000,
    );
    const token = resetToken?.identifier.slice('reset-password:'.length) ?? '';
    const reset = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.222',
        },
        body: JSON.stringify({ token, newPassword: 'new-password' }),
      }),
    );
    const consumed = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.223',
        },
        body: JSON.stringify({ token, newPassword: 'another-password' }),
      }),
    );

    expect(reset.status).toBe(200);
    expect(await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${sessionToken ?? ''}` }),
    })).toBeNull();
    expect(consumed.status).toBe(400);
  });
});

describe('change password', () => {
  it('rotates the caller token, revokes the other session, and replaces the accepted password', async () => {
    const { auth } = buildAuth();
    const email = `change-password-${Date.now()}@together.dev`;
    const first = await signUp(auth, email, { password: 'old-password' });
    const firstToken = first.headers.get('set-auth-token');
    const second = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.210',
        },
        body: JSON.stringify({ email, password: 'old-password' }),
      }),
    );
    const secondToken = second.headers.get('set-auth-token');

    expect(firstToken).not.toBeNull();
    expect(secondToken).not.toBeNull();
    const changed = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/change-password', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${firstToken ?? ''}`,
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.211',
        },
        body: JSON.stringify({
          currentPassword: 'old-password',
          newPassword: 'new-password',
          revokeOtherSessions: true,
        }),
      }),
    );
    const replacementToken = changed.headers.get('set-auth-token');

    expect(changed.status).toBe(200);
    expect(replacementToken).not.toBeNull();
    expect(replacementToken).not.toBe(firstToken);
    expect(await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${replacementToken ?? ''}` }),
    })).not.toBeNull();
    expect(await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${secondToken ?? ''}` }),
    })).toBeNull();

    const oldPassword = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.212',
        },
        body: JSON.stringify({ email, password: 'old-password' }),
      }),
    );
    const newPassword = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.213',
        },
        body: JSON.stringify({ email, password: 'new-password' }),
      }),
    );

    expect(oldPassword.status).toBe(401);
    expect(newPassword.status).toBe(200);
  }, 30000);

  it('accepts and migrates an imported Payload PBKDF2 credential', async () => {
    const { auth } = buildAuth();
    const db = createDb('node-postgres', connectionString);
    const email = `change-legacy-${Date.now()}@together.dev`;
    const signedUp = await signUp(auth, email, { password: 'temporary-password' });
    const token = signedUp.headers.get('set-auth-token');
    const users = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    const legacyPassword = deriveLegacyPasswordHash('legacy-password', 'legacy-change-password-salt');
    await db
      .update(account)
      .set({ password: legacyPassword })
      .where(and(
        eq(account.userId, users[0]?.id ?? ''),
        eq(account.providerId, 'credential'),
      ));

    const changed = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/change-password', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token ?? ''}`,
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.214',
        },
        body: JSON.stringify({
          currentPassword: 'legacy-password',
          newPassword: 'native-password',
          revokeOtherSessions: false,
        }),
      }),
    );
    const credentials = await db
      .select({ password: account.password })
      .from(account)
      .where(and(
        eq(account.userId, users[0]?.id ?? ''),
        eq(account.providerId, 'credential'),
      ));

    expect(changed.status).toBe(200);
    expect(credentials[0]?.password).not.toBeNull();
    expect(credentials[0]?.password).not.toContain('payload-pbkdf2$');
    const signedIn = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.215',
        },
        body: JSON.stringify({ email, password: 'native-password' }),
      }),
    );
    expect(signedIn.status).toBe(200);
  }, 30000);

  it('allows twenty attempts per minute before rate limiting the endpoint', async () => {
    const { auth } = buildAuth();
    const email = `change-rate-limit-${Date.now()}@together.dev`;
    const signedUp = await signUp(auth, email, { password: 'current-password' });
    const token = signedUp.headers.get('set-auth-token');
    const attempt = () =>
      auth.handler(
        new Request('http://studio.localhost:48730/api/auth/change-password', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token ?? ''}`,
            'content-type': 'application/json',
            origin: 'http://studio.localhost:48730',
            'x-forwarded-for': '198.51.100.216',
          },
          body: JSON.stringify({
            currentPassword: 'wrong-password',
            newPassword: 'new-password',
            revokeOtherSessions: false,
          }),
        }),
      );

    const statuses: number[] = [];
    for (let count = 0; count < 21; count += 1) statuses.push((await attempt()).status);

    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  }, 30000);
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
