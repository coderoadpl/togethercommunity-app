import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createEntitlementKeyRepository } from '#adapters/db/entitlement-keys.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { members, productGrants, products, shopManagementKeyEvents, shopManagementKeys, tenantAdmins, tenants, user } from '#adapters/db/schema.js';
import { API_PATHS, entitlementContracts, SHOP_CATALOG_ROUTES } from '#core/contract/index.js';
import type { EntitlementKeyScope } from '#core/domain/index.js';
import { entitlementKeyHash } from '#core/server/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const CREATED_AT = '2026-11-01T00:00:00.000Z';
const EXPIRES_AT = '2026-12-01T00:00:00.000Z';
const START = Date.parse('2026-11-15T10:00:30.000Z');
const OWNER = 'user-entitlement-owner';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let disabledApp: ReturnType<typeof buildApp>;
let deps: ReturnType<typeof createDeps>;
let minute = 0;
let now = new Date(START).toISOString();

const depsFor = (switchState: 'enabled' | 'disabled') => createDeps(envSchema.parse({
  NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
  APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
  BETTER_AUTH_SECRET: 'entitlement-routes-test-secret-at-least-32-characters',
  SHOP_MANAGEMENT_KEYS: switchState,
}), { db: database.db, clock: { nowIso: () => now } });

const insertKey = async (id: string, secret: string, options: { scopes?: EntitlementKeyScope[]; productIds?: string[]; tenantId?: string; revokedAt?: string; expiresAt?: string } = {}) => {
  const tenantId = options.tenantId ?? 'acme';
  await createEntitlementKeyRepository(database.db).create(tenantId, {
    id, tenantId, name: id, keyHash: entitlementKeyHash(deps.apiKeyCrypto, secret), scopes: options.scopes ?? ['entitlements:check'],
    productIds: options.productIds ?? null, issuedByUserId: OWNER, createdAt: CREATED_AT, expiresAt: options.expiresAt ?? EXPIRES_AT,
    revokedAt: options.revokedAt ?? null,
  }, { id: `created-${id}`, tenantId, apiKeyId: id, kind: 'created', actorUserId: OWNER, method: null, route: null, resourceId: null, at: CREATED_AT });
};

const check = (secret: string | null, body: unknown, options: { host?: string; headers?: Record<string, string>; target?: ReturnType<typeof buildApp> } = {}) =>
  (options.target ?? app).request(`${baseUrl}${API_PATHS.m2mEntitlementCheck}`, {
    method: 'POST',
    headers: { host: options.host ?? acmeHost, 'content-type': 'application/json', ...(secret === null ? {} : { 'x-api-key': secret }), ...options.headers },
    body: JSON.stringify(body),
  });

const errorCode = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }).parse(await response.json()).error.code;

const answer = async (response: Response) =>
  z.object({ ok: z.literal(true), data: entitlementContracts.checkEntitlements.output }).parse(await response.json()).data;

