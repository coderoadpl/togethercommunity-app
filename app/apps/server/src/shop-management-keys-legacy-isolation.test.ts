import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  importAuditEvents,
  shopManagementKeyEvents,
  shopManagementKeyRateLimitBuckets,
  shopManagementKeys,
  tenantAdmins,
  tenants,
} from '#adapters/db/schema.js';
import { API_PATHS, API_ROUTES, apiKeyCreateOutputSchema, SHOP_CATALOG_ROUTES } from '#core/contract/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const email = 'shop-isolation-owner@example.test';
const password = 'shop-isolation-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const SHOP_KEY_ID = 'shop-isolation-key';
const SHOP_SECRET = 'shop-isolation-secret';

// Frozen copy of the previous release's stored key schema (main d44a6cb6); importing the current one would prove nothing.
const previousReleaseApiKeySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  keyHash: z.string(),
  scopes: z.array(z.enum([
    'report:read',
    'enrollment',
    'subscriptions:read',
    'subscriptions:adopt',
    'marketing',
    'transactional',
    'import:content',
    'import:users',
  ])).min(1).nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
}).strict();

const storedApiKeyRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  key_hash: z.string(),
  scopes: z.unknown(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
}).strict().transform((row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  keyHash: row.key_hash,
  scopes: row.scopes,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
}));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;
let ownerId: string;
let ownerToken: string;
const legacy = { importKeyId: '', enrollmentSecret: '', unscopedSecret: '' };

const ownerRequest = (method: string, path: string, body?: unknown) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host: acmeHost,
    authorization: `Bearer ${ownerToken}`,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const keyedRequest = (secret: string, method: string, path: string, body?: unknown) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host: acmeHost, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createLegacyKey = async (input: Record<string, unknown>) => {
  const response = await ownerRequest(API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, input);
  expect(response.status).toBe(200);
  return z.object({ ok: z.literal(true), data: apiKeyCreateOutputSchema }).parse(await response.json()).data;
};

const answer = async (response: Response | Promise<Response>) => {
  const settled = await response;
  return { status: settled.status, body: await settled.text() };
};

const legacySurface = async (shopSecret: string) => {
  const enrollment = { email: 'buyer@example.test', productId: 'no-such-product' };
  return {
    keyList: await answer(ownerRequest(API_ROUTES.apiKeys.method, API_PATHS.apiKeys)),
    importAudit: await answer(ownerRequest('GET', API_PATHS.apiKeyImportAudit.replace(':id', legacy.importKeyId))),
    importAuditOfShopKeyId: await answer(ownerRequest('GET', API_PATHS.apiKeyImportAudit.replace(':id', SHOP_KEY_ID))),
    revokeShopKeyIdOnLegacyRoute: await answer(ownerRequest('DELETE', API_PATHS.apiKeyRevoke.replace(':id', SHOP_KEY_ID))),
    enrollWithLegacyKey: await answer(keyedRequest(legacy.enrollmentSecret, 'POST', API_PATHS.m2mEnroll, enrollment)),
    enrollWithUnscopedLegacyKey: await answer(keyedRequest(legacy.unscopedSecret, 'POST', API_PATHS.m2mEnroll, enrollment)),
    enrollWithShopSecret: await answer(keyedRequest(shopSecret, 'POST', API_PATHS.m2mEnroll, enrollment)),
    importValidateWithShopSecret: await answer(keyedRequest(shopSecret, 'POST', API_PATHS.m2mImportValidate, { records: [] })),
  };
};

const storeActiveShopKeyWithHistory = async () => {
  await database.db.insert(shopManagementKeys).values({
    id: SHOP_KEY_ID, tenantId: 'acme', name: 'Shop backend', keyHash: deps.apiKeyCrypto.hash(SHOP_SECRET),
    scopes: ['shop:catalog:read', 'shop:catalog:write'], issuedByUserId: ownerId, createdAt: now, expiresAt, revokedAt: null,
  });
  await database.db.insert(shopManagementKeyEvents).values([
    { id: 'shop-isolation-created', tenantId: 'acme', apiKeyId: SHOP_KEY_ID, kind: 'created', actorUserId: ownerId, at: now },
    {
      id: 'shop-isolation-request', tenantId: 'acme', apiKeyId: SHOP_KEY_ID, kind: 'request', actorUserId: ownerId,
      method: 'POST', route: SHOP_CATALOG_ROUTES.updateProduct.path, resourceId: 'product-1', at: now,
    },
  ]);
  await database.db.insert(shopManagementKeyRateLimitBuckets).values({
    apiKeyId: SHOP_KEY_ID, period: 'day', windowStartedAt: now, count: 1,
  });
};

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_key_isolation_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-isolation-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp(deps);

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Shop Isolation Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  await database.db.insert(tenants).values({ id: 'acme', slug: 'acme', name: 'Workspace', createdAt: now });
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme', tenantId: 'acme', userId: ownerId, role: 'owner' });
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;

  const importKey = await createLegacyKey({ name: 'Importer', scopes: ['import:content'], expiresAt });
  legacy.importKeyId = importKey.apiKey.id;
  legacy.enrollmentSecret = (await createLegacyKey({ name: 'Enrollment', scopes: ['enrollment'] })).secret;
  legacy.unscopedSecret = (await createLegacyKey({ name: 'Unscoped' })).secret;
  const revoked = await createLegacyKey({ name: 'Revoked', scopes: ['marketing'] });
  expect((await ownerRequest('DELETE', API_PATHS.apiKeyRevoke.replace(':id', revoked.apiKey.id))).status).toBe(200);
  await database.db.insert(importAuditEvents).values({
    id: 'import-audit-1', tenantId: 'acme', apiKeyId: legacy.importKeyId, kind: 'course', importKey: 'course-1',
    resourceId: 'course-1', action: 'created', payloadHash: 'a'.repeat(64), at: now,
  });
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('legacy API keys next to a stored shop management key', () => {
  it('answer the key list, import audit and legacy key authentication exactly as without the shop rows', async () => {
    const without = await legacySurface(SHOP_SECRET);
    expect(without.keyList.status).toBe(200);
    expect(without.importAudit.body).toContain('import-audit-1');
    expect(without.enrollWithShopSecret.status).toBe(401);

    await storeActiveShopKeyWithHistory();
    const shopList = await keyedRequest(SHOP_SECRET, 'GET', SHOP_CATALOG_ROUTES.listProducts.path);
    expect(shopList.status).toBe(200);

    expect(await legacySurface(SHOP_SECRET)).toEqual(without);
  });

  it('leaves every tenant_api_keys row parseable by the previous release, column for column', async () => {
    expect(await database.db.select().from(shopManagementKeys)).toHaveLength(1);
    const { rows } = z.object({ rows: z.array(storedApiKeyRowSchema) })
      .parse(await database.db.execute('select * from tenant_api_keys'));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(previousReleaseApiKeySchema.safeParse(row)).toMatchObject({ success: true });
    }
  });
});
