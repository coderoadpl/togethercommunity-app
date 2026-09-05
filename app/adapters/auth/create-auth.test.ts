import { describe, expect, it } from 'vitest';
import { BASE_ERROR_CODES } from 'better-auth';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { z } from 'zod';

import { err, normalizeEmail, ok, PASSWORD_MIN_LENGTH, validation } from '#core/domain/index.js';
import { createDb } from '#adapters/db/client.js';
import { user, verification } from '#adapters/db/schema.js';
import { createDevEmailPort } from '#adapters/email/dev.js';
import { createDevEmailReader, createDevMagicLinkReader } from '#adapters/db/repositories.js';
import { createEmailOutboxRepository } from '#adapters/db/email-outbox.js';
import { createEmailEventRepository } from '#adapters/db/email-events.js';
import { dispatchEmailBatch } from '#core/server/index.js';
import { InMemorySchedulerRunRepository } from '#core/server/testing/marketing-fakes.js';

import {
  authRequestHost,
  baseRelyingPartyId,
  createAuth,
  createAuthPort,
  hostServedByBaseDomain,
  isPasskeyCeremonyPath,
  sharedCookieDomain,
  EMAIL_VERIFICATION_CONTEXT_MAX_ENTRIES,
  isAdditionalTwoFactorPath,
  isSensitivePasskeyPath,
  isSuccessfulPasswordVerification,
  MAGIC_LINK_CONTEXT_MAX_ENTRIES,
  MAGIC_LINK_TOKEN_EXPIRES_IN_SECONDS,
  PASSKEY_SENSITIVE_PROOF_MAX_AGE_SECONDS,
  passwordResetOriginMatches,
  PASSWORD_RESET_TOKEN_EXPIRES_IN_SECONDS,
  RESET_PASSWORD_CONTEXT_MAX_ENTRIES,
} from './create-auth.js';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

let signUpIpSuffix = 1;

const passwordFixture = (value: string): string =>
  value.padEnd(PASSWORD_MIN_LENGTH, 'x');
const SIGN_UP_PASSWORD = passwordFixture('signup-password');
const OLD_PASSWORD = passwordFixture('old-password');
const NEW_PASSWORD = passwordFixture('new-password');
const CURRENT_PASSWORD = passwordFixture('current-password');

const totpCode = (secret: string): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.toUpperCase().replace(/=+$/u, '')) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Invalid base32 secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = ((digest[offset] ?? 0) & 0x7f) << 24 |
    (digest[offset + 1] ?? 0) << 16 |
    (digest[offset + 2] ?? 0) << 8 |
    (digest[offset + 3] ?? 0);
  return (binary % 1_000_000).toString().padStart(6, '0');
};

describe('ASVS authentication policy', () => {
  it.each([
    '/callback/google',
    '/magic-link/verify',
    '/passkey/verify-authentication',
    '/sign-in/social',
  ])('requires the existing two-factor plugin after %s', (path) => {
    expect(isAdditionalTwoFactorPath(path)).toBe(true);
  });

  it('does not challenge an ordinary authenticated command', () => {
    expect(isAdditionalTwoFactorPath('/change-password')).toBe(false);
  });

  it('confines password-reset redirects to the exact requesting origin', () => {
    const headers = new Headers({ origin: 'https://one.example' });
    expect(passwordResetOriginMatches(
      { redirectTo: 'https://one.example/reset-password' },
      headers,
    )).toBe(true);
    expect(passwordResetOriginMatches(
      { redirectTo: 'https://two.example/reset-password' },
      headers,
    )).toBe(false);
    expect(passwordResetOriginMatches({ redirectTo: 'not-a-url' }, headers)).toBe(false);
    expect(passwordResetOriginMatches({ redirectTo: 'https://one.example/reset' }, undefined)).toBe(false);
  });

  it.each([
    '/passkey/generate-register-options',
    '/passkey/verify-registration',
    '/passkey/delete-passkey',
  ])('requires a recent user-bound proof for %s', (path) => {
    expect(isSensitivePasskeyPath(path)).toBe(true);
  });

  it('recognizes only successful password proof responses', () => {
    expect(isSuccessfulPasswordVerification({ status: true })).toBe(true);
    expect(isSuccessfulPasswordVerification({ status: false })).toBe(false);
  });
});

