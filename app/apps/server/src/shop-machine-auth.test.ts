import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Hono, type Context } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_SESSION_PATH, BETTER_AUTH_TWO_FACTOR_TOTP_PATH } from '#adapters/auth/create-auth.js';
import { createDb } from '#adapters/db/client.js';
import { createShopManagementKeyRepository } from '#adapters/db/shop-management-keys.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  organizationAuditEvents,
  organizationMembers,
  organizationSecrets,
  organizations,
  products,
  shopManagementKeyEvents,
  shopManagementKeyRateLimitBuckets,
  shopManagementKeys,
  tenantAdmins,
  tenantApiKeys,
  tenantConfigSources,
  tenantSecrets,
  tenants,
  user,
} from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  SHOP_ASSETS_ROUTES,
  SHOP_CATALOG_ROUTES,
  SHOP_INTEGRATION_ROUTES,
  SHOP_ORDER_ROUTES,
  SHOP_PROPOSAL_ROUTES,
  SHOP_SETTINGS_ROUTES,
  shopCatalogContracts,
  shopIntegrationContracts,
} from '#core/contract/index.js';
import {
  capabilitiesForPrincipal,
  shopManagementScopeSchema,
  type ShopManagementScope,
  type TenantApiKeyScope,
} from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';
import { buildApp } from './app.js';
import { DEFAULT_API_BODY_LIMIT } from './body-limits.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';
import { telemetryMiddleware } from './telemetry.js';
import { registerInternalRoutes } from './internal-app.js';
import {
  assertShopMachineRouteCoverage,
  registerShopMachineRoute,
  SHOP_MACHINE_PATH_PREFIX,
} from './shop-machine-auth.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const PROBE_PATH = '/api/m2m/shop/test-probe';
const PROBE_PROPOSE_MODE = { kind: 'refuse', reason: 'side-effect' } as const;
const THROWING_PATH = '/api/m2m/shop/test-throwing-probe';
const CREATED_AT = '2026-11-01T00:00:00.000Z';
const EXPIRES_AT = '2026-11-20T00:00:00.000Z';
const START = Date.parse('2026-11-15T10:00:30.000Z');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let probeApp: Hono<AppVars>;
let realApp: ReturnType<typeof buildApp>;
let minute = 0;
let now = new Date(START).toISOString();

const probeResponseSchema = z.object({
  userId: z.string(),
  email: z.string(),
  staffRole: z.string().nullable(),
  tenantId: z.string(),
  capabilities: z.array(z.string()),
  machineActor: z.object({ kind: z.literal('shop_management_key'), apiKeyId: z.string(), mode: z.enum(['direct', 'propose']) }),
});

const issuers = {
  owner: 'user-shop-owner',
  demoted: 'user-shop-demoted',
  removed: 'user-shop-removed',
  unverified: 'user-shop-unverified',
  deleted: 'user-shop-deleted',
} as const;

const insertKey = async (input: {
  id: string;
  secret: string;
  tenantId?: string;
  scopes: ShopManagementScope[];
  issuedByUserId?: string;
  expiresAt?: string;
  revokedAt?: string | null;
}): Promise<void> => {
  await database.db.insert(shopManagementKeys).values({
    id: input.id,
    tenantId: input.tenantId ?? 'acme',
    name: input.id,
    keyHash: deps.apiKeyCrypto.hash(input.secret),
    scopes: input.scopes,
    issuedByUserId: input.issuedByUserId ?? issuers.owner,
    createdAt: CREATED_AT,
    expiresAt: input.expiresAt ?? EXPIRES_AT,
    revokedAt: input.revokedAt ?? null,
  });
};

const insertLegacyKey = async (id: string, secret: string, scopes: TenantApiKeyScope[] | null): Promise<void> => {
  await database.db.insert(tenantApiKeys).values({
    id, tenantId: 'acme', name: id, keyHash: deps.apiKeyCrypto.hash(secret), scopes,
    createdAt: CREATED_AT, expiresAt: null, revokedAt: null,
  });
};

const probe = (headers: Record<string, string>, method: 'GET' | 'POST' = 'GET') =>
  probeApp.request(`${baseUrl}${PROBE_PATH}`, {
    method,
    headers: { host: acmeHost, ...headers },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });

const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_machine_auth_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-machine-auth-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });

  await database.db.insert(user).values([
    { id: issuers.owner, name: 'Shop Owner', email: 'shop-owner@example.test', emailVerified: true },
    { id: issuers.demoted, name: 'Demoted Owner', email: 'demoted-owner@example.test', emailVerified: true },
    { id: issuers.removed, name: 'Removed Owner', email: 'removed-owner@example.test', emailVerified: true },
    { id: issuers.unverified, name: 'Unverified Owner', email: 'unverified-owner@example.test', emailVerified: false },
    { id: issuers.deleted, name: 'Deleted Owner', email: 'deleted-owner@example.test', emailVerified: true },
  ]);
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: CREATED_AT });
  }
  await database.db.insert(tenantAdmins).values(Object.values(issuers).map((userId) => ({
    id: `grant-${userId}`, tenantId: 'acme', userId, role: 'owner' as const,
  })));
  await database.db.insert(tenantAdmins).values({ id: 'grant-studio-owner', tenantId: 'studio', userId: issuers.owner, role: 'owner' });

  await insertKey({ id: 'shop-read', secret: 'shop-read-secret', scopes: ['shop:catalog:read'] });
  await insertKey({ id: 'shop-all', secret: 'shop-all-secret', scopes: [...shopManagementScopeSchema.options] });
  await insertKey({ id: 'shop-orders', secret: 'shop-orders-secret', scopes: ['shop:orders:read'] });
  await insertKey({ id: 'shop-revoked', secret: 'shop-revoked-secret', scopes: ['shop:catalog:read'], revokedAt: CREATED_AT });
  await insertKey({ id: 'shop-expiring', secret: 'shop-expiring-secret', scopes: ['shop:catalog:read'], expiresAt: '2026-11-16T00:00:00.000Z' });
  await insertKey({ id: 'shop-rate', secret: 'shop-rate-secret', scopes: ['shop:catalog:read'] });
  await insertLegacyKey('legacy-null', 'legacy-null-secret', null);
  for (const scope of ['report:read', 'enrollment', 'subscriptions:read', 'subscriptions:adopt', 'marketing', 'transactional', 'import:content', 'import:users'] as const) {
    await insertLegacyKey(`legacy-${scope}`, `legacy-${scope}-secret`, [scope]);
  }
  for (const [name, issuer] of Object.entries(issuers)) {
    if (name === 'owner') continue;
    await insertKey({ id: `shop-${name}`, secret: `shop-${name}-secret`, scopes: ['shop:catalog:read'], issuedByUserId: issuer });
  }

  probeApp = new Hono<AppVars>();
  const probeHandler: Parameters<typeof registerShopMachineRoute>[2]['handler'] = (c, request) => c.json({
    userId: request.ctx.identity.userId,
    email: request.ctx.identity.email,
    staffRole: request.ctx.identity.staffRole,
    tenantId: request.tenant.id,
    capabilities: request.ctx.capabilities ?? [],
    machineActor: request.ctx.machineActor,
  });
  registerShopMachineRoute(probeApp, deps, { method: 'GET', path: PROBE_PATH, scope: 'shop:catalog:read', handler: probeHandler });
  registerShopMachineRoute(probeApp, deps, {
    method: 'POST', path: PROBE_PATH, scope: 'shop:catalog:write', proposeMode: PROBE_PROPOSE_MODE, handler: probeHandler,
  });
  registerInternalRoutes(probeApp, deps);
  realApp = buildApp(deps);
}, 120_000);

