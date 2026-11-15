import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { shopManagementKeyEvents, tenantAdmins, tenantApiKeys, tenantAuditEvents, tenants } from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeyCreateOutputSchema,
  apiKeyRevokeOutputSchema,
  apiKeysListOutputSchema,
  apiKeysShopManagementPurgeOutputSchema,
  SHOP_CATALOG_ROUTES,
} from '#core/contract/index.js';

import { buildApp } from './app.js';
import { createDeps, type AppDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const email = 'shop-switch-owner@example.test';
const password = 'shop-switch-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let enabledApp: ReturnType<typeof buildApp>;
let disabledApp: ReturnType<typeof buildApp>;
let ownerToken: string;
let sessionLookups = 0;

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
});

const previousReleaseAuditEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  kind: z.enum([
    'impersonation_started',
    'impersonation_ended',
    'content_version_restored',
    'redirect_created',
    'redirect_updated',
    'redirect_deleted',
    'post_purged',
    'tenant_provisioned',
    'team.admin_added',
    'team.admin_invited',
    'team.admin_activated',
    'team.invitation_revoked',
    'team.admin_removed',
  ]),
  actorUserId: z.string().min(1),
  actorEmail: z.string().min(1),
  subjectMemberId: z.string().nullable(),
  subjectLabel: z.string().nullable(),
  reason: z.string().nullable(),
  at: z.string().datetime(),
});

const previousReleaseAuditRows = async () => (await database.db.select().from(tenantAuditEvents))
  .map((row) => ({ ...row, subjectLabel: null }));

const previousReleaseKeyRows = () => database.db
  .select({
    id: tenantApiKeys.id,
    tenantId: tenantApiKeys.tenantId,
    name: tenantApiKeys.name,
    keyHash: tenantApiKeys.keyHash,
    scopes: tenantApiKeys.scopes,
    createdAt: tenantApiKeys.createdAt,
    expiresAt: tenantApiKeys.expiresAt,
    revokedAt: tenantApiKeys.revokedAt,
  })
  .from(tenantApiKeys);

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;

const countingSessionLookups = (deps: AppDeps): AppDeps => ({
  ...deps,
  authPort: {
    ...deps.authPort,
    getAuthenticatedUser: async (headers) => {
      sessionLookups += 1;
      return deps.authPort.getAuthenticatedUser(headers);
    },
  },
});

const depsFor = (switchState: 'enabled' | 'disabled'): AppDeps => countingSessionLookups(createDeps(envSchema.parse({
  NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
  APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
  BETTER_AUTH_SECRET: 'shop-switch-test-secret-at-least-32-characters',
  SHOP_MANAGEMENT_KEYS: switchState,
}), { db: database.db, clock: { nowIso: () => now } }));

