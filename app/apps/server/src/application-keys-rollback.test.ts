import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { products, tenantAdmins, tenants } from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysApplicationCreateOutputSchema,
  apiKeysShopManagementCreateOutputSchema,
} from '#core/contract/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

// Frozen copies of what the production release (779b7198) parses when it reads the shared key tables; importing the current schemas would prove nothing.
const previousRelease = (() => {
  const shopManagementKeyEventKindSchema = z.enum(['created', 'revoked', 'purged', 'request']);
  const shopManagementKeyEventMethodSchema = z.enum(['POST', 'PUT', 'PATCH', 'DELETE']);
  const SHOP_MANAGEMENT_KEY_EVENT_RESOURCE_ID_MAX_LENGTH = 200;
  const shopManagementKeyEventResourceIdSchema = z.string()
    .max(SHOP_MANAGEMENT_KEY_EVENT_RESOURCE_ID_MAX_LENGTH)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  const shopManagementKeyEventSchema = z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    apiKeyId: z.string().min(1),
    kind: shopManagementKeyEventKindSchema,
    actorUserId: z.string().min(1),
    method: shopManagementKeyEventMethodSchema.nullable(),
    route: z.string().min(1).nullable(),
    resourceId: shopManagementKeyEventResourceIdSchema.nullable(),
    at: z.string().datetime(),
  });
  const shopManagementScopeSchema = z.enum([
    'shop:catalog:read',
    'shop:catalog:write',
    'shop:orders:read',
    'shop:fulfilment:write',
    'shop:settings:read',
    'shop:settings:write',
    'shop:integrations:read',
    'shop:integrations:write',
  ]);
  const shopManagementKeyModeSchema = z.enum(['direct', 'propose']);
  const shopManagementKeySchema = z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    name: z.string(),
    keyHash: z.string().min(1),
    scopes: z.array(shopManagementScopeSchema).min(1),
    mode: shopManagementKeyModeSchema,
    issuedByUserId: z.string().min(1),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
  });
  const shopManagementKeyEventRow = z.object({
    id: z.unknown(),
    tenant_id: z.unknown(),
    api_key_id: z.unknown(),
    kind: z.unknown(),
    actor_user_id: z.unknown(),
    method: z.unknown(),
    route: z.unknown(),
    resource_id: z.unknown(),
    at: z.unknown(),
  }).transform((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    apiKeyId: row.api_key_id,
    kind: row.kind,
    actorUserId: row.actor_user_id,
    method: row.method,
    route: row.route,
    resourceId: row.resource_id,
    at: row.at,
  }));
  const shopManagementKeyRow = z.object({
    id: z.unknown(),
    tenant_id: z.unknown(),
    name: z.unknown(),
    key_hash: z.unknown(),
    scopes: z.unknown(),
    mode: z.unknown(),
    issued_by_user_id: z.unknown(),
    created_at: z.unknown(),
    expires_at: z.unknown(),
    revoked_at: z.unknown(),
  }).transform((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    keyHash: row.key_hash,
    scopes: row.scopes,
    mode: row.mode,
    issuedByUserId: row.issued_by_user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
  return {
    readEvent: (row: unknown) => shopManagementKeyEventSchema.safeParse(shopManagementKeyEventRow.parse(row)),
    readShopKey: (row: unknown) => shopManagementKeySchema.safeParse(shopManagementKeyRow.parse(row)),
  };
})();

const baseUrl = 'http://localhost:48730';
const now = '2026-11-20T12:00:00.000Z';
const expiresAt = '2026-12-01T00:00:00.000Z';
const email = 'application-rollback-owner@example.test';
const password = 'application-rollback-password-15';
const WORKSPACE = 'rollback';
const RESEED_WORKSPACE = 'rollback-reseed';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let ownerToken: string;

const hostOf = (workspace: string): string => `${workspace}.localhost:48730`;

const ownerRequest = (workspace: string, method: string, path: string, body?: unknown) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host: hostOf(workspace),
    authorization: `Bearer ${ownerToken}`,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const okData = async <T extends z.ZodTypeAny>(response: Response, schema: T): Promise<z.output<T>> => {
  expect(response.status).toBe(200);
  return z.object({ ok: z.literal(true), data: schema }).parse(await response.json()).data;
};

const createApplicationKey = async (workspace: string, input: Record<string, unknown>) =>
  okData(await ownerRequest(workspace, API_ROUTES.apiKeysApplicationCreate.method, API_ROUTES.apiKeysApplicationCreate.path, input), apiKeysApplicationCreateOutputSchema);

