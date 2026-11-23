import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { normalizeEmail, ok, PASSWORD_MIN_LENGTH } from '#core/domain/index.js';
import { createDevMagicLinkReader } from '#adapters/db/repositories.js';
import { createEmailOutboxRepository, createPlatformAuthSendLog } from '#adapters/db/email-outbox.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createDevEmailPort } from '#adapters/email/dev.js';

import { withoutBrowserSessionToken } from './browser-session-token.js';
import { createAuth, createAuthPort } from './create-auth.js';
import { totpCode } from './totp-test-helper.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase(
    'together_browser_session_token_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together',
  );
});
afterAll(async () => { await database?.close(); });

const host = 'studio.localhost:48730';
const origin = `http://${host}`;
const password = 'browser-token-password'.padEnd(PASSWORD_MIN_LENGTH, 'x');
let ipSuffix = 1;

const buildAuth = () => {
  const db = database.db;
  const auth = createAuth(db, {
    secret: 'browser-session-token-test-secret-32-characters',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
    trustedOrigins: ['http://localhost:48730', origin],
    secureCookies: false,
    exposeMagicLinks: true,
    emailOutbox: createEmailOutboxRepository(db),
    emailSender: {
      send: async (message) => {
        const sent = await createDevEmailPort(db).send(message);
        return sent.ok ? ok({ ...sent.value, transport: 'platform' as const }) : sent;
      },
    },
    authSendLog: createPlatformAuthSendLog(db),
    ids: { nextId: () => crypto.randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    dispatchEmail: () => undefined,
    defaultTenantName: 'Together',
    google: null,
  });
  return { auth, authPort: createAuthPort(auth), magicLinks: createDevMagicLinkReader(db) };
};

type Auth = ReturnType<typeof buildAuth>['auth'];

const browserHeaders = { host, origin, 'sec-fetch-site': 'same-origin' };
const cliHeaders = { host, origin };

const call = (
  auth: Auth,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) => auth.handler(new Request(`${origin}/api/auth${path}`, body === undefined
  ? { headers }
  : {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${ipSuffix++}` },
    body: JSON.stringify(body),
  }));

const sessionCookie = (response: Response): string =>
  response.headers.getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((entry) => entry.includes('session_token=') || entry.includes('two_factor='))
    .join('; ');

const expectNoToken = async (response: Response) => {
  expect(response.headers.get('set-auth-token')).toBeNull();
  expect(response.headers.get('access-control-expose-headers') ?? '').not.toMatch(/set-auth-token/iu);
  const text = await response.text();
  expect(text).not.toMatch(/"token"/u);
  return text;
};

const signedUpUser = async (auth: Auth) => {
  const email = `browser-token-${crypto.randomUUID()}@together.dev`;
  const response = await call(auth, '/sign-up/email', cliHeaders, { name: 'Ada', email, password });
  expect(response.status).toBe(200);
  return { email, token: response.headers.get('set-auth-token') ?? '' };
};

describe('session tokens on browser auth responses', () => {
  it('keeps the token out of a browser sign-in while the session cookie still signs the browser in', async () => {
    const { auth, authPort } = buildAuth();
    const { email } = await signedUpUser(auth);

    const signedIn = await call(auth, '/sign-in/email', browserHeaders, { email, password });

    expect(signedIn.status).toBe(200);
    const cookie = sessionCookie(signedIn);
    expect(cookie).toContain('session_token=');
    expect(JSON.parse(await expectNoToken(signedIn))).toMatchObject({ user: { email } });
    expect(await authPort.getAuthenticatedUser(new Headers({ cookie }))).toMatchObject({ email });
  });

  it('keeps session.token out of a browser get-session body', async () => {
    const { auth } = buildAuth();
    const { email, token } = await signedUpUser(auth);

    const session = await call(auth, '/get-session', { ...browserHeaders, authorization: `Bearer ${token}` });

    expect(session.status).toBe(200);
    const body = z.object({
      session: z.record(z.string(), z.unknown()),
      user: z.object({ email: z.string() }),
    }).parse(JSON.parse(await expectNoToken(session)));
    expect(body.user.email).toBe(email);
    expect(body.session).not.toHaveProperty('token');
    expect(body.session).toHaveProperty('expiresAt');
  });

  it('keeps the token out of a browser update-user that refreshes the session cookie', async () => {
    const { auth } = buildAuth();
    const { email } = await signedUpUser(auth);
    const cookie = sessionCookie(await call(auth, '/sign-in/email', browserHeaders, { email, password }));

    const updated = await call(auth, '/update-user', { ...browserHeaders, cookie }, { name: 'Grace' });

    expect(updated.status).toBe(200);
    expect(sessionCookie(updated)).toContain('session_token=');
    expect(JSON.parse(await expectNoToken(updated))).toEqual({ status: true });
  });

  it('completes a browser two-factor sign-in with the cookie only', async () => {
    const { auth, authPort } = buildAuth();
    const { email, token } = await signedUpUser(auth);
    const bearer = { ...cliHeaders, authorization: `Bearer ${token}` };
    const enabled = await call(auth, '/two-factor/enable', bearer, { password });
    const secret = new URL(z.object({ totpURI: z.string() }).parse(await enabled.json()).totpURI).searchParams.get('secret') ?? '';
    expect((await call(auth, '/two-factor/verify-totp', bearer, { code: totpCode(secret) })).status).toBe(200);

    const challenged = await call(auth, '/sign-in/email', browserHeaders, { email, password });
    expect(JSON.parse(await expectNoToken(challenged))).toMatchObject({ twoFactorRedirect: true });
    const completed = await call(
      auth,
      '/two-factor/verify-totp',
      { ...browserHeaders, cookie: sessionCookie(challenged) },
      { code: totpCode(secret) },
    );

    expect(completed.status).toBe(200);
    const cookie = sessionCookie(completed);
    expect(cookie).toContain('session_token=');
    await expectNoToken(completed);
    expect(await authPort.getAuthenticatedUser(new Headers({ cookie }))).toMatchObject({ email });
  });

  it('signs a browser in through a magic link with the cookie only', async () => {
    const { auth, authPort, magicLinks } = buildAuth();
    const email = `browser-magic-${crypto.randomUUID()}@together.dev`;
    await authPort.requestMagicLink({
      email, callbackURL: `${origin}/`, tenantName: 'Studio', language: 'en', baseUrl: origin,
    });
    const link = await magicLinks.findByEmail(normalizeEmail(email));

    const verified = await auth.handler(new Request(link?.url ?? '', {
      headers: { host, 'sec-fetch-site': 'none' },
    }));

    expect(verified.status).toBe(302);
    expect(verified.headers.get('set-auth-token')).toBeNull();
    const cookie = sessionCookie(verified);
    expect(await authPort.getAuthenticatedUser(new Headers({ cookie }))).toMatchObject({ email });
  });

  it('still clears the session cookie on a browser sign-out', async () => {
    const { auth, authPort } = buildAuth();
    const { email } = await signedUpUser(auth);
    const cookie = sessionCookie(await call(auth, '/sign-in/email', browserHeaders, { email, password }));

    const signedOut = await call(auth, '/sign-out', { ...browserHeaders, cookie }, {});

    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.getSetCookie().some((entry) => /session_token=;.*Max-Age=0/iu.test(entry))).toBe(true);
    expect(await authPort.getAuthenticatedUser(new Headers({ cookie }))).toBeNull();
  });

  it('still hands the token to a non-browser client such as the CLI', async () => {
    const { auth, authPort } = buildAuth();
    const { email } = await signedUpUser(auth);

    const signedIn = await call(auth, '/sign-in/email', cliHeaders, { email, password });

    const token = signedIn.headers.get('set-auth-token');
    expect(token).not.toBeNull();
    expect(signedIn.headers.get('access-control-expose-headers')).toContain('set-auth-token');
    expect(z.object({ token: z.string() }).parse(await signedIn.json()).token).not.toBe('');
    const session = await call(auth, '/get-session', { ...cliHeaders, authorization: `Bearer ${token ?? ''}` });
    expect(z.object({ session: z.object({ token: z.string() }) }).parse(await session.json()).session.token).not.toBe('');
    expect(await authPort.getAuthenticatedUser(new Headers({ authorization: `Bearer ${token ?? ''}` }))).toMatchObject({ email });
  });
});

describe('withoutBrowserSessionToken', () => {
  const browserRequest = new Request('http://localhost/api/auth/list-sessions', { headers: { 'sec-fetch-site': 'same-origin' } });

  it('keeps other exposed headers and every Set-Cookie entry', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'set-auth-token': 'signed.token',
      'access-control-expose-headers': 'x-request-id, set-auth-token',
    });
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');

    const stripped = await withoutBrowserSessionToken(browserRequest, new Response(JSON.stringify([{ id: 's1', token: 't1' }]), { headers }));

    expect(stripped.headers.get('access-control-expose-headers')).toBe('x-request-id');
    expect(stripped.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(await stripped.json()).toEqual([{ id: 's1' }]);
  });

  it('passes a non-JSON body through untouched', async () => {
    const stripped = await withoutBrowserSessionToken(
      browserRequest,
      new Response('token=plain', { status: 400, headers: { 'content-type': 'text/plain' } }),
    );

    expect(stripped.status).toBe(400);
    expect(await stripped.text()).toBe('token=plain');
  });
});