describe('real-provider sign-in and passkey proofs', () => {
  it('challenges password and magic-link sign-ins and redeems each backup code once', async () => {
    const { auth } = buildAuth();
    const email = `two-factor-${Date.now()}@together.dev`;
    const password = passwordFixture('password-1234');
    const signedUp = await signUp(auth, email, { password });
    const token = signedUp.headers.get('set-auth-token') ?? '';
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => auth.handler(
      new Request(`http://studio.localhost:48730/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );

    const enabled = await post('/two-factor/enable', { password }, {
      authorization: `Bearer ${token}`,
    });
    const enrollment = z.object({
      totpURI: z.string(),
      backupCodes: z.array(z.string()).min(1),
    }).parse(await enabled.json());
    const secret = new URL(enrollment.totpURI).searchParams.get('secret') ?? '';
    const verifiedEnrollment = await post('/two-factor/verify-totp', {
      code: totpCode(secret),
    }, { authorization: `Bearer ${token}` });
    expect(verifiedEnrollment.status).toBe(200);

    const challenged = await post('/sign-in/email', { email, password });
    expect(challenged.status).toBe(200);
    expect(await challenged.json()).toMatchObject({ twoFactorRedirect: true });
    const provisionalToken = challenged.headers.get('set-auth-token') ?? '';
    expect(await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${provisionalToken}` }),
    })).toBeNull();
    const challengeCookie = challenged.headers.getSetCookie()
      .find((entry) => entry.startsWith('better-auth.two_factor='))
      ?.split(';')[0] ?? '';
    expect(challengeCookie).not.toBe('');
    expect(challenged.headers.getSetCookie().some((entry) =>
      entry.startsWith('better-auth.session_token=') && entry.includes('Max-Age=0'))).toBe(true);

    const backupCode = enrollment.backupCodes[0] ?? '';
    const completed = await post('/two-factor/verify-backup-code', {
      code: backupCode,
      trustDevice: true,
    }, {
      cookie: challengeCookie,
    });
    expect(completed.status).toBe(200);
    expect(completed.headers.get('set-auth-token')).not.toBeNull();
    const completedCookies = completed.headers.getSetCookie();
    const completedSessionCookie = completedCookies
      .find((entry) => entry.startsWith('better-auth.session_token='))
      ?.split(';')[0] ?? '';
    const trustDeviceCookie = completedCookies
      .find((entry) => entry.includes('.trust_device='))
      ?.split(';')[0] ?? '';
    expect(completedCookies.some((entry) => entry.includes('.passkey_sensitive='))).toBe(false);
    expect(trustDeviceCookie).not.toBe('');
    const passkeyOptions = await auth.handler(new Request(
      'http://studio.localhost:48730/api/auth/passkey/generate-register-options',
      {
        headers: {
          origin: 'http://studio.localhost:48730',
          cookie: completedSessionCookie,
        },
      },
    ));
    expect(passkeyOptions.status).toBe(403);

    const challengedAgain = await post('/sign-in/email', { email, password }, {
      cookie: trustDeviceCookie,
    });
    expect(await challengedAgain.clone().json()).toMatchObject({ twoFactorRedirect: true });
    const nextChallengeCookie = challengedAgain.headers.getSetCookie()
      .find((entry) => entry.startsWith('better-auth.two_factor='))
      ?.split(';')[0] ?? '';
    const replayed = await post('/two-factor/verify-backup-code', { code: backupCode }, {
      cookie: nextChallengeCookie,
    });
    expect(replayed.status).toBe(401);
    const invalidTotp = await post('/two-factor/verify-totp', { code: 'not-a-code' }, {
      cookie: nextChallengeCookie,
    });
    expect(invalidTotp.status).toBeGreaterThanOrEqual(400);

    auth.setMagicLinkDeliveryContext(email, {
      language: 'en',
      mode: 'capture',
      baseUrl: 'http://studio.localhost:48730',
    });
    await post('/sign-in/magic-link', {
      email,
      callbackURL: 'http://studio.localhost:48730/my',
    });
    const captured = auth.consumeCapturedMagicLink(email);
    const magicResponse = await auth.handler(new Request(captured?.url ?? '', { redirect: 'manual' }));
    expect(magicResponse.status).toBe(302);
    expect(magicResponse.headers.get('location')).toBe(
      'http://studio.localhost:48730/login?twoFactor=required',
    );
    expect(magicResponse.headers.getSetCookie().some((entry) =>
      entry.startsWith('better-auth.two_factor='))).toBe(true);
  });

  it('issues and accepts the prefixed challenge cookie used by HTTPS deployments', async () => {
    const { auth } = buildAuth({ secureCookies: true });
    const email = `secure-two-factor-${Date.now()}@together.dev`;
    const password = passwordFixture('password-1234');
    const signedUp = await signUp(auth, email, { password });
    const token = signedUp.headers.get('set-auth-token') ?? '';
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => auth.handler(
      new Request(`http://studio.localhost:48730/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );

    const enabled = await post('/two-factor/enable', { password }, {
      authorization: `Bearer ${token}`,
    });
    const enrollment = z.object({
      totpURI: z.string(),
      backupCodes: z.array(z.string()).min(1),
    }).parse(await enabled.json());
    const secret = new URL(enrollment.totpURI).searchParams.get('secret') ?? '';
    expect((await post('/two-factor/verify-totp', {
      code: totpCode(secret),
    }, { authorization: `Bearer ${token}` })).status).toBe(200);

    const challenged = await post('/sign-in/email', { email, password });
    const challengeCookie = challenged.headers.getSetCookie()
      .find((entry) => entry.startsWith('__Secure-better-auth.two_factor='))
      ?.split(';')[0] ?? '';
    expect(await challenged.json()).toMatchObject({ twoFactorRedirect: true });
    expect(challengeCookie).not.toBe('');

    const completed = await post('/two-factor/verify-backup-code', {
      code: enrollment.backupCodes[0] ?? '',
    }, { cookie: challengeCookie });
    expect(completed.status).toBe(200);
    expect(completed.headers.get('set-auth-token')).not.toBeNull();
  });

  it.each(['/callback/google', '/passkey/verify-authentication', '/sign-in/social'])(
    'extends the two-factor after hook to %s when the route supplies a new session',
    async (path) => {
      const { auth } = buildAuth();
      const email = `additional-two-factor-${path.replaceAll('/', '-')}-${Date.now()}@together.dev`;
      const password = passwordFixture('password-1234');
      const signedUp = await signUp(auth, email, { password });
      const token = signedUp.headers.get('set-auth-token') ?? '';
      const post = (endpointPath: string, body: unknown) => auth.handler(
        new Request(`http://studio.localhost:48730/api/auth${endpointPath}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            origin: 'http://studio.localhost:48730',
            'x-forwarded-for': `198.51.100.${signUpIpSuffix++}`,
          },
          body: JSON.stringify(body),
        }),
      );
      const enabled = await post('/two-factor/enable', { password });
      const enrollment = z.object({ totpURI: z.string() }).parse(await enabled.json());
      const secret = new URL(enrollment.totpURI).searchParams.get('secret') ?? '';
      expect((await post('/two-factor/verify-totp', { code: totpCode(secret) })).status).toBe(200);

      const context = await auth.$context;
      const found = await context.internalAdapter.findUserByEmail(email);
      if (found === null) throw new Error('Two-factor test user was not found');
      const session = await context.internalAdapter.createSession(found.user.id);
      if (session === null) throw new Error('Two-factor test session was not created');
      const plugin: unknown = context.options.plugins?.find(
        (candidate) => candidate.id === 'two-factor',
      );
      const hooks = typeof plugin === 'object' && plugin !== null
        ? Reflect.get(plugin, 'hooks')
        : undefined;
      const after = typeof hooks === 'object' && hooks !== null
        ? Reflect.get(hooks, 'after')
        : undefined;
      const hook = z.object({
        matcher: z.function()
          .args(z.object({ path: z.string().optional() }))
          .returns(z.boolean()),
        handler: z.function().args(z.unknown()).returns(z.promise(z.unknown())),
      }).parse(Array.isArray(after) ? after[0] : undefined);
      let pendingSession: unknown = { session, user: found.user };

      expect(hook.matcher({ path })).toBe(true);
      const challenged = z.object({
        headers: z.instanceof(Headers),
        response: z.unknown(),
      }).parse(await hook.handler({
        path,
        headers: new Headers({ origin: 'http://studio.localhost:48730' }),
        context: {
          ...context,
          newSession: pendingSession,
          setNewSession: (value: unknown) => { pendingSession = value; },
        },
        returnHeaders: true,
      }));

      expect(challenged.response).toMatchObject({ twoFactorRedirect: true });
      expect(challenged.headers.getSetCookie().some((entry) =>
        entry.startsWith('better-auth.two_factor='))).toBe(true);
      expect(pendingSession).toBeNull();
      expect(await auth.api.getSession({
        headers: new Headers({ authorization: `Bearer ${session.token}` }),
      })).toBeNull();
    },
  );

  it('requires a fresh user-bound password proof before passkey registration', async () => {
    const { auth } = buildAuth();
    const email = `passkey-proof-${Date.now()}@together.dev`;
    const password = passwordFixture('password-1234');
    const signedUp = await signUp(auth, email, { password });
    const sessionCookie = signedUp.headers.getSetCookie()
      .find((entry) => entry.startsWith('better-auth.session_token='))
      ?.split(';')[0] ?? '';
    const registrationOptions = (proofCookie = '') => auth.handler(
      new Request(
        'http://studio.localhost:48730/api/auth/passkey/generate-register-options',
        {
          headers: {
            origin: 'http://studio.localhost:48730',
            cookie: [sessionCookie, proofCookie].filter(Boolean).join('; '),
          },
        },
      ),
    );

    expect((await registrationOptions()).status).toBe(403);
    const rejected = await auth.handler(new Request(
      'http://studio.localhost:48730/api/auth/verify-password',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          cookie: sessionCookie,
        },
        body: JSON.stringify({ password: 'wrong-password' }),
      },
    ));
    expect(rejected.status).toBe(400);
    expect(rejected.headers.getSetCookie().some((entry) =>
      entry.includes('.passkey_sensitive='))).toBe(false);

    const verified = await auth.handler(new Request(
      'http://studio.localhost:48730/api/auth/verify-password',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          cookie: sessionCookie,
        },
        body: JSON.stringify({ password }),
      },
    ));
    const proofCookie = verified.headers.getSetCookie()
      .find((entry) => entry.includes('.passkey_sensitive='))
      ?.split(';')[0] ?? '';
    const proofSetCookie = verified.headers.getSetCookie()
      .find((entry) => entry.includes('.passkey_sensitive=')) ?? '';
    expect(proofCookie).not.toBe('');
    expect(proofSetCookie).toContain(
      `Max-Age=${String(PASSKEY_SENSITIVE_PROOF_MAX_AGE_SECONDS)}`,
    );
    expect((await registrationOptions(proofCookie)).status).toBe(200);
  });
});