beforeAll(async () => {
  database = await createTestDatabase('together_entitlement_routes_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres');
  deps = depsFor('enabled');
  await database.db.insert(user).values([
    { id: OWNER, name: 'Owner', email: 'entitlement-owner@example.test', emailVerified: true },
    { id: 'user-ada', name: 'Ada', email: 'ada@example.test', emailVerified: true },
    { id: 'user-eve', name: 'Eve', email: 'eve@example.test', emailVerified: false },
  ]);
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: tenantId, createdAt: CREATED_AT });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: OWNER, role: 'owner' });
  }
  await database.db.insert(products).values({ id: 'prod-pro', tenantId: 'acme', slug: 'pro', title: 'Pro', description: '', priceCents: 1000, currency: 'PLN', published: true, createdAt: CREATED_AT });
  await database.db.insert(members).values([
    { id: 'm-ada', tenantId: 'acme', userId: 'user-ada', email: 'ada@example.test', createdAt: CREATED_AT },
    { id: 'm-eve', tenantId: 'acme', userId: 'user-eve', email: 'eve@example.test', createdAt: CREATED_AT },
    { id: 'm-ada-studio', tenantId: 'studio', userId: 'user-ada', email: 'ada@example.test', createdAt: CREATED_AT },
  ]);
  await database.db.insert(productGrants).values([
    { id: 'g-ada', tenantId: 'acme', memberId: 'm-ada', productId: 'prod-pro', source: 'stripe', mode: 'live', startsAt: CREATED_AT, createdAt: CREATED_AT },
    { id: 'g-eve', tenantId: 'acme', memberId: 'm-eve', productId: 'prod-pro', source: 'stripe', mode: 'live', startsAt: CREATED_AT, createdAt: CREATED_AT },
  ]);
  await insertKey('ek-check', 'check-secret');
  await insertKey('ek-members', 'members-secret', { scopes: ['entitlements:check', 'entitlements:members:read'] });
  await insertKey('ek-studio', 'studio-secret', { tenantId: 'studio' });
  await insertKey('ek-revoked', 'revoked-secret', { revokedAt: CREATED_AT });
  await insertKey('ek-expired', 'expired-secret', { expiresAt: '2026-11-02T00:00:00.000Z' });
  await insertKey('ek-limited', 'limited-secret');
  await database.db.insert(shopManagementKeys).values({
    id: 'shop-read', tenantId: 'acme', name: 'shop', keyHash: deps.apiKeyCrypto.hash('shop-secret'), scopes: ['shop:catalog:read'],
    issuedByUserId: OWNER, createdAt: CREATED_AT, expiresAt: EXPIRES_AT, revokedAt: null,
  });
  app = buildApp(deps);
  disabledApp = buildApp(depsFor('disabled'));
}, 120_000);

afterAll(async () => { await database?.close(); });

beforeEach(() => {
  minute += 1;
  now = new Date(START + minute * 60_000).toISOString();
});

