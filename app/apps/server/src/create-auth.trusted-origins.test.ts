import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ok } from '#core/domain/index.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createEmailOutboxRepository, createPlatformAuthSendLog } from '#adapters/db/email-outbox.js';
import { verification } from '#adapters/db/schema.js';
import { createDevEmailPort } from '#adapters/email/dev.js';

import { createTrustedOrigins, FAILURE_RETRY_MS } from './trusted-origins.js';
import { BETTER_AUTH_MAGIC_LINK_PATH, createAuth } from '#adapters/auth/create-auth.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase(
    'together_auth_origins_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together',
  );
});
afterAll(async () => { await database?.close(); });

const customHost = 'course.acme.example';
const customOrigin = `http://${customHost}`;
const configuredOrigins = ['http://localhost:48730'];
const authPath = BETTER_AUTH_MAGIC_LINK_PATH.slice(0, -'/sign-in/magic-link'.length);

const buildAuth = (trustedOrigins: () => Promise<string[]>) => {
  const db = database.db;
  return createAuth(db, {
    secret: 'trusted-origins-test-secret-at-least-32-characters',
    baseUrl: configuredOrigins[0] ?? '',
    baseDomain: 'together.example',
    singleTenantMode: false,
    trustedOrigins,
    secureCookies: false,
    isVerifiedCustomHost: async (host) => host === customHost,
    exposeMagicLinks: false,
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
};

const call = (
  auth: ReturnType<typeof createAuth>,
  host: string,
  path: string,
  body?: unknown,
) => auth.handler(new Request(`http://${host}${authPath}${path}`, {
  ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  headers: {
    'content-type': 'application/json',
    host,
    origin: `http://${host}`,
    'x-forwarded-for': '203.0.113.17',
  },
  redirect: 'manual',
}));

describe('custom-domain sign-in after a cold domain lookup failure', () => {
  it('recovers after the backoff without consuming a rejected magic link or trusting an unknown origin', async () => {
    let time = 0;
    const coldInstance = async () => {
      const loadCustomOrigins = vi.fn<() => Promise<readonly string[]>>()
        .mockRejectedValueOnce(new Error('Connection terminated due to connection timeout', {
          cause: new Error('Connection terminated unexpectedly'),
        }))
        .mockResolvedValue([customOrigin]);
      const logger = { error: vi.fn(), warn: vi.fn() };
      const auth = buildAuth(createTrustedOrigins({
        configuredOrigins,
        loadCustomOrigins,
        logger,
        now: () => time,
      }));
      // Better Auth skips origin validation in test mode unless explicitly enabled.
      (await auth.$context).skipOriginCheck = false;
      return { auth, loadCustomOrigins, logger };
    };
    const issuer = await coldInstance();
    const email = `origins-recovery-${crypto.randomUUID()}@example.com`;
    const callbackURL = `${customOrigin}/my`;
    issuer.auth.setMagicLinkDeliveryContext(email, {
      language: 'en',
      mode: 'capture',
      baseUrl: customOrigin,
    });

    const rejectedIssue = await call(issuer.auth, customHost, '/sign-in/magic-link', { email, callbackURL });
    expect(rejectedIssue.status).toBe(403);
    expect(await rejectedIssue.json()).toEqual({ message: 'Invalid callbackURL', code: 'INVALID_CALLBACK_URL' });
    expect(issuer.loadCustomOrigins).toHaveBeenCalledTimes(1);
    expect(issuer.auth.consumeCapturedMagicLink(email)).toBeNull();

    time += FAILURE_RETRY_MS;
    const issued = await call(issuer.auth, customHost, '/sign-in/magic-link', { email, callbackURL });
    expect(issued.status).toBe(200);
    expect(issuer.loadCustomOrigins).toHaveBeenCalledTimes(2);
    const captured = issuer.auth.consumeCapturedMagicLink(email);
    expect(captured?.url).toContain(customOrigin);
    const verifyUrl = new URL(captured?.url ?? '');
    const verifyPath = `${verifyUrl.pathname.slice(authPath.length)}${verifyUrl.search}`;
    const tokenBeforeFailure = await database.db.select().from(verification);
    expect(tokenBeforeFailure).toHaveLength(1);

    const verifier = await coldInstance();
    const rejectedVerify = await call(verifier.auth, customHost, verifyPath);
    expect(rejectedVerify.status).toBe(403);
    expect(await rejectedVerify.json()).toEqual({ message: 'Invalid callbackURL', code: 'INVALID_CALLBACK_URL' });
    expect(verifier.loadCustomOrigins).toHaveBeenCalledTimes(1);
    expect(await database.db.select().from(verification)).toEqual(tokenBeforeFailure);

    time += FAILURE_RETRY_MS;
    const verified = await call(verifier.auth, customHost, verifyPath);
    expect(verified.status).toBe(302);
    expect(verified.headers.get('location')).toBe(callbackURL);
    const sessionCookie = verified.headers.getSetCookie().find((entry) =>
      entry.startsWith('better-auth.session_token=') && !entry.includes('Max-Age=0'));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).not.toContain('Domain=');
    expect(verifier.loadCustomOrigins).toHaveBeenCalledTimes(2);

    const unverifiedHost = 'unverified.example';
    const rejectedUnknown = await call(verifier.auth, unverifiedHost, '/sign-in/magic-link', {
      email,
      callbackURL: `http://${unverifiedHost}/my`,
    });
    expect(rejectedUnknown.status).toBe(403);
    expect(await rejectedUnknown.json()).toEqual({ message: 'Invalid callbackURL', code: 'INVALID_CALLBACK_URL' });
    expect(verifier.loadCustomOrigins).toHaveBeenCalledTimes(2);
    expect(issuer.logger.error).toHaveBeenCalledTimes(1);
    expect(verifier.logger.error).toHaveBeenCalledTimes(1);
    expect(issuer.logger.warn).toHaveBeenCalledExactlyOnceWith('[trusted-origins] Domain lookup recovered after 1 failures');
    expect(verifier.logger.warn).toHaveBeenCalledExactlyOnceWith('[trusted-origins] Domain lookup recovered after 1 failures');
  });
});