const buildAuth = (options: {
  consentRequired?: boolean;
  recordedEmails?: string[];
  secureCookies?: boolean;
  baseDomain?: string;
  singleTenantMode?: boolean;
  verifiedCustomHosts?: string[];
  trustedOrigins?: string[];
} = {}) => {
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
    baseDomain: options.baseDomain ?? 'localhost',
    singleTenantMode: options.singleTenantMode ?? false,
    trustedOrigins: options.trustedOrigins ??
      ['http://localhost:48730', 'http://studio.localhost:48730'],
    secureCookies: options.secureCookies ?? false,
    isVerifiedCustomHost: async (host) =>
      (options.verifiedCustomHosts ?? []).includes(host),
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

describe('auth cookie scope', () => {
  it('composes soft email verification without blocking password sign-in', async () => {
    const { auth } = buildAuth();
    const options = (await auth.$context).options;
    expect(options.emailAndPassword?.requireEmailVerification).toBe(false);
    expect(options.emailVerification?.sendOnSignUp).toBe(true);
    expect(options.emailVerification?.autoSignInAfterVerification).toBe(true);
    expect(options.emailVerification?.sendVerificationEmail).toBeTypeOf('function');
  });

  it('keeps cookies host-only in single-tenant mode on a non-localhost domain', async () => {
    const { auth } = buildAuth({
      baseDomain: 'learn.example.com',
      singleTenantMode: true,
    });

    expect((await auth.$context).options.advanced?.crossSubDomainCookies).toBeUndefined();
  });

  it('shares cookies across tenant subdomains only in multi-tenant mode', async () => {
    const { auth } = buildAuth({
      baseDomain: 'example.com',
      singleTenantMode: false,
    });

    expect((await auth.$context).options.advanced?.crossSubDomainCookies).toEqual({
      enabled: true,
      domain: '.example.com',
    });
  });
});

describe('host scope derivation', () => {
  const deployed = {
    baseUrl: 'https://start.together.example',
    baseDomain: 'together.example',
    singleTenantMode: false,
  };

  it('shares the base domain across tenant subdomains when one is routable', () => {
    expect(sharedCookieDomain(deployed)).toBe('.together.example');
    expect(baseRelyingPartyId(deployed)).toBe('together.example');
  });

  it.each([
    ['single-tenant mode', { ...deployed, singleTenantMode: true }],
    ['a localhost base domain', {
      baseUrl: 'http://acme.localhost:48730',
      baseDomain: 'localhost',
      singleTenantMode: false,
    }],
  ])('keeps cookies and the relying party on the configured host for %s', (_case, routing) => {
    expect(sharedCookieDomain(routing)).toBeNull();
    expect(baseRelyingPartyId(routing)).toBe(new URL(routing.baseUrl).hostname);
  });

  it('separates hosts served by the base domain from custom ones', () => {
    expect(hostServedByBaseDomain('together.example', 'together.example')).toBe(true);
    expect(hostServedByBaseDomain('acme.together.example', 'together.example')).toBe(true);
    expect(hostServedByBaseDomain('kurs.coderoad.example', 'together.example')).toBe(false);
    expect(hostServedByBaseDomain('kurs.coderoad.localhost', 'localhost')).toBe(false);
  });

  it('recognizes the ceremonies that carry a relying party', () => {
    expect(isPasskeyCeremonyPath('/passkey/verify-authentication')).toBe(true);
    expect(isPasskeyCeremonyPath('/passkey/list-user-passkeys')).toBe(false);
    expect(isPasskeyCeremonyPath(undefined)).toBe(false);
  });

  it('reads the request host from the header, then the URL, without its port', () => {
    expect(authRequestHost({ headers: new Headers({ host: 'KURS.coderoad.example:8443' }) }))
      .toBe('kurs.coderoad.example');
    expect(authRequestHost({ request: new Request('http://acme.localhost:48730/api/auth/ok') }))
      .toBe('acme.localhost');
    expect(authRequestHost({})).toBeNull();
  });
});

describe('host-scoped credentials', () => {
  const baseDomain = 'together.example';
  const tenantHost = `acme.${baseDomain}`;
  const customHost = 'kurs.coderoad.example';

  const buildHostAuth = () => buildAuth({
    baseDomain,
    verifiedCustomHosts: [customHost],
    trustedOrigins: [
      'http://localhost:48730',
      `http://${tenantHost}`,
      `http://${customHost}`,
    ],
  });

  const call = (
    auth: ReturnType<typeof buildAuth>['auth'],
    host: string,
    path: string,
    init: { body?: unknown; cookie?: string; authorization?: string } = {},
  ) => auth.handler(new Request(`http://${host}/api/auth${path}`, {
    ...(init.body === undefined ? {} : { method: 'POST', body: JSON.stringify(init.body) }),
    headers: {
      'content-type': 'application/json',
      host,
      origin: `http://${host}`,
      'x-forwarded-for': `203.0.113.${signUpIpSuffix++}`,
      ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
      ...(init.authorization === undefined ? {} : { authorization: init.authorization }),
    },
  }));

  const sessionCookie = (response: Response): string =>
    response.headers.getSetCookie()
      .find((entry) => entry.startsWith('better-auth.session_token=') && !entry.includes('Max-Age=0'))
    ?? '';

  const register = async (
    auth: ReturnType<typeof buildAuth>['auth'],
    host: string,
    email: string,
    password: string,
  ) => {
    const response = await call(auth, host, '/sign-up/email', {
      body: { name: 'Ada', email, password, callbackURL: `http://${host}/my` },
    });
    expect(response.status).toBe(200);
    return response.headers.get('set-auth-token') ?? '';
  };

  it('keeps the shared base-domain scope for a tenant subdomain sign-in', async () => {
    const { auth } = buildHostAuth();
    const email = `subdomain-scope-${Date.now()}@together.dev`;
    const password = passwordFixture('subdomain-scope');
    await register(auth, tenantHost, email, password);

    const signedIn = await call(auth, tenantHost, '/sign-in/email', { body: { email, password } });

    expect(signedIn.status).toBe(200);
    expect(sessionCookie(signedIn)).toContain(`Domain=.${baseDomain}`);
  });

  it('scopes a password sign-in to the verified custom host only', async () => {
    const { auth } = buildHostAuth();
    const email = `custom-scope-${Date.now()}@together.dev`;
    const password = passwordFixture('custom-scope');
    await register(auth, customHost, email, password);

    const signedIn = await call(auth, customHost, '/sign-in/email', { body: { email, password } });

    expect(signedIn.status).toBe(200);
    expect(sessionCookie(signedIn)).not.toBe('');
    expect(sessionCookie(signedIn)).not.toContain('Domain=');
  });

  it('scopes a magic-link sign-in to the verified custom host only', async () => {
    const { auth } = buildHostAuth();
    const email = `custom-magic-${Date.now()}@together.dev`;
    auth.setMagicLinkDeliveryContext(email, {
      language: 'pl',
      mode: 'capture',
      baseUrl: `http://${customHost}`,
    });
    await call(auth, customHost, '/sign-in/magic-link', {
      body: { email, callbackURL: `http://${customHost}/my` },
    });
    const captured = auth.consumeCapturedMagicLink(email);
    expect(captured?.url).toContain(customHost);

    const verified = await auth.handler(new Request(captured?.url ?? '', { redirect: 'manual' }));

    expect(verified.status).toBe(302);
    expect(sessionCookie(verified)).not.toBe('');
    expect(sessionCookie(verified)).not.toContain('Domain=');
  });

  it('scopes the two-factor challenge and its session to the verified custom host', async () => {
    const { auth } = buildHostAuth();
    const email = `custom-two-factor-${Date.now()}@together.dev`;
    const password = passwordFixture('custom-two-factor');
    const token = await register(auth, customHost, email, password);
    const enabled = await call(auth, customHost, '/two-factor/enable', {
      body: { password },
      authorization: `Bearer ${token}`,
    });
    const secret = new URL(
      z.object({ totpURI: z.string() }).parse(await enabled.json()).totpURI,
    ).searchParams.get('secret') ?? '';
    await call(auth, customHost, '/two-factor/verify-totp', {
      body: { code: totpCode(secret) },
      authorization: `Bearer ${token}`,
    });

    const challenged = await call(auth, customHost, '/sign-in/email', { body: { email, password } });
    const challengeCookie = challenged.headers.getSetCookie()
      .find((entry) => entry.startsWith('better-auth.two_factor=')) ?? '';
    expect(challengeCookie).not.toBe('');
    expect(challengeCookie).not.toContain('Domain=');

    const completed = await call(auth, customHost, '/two-factor/verify-totp', {
      body: { code: totpCode(secret) },
      cookie: challengeCookie.split(';')[0] ?? '',
    });

    expect(completed.status).toBe(200);
    expect(sessionCookie(completed)).not.toContain('Domain=');
  });

  it('answers passkey ceremonies for the base domain and for the verified custom host', async () => {
    const { auth } = buildHostAuth();
    const relyingParty = async (host: string): Promise<string> => {
      const response = await call(auth, host, '/passkey/generate-authenticate-options');
      expect(response.status).toBe(200);
      return z.object({ rpId: z.string() }).parse(await response.json()).rpId;
    };

    expect(await relyingParty(tenantHost)).toBe(baseDomain);
    expect(await relyingParty(customHost)).toBe(customHost);
  });

  it('keeps the passkey challenge cookie inside the custom host cookie world', async () => {
    const { auth } = buildHostAuth();
    const challenge = await call(auth, customHost, '/passkey/generate-authenticate-options');
    const challengeCookie = challenge.headers.getSetCookie()
      .find((entry) => entry.startsWith('better-auth.better-auth-passkey=')) ?? '';

    expect(challengeCookie).not.toBe('');
    expect(challengeCookie).not.toContain('Domain=');
  });
});

const signUp = (
  auth: ReturnType<typeof buildAuth>['auth'],
  email: string,
  options: {
    termsAccepted?: unknown;
    password?: string;
    callbackURL?: string;
    image?: string;
  } = {},
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
        password: options.password ?? SIGN_UP_PASSWORD,
        callbackURL: options.callbackURL ?? 'http://studio.localhost:48730/login?verification=verified',
        ...(options.termsAccepted === undefined ? {} : { termsAccepted: options.termsAccepted }),
        ...(options.image === undefined ? {} : { image: options.image }),
      }),
    }),
  );