describe('POST /api/m2m/entitlements/check', () => {
  it('answers access for a verified e-mail of this workspace', async () => {
    const response = await check('check-secret', { subjects: [{ email: 'ADA@example.test' }], productIds: ['prod-pro'] });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await answer(response)).toEqual({
      version: 1,
      results: [{ subject: { email: 'ada@example.test' }, products: [{ productId: 'prod-pro', access: true, source: 'purchase', subscription: null, checkedAt: now }], member: null }],
    });
  });

  it('gives an unverified e-mail exactly the bytes of an unknown person', async () => {
    const unverified = await (await check('check-secret', { subjects: [{ email: 'eve@example.test' }], productIds: ['prod-pro'] })).text();
    const nobody = await (await check('check-secret', { subjects: [{ email: 'nobody@example.test' }], productIds: ['prod-pro'] })).text();
    expect(unverified).toContain('"access":false');
    expect(nobody.replace('nobody@example.test', 'eve@example.test')).toBe(unverified);
  });

  it.each([
    ['a key of another workspace', 'studio-secret', acmeHost],
    ['an acme key on the studio host', 'check-secret', studioHost],
    ['a revoked key', 'revoked-secret', acmeHost],
    ['an expired key', 'expired-secret', acmeHost],
    ['a shop management key', 'shop-secret', acmeHost],
    ['an unknown key', 'not-a-key', acmeHost],
  ])('refuses %s as unauthorized', async (_label, secret, host) => {
    const response = await check(secret, { subjects: [{ email: 'ada@example.test' }] }, { host });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('unauthorized');
  });

  it('refuses a request without a key or with a cookie or an Authorization header next to it', async () => {
    expect((await check(null, { subjects: [{ email: 'ada@example.test' }] })).status).toBe(401);
    expect((await check('check-secret', { subjects: [{ email: 'ada@example.test' }] }, { headers: { cookie: 'session=1' } })).status).toBe(401);
    expect((await check('check-secret', { subjects: [{ email: 'ada@example.test' }] }, { headers: { authorization: 'Bearer x' } })).status).toBe(401);
  });

  it('never lets an entitlement key call a shop management route', async () => {
    const response = await app.request(`${baseUrl}${SHOP_CATALOG_ROUTES.listProducts.path}`, { headers: { host: acmeHost, 'x-api-key': 'check-secret' } });
    expect(response.status).toBe(401);
  });

  it('never answers from another workspace where the same person has access', async () => {
    await database.db.insert(products).values({ id: 'prod-studio', tenantId: 'studio', slug: 'studio-pro', title: 'Studio Pro', description: '', priceCents: 1000, currency: 'PLN', published: true, createdAt: CREATED_AT });
    await database.db.insert(productGrants).values({ id: 'g-ada-studio', tenantId: 'studio', memberId: 'm-ada-studio', productId: 'prod-studio', source: 'manual', mode: 'live', startsAt: CREATED_AT, createdAt: CREATED_AT });
    const fromAcme = await answer(await check('members-secret', { subjects: [{ email: 'ada@example.test' }, { memberId: 'm-ada-studio' }] }));
    expect(fromAcme.results.map((result) => [result.member, result.products.map((entry) => entry.productId)])).toEqual([
      [{ id: 'm-ada' }, ['prod-pro']],
      [null, []],
    ]);
    const named = await answer(await check('check-secret', { subjects: [{ email: 'ada@example.test' }], productIds: ['prod-studio'] }));
    expect(named.results[0]?.products).toEqual([{ productId: 'prod-studio', access: false, source: null, subscription: null, checkedAt: now }]);
    const fromStudio = await answer(await check('studio-secret', { subjects: [{ email: 'ada@example.test' }] }, { host: studioHost }));
    expect(fromStudio.results[0]?.products.map((entry) => entry.productId)).toEqual(['prod-studio']);
  });

  it('refuses a member id lookup without entitlements:members:read and answers it with the scope', async () => {
    const refused = await check('check-secret', { subjects: [{ memberId: 'm-ada' }] });
    expect(refused.status).toBe(403);
    const allowed = await answer(await check('members-secret', { subjects: [{ memberId: 'm-ada' }, { email: 'ada@example.test' }] }));
    expect(allowed.results.map((result) => [result.member, result.products.map((entry) => entry.productId)])).toEqual([
      [{ id: 'm-ada' }, ['prod-pro']],
      [{ id: 'm-ada' }, ['prod-pro']],
    ]);
  });

  it('rejects an invalid body after authentication without echoing the subject', async () => {
    const response = await check('check-secret', { subjects: [{ email: 'not-an-address-private' }] });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('not-an-address-private');
    expect((await check(null, { subjects: 'nonsense' })).status).toBe(401);
  });

  it('counts every subject against the minute limit and answers 429 with retry-after', async () => {
    const batch = { subjects: Array.from({ length: 25 }, (_, index) => ({ email: `p${String(index)}@example.test` })) };
    for (let request = 0; request < 12; request += 1) expect((await check('limited-secret', batch)).status).toBe(200);
    const limited = await check('limited-secret', { subjects: [{ email: 'ada@example.test' }] });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('records one history row per check without the identifier', async () => {
    await check('members-secret', { subjects: [{ email: 'ada@example.test' }] });
    const rows = await database.db.select().from(shopManagementKeyEvents);
    const requests = rows.filter((row) => row.apiKeyId === 'ek-members' && row.kind === 'request');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((row) => row.method === 'POST' && row.route === API_PATHS.m2mEntitlementCheck && row.resourceId === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('ada@example.test');
  });

  it('answers 404 before any key lookup while the deployment switch is off', async () => {
    const response = await check('check-secret', { subjects: [{ email: 'ada@example.test' }] }, { target: disabledApp });
    expect(response.status).toBe(404);
  });
});

describe('entitlement key routes', () => {
  it('refuses issuance, listing and revocation without an owner session, a key included', async () => {
    const create = await app.request(`${baseUrl}${API_PATHS.apiKeysEntitlement}`, {
      method: 'POST',
      headers: { host: acmeHost, 'content-type': 'application/json', origin: baseUrl, 'x-api-key': 'check-secret' },
      body: JSON.stringify({ name: 'x', scopes: ['entitlements:check'], expiresAt: EXPIRES_AT }),
    });
    expect([401, 403]).toContain(create.status);
    expect((await app.request(`${baseUrl}${API_PATHS.apiKeysEntitlement}`, { headers: { host: acmeHost } })).status).toBe(401);
  });
});