afterAll(async () => { await database?.close(); });

beforeEach(() => {
  minute += 1;
  now = new Date(START + minute * 60_000).toISOString();
});

describe('shop management route registration', () => {
  it('refuses a route outside the shop management prefix', () => {
    expect(() => registerShopMachineRoute(new Hono<AppVars>(), deps, {
      method: 'GET', path: '/api/products', scope: 'shop:catalog:read', handler: (c) => c.json({}),
    })).toThrow(SHOP_MACHINE_PATH_PREFIX);
  });

  it('requires a manifest entry and the api-key origin policy for every shop route', () => {
    expect(() => assertShopMachineRouteCoverage([{ method: 'POST', path: PROBE_PATH }])).toThrow(`POST ${PROBE_PATH}`);
    expect(() => assertShopMachineRouteCoverage([{ method: 'GET', path: PROBE_PATH }])).toThrow(`GET ${PROBE_PATH}`);
    expect(() => assertShopMachineRouteCoverage([])).not.toThrow();
  });

  it('refuses at startup a shop mutation that declares no proposeMode class', () => {
    expect(() => assertShopMachineRouteCoverage([SHOP_CATALOG_ROUTES.createProduct]))
      .toThrow(`Shop management mutations need a proposeMode class: POST ${SHOP_CATALOG_ROUTES.createProduct.path}`);
    expect(() => assertShopMachineRouteCoverage([{ ...SHOP_CATALOG_ROUTES.createProduct, proposeMode: { kind: 'refuse' } }])).not.toThrow();
    expect(() => assertShopMachineRouteCoverage([SHOP_CATALOG_ROUTES.listProducts])).not.toThrow();
  });

  it('exposes no refund route to a shop management key', () => {
    const shopRoutes = [...Object.values(SHOP_CATALOG_ROUTES), ...Object.values(SHOP_ORDER_ROUTES), ...Object.values(SHOP_SETTINGS_ROUTES), ...Object.values(SHOP_ASSETS_ROUTES), ...Object.values(SHOP_INTEGRATION_ROUTES), ...Object.values(SHOP_PROPOSAL_ROUTES)];
    expect(shopRoutes.filter((route) => route.path.includes('refund') || (route.method === 'POST' && route.path.endsWith('/packing-list')))).toEqual([]);
    expect(realApp.routes.filter((route) => route.path.startsWith(SHOP_MACHINE_PATH_PREFIX) && route.path.includes('refund'))).toEqual([]);
  });

  it('registers only the catalog, order, settings, asset, integration and proposal routes under the shop management prefix', () => {
    expect(realApp.routes
      .filter((route) => route.path.startsWith(SHOP_MACHINE_PATH_PREFIX))
      .map((route) => `${route.method} ${route.path}`))
      .toEqual([...Object.values(SHOP_CATALOG_ROUTES), ...Object.values(SHOP_ORDER_ROUTES), ...Object.values(SHOP_SETTINGS_ROUTES), ...Object.values(SHOP_ASSETS_ROUTES), ...Object.values(SHOP_INTEGRATION_ROUTES), ...Object.values(SHOP_PROPOSAL_ROUTES)].map((route) => `${route.method} ${route.path}`));
  });
});