describe('soft email verification', () => {
  it('keeps redirect error outcomes aligned with Better Auth', () => {
    expect(BASE_ERROR_CODES.TOKEN_EXPIRED.code).toBe('TOKEN_EXPIRED');
    expect(BASE_ERROR_CODES.INVALID_TOKEN.code).toBe('INVALID_TOKEN');
  });

  it('queues a bilingual tenant-host link on signup while leaving sign-in available', async () => {
    const { auth, authPort, emails, flushEmails } = buildAuth();
    const email = `verification-signup-${Date.now()}@together.dev`;
    auth.setEmailVerificationDeliveryContext(email, {
      language: 'en',
      baseUrl: 'http://studio.localhost:48730',
    });

    const signedUp = await signUp(auth, email);
    await flushEmails();

    expect(signedUp.status).toBe(200);
    const signedIn = await auth.handler(new Request('http://studio.localhost:48730/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'studio.localhost:48730',
        origin: 'http://studio.localhost:48730',
        'x-forwarded-for': `198.51.100.${signUpIpSuffix++}`,
      },
      body: JSON.stringify({ email, password: SIGN_UP_PASSWORD }),
    }));
    expect(signedIn.status).toBe(200);

    const session = await authPort.getAuthenticatedUser(new Headers({
      authorization: `Bearer ${signedIn.headers.get('set-auth-token') ?? ''}`,
    }));
    expect(session).toMatchObject({ email, emailVerified: false });

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Verify your email address');
    const actionUrl = message?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
    expect(new URL(actionUrl).host).toBe('studio.localhost:48730');

    const verified = await auth.handler(new Request(actionUrl));
    expect(verified.status).toBe(302);
    const { internalAdapter } = await auth.$context;
    expect((await internalAdapter.findUserByEmail(email))?.user.emailVerified).toBe(true);
  });

  it('resends a Polish verification link through the outbox', async () => {
    const { auth, emails, flushEmails } = buildAuth();
    const email = `verification-resend-${Date.now()}@together.dev`;
    await signUp(auth, email);
    await flushEmails();
    auth.setEmailVerificationDeliveryContext(email, {
      language: 'pl',
      baseUrl: 'http://studio.localhost:48730',
    });

    const response = await auth.api.sendVerificationEmail({
      body: { email, callbackURL: 'http://studio.localhost:48730/login?verification=verified' },
      headers: new Headers({ 'x-forwarded-for': `198.51.100.${signUpIpSuffix++}` }),
    });
    await flushEmails();

    expect(response.status).toBe(true);
    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Potwierdź swój adres e-mail');
    expect(message?.text).toContain('studio.localhost:48730');
  });

  it('returns indistinguishable resend responses for known and unknown addresses', async () => {
    const { auth, emails, flushEmails } = buildAuth();
    const knownEmail = `verification-known-${Date.now()}@together.dev`;
    const unknownEmail = `verification-unknown-${Date.now()}@together.dev`;
    await signUp(auth, knownEmail);
    const request = (email: string, ip: string) => auth.handler(
      new Request('http://studio.localhost:48730/api/auth/send-verification-email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({
          email,
          callbackURL: 'http://studio.localhost:48730/login?verification=verified',
        }),
      }),
    );

    const knownResponse = await request(knownEmail, '198.51.100.224');
    const unknownResponse = await request(unknownEmail, '198.51.100.225');
    const knownBody = await knownResponse.json();
    const unknownBody = await unknownResponse.json();
    await flushEmails();

    expect(knownResponse.status).toBe(200);
    expect(unknownResponse.status).toBe(knownResponse.status);
    expect(unknownBody).toEqual(knownBody);
    expect(await emails.findByRecipient(normalizeEmail(knownEmail))).not.toBeNull();
    expect(await emails.findByRecipient(normalizeEmail(unknownEmail))).toBeNull();
  });

  it('caps pending verification delivery contexts created by address enumeration', async () => {
    const { auth, emails, flushEmails } = buildAuth();
    const email = `verification-context-cap-${Date.now()}@together.dev`;
    await signUp(auth, email);
    await flushEmails();
    auth.setEmailVerificationDeliveryContext(email, {
      language: 'en',
      baseUrl: 'http://studio.localhost:48730',
    });
    for (let index = 0; index < EMAIL_VERIFICATION_CONTEXT_MAX_ENTRIES; index += 1) {
      auth.setEmailVerificationDeliveryContext(`enumerated-verification-${index}@together.dev`, {
        language: 'en',
        baseUrl: 'http://studio.localhost:48730',
      });
    }

    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: 'http://studio.localhost:48730/login?verification=verified' },
      headers: new Headers({ 'x-forwarded-for': `198.51.100.${signUpIpSuffix++}` }),
    });
    await flushEmails();

    const message = await emails.findByRecipient(normalizeEmail(email));
    expect(message?.subject).toBe('Potwierdź swój adres e-mail');
    const actionUrl = message?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
    expect(new URL(actionUrl).host).toBe('localhost:48730');
  });
});

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
    const { auth, authPort } = buildAuth();
    const email = `ensure-${Date.now()}@together.dev`;

    const first = await authPort.ensureUser(email);
    expect(first.created).toBe(true);
    expect(first.userId.length).toBeGreaterThan(0);
    const { internalAdapter } = await auth.$context;
    expect((await internalAdapter.findUserByEmail(email))?.user.emailVerified).toBe(false);

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

  it('marks a magic-link-created account verified when the link is consumed', async () => {
    const { auth, authPort, magicLinks } = buildAuth();
    const email = `magic-verified-${Date.now()}@together.dev`;

    await authPort.requestMagicLink({ email, callbackURL: 'http://localhost:48730/my' });
    const { internalAdapter } = await auth.$context;
    expect(await internalAdapter.findUserByEmail(email)).toBeNull();

    const link = await magicLinks.findByEmail(normalizeEmail(email));
    const response = await auth.handler(new Request(link?.url ?? ''));

    expect(response.status).toBe(302);
    expect((await internalAdapter.findUserByEmail(email))?.user.emailVerified).toBe(true);
  });
});

