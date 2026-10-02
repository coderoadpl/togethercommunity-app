import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SESSION_PATH, BETTER_AUTH_SIGN_OUT_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { members, tenants } from '#adapters/db/schema.js';
import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const email = 'shared@example.test';
const password = 'test-password-15';
const createdAt = '1998-08-01T00:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;
let userId: string;

const post = (path: string, body: unknown, tenant?: string) => app.request(new URL(path, baseUrl).toString(), {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: baseUrl, ...(tenant === undefined ? {} : { 'x-tenant': tenant }) },
  body: JSON.stringify(body),
});
const events = async () => (await Promise.all(
  ['acme', 'studio', 'deleted', 'empty'].map((tenantId) => deps.memberEvents.listForMember(tenantId, 'shared')),
)).flat().filter((event) => event.type === 'sign-in');

beforeAll(async () => {
  database = await createTestDatabase('together_sign_in_events_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'sign-in-events-secret-at-least-32-characters',
  }), { db: database.db });
  app = buildApp(deps);
  const response = await post(BETTER_AUTH_SIGN_UP_PATH, { name: 'Shared member', email, password });
  expect(response.status).toBe(200);
  userId = z.object({ user: z.object({ id: z.string() }) }).parse(await response.json()).user.id;
  for (const tenantId of ['acme', 'studio', 'deleted']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt });
    await database.db.insert(members).values({ id: 'shared', tenantId, userId, email, createdAt, deletedAt: tenantId === 'deleted' ? createdAt : null });
  }
}, 120_000);
afterAll(async () => { await database?.close(); });

describe('tenant sign-in emission', () => {
  it('records password sign-ins only on the resolved tenant and never on session reads', async () => {
    const response = await post(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, { email, password }, 'acme');
    expect(response.status).toBe(200);
    const { token } = z.object({ token: z.string() }).parse(await response.json());
    let before = await events();
    await vi.waitFor(async () => {
      before = await events();
      expect(before).toMatchObject([{ tenantId: 'acme', memberId: 'shared', type: 'sign-in', payload: {} }]);
    });
    for (const tenant of ['acme', 'studio']) {
      const session = await app.request(new URL(BETTER_AUTH_SESSION_PATH, baseUrl).toString(), { headers: { authorization: `Bearer ${token}`, 'x-tenant': tenant } });
      expect(session.status).toBe(200);
    }
    expect(await events()).toEqual(before);
  });

  it('ignores failed, tenantless, unknown-tenant and nonmember logins', async () => {
    const before = await events();
    expect((await post(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, { email, password: 'incorrect-password' }, 'studio')).status).toBe(401);
    for (const tenant of [undefined, 'missing']) {
      expect((await post(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, { email, password }, tenant)).status).toBe(200);
    }
    await database.db.insert(tenants).values({ id: 'empty', slug: 'empty', name: 'Workspace', createdAt });
    expect((await post(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, { email, password }, 'empty')).status).toBe(200);
    expect((await post(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, { email, password }, 'deleted')).status).toBe(200);
    expect(await events()).toEqual(before);
  });

  it('records magic-link verification on its tenant and retains the event after sign-out', async () => {
    const before = await events();
    const link = await deps.authPort.createEnrollmentMagicLink({ email, callbackURL: `${baseUrl}/my`, baseUrl, tenantName: 'Workspace', language: 'en' });
    const response = await app.request(link.url, { headers: { 'x-tenant': 'studio' } });
    expect(response.status).toBe(302);
    let recorded = before;
    await vi.waitFor(async () => {
      recorded = await events();
      expect(recorded).toHaveLength(before.length + 1);
    });
    expect(recorded.at(-1)).toMatchObject({ tenantId: 'studio', memberId: 'shared', type: 'sign-in' });
    const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const signedOut = await app.request(new URL(BETTER_AUTH_SIGN_OUT_PATH, baseUrl).toString(), { method: 'POST', headers: { origin: baseUrl, cookie, 'x-tenant': 'studio' } });
    expect(signedOut.status).toBe(200);
    expect(await events()).toEqual(recorded);
  });
});
