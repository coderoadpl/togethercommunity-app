import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { shopManagementKeyEvents, shopManagementKeys, tenantAdmins, tenants } from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeyCreateOutputSchema,
  apiKeysListOutputSchema,
  apiKeysShopManagementCreateOutputSchema,
  apiKeysShopManagementListOutputSchema,
  apiKeysShopManagementPurgeOutputSchema,
  apiKeysShopManagementRevokeOutputSchema,
  SHOP_ASSETS_ROUTES,
  SHOP_CATALOG_ROUTES,
  SHOP_INTEGRATION_ROUTES,
  SHOP_ORDER_ROUTES,
  SHOP_SETTINGS_ROUTES,
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
let keyLookups = 0;
let sessionLookups = 0;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;

const countingSessionLookups = (deps: AppDeps): AppDeps => ({
  ...deps,
  shopManagementKeys: {
    ...deps.shopManagementKeys,
    findByHash: async (tenantId, keyHash) => {
      keyLookups += 1;
      return deps.shopManagementKeys.findByHash(tenantId, keyHash);
    },
  },
  tenantApiKeys: {
    ...deps.tenantApiKeys,
    findActiveByHash: async (tenantId, keyHash) => {
      keyLookups += 1;
      return deps.tenantApiKeys.findActiveByHash(tenantId, keyHash);
    },
  },
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

const shopKeyInput = { name: 'Shop backend', scopes: ['shop:catalog:read'], expiresAt };

const createShopKey = async () => {
  const response = await ownerRequest(
    enabledApp,
    API_ROUTES.apiKeysShopManagementCreate.method,
    API_ROUTES.apiKeysShopManagementCreate.path,
    shopKeyInput,
  );
  expect(response.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await response.json()).data;
};

const listShopKeys = async (app: ReturnType<typeof buildApp>) => {
  const listed = await ownerRequest(app, API_ROUTES.apiKeysShopManagement.method, API_ROUTES.apiKeysShopManagement.path);
  expect(listed.status).toBe(200);
  return envelope(apiKeysShopManagementListOutputSchema).parse(await listed.json()).data.apiKeys;
};

const stackedMutations = [
  ['POST', SHOP_ORDER_ROUTES.shipOrder.path.replace(':orderId', 'order-1'), { carrier: 'other', trackingNumber: 'SPAN01' }],
  ['POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { supportUrl: null }],
  ['DELETE', SHOP_ASSETS_ROUTES.deleteSalesLink.path.replace(':id', 'link-1'), undefined],
  ['POST', SHOP_INTEGRATION_ROUTES.setSecret.path, { key: 'ifirma.username', value: 'span-login' }],
  ['POST', SHOP_INTEGRATION_ROUTES.shipxConfigure.path, { production: { organizationId: '24680', token: 'span-shipx-token' } }],
] as const;

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] });

const recordedSpans = async (run: () => Promise<void>) => {
  spanExporter.reset();
  await run();
  await tracerProvider.forceFlush();
  return spanExporter.getFinishedSpans().map((span) => span.attributes);
};

const keyRequestRows = async (apiKeyId: string) => (await database.db.select().from(shopManagementKeyEvents))
  .filter((event) => event.apiKeyId === apiKeyId && event.kind === 'request');

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_management_switch_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  tracerProvider.register();
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

afterAll(async () => {
  await tracerProvider.shutdown();
  await database?.close();
});

beforeEach(() => { sessionLookups = 0; keyLookups = 0; });