describe('magic-link delivery contexts', () => {
  it('caps pending magic-link delivery contexts created by address enumeration', async () => {
    const { auth, authPort, magicLinks } = buildAuth();
    const email = `magic-context-cap-${Date.now()}@together.dev`;
    auth.setMagicLinkDeliveryContext(email, {
      language: 'en',
      mode: 'email',
      baseUrl: 'http://studio.localhost:48730',
    });
    for (let index = 0; index < MAGIC_LINK_CONTEXT_MAX_ENTRIES; index += 1) {
      auth.setMagicLinkDeliveryContext(`enumerated-magic-${index}@together.dev`, {
        language: 'en',
        mode: 'email',
        baseUrl: 'http://studio.localhost:48730',
      });
    }

    await authPort.requestMagicLink({ email, callbackURL: 'http://localhost:48730/my' });

    const link = await magicLinks.findByEmail(normalizeEmail(email));
    expect(new URL(link?.url ?? '').host).toBe('localhost:48730');
  });

  it('clears a delivery context that the send callback never consumed', async () => {
    const { auth, authPort, magicLinks } = buildAuth();
    const email = `magic-context-clear-${Date.now()}@together.dev`;
    auth.setMagicLinkDeliveryContext(email, {
      language: 'en',
      mode: 'email',
      baseUrl: 'http://studio.localhost:48730',
    });
    auth.clearMagicLinkDeliveryContext(email);

    await authPort.requestMagicLink({ email, callbackURL: 'http://localhost:48730/my' });

    const link = await magicLinks.findByEmail(normalizeEmail(email));
    expect(new URL(link?.url ?? '').host).toBe('localhost:48730');
  });

  it('keeps email send callbacks awaited so request-scoped contexts outlive them', async () => {
    const { auth } = buildAuth();

    expect(Object.keys((await auth.$context).options.advanced ?? {})).not.toContain('backgroundTasks');
  });
});