describe('shop management key authentication over HTTP', () => {
  it('builds the context from the issuer identity and the key id', async () => {
    const response = await probe({ 'x-api-key': 'shop-read-secret' });
    expect(response.status).toBe(200);
    const body = probeResponseSchema.parse(await response.json());
    expect(body).toEqual({
      userId: issuers.owner,
      email: 'shop-owner@example.test',
      staffRole: 'owner',
      tenantId: 'acme',
      capabilities: ['product:read', 'product:price:read'],
      machineActor: { kind: 'shop_management_key', apiKeyId: 'shop-read', mode: 'direct' },
    });
  });

  it('never grants more than owner capabilities', async () => {
    const response = await probe({ 'x-api-key': 'shop-all-secret' });
    expect(response.status).toBe(200);
    const { capabilities } = probeResponseSchema.parse(await response.json());
    const owner: readonly string[] = capabilitiesForPrincipal('owner');
    expect(capabilities.every((capability) => owner.includes(capability))).toBe(true);
    expect(capabilities).not.toContain('api-key:write');
  });

  it('rejects a key without the route scope and a key with another shop scope', async () => {
    const write = await probe({ 'x-api-key': 'shop-read-secret' }, 'POST');
    expect(write.status).toBe(403);
    expect(await errorOf(write)).toEqual({ code: 'forbidden', message: 'shop:catalog:write is not permitted' });
    const read = await probe({ 'x-api-key': 'shop-orders-secret' });
    expect(read.status).toBe(403);
    expect(await errorOf(read)).toEqual({ code: 'forbidden', message: 'shop:catalog:read is not permitted' });
  });

  it.each([
    'legacy-null-secret',
    'legacy-report:read-secret',
    'legacy-enrollment-secret',
    'legacy-subscriptions:read-secret',
    'legacy-subscriptions:adopt-secret',
    'legacy-marketing-secret',
    'legacy-transactional-secret',
    'legacy-import:content-secret',
    'legacy-import:users-secret',
    'shop-revoked-secret',
    'unknown-secret',
  ])('rejects %s as an invalid key', async (secret) => {
    const response = await probe({ 'x-api-key': secret });
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
  });

  it('rejects the key on another tenant host and through another x-tenant header', async () => {
    const otherHost = await probe({ host: studioHost, 'x-api-key': 'shop-read-secret' });
    expect(otherHost.status).toBe(401);
    expect(await errorOf(otherHost)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
    const otherHeader = await probe({ host: 'localhost:48730', 'x-tenant': 'studio', 'x-api-key': 'shop-read-secret' });
    expect(otherHeader.status).toBe(401);
    expect(await errorOf(otherHeader)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
    const ownHeader = await probe({ host: 'localhost:48730', 'x-tenant': 'acme', 'x-api-key': 'shop-read-secret' });
    expect(ownHeader.status).toBe(200);
  });

  it('rejects a key once the clock passes its expiry', async () => {
    expect((await probe({ 'x-api-key': 'shop-expiring-secret' })).status).toBe(200);
    now = '2026-11-16T00:00:00.000Z';
    const expired = await probe({ 'x-api-key': 'shop-expiring-secret' });
    expect(expired.status).toBe(401);
    expect(await errorOf(expired)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
  });

  it('applies issuer demotion, removal, unverified email and account deletion on the next request', async () => {
    for (const name of ['demoted', 'removed', 'deleted'] as const) {
      expect((await probe({ 'x-api-key': `shop-${name}-secret` })).status).toBe(200);
    }
    await database.db.execute(`update tenant_admins set role = 'admin' where user_id = '${issuers.demoted}'`);
    await database.db.execute(`delete from tenant_admins where user_id = '${issuers.removed}'`);
    await database.db.execute(`delete from "user" where id = '${issuers.deleted}'`);
    for (const name of ['demoted', 'removed', 'unverified', 'deleted'] as const) {
      const response = await probe({ 'x-api-key': `shop-${name}-secret` });
      expect(response.status).toBe(401);
      expect(await errorOf(response)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
    }
  });

  it.each([
    ['a cookie', { cookie: 'better-auth.session_token=anything', 'x-api-key': 'shop-read-secret' }],
    ['a Bearer token', { authorization: 'Bearer anything', 'x-api-key': 'shop-read-secret' }],
    ['a Bearer token alone', { authorization: 'Bearer anything' }],
    ['a cookie alone', { cookie: 'better-auth.session_token=anything' }],
  ])('rejects a request with %s without consulting the session', async (_label, headers) => {
    for (const method of ['GET', 'POST'] as const) {
      const response = await probe(headers, method);
      expect(response.status).toBe(401);
      expect(await errorOf(response)).toEqual({
        code: 'unauthorized',
        message: 'Shop management requests must not carry a cookie or an Authorization header',
      });
    }
  });

  it('rejects a request without a key', async () => {
    const response = await probe({});
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toEqual({ code: 'unauthorized', message: 'Missing API key' });
  });

  it('rejects the 61st request in a minute with Retry-After', async () => {
    for (let request = 0; request < 60; request += 1) {
      expect((await probe({ 'x-api-key': 'shop-rate-secret' })).status).toBe(200);
    }
    const limited = await probe({ 'x-api-key': 'shop-rate-secret' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
    expect(await errorOf(limited)).toMatchObject({ code: 'rate_limited' });
    expect((await probe({ 'x-api-key': 'shop-read-secret' })).status).toBe(200);
    const buckets = (await database.db.select().from(shopManagementKeyRateLimitBuckets))
      .filter((bucket) => bucket.apiKeyId === 'shop-rate')
      .map((bucket) => ({ period: bucket.period, count: bucket.count }));
    expect(buckets).toEqual(expect.arrayContaining([{ period: 'day', count: 60 }, { period: 'minute', count: 60 }]));
  });
});

describe('shop management keys on existing routes of the real app', () => {
  const keyed = (path: string, method: string, body?: unknown) => realApp.request(`${baseUrl}${path}`, {
    method,
    headers: { host: acmeHost, 'x-api-key': 'shop-all-secret', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  it.each([
    ['POST', API_ROUTES.apiKeysShopManagementCreate.path, { name: 'Minted by a key', scopes: ['shop:catalog:read'], expiresAt: EXPIRES_AT }],
    ['DELETE', API_PATHS.apiKeysShopManagementRevoke.replace(':id', 'shop-read'), undefined],
    ['GET', API_PATHS.apiKeysShopManagement, undefined],
    ['POST', API_PATHS.apiKeysShopManagementPurge, undefined],
    ['GET', API_PATHS.apiKeysShopManagementEvents, undefined],
    ['POST', API_ROUTES.apiKeysCreate.path, { name: 'Minted by a key' }],
    ['GET', API_PATHS.apiKeys, undefined],
    ['GET', API_PATHS.tenantTeam, undefined],
    ['POST', API_PATHS.tenantSettingsUpdate, { name: 'Renamed by a key' }],
    ['POST', API_ROUTES.productsCreate.path, { title: 'Created by a key', type: 'course' }],
    ['GET', API_PATHS.orders, undefined],
    ['GET', API_PATHS.orderRefundPreview.replace(':orderId', 'order-1'), undefined],
    ['POST', API_PATHS.orderRefundCreate.replace(':orderId', 'order-1'), { requestKey: 'keyed-refund' }],
    ['POST', API_PATHS.orderShipAnyway.replace(':orderId', 'order-1'), {}],
    ['POST', API_PATHS.operatorTenantProvision, { slug: 'minted', name: 'Minted' }],
  ] as const)('refuses %s %s', async (method, path, body) => {
    const response = await keyed(path, method, body);
    expect(response.status).toBe(401);
  });

  it.each(['legacy-null-secret', 'legacy-report:read-secret', 'legacy-enrollment-secret', 'legacy-transactional-secret', 'legacy-import:users-secret'])('refuses the refund routes to the API key %s', async (secret) => {
    for (const [method, path, body] of [
      ['GET', API_PATHS.orderRefundPreview.replace(':orderId', 'order-1'), undefined],
      ['POST', API_PATHS.orderRefundCreate.replace(':orderId', 'order-1'), { requestKey: 'keyed-refund' }],
      ['POST', API_PATHS.orderShipAnyway.replace(':orderId', 'order-1'), {}],
    ] as const) {
      const response = await realApp.request(`${baseUrl}${path}`, {
        method,
        headers: { host: acmeHost, 'x-api-key': secret, authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it('derives no Better Auth session from the key', async () => {
    const session = await keyed(BETTER_AUTH_SESSION_PATH, 'GET');
    expect(session.status).toBe(200);
    expect(await session.json()).toBeNull();
    const totp = await realApp.request(`${baseUrl}${BETTER_AUTH_TWO_FACTOR_TOTP_PATH}`, {
      method: 'POST',
      headers: { host: acmeHost, origin: 'http://acme.localhost:48730', 'content-type': 'application/json', 'x-api-key': 'shop-all-secret' },
      body: JSON.stringify({ code: '000000' }),
    });
    expect(totp.status).toBe(401);
  });

  it('leaves the key and the key list untouched after the refused key administration calls', async () => {
    const keys = await deps.shopManagementKeys.listByTenant('acme');
    expect(keys.find((key) => key.id === 'shop-read')?.revokedAt).toBeNull();
    expect(keys.some((key) => key.name === 'Minted by a key')).toBe(false);
  });

  it('writes no request row for a keyed mutation refused by the body size limit', async () => {
    const before = (await database.db.select().from(shopManagementKeyEvents)).length;
    const response = await keyed(SHOP_CATALOG_ROUTES.updateProduct.path, 'POST', { id: 'product-1', description: 'x'.repeat(DEFAULT_API_BODY_LIMIT) });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatchObject({ code: 'validation' });
    expect(await database.db.select().from(shopManagementKeyEvents)).toHaveLength(before);
  });

  it.each([
    ['POST', API_PATHS.m2mEnroll, { email: 'buyer@example.test', productId: 'product' }],
    ['GET', API_PATHS.activitySummary, undefined],
    ['POST', API_PATHS.m2mImportValidate, { records: [] }],
    ['GET', API_PATHS.m2mListMarketingContacts, undefined],
  ] as const)('answers %s %s with unauthorized', async (method, path, body) => {
    const response = await keyed(path, method, body);
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toMatchObject({ code: 'unauthorized' });
  });
});

describe('shop management key secrecy in telemetry', () => {
  const exporter = new InMemorySpanExporter();
  const rowsSeenByThrowingHandler: number[] = [];
  const throwingRows = async () => (await database.db.select().from(shopManagementKeyEvents))
    .filter((event) => event.route === THROWING_PATH);
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  let app: Hono<AppVars>;

  beforeAll(() => {
    provider.register();
    app = new Hono<AppVars>();
    app.use('*', telemetryMiddleware);
    registerShopMachineRoute(app, deps, {
      method: 'GET', path: PROBE_PATH, scope: 'shop:catalog:read', handler: (c) => c.json({ ok: true }),
    });
    registerShopMachineRoute(app, deps, {
      method: 'POST',
      path: THROWING_PATH,
      scope: 'shop:catalog:read',
      proposeMode: PROBE_PROPOSE_MODE,
      handler: async () => {
        rowsSeenByThrowingHandler.push((await throwingRows()).length);
        throw new Error('handler failed');
      },
    });
    registerShopMachineRoute(app, deps, {
      method: 'POST', path: PROBE_PATH, scope: 'shop:catalog:read', proposeMode: PROBE_PROPOSE_MODE, handler: (c) => c.json({ ok: true }),
    });
  });
  beforeAll(async () => {
    await insertKey({ id: 'shop-span-rate', secret: 'shop-span-rate-secret', scopes: ['shop:catalog:read'] });
    await insertKey({ id: 'shop-span-expired', secret: 'shop-span-expired-secret', scopes: ['shop:catalog:read'], expiresAt: '2026-11-02T00:00:00.000Z' });
    await insertKey({ id: 'shop-row-rate', secret: 'shop-row-rate-secret', scopes: ['shop:catalog:read'] });
  });
  afterAll(async () => { await provider.shutdown(); });
  beforeEach(() => { exporter.reset(); });

  it('keeps presented key secrets out of request spans on success and on every refusal', async () => {
    const secrets = ['shop-read-secret', 'shop-orders-secret', 'shop-revoked-secret', 'never-issued-secret'];
    for (const secret of secrets) {
      await app.request(`${baseUrl}${PROBE_PATH}`, { headers: { host: acmeHost, 'x-api-key': secret } });
    }
    await app.request(`${baseUrl}${PROBE_PATH}`, { headers: { host: acmeHost, 'x-api-key': 'cookie-mixed-secret', cookie: 'session=x' } });
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(secrets.length + 1);
    const recorded = JSON.stringify(spans.map((span) => ({
      name: span.name, attributes: span.attributes, events: span.events, status: span.status,
    })));
    for (const secret of [...secrets, 'cookie-mixed-secret']) expect(recorded).not.toContain(secret);
    expect(recorded).not.toContain('x-api-key');
  });

  it('records the key id and the issuer identity on the request span of a keyed request', async () => {
    const response = await app.request(`${baseUrl}${PROBE_PATH}`, { headers: { host: acmeHost, 'x-api-key': 'shop-read-secret' } });
    expect(response.status).toBe(200);
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toMatchObject({
      'app.api_key.id': 'shop-read',
      'app.user.id': issuers.owner,
      'app.user.email': 'shop-owner@example.test',
      'app.tenant.id': 'acme',
    });
    expect(JSON.stringify(spans[0]?.attributes)).not.toContain('shop-read-secret');
  });

  const spanOf = async (headers: Record<string, string>, path = PROBE_PATH, method = 'GET', body: unknown = {}) => {
    exporter.reset();
    const response = await app.request(`${baseUrl}${path}`, {
      method,
      headers: { host: acmeHost, ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    return { status: response.status, attributes: spans[0]?.attributes ?? {} };
  };

  const keyAttributes = (apiKeyId: string, issuerId: string = issuers.owner) => ({
    'app.api_key.match': 'matched',
    'app.api_key.id': apiKeyId,
    'app.api_key.issuer.id': issuerId,
    'app.tenant.id': 'acme',
  });

  it.each([
    ['a revoked key', 'shop-revoked-secret', keyAttributes('shop-revoked')],
    ['an expired key', 'shop-span-expired-secret', keyAttributes('shop-span-expired')],
    ['a key whose issuer is unverified', 'shop-unverified-secret', keyAttributes('shop-unverified', issuers.unverified)],
  ])('attributes the 401 refusal of %s to the stored key row', async (_label, secret, expected) => {
    const { status, attributes } = await spanOf({ 'x-api-key': secret });
    expect(status).toBe(401);
    expect(attributes).toMatchObject(expected);
    expect(attributes).not.toHaveProperty('app.user.id');
  });

  it('never looks a legacy key up on a shop route: its 401 matches no key', async () => {
    const { status, attributes } = await spanOf({ 'x-api-key': 'legacy-null-secret' });
    expect(status).toBe(401);
    expect(attributes).toMatchObject({ 'app.api_key.match': 'none', 'app.tenant.id': 'acme' });
    expect(attributes).not.toHaveProperty('app.api_key.id');
  });

  it('records that no key matched an unknown secret and that a request carried no key', async () => {
    const unknown = await spanOf({ 'x-api-key': 'never-issued-secret' });
    expect(unknown.status).toBe(401);
    expect(unknown.attributes).toMatchObject({ 'app.api_key.match': 'none', 'app.tenant.id': 'acme' });
    expect(unknown.attributes).not.toHaveProperty('app.api_key.id');
    const missing = await spanOf({});
    expect(missing.status).toBe(401);
    expect(missing.attributes).toMatchObject({ 'app.api_key.match': 'missing', 'app.tenant.id': 'acme' });
  });

  it.each([
    ['a cookie', { cookie: 'session=x' }],
    ['an Authorization header', { authorization: 'Bearer anything' }],
  ])('records only the refusal reason for a key sent with %s and never looks the key up', async (_label, extra) => {
    const findByHash = vi.fn(deps.shopManagementKeys.findByHash);
    const mixed = new Hono<AppVars>();
    mixed.use('*', telemetryMiddleware);
    registerShopMachineRoute(mixed, { ...deps, shopManagementKeys: { ...deps.shopManagementKeys, findByHash } }, {
      method: 'GET', path: PROBE_PATH, scope: 'shop:catalog:read', handler: (c) => c.json({ ok: true }),
    });
    exporter.reset();
    const response = await mixed.request(`${baseUrl}${PROBE_PATH}`, { headers: { host: acmeHost, 'x-api-key': 'shop-read-secret', ...extra } });
    expect(response.status).toBe(401);
    await provider.forceFlush();
    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes).toMatchObject({ 'app.api_key.match': 'mixed_credentials' });
    expect(Object.keys(span?.attributes ?? {}).filter((name) => name.startsWith('app.api_key.'))).toEqual(['app.api_key.match']);
    expect(span?.attributes).not.toHaveProperty('app.user.id');
    expect(findByHash).not.toHaveBeenCalled();
  });

  it('attributes a scope refusal to the key', async () => {
    const { status, attributes } = await spanOf({ 'x-api-key': 'shop-orders-secret' });
    expect(status).toBe(403);
    expect(attributes).toMatchObject(keyAttributes('shop-orders'));
  });

  it('attributes a rate-limit refusal to the key', async () => {
    for (let request = 0; request < 60; request += 1) {
      await app.request(`${baseUrl}${PROBE_PATH}`, { headers: { host: acmeHost, 'x-api-key': 'shop-span-rate-secret' } });
    }
    const { status, attributes } = await spanOf({ 'x-api-key': 'shop-span-rate-secret' });
    expect(status).toBe(429);
    expect(attributes).toMatchObject(keyAttributes('shop-span-rate'));
  });

  it('attributes a handler error to the key and its issuer', async () => {
    const { status, attributes } = await spanOf({ 'x-api-key': 'shop-read-secret' }, THROWING_PATH, 'POST');
    expect(status).toBe(500);
    expect(attributes).toMatchObject({ ...keyAttributes('shop-read'), 'app.user.id': issuers.owner });
  });

  it('writes the request row before a keyed mutation handler runs and answers the handler error when it throws', async () => {
    const before = (await throwingRows()).length;
    const { status, attributes } = await spanOf({ 'x-api-key': 'shop-read-secret' }, THROWING_PATH, 'POST', { id: 'product-1' });
    expect(status).toBe(500);
    expect(attributes).toMatchObject(keyAttributes('shop-read'));
    expect(rowsSeenByThrowingHandler.at(-1)).toBe(before + 1);
    const rows = await throwingRows();
    expect(rows).toHaveLength(before + 1);
    expect(rows).toContainEqual(expect.objectContaining({ apiKeyId: 'shop-read', actorUserId: issuers.owner, resourceId: 'product-1' }));
  });

  it('refuses a keyed mutation with a retryable 503 before its handler when the history write fails', async () => {
    const handler = vi.fn((c: Context<AppVars>) => c.json({ ok: true }));
    const historyDown = new Hono<AppVars>();
    historyDown.use('*', telemetryMiddleware);
    registerShopMachineRoute(historyDown, {
      ...deps,
      shopManagementKeyEvents: { record: async () => { throw new Error('history unavailable'); } },
    }, { method: 'POST', path: PROBE_PATH, scope: 'shop:catalog:read', proposeMode: PROBE_PROPOSE_MODE, handler });
    exporter.reset();
    const response = await historyDown.request(`${baseUrl}${PROBE_PATH}`, {
      method: 'POST', headers: { host: acmeHost, 'x-api-key': 'shop-read-secret' }, body: '{}',
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
    expect(await errorOf(response)).toMatchObject({ code: 'unavailable' });
    expect(handler).not.toHaveBeenCalled();
    await provider.forceFlush();
    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes).toMatchObject(keyAttributes('shop-read'));
    expect(span?.events.map((event) => event.name)).toContain('exception');
  });

  it('answers a committed keyed mutation with the handler response because no history write follows the handler', async () => {
    const steps: string[] = [];
    const recordOnce = vi.fn(async (...args: Parameters<typeof deps.shopManagementKeyEvents.record>) => {
      steps.push('history');
      if (recordOnce.mock.calls.length > 1) throw new Error('history unavailable');
      await deps.shopManagementKeyEvents.record(...args);
    });
    const committed = new Hono<AppVars>();
    registerShopMachineRoute(committed, { ...deps, shopManagementKeyEvents: { record: recordOnce } }, {
      method: 'POST', path: PROBE_PATH, scope: 'shop:catalog:read', proposeMode: PROBE_PROPOSE_MODE, handler: (c) => { steps.push('handler'); return c.json({ ok: true }); },
    });
    const response = await committed.request(`${baseUrl}${PROBE_PATH}`, {
      method: 'POST', headers: { host: acmeHost, 'x-api-key': 'shop-read-secret' }, body: '{}',
    });
    expect(response.status).toBe(200);
    expect(steps).toEqual(['history', 'handler']);
  });

  const probeRows = async () => (await database.db.select().from(shopManagementKeyEvents))
    .filter((event) => event.route === PROBE_PATH);

  it.each([
    ['a revoked key', { 'x-api-key': 'shop-revoked-secret' }, 401, keyAttributes('shop-revoked')],
    ['an expired key', { 'x-api-key': 'shop-span-expired-secret' }, 401, keyAttributes('shop-span-expired')],
    ['a legacy key', { 'x-api-key': 'legacy-null-secret' }, 401, { 'app.api_key.match': 'none', 'app.tenant.id': 'acme' }],
    ['mixed credentials', { 'x-api-key': 'shop-read-secret', cookie: 'session=x' }, 401, { 'app.api_key.match': 'mixed_credentials' }],
    ['a missing scope', { 'x-api-key': 'shop-orders-secret' }, 403, keyAttributes('shop-orders')],
  ])('writes no request row for a keyed mutation refused for %s and still attributes its span', async (_label, headers, expectedStatus, expected) => {
    const before = await probeRows();
    const { status, attributes } = await spanOf(headers, PROBE_PATH, 'POST', { id: 'product-1' });
    expect(status).toBe(expectedStatus);
    expect(attributes).toMatchObject(expected);
    expect(await probeRows()).toEqual(before);
  });

  it('writes no request row for a keyed mutation refused by the rate limit and still attributes its span', async () => {
    for (let request = 0; request < 60; request += 1) {
      await app.request(`${baseUrl}${PROBE_PATH}`, { method: 'POST', headers: { host: acmeHost, 'x-api-key': 'shop-row-rate-secret' }, body: '{}' });
    }
    const before = await probeRows();
    const { status, attributes } = await spanOf({ 'x-api-key': 'shop-row-rate-secret' }, PROBE_PATH, 'POST', { id: 'product-1' });
    expect(status).toBe(429);
    expect(attributes).toMatchObject(keyAttributes('shop-row-rate'));
    expect(await probeRows()).toEqual(before);
  });

  it('writes exactly one request row with the key, issuer, route and resource id for an accepted keyed mutation', async () => {
    const before = await probeRows();
    const longestId = `p${'x'.repeat(199)}`;
    const { status } = await spanOf({ 'x-api-key': 'shop-read-secret' }, PROBE_PATH, 'POST', { id: longestId });
    expect(status).toBe(200);
    const added = (await probeRows()).filter((row) => !before.some((earlier) => earlier.id === row.id));
    expect(added).toEqual([expect.objectContaining({
      apiKeyId: 'shop-read', kind: 'request', actorUserId: issuers.owner, method: 'POST', route: PROBE_PATH, resourceId: longestId,
    })]);
  });

  it.each([
    ['an over-long id', { id: `p${'x'.repeat(200)}` }],
    ['an id that is not an identifier', { id: 'product 1; drop table' }],
    ['an id starting with a separator', { productId: '-product-1' }],
  ])('stores %s as no resource id', async (_label, body) => {
    const before = await probeRows();
    const { status } = await spanOf({ 'x-api-key': 'shop-read-secret' }, PROBE_PATH, 'POST', body);
    expect(status).toBe(200);
    const added = (await probeRows()).filter((row) => !before.some((earlier) => earlier.id === row.id));
    expect(added).toEqual([expect.objectContaining({ apiKeyId: 'shop-read', resourceId: null })]);
  });

  it.each([
    ['a shop route', SHOP_CATALOG_ROUTES.listProducts.path, 'shop-read-secret', {}],
  ])('keeps the key and its hash out of the span, the logs and the response when the key lookup fails on %s', async (_label, path, secret, extraHeaders) => {
    const brokenDb = createDb('node-postgres', `${database.url.replace(/\/[^/?]+(\?|$)/, '/together_missing_hash_lookup_db$1')}`, { connectionTimeoutMillis: 5_000 });
    const failingLookups = buildApp({ ...deps, shopManagementKeys: createShopManagementKeyRepository(brokenDb) });
    const logged: unknown[] = [];
    const consoleSpies = (['error', 'warn', 'log', 'info', 'debug'] as const)
      .map((level) => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args); }));
    exporter.reset();
    try {
      const response = await failingLookups.request(`${baseUrl}${path}`, { headers: { host: acmeHost, 'x-api-key': secret, ...extraHeaders } });
      expect(response.status).toBe(500);
      const body = await response.text();
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBeGreaterThan(0);
      const exceptions = spans.flatMap((span) => span.events.filter((event) => event.name === 'exception'));
      expect(exceptions.length).toBeGreaterThan(0);
      const recorded = JSON.stringify({
        spans: spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events, status: span.status })),
        logged: logged.map((args) => String(args)),
        body,
      });
      const hash = deps.apiKeyCrypto.hash(secret);
      expect(recorded).not.toContain(hash);
      expect(recorded).not.toContain(secret);
      expect(recorded).not.toContain(hash.slice(0, 16));
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  it('attributes no key to a keyed mutation refused by the body size limit', async () => {
    exporter.reset();
    const response = await realApp.request(`${baseUrl}${SHOP_CATALOG_ROUTES.updateProduct.path}`, {
      method: 'POST',
      headers: { host: acmeHost, 'x-api-key': 'shop-all-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'product-1', description: 'x'.repeat(DEFAULT_API_BODY_LIMIT) }),
    });
    expect(response.status).toBe(400);
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(Object.keys(spans[0]?.attributes ?? {}).filter((name) => name.startsWith('app.api_key.'))).toEqual([]);
  });

  it('never records the key hash or a prefix of the secret', async () => {
    const { attributes } = await spanOf({ 'x-api-key': 'shop-revoked-secret' });
    const recorded = JSON.stringify(attributes);
    expect(recorded).not.toContain(deps.apiKeyCrypto.hash('shop-revoked-secret'));
    expect(recorded).not.toContain('shop-revoked-se');
  });
});

describe('shop management keys next to an organization of two workspaces', () => {
  const ORGANIZATION_ID = 'org-shared';
  const orgPath = (template: string) => template.replace(':organizationId', ORGANIZATION_ID);
  const keyed = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
    realApp.request(`${baseUrl}${path}`, {
      method,
      headers: {
        host: acmeHost,
        'x-api-key': 'shop-all-secret',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const ORGANIZATION_SECRET_VALUES = {
    'ifirma.invoiceApiKey': 'organization-ifirma-key-qzxw',
    'shipx.token': 'organization-shipx-token-vkjy',
  } as const;
  const organizationState = async () => ({
    organizations: await database.db.select().from(organizations),
    members: await database.db.select().from(organizationMembers),
    audit: await database.db.select().from(organizationAuditEvents),
    secrets: (await database.db.select().from(organizationSecrets)).sort((left, right) => left.key.localeCompare(right.key)),
    sources: (await database.db.select().from(tenantConfigSources))
      .sort((left, right) => `${left.tenantId}/${left.configGroup}`.localeCompare(`${right.tenantId}/${right.configGroup}`)),
    links: (await database.db.select({ id: tenants.id, organizationId: tenants.organizationId }).from(tenants))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
  const studioRows = async () => ({
    products: (await database.db.select().from(products)).filter((product) => product.tenantId === 'studio'),
    events: (await database.db.select().from(shopManagementKeyEvents)).filter((event) => event.tenantId === 'studio'),
  });

  beforeAll(async () => {
    await database.db.insert(organizations).values({
      id: ORGANIZATION_ID, slug: 'shared', name: 'Shared', maxWorkspaces: 3, createdAt: CREATED_AT, updatedAt: CREATED_AT,
    });
    await database.db.insert(organizationMembers).values({
      id: 'org-member-owner', organizationId: ORGANIZATION_ID, userId: issuers.owner, role: 'owner',
      createdAt: CREATED_AT, createdByUserId: issuers.owner,
    });
    await database.db.insert(tenants).values({ id: 'akademia', slug: 'akademia', name: 'Workspace', createdAt: CREATED_AT });
    await database.db.insert(tenantAdmins).values({ id: 'grant-akademia-owner', tenantId: 'akademia', userId: issuers.owner, role: 'owner' });
    await database.db.execute(`update tenants set organization_id = '${ORGANIZATION_ID}' where id in ('acme', 'studio')`);
    await insertKey({ id: 'shop-studio', secret: 'shop-studio-secret', tenantId: 'studio', scopes: [...shopManagementScopeSchema.options] });
    await database.db.insert(user).values({
      id: 'user-org-derived', name: 'Organization Owner', email: 'organization-owner@example.test', emailVerified: true,
    });
    await database.db.insert(organizationMembers).values({
      id: 'org-member-derived', organizationId: ORGANIZATION_ID, userId: 'user-org-derived', role: 'owner',
      createdAt: CREATED_AT, createdByUserId: issuers.owner,
    });
    await insertKey({ id: 'shop-derived', secret: 'shop-derived-secret', scopes: [...shopManagementScopeSchema.options], issuedByUserId: 'user-org-derived' });
    for (const [key, value] of Object.entries(ORGANIZATION_SECRET_VALUES)) {
      await database.db.insert(organizationSecrets).values({
        id: `org-secret-${key}`, organizationId: ORGANIZATION_ID, key, ...deps.secretCrypto.encrypt(value),
        maskedPreview: `••••${value.slice(-4)}`, updatedAt: CREATED_AT,
      });
    }
    await database.db.insert(tenantConfigSources).values((['invoicing', 'shipping_carrier'] as const).map((configGroup) => ({
      tenantId: 'acme', configGroup, source: 'organization' as const, updatedAt: CREATED_AT, updatedByUserId: issuers.owner,
    })));
  });

  const sessionRequired = 'Authentication required';
  const operatorRequired = 'Invalid operator secret';

  it.each([
    ['GET', API_PATHS.organizations, undefined, sessionRequired],
    ['GET', orgPath(API_PATHS.organization), undefined, sessionRequired],
    ['GET', orgPath(API_PATHS.organizationMembers), undefined, sessionRequired],
    ['GET', orgPath(API_PATHS.organizationAuditEvents), undefined, sessionRequired],
    ['GET', orgPath(API_PATHS.organizationWorkspaces), undefined, sessionRequired],
    ['POST', orgPath(API_PATHS.organizationWorkspaceLink), { tenantId: 'akademia' }, sessionRequired],
    ['POST', orgPath(API_PATHS.organizationWorkspaceUnlink), { tenantId: 'studio' }, sessionRequired],
    ['GET', orgPath(API_PATHS.organizationSecrets), undefined, sessionRequired],
    ['POST', orgPath(API_PATHS.organizationSecrets), { key: 'ifirma.invoiceApiKey', value: 'minted-by-a-key-1234' }, sessionRequired],
    ['DELETE', orgPath(API_PATHS.organizationSecretDelete).replace(':key', 'shipx.token'), undefined, sessionRequired],
    ['POST', orgPath(API_PATHS.organizationUpdate), { legalName: 'Renamed by a key' }, sessionRequired],
    ['POST', orgPath(API_PATHS.organizationMemberAdd), { email: 'shop-owner@example.test', role: 'admin' }, sessionRequired],
    ['POST', orgPath(API_PATHS.organizationMemberRole), { email: 'organization-owner@example.test', role: 'admin' }, sessionRequired],
    ['POST', orgPath(API_PATHS.organizationMemberRemove), { email: 'organization-owner@example.test' }, sessionRequired],
    ['GET', orgPath(API_PATHS.organizationWorkspaceSources).replace(':tenantId', 'acme'), undefined, sessionRequired],
    ['POST', API_PATHS.tenantOrganizationUnlink, {}, sessionRequired],
    ['POST', API_PATHS.operatorOrganizationCreate, { slug: 'minted', name: 'Minted', ownerEmail: 'shop-owner@example.test' }, operatorRequired],
    ['POST', orgPath(API_PATHS.operatorOrganizationLimits), { maxWorkspaces: 10 }, operatorRequired],
  ] as const)('refuses the key of an organization owner on %s %s and writes nothing', async (method, path, body, message) => {
    const before = await organizationState();
    const response = await keyed(path, method, body);
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toEqual({ code: 'unauthorized', message });
    expect(await organizationState()).toEqual(before);
  });

  it('refuses the key of one workspace on the shop routes of another workspace of the same organization', async () => {
    const before = await studioRows();
    for (const headers of [{ host: studioHost }, { host: 'localhost:48730', 'x-tenant': 'studio' }]) {
      const read = await keyed(SHOP_CATALOG_ROUTES.listProducts.path, 'GET', undefined, headers);
      expect(read.status).toBe(401);
      expect(await errorOf(read)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
      const write = await keyed(SHOP_CATALOG_ROUTES.createProduct.path, 'POST', { title: 'Cross workspace', type: 'physical', priceCents: 100 }, headers);
      expect(write.status).toBe(401);
      expect(await errorOf(write)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
    }
    expect(await studioRows()).toEqual(before);
  });

  it('treats a product of another workspace of the same organization as not found to the key', async () => {
    const created = await keyed(
      SHOP_CATALOG_ROUTES.createProduct.path, 'POST', { title: 'Studio print', type: 'physical', priceCents: 500 },
      { host: studioHost, 'x-api-key': 'shop-studio-secret' },
    );
    expect(created.status).toBe(200);
    const { product } = z.object({ ok: z.literal(true), data: shopCatalogContracts.createProduct.output }).parse(await created.json()).data;
    const before = await studioRows();
    const update = await keyed(SHOP_CATALOG_ROUTES.updateProduct.path, 'POST', { id: product.id, title: 'Renamed from acme' });
    expect(update.status).toBe(404);
    expect(await errorOf(update)).toMatchObject({ code: 'not_found' });
    const prices = await keyed(SHOP_CATALOG_ROUTES.listProductPrices.path.replace(':productId', product.id), 'GET');
    expect(prices.status).toBe(404);
    const listed = z.object({ ok: z.literal(true), data: shopCatalogContracts.listProducts.output })
      .parse(await (await keyed(SHOP_CATALOG_ROUTES.listProducts.path, 'GET')).json()).data.products;
    expect(listed.map((entry) => entry.id)).not.toContain(product.id);
    expect((await studioRows()).products).toEqual(before.products);
  });

  it('keeps the key of an organization-derived owner bound to its workspace although the issuer derives owner in the other one', async () => {
    const derived = { 'x-api-key': 'shop-derived-secret' };
    const own = await keyed(SHOP_CATALOG_ROUTES.listProducts.path, 'GET', undefined, derived);
    expect(own.status).toBe(200);
    const before = await studioRows();
    for (const headers of [{ ...derived, host: studioHost }, { ...derived, host: 'localhost:48730', 'x-tenant': 'studio' }]) {
      const read = await keyed(SHOP_CATALOG_ROUTES.listProducts.path, 'GET', undefined, headers);
      expect(read.status).toBe(401);
      expect(await errorOf(read)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
      const write = await keyed(SHOP_CATALOG_ROUTES.createProduct.path, 'POST', { title: 'Derived cross workspace', type: 'physical', priceCents: 100 }, headers);
      expect(write.status).toBe(401);
      expect(await errorOf(write)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
    }
    expect(await studioRows()).toEqual(before);
  });

  it('hands no organization secret to the integration routes of a key whose workspace inherits that group', async () => {
    const before = await organizationState();
    const leaked = (body: string) => Object.values(ORGANIZATION_SECRET_VALUES)
      .flatMap((value) => [value, value.slice(-4)])
      .concat(before.secrets.flatMap((secret) => [secret.ciphertext, secret.maskedPreview]))
      .filter((needle) => body.includes(needle));
    const bodyOf = async (response: Response, status: number) => {
      expect(response.status).toBe(status);
      const body = await response.text();
      expect(leaked(body)).toEqual([]);
      return body;
    };
    const workspaceKeys = async () => (await database.db.select().from(tenantSecrets))
      .filter((secret) => secret.tenantId === 'acme').map((secret) => secret.key).sort();

    const listed = shopIntegrationContracts.listSecrets.output.parse(z.object({ ok: z.literal(true), data: z.unknown() })
      .parse(JSON.parse(await bodyOf(await keyed(SHOP_INTEGRATION_ROUTES.listSecrets.path, 'GET'), 200))).data);
    expect(listed.secrets.map((secret) => secret.key).sort()).toEqual(await workspaceKeys());
    expect(listed.secrets.map((secret) => secret.key)).not.toContain('ifirma.invoiceApiKey');

    const shipx = shopIntegrationContracts.shipxSettings.output.parse(z.object({ ok: z.literal(true), data: z.unknown() })
      .parse(JSON.parse(await bodyOf(await keyed(SHOP_INTEGRATION_ROUTES.shipxSettings.path, 'GET'), 200))).data);
    expect(shipx.sandbox.token).toBeNull();
    expect(shipx.production.token).toBeNull();

    await bodyOf(await keyed(SHOP_INTEGRATION_ROUTES.setSecret.path, 'POST', { key: 'ifirma.invoiceApiKey', value: 'workspace-ifirma-key-mnrt' }), 200);
    expect(await workspaceKeys()).toContain('ifirma.invoiceApiKey');
    await bodyOf(await keyed(SHOP_INTEGRATION_ROUTES.deleteSecret.path.replace(':key', 'ifirma.invoiceApiKey'), 'DELETE'), 200);
    expect(await workspaceKeys()).not.toContain('ifirma.invoiceApiKey');

    expect(await organizationState()).toEqual(before);
  });
});