describe('SHOP_MANAGEMENT_KEYS=disabled', () => {
  const shopRequests: [string, string, Record<string, string>][] = [
    ['GET', SHOP_CATALOG_ROUTES.listProducts.path, {}],
    ['POST', SHOP_CATALOG_ROUTES.createProduct.path, { 'content-type': 'application/json' }],
    ['DELETE', SHOP_CATALOG_ROUTES.listProducts.path, {}],
    ['GET', SHOP_ORDER_ROUTES.listOrders.path, {}],
    ['POST', SHOP_ORDER_ROUTES.shipxLabel.path.replace(':orderId', 'order-1'), { 'content-type': 'application/json' }],
    ['POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { 'content-type': 'application/json' }],
    ['POST', SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, { 'content-type': 'application/json' }],
    ['POST', SHOP_ASSETS_ROUTES.productCoverUpload.path, { 'content-type': 'application/json' }],
    ['GET', SHOP_ASSETS_ROUTES.listSalesLinks.path, {}],
    ['POST', SHOP_INTEGRATION_ROUTES.stripeConfigure.path, { 'content-type': 'application/json' }],
    ['GET', SHOP_INTEGRATION_ROUTES.shipxSettings.path, {}],
    ['GET', '/api/m2m/shop/unknown-path', {}],
    ['POST', '/api/m2m/shop/unknown-path', {}],
    ['GET', '/api/m2m/shop', {}],
    ['GET', SHOP_CATALOG_ROUTES.listProducts.path, { cookie: 'better-auth.session_token=anything' }],
    ['POST', SHOP_CATALOG_ROUTES.createProduct.path, { authorization: 'Bearer anything' }],
  ];

  it.each(shopRequests)('answers %s %s with 404 not_found before any session or key lookup', async (method, path, headers) => {
    const { secret } = await createShopKey();
    sessionLookups = 0;
    keyLookups = 0;
    const response = await disabledApp.request(`${baseUrl}${path}`, {
      method,
      headers: { host: acmeHost, 'x-api-key': secret, ...headers },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toMatchObject({ code: 'not_found' });
    expect(sessionLookups).toBe(0);
    expect(keyLookups).toBe(0);
  });

  it('records the switch as the refusal reason on the request span without reading the key', async () => {
    const { secret } = await createShopKey();
    const spans = await recordedSpans(async () => {
      const response = await disabledApp.request(`${baseUrl}${SHOP_CATALOG_ROUTES.listProducts.path}`, {
        headers: { host: acmeHost, 'x-api-key': secret },
      });
      expect(response.status).toBe(404);
    });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ 'app.api_key.match': 'switch_off', 'http.response.status_code': 404 });
    expect(spans[0]).not.toHaveProperty('app.api_key.id');
    expect(JSON.stringify(spans[0])).not.toContain(secret);
  });

  it('records the switch on the span of every stacked route family and writes no key history row', async () => {
    const { apiKey, secret } = await createShopKey();
    const spans = await recordedSpans(async () => {
      for (const [method, path, body] of stackedMutations) {
        const response = await disabledApp.request(`${baseUrl}${path}`, {
          method,
          headers: { host: acmeHost, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        expect(response.status, path).toBe(404);
      }
    });
    expect(spans).toHaveLength(stackedMutations.length);
    for (const attributes of spans) {
      expect(attributes).toMatchObject({ 'app.api_key.match': 'switch_off', 'http.response.status_code': 404 });
      expect(attributes).not.toHaveProperty('app.api_key.id');
    }
    expect(await keyRequestRows(apiKey.id)).toEqual([]);
  });

  it('refuses to create a shop management key and names the switch state', async () => {
    const before = await database.db.select().from(shopManagementKeys);
    const response = await ownerRequest(
      disabledApp,
      API_ROUTES.apiKeysShopManagementCreate.method,
      API_ROUTES.apiKeysShopManagementCreate.path,
      shopKeyInput,
    );
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatchObject({ code: 'forbidden', message: expect.stringContaining('SHOP_MANAGEMENT_KEYS=disabled') });
    expect(await database.db.select().from(shopManagementKeys)).toHaveLength(before.length);
  });

  it('keeps legacy key creation, listing and shop key revocation available to the owner session', async () => {
    const { apiKey: shopKey } = await createShopKey();
    const legacy = await ownerRequest(disabledApp, API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, { name: 'CI key' });
    expect(legacy.status).toBe(200);
    const { apiKey: legacyKey } = envelope(apiKeyCreateOutputSchema).parse(await legacy.json()).data;

    const legacyList = await ownerRequest(disabledApp, API_ROUTES.apiKeys.method, API_ROUTES.apiKeys.path);
    expect(envelope(apiKeysListOutputSchema).parse(await legacyList.json()).data.apiKeys.map((key) => key.id)).toContain(legacyKey.id);
    expect((await listShopKeys(disabledApp)).map((key) => key.id)).toContain(shopKey.id);

    const revoked = await ownerRequest(
      disabledApp,
      API_ROUTES.apiKeysShopManagementRevoke.method,
      API_PATHS.apiKeysShopManagementRevoke.replace(':id', shopKey.id),
    );
    expect(revoked.status).toBe(200);
    expect(envelope(apiKeysShopManagementRevokeOutputSchema).parse(await revoked.json()).data.apiKey.revokedAt).toBe(now);
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

  it('puts the key on the span and writes no key history row for a scope refusal on every stacked route family', async () => {
    const { apiKey, secret } = await createShopKey();
    const statuses: number[] = [];
    const spans = await recordedSpans(async () => {
      for (const [method, path, body] of stackedMutations) {
        const response = await enabledApp.request(`${baseUrl}${path}`, {
          method,
          headers: { host: acmeHost, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        statuses.push(response.status);
      }
    });
    expect(statuses).toEqual(stackedMutations.map(() => 403));
    expect(spans).toHaveLength(stackedMutations.length);
    for (const attributes of spans) {
      expect(attributes).toMatchObject({ 'app.api_key.match': 'matched', 'app.api_key.id': apiKey.id, 'http.response.status_code': 403 });
      expect(JSON.stringify(attributes)).not.toContain(secret);
    }
    expect(await keyRequestRows(apiKey.id)).toEqual([]);
  });
});

describe('shop management key purge route', () => {
  it.each(['enabled', 'disabled'] as const)('lets the owner purge every shop management key while the switch is %s', async (switchState) => {
    const app = switchState === 'enabled' ? enabledApp : disabledApp;
    await createShopKey();
    const legacy = await ownerRequest(enabledApp, API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, { name: `Legacy ${switchState}` });
    expect(legacy.status).toBe(200);
    const { apiKey: legacyKey } = envelope(apiKeyCreateOutputSchema).parse(await legacy.json()).data;

    const purged = await ownerRequest(app, API_ROUTES.apiKeysShopManagementPurge.method, API_ROUTES.apiKeysShopManagementPurge.path);
    expect(purged.status).toBe(200);
    expect(envelope(apiKeysShopManagementPurgeOutputSchema).parse(await purged.json()).data.purged).toBeGreaterThan(0);

    expect(await listShopKeys(app)).toEqual([]);
    const listed = await ownerRequest(app, API_ROUTES.apiKeys.method, API_ROUTES.apiKeys.path);
    expect(envelope(apiKeysListOutputSchema).parse(await listed.json()).data.apiKeys.map((key) => key.id)).toContain(legacyKey.id);
  });
});
