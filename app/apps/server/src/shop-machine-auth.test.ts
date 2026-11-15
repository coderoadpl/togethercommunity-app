import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_SESSION_PATH, BETTER_AUTH_TWO_FACTOR_TOTP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { apiKeyRateLimitBuckets, tenantAdmins, tenantApiKeys, tenants, user } from '#adapters/db/schema.js';
import { API_PATHS, API_ROUTES, SHOP_CATALOG_ROUTES } from '#core/contract/index.js';
import {
  capabilitiesForPrincipal,
  shopManagementScopeSchema,
  type TenantApiKeyStoredScope,
} from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';
import { buildApp } from './app.js';
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
  machineActor: z.object({ kind: z.literal('shop_management_key'), apiKeyId: z.string() }),
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
  kind?: 'legacy' | 'shop_management';
  scopes: TenantApiKeyStoredScope[] | null;
  issuedByUserId?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
}): Promise<void> => {
  await database.db.insert(tenantApiKeys).values({
    id: input.id,
    tenantId: input.tenantId ?? 'acme',
    name: input.id,
    keyHash: deps.apiKeyCrypto.hash(input.secret),
    kind: input.kind ?? 'shop_management',
    scopes: input.scopes,
    issuedByUserId: input.issuedByUserId === undefined ? issuers.owner : input.issuedByUserId,
    createdAt: CREATED_AT,
    expiresAt: input.expiresAt === undefined ? EXPIRES_AT : input.expiresAt,
    revokedAt: input.revokedAt ?? null,
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
  await insertKey({ id: 'shop-mixed', secret: 'shop-mixed-secret', scopes: ['shop:catalog:read', 'report:read'] });
  await insertKey({ id: 'shop-revoked', secret: 'shop-revoked-secret', scopes: ['shop:catalog:read'], revokedAt: CREATED_AT });
  await insertKey({ id: 'shop-expiring', secret: 'shop-expiring-secret', scopes: ['shop:catalog:read'], expiresAt: '2026-11-16T00:00:00.000Z' });
  await insertKey({ id: 'shop-rate', secret: 'shop-rate-secret', scopes: ['shop:catalog:read'] });
  await insertKey({ id: 'legacy-null', secret: 'legacy-null-secret', kind: 'legacy', scopes: null, issuedByUserId: null, expiresAt: null });
  for (const scope of ['report:read', 'enrollment', 'subscriptions:read', 'subscriptions:adopt', 'marketing', 'transactional', 'import:content', 'import:users'] as const) {
    await insertKey({ id: `legacy-${scope}`, secret: `legacy-${scope}-secret`, kind: 'legacy', scopes: [scope], issuedByUserId: null });
  }
  for (const [name, issuer] of Object.entries(issuers)) {
    if (name === 'owner') continue;
    await insertKey({ id: `shop-${name}`, secret: `shop-${name}-secret`, scopes: ['shop:catalog:read'], issuedByUserId: issuer });
  }

  probeApp = new Hono<AppVars>();
  for (const method of ['GET', 'POST'] as const) {
    registerShopMachineRoute(probeApp, deps, {
      method,
      path: PROBE_PATH,
      scope: method === 'GET' ? 'shop:catalog:read' : 'shop:catalog:write',
      handler: (c, request) => c.json({
        userId: request.ctx.identity.userId,
        email: request.ctx.identity.email,
        staffRole: request.ctx.identity.staffRole,
        tenantId: request.tenant.id,
        capabilities: request.ctx.capabilities ?? [],
        machineActor: request.ctx.machineActor,
      }),
    });
  }
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

  it('registers only the catalog routes under the shop management prefix', () => {
    expect(realApp.routes
      .filter((route) => route.path.startsWith(SHOP_MACHINE_PATH_PREFIX))
      .map((route) => `${route.method} ${route.path}`))
      .toEqual(Object.values(SHOP_CATALOG_ROUTES).map((route) => `${route.method} ${route.path}`));
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
      machineActor: { kind: 'shop_management_key', apiKeyId: 'shop-read' },
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
    'shop-mixed-secret',
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
    const buckets = (await database.db.select().from(apiKeyRateLimitBuckets))
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
    ['POST', API_ROUTES.apiKeysCreate.path, { name: 'Minted by a key', kind: 'shop_management', scopes: ['shop:catalog:read'], expiresAt: EXPIRES_AT }],
    ['DELETE', API_PATHS.apiKeyRevoke.replace(':id', 'shop-read'), undefined],
    ['GET', API_PATHS.apiKeys, undefined],
    ['GET', API_PATHS.tenantTeam, undefined],
    ['POST', API_PATHS.tenantSettingsUpdate, { name: 'Renamed by a key' }],
    ['POST', API_ROUTES.productsCreate.path, { title: 'Created by a key', type: 'course' }],
    ['GET', API_PATHS.orders, undefined],
    ['POST', API_PATHS.operatorTenantProvision, { slug: 'minted', name: 'Minted' }],
  ] as const)('refuses %s %s', async (method, path, body) => {
    const response = await keyed(path, method, body);
    expect(response.status).toBe(401);
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
    const keys = await deps.tenantApiKeys.listByTenant('acme');
    expect(keys.find((key) => key.id === 'shop-read')?.revokedAt).toBeNull();
    expect(keys.some((key) => key.name === 'Minted by a key')).toBe(false);
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
      method: 'POST', path: THROWING_PATH, scope: 'shop:catalog:read', handler: () => { throw new Error('handler failed'); },
    });
  });
  beforeAll(async () => {
    await insertKey({ id: 'shop-span-rate', secret: 'shop-span-rate-secret', scopes: ['shop:catalog:read'] });
    await insertKey({ id: 'shop-span-expired', secret: 'shop-span-expired-secret', scopes: ['shop:catalog:read'], expiresAt: '2026-11-02T00:00:00.000Z' });
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

  const spanOf = async (headers: Record<string, string>, path = PROBE_PATH, method = 'GET') => {
    exporter.reset();
    const response = await app.request(`${baseUrl}${path}`, {
      method,
      headers: { host: acmeHost, ...headers },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    return { status: response.status, attributes: spans[0]?.attributes ?? {} };
  };

  const keyAttributes = (apiKeyId: string, kind = 'shop_management', issuerId: string | null = issuers.owner) => ({
    'app.api_key.match': 'matched',
    'app.api_key.id': apiKeyId,
    'app.api_key.kind': kind,
    'app.tenant.id': 'acme',
    ...(issuerId === null ? {} : { 'app.api_key.issuer.id': issuerId }),
  });

  it.each([
    ['a revoked key', 'shop-revoked-secret', keyAttributes('shop-revoked')],
    ['an expired key', 'shop-span-expired-secret', keyAttributes('shop-span-expired')],
    ['a legacy key', 'legacy-null-secret', keyAttributes('legacy-null', 'legacy', null)],
    ['a key whose issuer is unverified', 'shop-unverified-secret', keyAttributes('shop-unverified', 'shop_management', issuers.unverified)],
  ])('attributes the 401 refusal of %s to the stored key row', async (_label, secret, expected) => {
    const { status, attributes } = await spanOf({ 'x-api-key': secret });
    expect(status).toBe(401);
    expect(attributes).toMatchObject(expected);
    expect(attributes).not.toHaveProperty('app.user.id');
    if (!('app.api_key.issuer.id' in expected)) expect(attributes).not.toHaveProperty('app.api_key.issuer.id');
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

  it('attributes a mixed-credential 401 to the presented key without authenticating it', async () => {
    const { status, attributes } = await spanOf({ 'x-api-key': 'shop-read-secret', cookie: 'session=x' });
    expect(status).toBe(401);
    expect(attributes).toMatchObject(keyAttributes('shop-read'));
    expect(attributes).not.toHaveProperty('app.user.id');
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

  it('never records the key hash or a prefix of the secret', async () => {
    const { attributes } = await spanOf({ 'x-api-key': 'shop-revoked-secret' });
    const recorded = JSON.stringify(attributes);
    expect(recorded).not.toContain(deps.apiKeyCrypto.hash('shop-revoked-secret'));
    expect(recorded).not.toContain('shop-revoked-se');
  });
});