const ownerRequest = (app: ReturnType<typeof buildApp>, method: string, path: string, body?: unknown) =>
  app.request(`${baseUrl}${path}`, {
    method,
    headers: {
      host: acmeHost,
      authorization: `Bearer ${ownerToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const shopKeyInput = { name: 'Shop backend', kind: 'shop_management', scopes: ['shop:catalog:read'], expiresAt };

const createShopKey = async () => {
  const response = await ownerRequest(enabledApp, API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, shopKeyInput);
  expect(response.status).toBe(200);
  return envelope(apiKeyCreateOutputSchema).parse(await response.json()).data;
};

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_management_switch_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  enabledApp = buildApp(depsFor('enabled'));
  disabledApp = buildApp(depsFor('disabled'));

  const signup = await enabledApp.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Shop Switch Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  const ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  await database.db.insert(tenants).values({ id: 'acme', slug: 'acme', name: 'Workspace', createdAt: now });
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme', tenantId: 'acme', userId: ownerId, role: 'owner' });
  const signin = await enabledApp.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

beforeEach(() => { sessionLookups = 0; });

describe('SHOP_MANAGEMENT_KEYS=disabled', () => {
  const shopRequests: [string, string, Record<string, string>][] = [
    ['GET', SHOP_CATALOG_ROUTES.listProducts.path, {}],
    ['POST', SHOP_CATALOG_ROUTES.createProduct.path, { 'content-type': 'application/json' }],
    ['DELETE', SHOP_CATALOG_ROUTES.listProducts.path, {}],
    ['GET', '/api/m2m/shop/unknown-path', {}],
    ['POST', '/api/m2m/shop/unknown-path', {}],
    ['GET', '/api/m2m/shop', {}],
    ['GET', SHOP_CATALOG_ROUTES.listProducts.path, { cookie: 'better-auth.session_token=anything' }],
    ['POST', SHOP_CATALOG_ROUTES.createProduct.path, { authorization: 'Bearer anything' }],
  ];

  it.each(shopRequests)('answers %s %s with 404 not_found before any session lookup', async (method, path, headers) => {
    const { secret } = await createShopKey();
    sessionLookups = 0;
    const response = await disabledApp.request(`${baseUrl}${path}`, {
      method,
      headers: { host: acmeHost, 'x-api-key': secret, ...headers },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toMatchObject({ code: 'not_found' });
    expect(sessionLookups).toBe(0);
  });

  it('records the switch as the refusal reason on the request span without reading the key', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    provider.register();
    try {
      const { secret } = await createShopKey();
      exporter.reset();
      const response = await disabledApp.request(`${baseUrl}${SHOP_CATALOG_ROUTES.listProducts.path}`, {
        headers: { host: acmeHost, 'x-api-key': secret },
      });
      expect(response.status).toBe(404);
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]?.attributes).toMatchObject({ 'app.api_key.match': 'switch_off', 'http.response.status_code': 404 });
      expect(spans[0]?.attributes).not.toHaveProperty('app.api_key.id');
      expect(JSON.stringify(spans[0]?.attributes)).not.toContain(secret);
    } finally {
      await provider.shutdown();
    }
  });

  it('refuses to create a shop management key and names the switch state', async () => {
    const before = await database.db.select().from(tenantApiKeys);
    const response = await ownerRequest(disabledApp, API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, shopKeyInput);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatchObject({ code: 'forbidden', message: expect.stringContaining('SHOP_MANAGEMENT_KEYS=disabled') });
    expect(await database.db.select().from(tenantApiKeys)).toHaveLength(before.length);
  });

  it('keeps legacy key creation, listing and shop key revocation available to the owner session', async () => {
    const { apiKey: shopKey } = await createShopKey();
    const legacy = await ownerRequest(disabledApp, API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, { name: 'CI key' });
    expect(legacy.status).toBe(200);
    expect(envelope(apiKeyCreateOutputSchema).parse(await legacy.json()).data.apiKey.kind).toBe('legacy');

    const listed = await ownerRequest(disabledApp, API_ROUTES.apiKeys.method, API_ROUTES.apiKeys.path);
    expect(listed.status).toBe(200);
    expect(envelope(apiKeysListOutputSchema).parse(await listed.json()).data.apiKeys.map((key) => key.id)).toContain(shopKey.id);

    const revoked = await ownerRequest(disabledApp, API_ROUTES.apiKeyRevoke.method, API_PATHS.apiKeyRevoke.replace(':id', shopKey.id));
    expect(revoked.status).toBe(200);
    expect(envelope(apiKeyRevokeOutputSchema).parse(await revoked.json()).data.apiKey.revokedAt).toBe(now);
  });
});

describe('SHOP_MANAGEMENT_KEYS=enabled', () => {
  it('keeps serving shop routes to a valid key', async () => {
    const { secret } = await createShopKey();
    sessionLookups = 0;
    const response = await enabledApp.request(`${baseUrl}${SHOP_CATALOG_ROUTES.listProducts.path}`, {
      headers: { host: acmeHost, 'x-api-key': secret },
    });
    expect(response.status).toBe(200);
    expect(sessionLookups).toBe(0);
  });
});

describe('shop management key purge route', () => {
  it.each(['enabled', 'disabled'] as const)('lets the owner purge every shop management key while the switch is %s', async (switchState) => {
    const app = switchState === 'enabled' ? enabledApp : disabledApp;
    await createShopKey();
    const legacy = await ownerRequest(enabledApp, API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, { name: `Legacy ${switchState}` });
    expect(legacy.status).toBe(200);

    const purged = await ownerRequest(app, API_ROUTES.apiKeysShopManagementPurge.method, API_ROUTES.apiKeysShopManagementPurge.path);
    expect(purged.status).toBe(200);
    expect(envelope(apiKeysShopManagementPurgeOutputSchema).parse(await purged.json()).data.purged).toBeGreaterThan(0);

    const listed = await ownerRequest(app, API_ROUTES.apiKeys.method, API_ROUTES.apiKeys.path);
    const kinds = envelope(apiKeysListOutputSchema).parse(await listed.json()).data.apiKeys.map((key) => key.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((kind) => kind === 'legacy')).toBe(true);
  });

  it('leaves only rows that the previous release parses as its own keys', async () => {
    const { apiKey: revokedShopKey } = await createShopKey();
    await ownerRequest(enabledApp, API_ROUTES.apiKeyRevoke.method, API_PATHS.apiKeyRevoke.replace(':id', revokedShopKey.id));
    await createShopKey();
    expect((await previousReleaseKeyRows()).some((row) => !previousReleaseApiKeySchema.safeParse(row).success)).toBe(true);

    const purged = await ownerRequest(disabledApp, API_ROUTES.apiKeysShopManagementPurge.method, API_ROUTES.apiKeysShopManagementPurge.path);
    expect(envelope(apiKeysShopManagementPurgeOutputSchema).parse(await purged.json()).data.purged).toBe(2);

    const remaining = await previousReleaseKeyRows();
    expect(remaining.length).toBeGreaterThan(0);
    for (const row of remaining) expect(previousReleaseApiKeySchema.safeParse(row)).toMatchObject({ success: true });
  });
});

describe('retreat to the previous release', () => {
  it('leaves workspace audit events and key rows that the previous release parses after a full create, use, revoke and purge cycle', async () => {
    await database.db.insert(tenantAuditEvents).values({
      id: 'audit-retreat-redirect', tenantId: 'acme', kind: 'redirect_created', actorUserId: 'someone',
      actorEmail: 'someone@example.test', subjectMemberId: null, reason: '/old to /new', at: now,
    });
    const created = await ownerRequest(enabledApp, API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, {
      ...shopKeyInput, scopes: ['shop:catalog:read', 'shop:catalog:write'],
    });
    const { apiKey, secret } = envelope(apiKeyCreateOutputSchema).parse(await created.json()).data;
    const used = await enabledApp.request(`${baseUrl}${SHOP_CATALOG_ROUTES.createProduct.path}`, {
      method: 'POST',
      headers: { host: acmeHost, 'x-api-key': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Retreat handbook', type: 'physical', priceCents: 4900, currency: 'PLN' }),
    });
    expect(used.status).toBe(200);
    expect((await ownerRequest(enabledApp, API_ROUTES.apiKeyRevoke.method, API_PATHS.apiKeyRevoke.replace(':id', apiKey.id))).status).toBe(200);
    await createShopKey();
    const purged = await ownerRequest(disabledApp, API_ROUTES.apiKeysShopManagementPurge.method, API_ROUTES.apiKeysShopManagementPurge.path);
    expect(purged.status).toBe(200);

    const auditRows = await previousReleaseAuditRows();
    expect(auditRows.map((row) => row.id)).toContain('audit-retreat-redirect');
    for (const row of auditRows) expect(previousReleaseAuditEventSchema.safeParse(row)).toMatchObject({ success: true });
    const keyRows = await previousReleaseKeyRows();
    expect(keyRows.length).toBeGreaterThan(0);
    for (const row of keyRows) expect(previousReleaseApiKeySchema.safeParse(row)).toMatchObject({ success: true });

    const history = (await database.db.select().from(shopManagementKeyEvents))
      .filter((event) => event.apiKeyId === apiKey.id)
      .map((event) => event.kind)
      .sort();
    expect(history).toEqual(expect.arrayContaining(['created', 'purged', 'request', 'revoked']));
  });
});