describe('provider-managed avatars', () => {
  const updateUser = async (body: Record<string, unknown>) => {
    const { auth } = buildAuth();
    const email = `update-user-${Date.now()}-${Math.random()}@together.dev`;
    const signedUp = await signUp(auth, email);
    const token = signedUp.headers.get('set-auth-token') ?? '';
    return auth.handler(new Request('http://studio.localhost:48730/api/auth/update-user', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://studio.localhost:48730',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }));
  };

  it('rejects an update that carries an image', async () => {
    expect((await updateUser({ name: 'Ada', image: 'https://attacker.example/beacon.png' })).status)
      .toBe(400);
  });

  it('accepts a name-only update', async () => {
    expect((await updateUser({ name: 'Ada Lovelace' })).status).toBe(200);
  });

  const signUpEmail = () => `sign-up-image-${Date.now()}-${Math.random()}@together.dev`;

  it('rejects a sign-up that carries an image', async () => {
    const { auth } = buildAuth();
    const response = await signUp(auth, signUpEmail(), {
      image: 'https://attacker.example/beacon.png',
    });
    expect(response.status).toBe(400);
  });

  it('accepts a sign-up without an image', async () => {
    const { auth } = buildAuth();
    expect((await signUp(auth, signUpEmail())).status).toBe(200);
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

  it('expires enrollment links after one hour and redirects reused tokens to login', async () => {
    const { auth, authPort } = buildAuth();
    const db = createDb('node-postgres', connectionString);
    const email = `enrollment-expiry-${Date.now()}@together.dev`;
    const requestedAt = Date.now();

    const created = await authPort.createEnrollmentMagicLink({
      email,
      callbackURL: 'http://studio.localhost:48730/',
      baseUrl: 'http://studio.localhost:48730',
      tenantName: 'Studio',
      language: 'en',
    });
    const token = new URL(created.url).searchParams.get('token') ?? '';
    const tokens = await db
      .select({ expiresAt: verification.expiresAt })
      .from(verification)
      .where(eq(verification.identifier, token));
    const expiresIn = (tokens[0]?.expiresAt.getTime() ?? 0) - requestedAt;

    expect(expiresIn).toBeGreaterThanOrEqual(
      MAGIC_LINK_TOKEN_EXPIRES_IN_SECONDS * 1000 - 2000,
    );
    expect(expiresIn).toBeLessThanOrEqual(
      MAGIC_LINK_TOKEN_EXPIRES_IN_SECONDS * 1000 + 2000,
    );
    expect((await auth.handler(new Request(created.url))).status).toBe(302);

    const reused = await auth.handler(new Request(created.url));

    expect(reused.status).toBe(302);
    expect(reused.headers.get('location')).toBe(
      'http://studio.localhost:48730/login?error=INVALID_TOKEN',
    );
  });
});

describe('reset password email', () => {
  it.each([
    [{ origin: 'http://studio.localhost:48730' }, 'http://other.localhost:48730/reset-password'],
    [{}, 'http://studio.localhost:48730/reset-password'],
    [{ origin: 'http://studio.localhost:48730' }, 'not-a-url'],
  ])('rejects a redirect outside the requesting origin', async (headers, redirectTo) => {
    const { auth } = buildAuth();
    const response = await auth.handler(new Request(
      'http://studio.localhost:48730/api/auth/request-password-reset',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ email: 'reset-origin@together.dev', redirectTo }),
      },
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_PASSWORD_RESET_ORIGIN' });
  });

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
      headers: new Headers({
        origin: 'http://studio.localhost:48730',
        'x-forwarded-for': '198.51.100.224',
      }),
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
      headers: new Headers({ origin: 'http://studio.localhost:48730' }),
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
      headers: new Headers({ origin: 'http://studio.localhost:48730' }),
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
    const signedUp = await signUp(auth, email, { password: OLD_PASSWORD });
    const sessionToken = signedUp.headers.get('set-auth-token');
    const requestedAt = Date.now();
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: 'http://studio.localhost:48730/reset-password' },
      headers: new Headers({ origin: 'http://studio.localhost:48730' }),
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
        body: JSON.stringify({ token, newPassword: NEW_PASSWORD }),
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
        body: JSON.stringify({ token, newPassword: passwordFixture('another-password') }),
      }),
    );

    expect(reset.status).toBe(200);
    expect(await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${sessionToken ?? ''}` }),
    })).toBeNull();
    expect(consumed.status).toBe(400);
  });

  it('proves the address, so a later magic-link sign-in keeps the credential and the session', async () => {
    const { auth, authPort, magicLinks } = buildAuth();
    const db = createDb('node-postgres', connectionString);
    const email = `reset-verifies-${Date.now()}@together.dev`;
    const { userId } = await authPort.ensureUser(email);
    const { internalAdapter } = await auth.$context;

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: 'http://studio.localhost:48730/reset-password' },
      headers: new Headers({ origin: 'http://studio.localhost:48730' }),
    });
    const tokens = await db
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(eq(verification.value, userId));
    const token = tokens
      .find((row) => row.identifier.startsWith('reset-password:'))
      ?.identifier.slice('reset-password:'.length) ?? '';
    const reset = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.231',
        },
        body: JSON.stringify({ token, newPassword: NEW_PASSWORD }),
      }),
    );

    expect(reset.status).toBe(200);
    expect((await internalAdapter.findUserById(userId))?.emailVerified).toBe(true);

    const signedIn = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: 'studio.localhost:48730',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.232',
        },
        body: JSON.stringify({ email, password: NEW_PASSWORD }),
      }),
    );
    const sessionToken = signedIn.headers.get('set-auth-token');
    await authPort.requestMagicLink({ email, callbackURL: 'http://localhost:48730/my' });
    const link = await magicLinks.findByEmail(normalizeEmail(email));
    const consumedLink = await auth.handler(new Request(link?.url ?? ''));

    expect(signedIn.status).toBe(200);
    expect(consumedLink.status).toBe(302);
    expect((await internalAdapter.findAccounts(userId)).map((row) => row.providerId))
      .toContain('credential');
    expect(await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${sessionToken ?? ''}` }),
    })).not.toBeNull();
  });
});

