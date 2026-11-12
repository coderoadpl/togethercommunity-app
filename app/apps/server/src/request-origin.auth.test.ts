import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { members, tenants } from '#adapters/db/schema.js';
import { tenantDomainFixture } from '#core/server/testing/tenant-domain-fakes.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const tenantHost = 'acme.localhost:48730';
const email = 'origin-member@example.test';
const password = 'origin-password-15';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;
let token: string;
let cookie: string;

beforeAll(async () => {
  database = await createTestDatabase('together_request_origin_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres');
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'request-origin-test-secret-at-least-32-characters',
  }), { db: database.db });
  app = buildApp(deps);
  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Origin member', email, password }),
  });
  expect(signup.status).toBe(200);
  const userId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: '2026-09-01T00:00:00.000Z' });
    await database.db.insert(members).values({ id: 'shared', tenantId, userId, email, createdAt: '2026-09-01T00:00:00.000Z' });
  }
  for (const domain of ['community.example.test', 'alias.example.test']) {
    await deps.tenantDomains.insert('acme', tenantDomainFixture({ id: domain, tenantId: 'acme', domain, verified: true }));
  }
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  token = z.object({ token: z.string() }).parse(await signin.json()).token;
  cookie = signin.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  expect(cookie).toContain('session_token=');
}, 120_000);

afterAll(async () => { await database?.close(); });

const updateProfile = (headers: Record<string, string>) => app.request(`${baseUrl}/api/me/profile`, {
  method: 'POST', headers: { host: tenantHost, 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ displayName: 'Allowed member' }),
});

describe('request origins with real session credentials', () => {
  it('rejects sibling origins and invalid bearer fallback before changing a member', async () => {
    const requests: Record<string, string>[] = [
      { cookie, origin: 'http://studio.localhost:48730', 'sec-fetch-site': 'same-site' },
      { cookie },
      { cookie, authorization: 'Bearer invalid.signature' },
      { cookie, authorization: 'Basic invalid' },
      { cookie, 'x-api-key': 'unverified' },
    ];
    for (const headers of requests) {
      const response = await updateProfile(headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'forbidden', message: 'Request origin is not allowed' } });
    }
    expect((await deps.members.findById('acme', 'shared'))?.displayName).toBeNull();
  });

  it('accepts actual cookie sessions from the platform and verified aliases', async () => {
    for (const origin of [baseUrl, 'https://community.example.test', 'https://alias.example.test']) {
      const response = await updateProfile({ cookie, origin });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { displayName: 'Allowed member' } });
    }
    expect((await deps.members.findById('acme', 'shared'))?.displayName).toBe('Allowed member');
  });

  it('accepts a verified CLI bearer without browser metadata, including alongside cookies', async () => {
    const requests: Record<string, string>[] = [{ authorization: `Bearer ${token}` }, { authorization: `Bearer ${token}`, cookie }];
    for (const headers of requests) {
      const response = await updateProfile(headers);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { displayName: 'Allowed member' } });
    }
  });

  it('preserves unauthorized responses for requests without session authority', async () => {
    expect((await updateProfile({})).status).toBe(401);
    expect((await updateProfile({ authorization: 'Bearer invalid.signature' })).status).toBe(401);
  });
});