const checkWithKey = (workspace: string, secret: string) => app.request(`${baseUrl}${API_PATHS.m2mEntitlementCheck}`, {
  method: 'POST',
  headers: { host: hostOf(workspace), 'x-api-key': secret, 'content-type': 'application/json' },
  body: JSON.stringify({ subjects: [{ email: 'nobody@example.test' }] }),
});

const rowsOf = async (table: string, workspace: string): Promise<unknown[]> =>
  z.object({ rows: z.array(z.unknown()) }).parse(await database.db.execute(`select * from ${table} where tenant_id = '${workspace}'`)).rows;

const countOf = async (sql: string): Promise<number> =>
  z.object({ rows: z.array(z.object({ count: z.coerce.number() })) }).parse(await database.db.execute(sql)).rows[0]?.count ?? -1;

beforeAll(async () => {
  database = await createTestDatabase(
    'together_application_key_rollback_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  app = buildApp(createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'application-rollback-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } }));

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Rollback Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  const ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  for (const workspace of [WORKSPACE, RESEED_WORKSPACE]) {
    await database.db.insert(tenants).values({ id: workspace, slug: workspace, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${workspace}`, tenantId: workspace, userId: ownerId, role: 'owner' });
  }
  await database.db.insert(products).values({
    id: 'prod-pro', tenantId: WORKSPACE, slug: 'pro', title: 'Pro', description: '', priceCents: 1000, currency: 'PLN', published: true, createdAt: now,
  });
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('rollback to the release without application keys (779b7198)', () => {
  it('leaves only key history and shop key rows that release parses after issuing, using, revoking and purging application keys', async () => {
    const shopKey = await okData(
      await ownerRequest(WORKSPACE, API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, { name: 'Shop backend', scopes: ['shop:catalog:read'], expiresAt }),
      apiKeysShopManagementCreateOutputSchema,
    );
    const kept = await createApplicationKey(WORKSPACE, { name: 'Companion app', scopes: ['entitlements:check', 'entitlements:members:read'], expiresAt, productIds: ['prod-pro'] });
    const revoked = await createApplicationKey(WORKSPACE, { name: 'Old companion app', scopes: ['entitlements:check'], expiresAt });
    expect((await checkWithKey(WORKSPACE, kept.secret)).status).toBe(200);
    expect((await ownerRequest(WORKSPACE, 'DELETE', API_PATHS.apiKeysApplicationRevoke.replace(':id', revoked.apiKey.id))).status).toBe(200);

    const events = await rowsOf('shop_management_key_events', WORKSPACE);
    expect(events.map((row) => previousRelease.readEvent(row).data?.kind).toSorted()).toEqual(['created', 'created', 'created', 'request', 'revoked']);
    for (const row of events) expect(previousRelease.readEvent(row)).toMatchObject({ success: true });
    const shopKeys = await rowsOf('shop_management_keys', WORKSPACE);
    expect(shopKeys.map((row) => previousRelease.readShopKey(row).data?.id)).toEqual([shopKey.apiKey.id]);

    expect(await okData(await ownerRequest(WORKSPACE, API_ROUTES.apiKeysShopManagementPurge.method, API_PATHS.apiKeysShopManagementPurge), z.object({ purged: z.number() })))
      .toEqual({ purged: 3 });
    const afterPurge = await rowsOf('shop_management_key_events', WORKSPACE);
    for (const row of afterPurge) expect(previousRelease.readEvent(row)).toMatchObject({ success: true });
    expect(afterPurge.filter((row) => previousRelease.readEvent(row).data?.kind === 'purged')).toHaveLength(3);
    expect(await rowsOf('shop_management_keys', WORKSPACE)).toEqual([]);
    expect(await rowsOf('application_keys', WORKSPACE)).toEqual([]);
  });

  it('lets that release delete a workspace by its own tables while application keys and their rate-limit buckets remain', async () => {
    const created = await createApplicationKey(RESEED_WORKSPACE, { name: 'Companion app', scopes: ['entitlements:check'], expiresAt });
    expect((await checkWithKey(RESEED_WORKSPACE, created.secret)).status).toBe(200);
    expect(await countOf(`select count(*) from application_key_rate_limit_buckets where api_key_id = '${created.apiKey.id}'`)).toBeGreaterThan(0);

    for (const table of ['shop_management_key_events', 'shop_management_keys', 'tenant_admins']) {
      await database.db.execute(`delete from ${table} where tenant_id = '${RESEED_WORKSPACE}'`);
    }
    await database.db.execute(`delete from tenants where id = '${RESEED_WORKSPACE}'`);
    expect(await rowsOf('application_keys', RESEED_WORKSPACE)).toEqual([]);
    expect(await countOf(`select count(*) from application_key_rate_limit_buckets where api_key_id = '${created.apiKey.id}'`)).toBe(0);
  });
});