describe('change password', () => {
  it('rotates the caller token, revokes the other session, and replaces the accepted password', async () => {
    const { auth } = buildAuth();
    const email = `change-password-${Date.now()}@together.dev`;
    const first = await signUp(auth, email, { password: OLD_PASSWORD });
    const firstToken = first.headers.get('set-auth-token');
    const second = await auth.handler(
      new Request('http://studio.localhost:48730/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://studio.localhost:48730',
          'x-forwarded-for': '198.51.100.210',
        },
        body: JSON.stringify({ email, password: OLD_PASSWORD }),
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
          currentPassword: OLD_PASSWORD,
          newPassword: NEW_PASSWORD,
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
        body: JSON.stringify({ email, password: OLD_PASSWORD }),
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
        body: JSON.stringify({ email, password: NEW_PASSWORD }),
      }),
    );

    expect(oldPassword.status).toBe(401);
    expect(newPassword.status).toBe(200);
  }, 30000);

  it('shares the endpoint limit across auth instances', async () => {
    const { auth: firstAuth } = buildAuth();
    const email = `change-rate-limit-${Date.now()}@together.dev`;
    const signedUp = await signUp(firstAuth, email, { password: CURRENT_PASSWORD });
    const token = signedUp.headers.get('set-auth-token');
    const random = crypto.randomUUID().replaceAll('-', '');
    const ip = `2001:db8:${random.slice(0, 4)}:${random.slice(4, 8)}:${random.slice(8, 12)}:${random.slice(12, 16)}:${random.slice(16, 20)}:1`;
    const attempt = (auth: ReturnType<typeof buildAuth>['auth']) =>
      auth.handler(
        new Request('http://studio.localhost:48730/api/auth/change-password', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token ?? ''}`,
            'content-type': 'application/json',
            origin: 'http://studio.localhost:48730',
            'x-forwarded-for': ip,
          },
          body: JSON.stringify({
            currentPassword: 'wrong-password',
            newPassword: NEW_PASSWORD,
            revokeOtherSessions: false,
          }),
        }),
      );

    const statuses: number[] = [];
    for (let count = 0; count < 10; count += 1) {
      statuses.push((await attempt(firstAuth)).status);
    }
    const { auth: secondAuth } = buildAuth();
    for (let count = 10; count < 21; count += 1) {
      statuses.push((await attempt(secondAuth)).status);
    }

    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  }, 30000);
});

describe('email-endpoint rate limiting', () => {
  it('returns 429 once the magic-link window limit is exceeded and stays available below it', async () => {
    const { auth } = buildAuth();
    const email = `rate-limit-${Date.now()}@together.dev`;
    const random = crypto.randomUUID().replaceAll('-', '');
    const ip = `2001:db8:${random.slice(0, 4)}:${random.slice(4, 8)}:${random.slice(8, 12)}:${random.slice(12, 16)}:${random.slice(16, 20)}:1`;
    const hammer = () =>
      auth.handler(
        new Request('http://localhost:48730/api/auth/sign-in/magic-link', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:48730',
            'x-forwarded-for': ip,
          },
          body: JSON.stringify({ email, callbackURL: '/my' }),
        }),
      );

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt += 1) statuses.push((await hammer()).status);

    expect(statuses[0]).not.toBe(429);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });
});
