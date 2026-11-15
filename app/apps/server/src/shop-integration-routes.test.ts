import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { tenantAdmins, tenants } from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeyCreateOutputSchema,
  SHOP_INTEGRATION_ROUTES,
  shopIntegrationContracts,
} from '#core/contract/index.js';
import { err, integrationUnavailable, ok, type StorageConfiguration, type TenantSecretKey } from '#core/domain/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const email = 'shop-integrations-owner@example.test';
const password = 'shop-integrations-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const READ = 'shop:integrations:read';
const WRITE = 'shop:integrations:write';
const validNip = '1234563218';
const storage = {
  provider: 'minio', endpoint: 'https://storage.example.test', region: 'eu-central-1',
  bucket: 'shop-assets', accessKeyId: 'access-key-id', secretAccessKey: 'secret-access-key',
} as const;
const sender = {
  name: 'Warehouse', company: 'Example Press', email: 'warehouse@example.test', phone: '600700800',
  street: 'Garden Street', buildingNumber: '5', city: 'Warsaw', postCode: '00-950',
};

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let deps: ReturnType<typeof createDeps>;
let ownerToken: string;
const registeredWebhooks: { tenantId: string; restrictedKey: string; webhookUrl: string }[] = [];
const deletedWebhooks: string[] = [];
const storageProbes: { input: StorageConfiguration; corsOrigins: string[] | undefined }[] = [];

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;

const ownerRequest = (method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createShopKey = async (scopes: string[], host = acmeHost) => {
  const response = await ownerRequest(API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, {
    name: `Shop ${scopes.join(' ')}`, kind: 'shop_management', scopes, expiresAt,
  }, host);
  expect(response.status).toBe(200);
  return envelope(apiKeyCreateOutputSchema).parse(await response.json()).data;
};

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const secretPath = (key: string): string => SHOP_INTEGRATION_ROUTES.deleteSecret.path.replace(':key', encodeURIComponent(key));

const storedSecret = async (tenantId: string, key: TenantSecretKey): Promise<string | null> => {
  const resolved = await deps.secretResolver.resolve(tenantId, key);
  return resolved.ok ? resolved.value : null;
};

const storedKeys = async (tenantId: string): Promise<string[]> =>
  (await deps.tenantSecrets.listByTenant(tenantId)).map((secret) => secret.key).toSorted();

const listSecrets = async (secret: string, host = acmeHost) => {
  const response = await keyed(secret, 'GET', SHOP_INTEGRATION_ROUTES.listSecrets.path, undefined, host);
  expect(response.status).toBe(200);
  return envelope(shopIntegrationContracts.listSecrets.output).parse(await response.json()).data;
};

const writeRoutes = [
  ['POST', SHOP_INTEGRATION_ROUTES.setSecret.path, { key: 'ifirma.username', value: 'refused' }],
  ['DELETE', secretPath('ifirma.username'), undefined],
  ['POST', SHOP_INTEGRATION_ROUTES.stripeConfigure.path, { mode: 'test', restrictedKey: 'rk_test_refused' }],
  ['POST', SHOP_INTEGRATION_ROUTES.stripeProbe.path, { mode: 'test' }],
  ['POST', SHOP_INTEGRATION_ROUTES.storageConfigure.path, storage],
  ['POST', SHOP_INTEGRATION_ROUTES.shipxConfigure.path, { organizationId: '999' }],
] as const;

const readRoutes = [SHOP_INTEGRATION_ROUTES.listSecrets.path, SHOP_INTEGRATION_ROUTES.shipxSettings.path] as const;

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_integration_routes_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-integration-routes-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  let endpointSequence = 0;
  app = buildApp({
    ...deps,
    payment: {
      ...deps.payment,
      configureWebhook: async (input) => {
        registeredWebhooks.push(input);
        endpointSequence += 1;
        return ok({ webhookEndpointId: `we_fake_${String(endpointSequence)}`, webhookSecret: `whsec_fake_${input.tenantId}_${String(endpointSequence)}` });
      },
      deleteWebhookEndpoint: async (input) => {
        deletedWebhooks.push(input.webhookEndpointId);
        return ok({ deleted: true });
      },
      probeStripePermissions: async (input) => ok((['Webhook Endpoints', 'Checkout Sessions'] as const).map((resource) => ({
        resource, permission: 'write' as const, status: input.mode === 'test' ? 'ok' as const : 'missing' as const,
      }))),
    },
    storage: {
      ...deps.storage,
      probe: async (input, corsOrigins) => {
        storageProbes.push({ input, corsOrigins });
        return input.bucket === 'unreachable'
          ? err(integrationUnavailable('The bucket is unreachable'))
          : ok({ code: 'storage.available', message: 'Storage is available.' });
      },
    },
  });

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Shop Integrations Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  const ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: ownerId, role: 'owner' });
  }
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('shop integration routes with a shop management key', () => {
  it('configures test-mode Stripe with a unique endpoint secret and keeps the live pair and another workspace intact', async () => {
    const liveSession = await ownerRequest(API_ROUTES.stripeConfigure.method, API_ROUTES.stripeConfigure.path, { mode: 'live', restrictedKey: 'rk_live_acme_owner' });
    expect(liveSession.status).toBe(200);
    const studio = await createShopKey([READ, WRITE], studioHost);
    const studioConfigured = await keyed(studio.secret, 'POST', SHOP_INTEGRATION_ROUTES.stripeConfigure.path, { mode: 'test', restrictedKey: 'rk_test_studio' }, studioHost);
    expect(studioConfigured.status).toBe(200);
    const studioBefore = await deps.tenantSecrets.listByTenant('studio');
    const liveBefore = {
      key: await storedSecret('acme', 'stripe.restrictedKey'),
      secret: await storedSecret('acme', 'stripe.webhookSecret'),
      endpoint: await storedSecret('acme', 'stripe.webhookEndpointId'),
    };
    expect(liveBefore.key).toBe('rk_live_acme_owner');

    const { secret } = await createShopKey([READ, WRITE]);
    const configured = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.stripeConfigure.path, { mode: 'test', restrictedKey: 'rk_test_acme' });
    expect(configured.status).toBe(200);
    expect(envelope(shopIntegrationContracts.stripeConfigure.output).parse(await configured.json()).data)
      .toEqual({ mode: 'test', webhookUrl: 'http://acme.localhost:48730/api/webhooks/stripe/acme?mode=test' });
    expect(registeredWebhooks.at(-1)).toEqual({ tenantId: 'acme', restrictedKey: 'rk_test_acme', webhookUrl: 'http://acme.localhost:48730/api/webhooks/stripe/acme?mode=test' });

    const testSecret = await storedSecret('acme', 'stripe.testWebhookSecret');
    expect(testSecret).toMatch(/^whsec_fake_acme_\d+$/u);
    expect(testSecret).not.toBe(await storedSecret('studio', 'stripe.testWebhookSecret'));
    expect(testSecret).not.toBe(liveBefore.secret);
    expect(await storedSecret('acme', 'stripe.testRestrictedKey')).toBe('rk_test_acme');
    expect({
      key: await storedSecret('acme', 'stripe.restrictedKey'),
      secret: await storedSecret('acme', 'stripe.webhookSecret'),
      endpoint: await storedSecret('acme', 'stripe.webhookEndpointId'),
    }).toEqual(liveBefore);
    expect(await deps.tenantSecrets.listByTenant('studio')).toEqual(studioBefore);
    expect(deletedWebhooks).toEqual([]);

    const listed = await listSecrets(secret);
    expect(listed.stripeMode).toBe('live');
    expect(listed.secrets.map((entry) => entry.key)).toEqual(expect.arrayContaining(['stripe.testRestrictedKey', 'stripe.testWebhookSecret', 'stripe.testWebhookEndpointId']));
    expect(JSON.stringify(listed)).not.toContain('rk_test_acme');
    expect(JSON.stringify(listed)).not.toContain(testSecret ?? 'missing');
    expect(listed.secrets.find((entry) => entry.key === 'stripe.testRestrictedKey')?.maskedPreview).toBe('••••acme');
  });

  it('rejects a Stripe key of the other mode before any provider call or write', async () => {
    const { secret } = await createShopKey([WRITE]);
    const before = await deps.tenantSecrets.listByTenant('acme');
    const calls = registeredWebhooks.length;
    for (const body of [{ mode: 'test', restrictedKey: 'rk_live_wrong_slot' }, { mode: 'test', restrictedKey: 'sk_test_secret' }, { mode: 'test' }]) {
      const response = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.stripeConfigure.path, body);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('validation');
    }
    expect(registeredWebhooks).toHaveLength(calls);
    expect(await deps.tenantSecrets.listByTenant('acme')).toEqual(before);
  });

  it('probes the stored Stripe key through the payment provider', async () => {
    const { secret } = await createShopKey([WRITE]);
    const response = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.stripeProbe.path, { mode: 'test' });
    expect(response.status).toBe(200);
    expect(envelope(shopIntegrationContracts.stripeProbe.output).parse(await response.json()).data)
      .toMatchObject({ mode: 'test', allOk: true, checkedAt: now });
    const invalid = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.stripeProbe.path, { mode: 'staging' });
    expect(invalid.status).toBe(400);
  });

  it('probes and stores storage with the workspace origins and rejects a malformed or unreachable bucket before persistence', async () => {
    const { secret } = await createShopKey([READ, WRITE]);
    const configured = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.storageConfigure.path, storage);
    expect(configured.status).toBe(200);
    expect(envelope(shopIntegrationContracts.storageConfigure.output).parse(await configured.json()).data)
      .toEqual({ diagnostic: { code: 'storage.available', message: 'Storage is available.' }, secret: { key: 's3.configuration', maskedPreview: '••••', updatedAt: now } });
    expect(storageProbes.at(-1)).toEqual({ input: storage, corsOrigins: ['http://acme.localhost:48730', baseUrl] });
    expect(JSON.parse(await storedSecret('acme', 's3.configuration') ?? '{}')).toEqual(storage);

    const probes = storageProbes.length;
    for (const body of [
      { ...storage, endpoint: 'ftp://storage.example.test' },
      { ...storage, provider: 'unknown' },
      { ...storage, secretAccessKey: '' },
    ]) {
      const response = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.storageConfigure.path, body);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('validation');
    }
    expect(storageProbes).toHaveLength(probes);
    const unreachable = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.storageConfigure.path, { ...storage, bucket: 'unreachable' });
    expect(unreachable.status).toBe(503);
    expect(JSON.parse(await storedSecret('acme', 's3.configuration') ?? '{}')).toEqual(storage);
  });

  it('configures the ShipX sender and credentials, shows them masked and rejects malformed input before persistence', async () => {
    const { secret } = await createShopKey([READ, WRITE]);
    const configured = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.shipxConfigure.path, {
      environment: 'sandbox', sender, organizationId: '12345', token: 'shipx-token-abcd',
    });
    expect(configured.status).toBe(200);
    const view = envelope(shopIntegrationContracts.shipxConfigure.output).parse(await configured.json()).data;
    expect(view).toEqual({
      environment: 'sandbox', sender, configured: true,
      organizationId: { maskedPreview: '••••2345', updatedAt: now }, token: { maskedPreview: '••••abcd', updatedAt: now },
    });
    const shown = await keyed(secret, 'GET', SHOP_INTEGRATION_ROUTES.shipxSettings.path);
    expect(shown.status).toBe(200);
    expect(envelope(shopIntegrationContracts.shipxSettings.output).parse(await shown.json()).data).toEqual(view);
    expect(await storedSecret('acme', 'shipx.token')).toBe('shipx-token-abcd');

    for (const body of [
      { organizationId: 'not-a-number' },
      { sender: { ...sender, phone: '12' } },
      { sender: { ...sender, postCode: '00950' } },
      { token: 'replacement', clearCredentials: true },
      { environment: 'staging' },
      { unknownField: true },
    ]) {
      const response = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.shipxConfigure.path, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await errorOf(response)).code).toBe('validation');
    }
    const after = await keyed(secret, 'GET', SHOP_INTEGRATION_ROUTES.shipxSettings.path);
    expect(envelope(shopIntegrationContracts.shipxSettings.output).parse(await after.json()).data).toEqual(view);
    expect(await storedSecret('acme', 'shipx.token')).toBe('shipx-token-abcd');
  });

  it('sets, lists masked and deletes the allow-listed iFirma and KSeF credentials', async () => {
    const { secret } = await createShopKey([READ, WRITE]);
    for (const [key, value] of [
      ['ifirma.invoiceApiKey', 'ifirma-hmac-key-0001'],
      ['ifirma.username', 'seller-login'],
      ['ksef.token', 'ksef-live-token-9999'],
      ['ksef.contextNip', ` ${validNip} `],
      ['ksef.test.token', 'ksef-test-token-7777'],
      ['ksef.test.contextNip', validNip],
    ] as const) {
      const response = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.setSecret.path, { key, value });
      expect(response.status, key).toBe(200);
      expect(envelope(shopIntegrationContracts.setSecret.output).parse(await response.json()).data.secret)
        .toEqual({ key, maskedPreview: `••••${value.trim().slice(-4)}`, updatedAt: now });
    }
    expect(await storedSecret('acme', 'ksef.contextNip')).toBe(validNip);
    const listed = await listSecrets(secret);
    expect(listed.secrets.find((entry) => entry.key === 'ifirma.invoiceApiKey')?.maskedPreview).toBe('••••0001');
    expect(JSON.stringify(listed)).not.toContain('ifirma-hmac-key-0001');

    const deleted = await keyed(secret, 'DELETE', secretPath('ksef.test.token'));
    expect(deleted.status).toBe(200);
    expect(envelope(shopIntegrationContracts.deleteSecret.output).parse(await deleted.json()).data).toEqual({ key: 'ksef.test.token' });
    expect(await storedKeys('acme')).not.toContain('ksef.test.token');
    const again = await keyed(secret, 'DELETE', secretPath('ksef.test.token'));
    expect(again.status).toBe(404);
  });

  it.each([
    'stripe.restrictedKey', 'stripe.testRestrictedKey', 'stripe.webhookSecret', 'stripe.testWebhookEndpointId',
    's3.configuration', 's3.accessKeyId', 'shipx.token', 'shipx.organizationId', 'telemetry.mongodb',
    'bunny.apiKey', 'ses.secretAccessKey', 'smtp.password', 'resend.apiKey', 'analyticsMetaCapiAccessToken', 'unknown.key',
  ])('rejects a generic write and delete of %s with validation and keeps every secret', async (key) => {
    const { secret } = await createShopKey([READ, WRITE]);
    const before = await deps.tenantSecrets.listByTenant('acme');
    const set = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.setSecret.path, { key, value: key.startsWith('stripe.') ? 'rk_live_raw_override' : 'raw-override' });
    expect(set.status).toBe(400);
    expect((await errorOf(set)).code).toBe('validation');
    const removed = await keyed(secret, 'DELETE', secretPath(key));
    expect(removed.status).toBe(400);
    expect((await errorOf(removed)).code).toBe('validation');
    expect(await deps.tenantSecrets.listByTenant('acme')).toEqual(before);
  });

  it.each([
    ['an invalid KSeF NIP', { key: 'ksef.contextNip', value: '1234567890' }],
    ['a short KSeF test NIP', { key: 'ksef.test.contextNip', value: '123' }],
    ['an empty iFirma key', { key: 'ifirma.invoiceApiKey', value: '   ' }],
    ['a missing value', { key: 'ifirma.username' }],
    ['an extra field', { key: 'ifirma.username', value: 'seller', mode: 'live' }],
  ])('rejects %s before persistence', async (_label, body) => {
    const { secret } = await createShopKey([WRITE]);
    const before = await deps.tenantSecrets.listByTenant('acme');
    const response = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.setSecret.path, body);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('validation');
    expect(await deps.tenantSecrets.listByTenant('acme')).toEqual(before);
  });

  it('serves masked reads to an integrations-read key and refuses its writes', async () => {
    const { secret } = await createShopKey([READ]);
    for (const path of readRoutes) expect((await keyed(secret, 'GET', path)).status, path).toBe(200);
    const before = await deps.tenantSecrets.listByTenant('acme');
    for (const [method, path, body] of writeRoutes) {
      const response = await keyed(secret, method, path, body);
      expect(response.status, path).toBe(403);
      expect(await errorOf(response), path).toEqual({ code: 'forbidden', message: `${WRITE} is not permitted` });
    }
    expect(await deps.tenantSecrets.listByTenant('acme')).toEqual(before);
  });

  it('refuses catalog, order, fulfilment and settings keys on every integration route', async () => {
    const before = await deps.tenantSecrets.listByTenant('acme');
    for (const scopes of [
      ['shop:catalog:read', 'shop:catalog:write'],
      ['shop:orders:read', 'shop:fulfilment:write'],
      ['shop:settings:read', 'shop:settings:write'],
    ]) {
      const { secret } = await createShopKey(scopes);
      for (const path of readRoutes) {
        const response = await keyed(secret, 'GET', path);
        expect(response.status, path).toBe(403);
        expect(await errorOf(response)).toEqual({ code: 'forbidden', message: `${READ} is not permitted` });
      }
      for (const [method, path, body] of writeRoutes) {
        const response = await keyed(secret, method, path, body);
        expect(response.status, path).toBe(403);
        expect(await errorOf(response)).toEqual({ code: 'forbidden', message: `${WRITE} is not permitted` });
      }
    }
    expect(await deps.tenantSecrets.listByTenant('acme')).toEqual(before);
  });

  it('keeps an integrations key away from team, key, session integration and other-workspace routes', async () => {
    const { apiKey, secret } = await createShopKey([READ, WRITE]);
    const before = await deps.tenantSecrets.listByTenant('acme');
    for (const [method, path, body] of [
      [API_ROUTES.apiKeys.method, API_ROUTES.apiKeys.path, undefined],
      [API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, { name: 'Escalated', kind: 'shop_management', scopes: [READ, WRITE], expiresAt }],
      [API_ROUTES.apiKeyRevoke.method, API_PATHS.apiKeyRevoke.replace(':id', apiKey.id), undefined],
      [API_ROUTES.tenantTeam.method, API_ROUTES.tenantTeam.path, undefined],
      [API_ROUTES.tenantTeamAdd.method, API_ROUTES.tenantTeamAdd.path, { email: 'intruder@example.test' }],
      [API_ROUTES.tenantSecrets.method, API_ROUTES.tenantSecrets.path, undefined],
      [API_ROUTES.tenantSecretSet.method, API_ROUTES.tenantSecretSet.path, { key: 'stripe.restrictedKey', value: 'rk_live_escalated' }],
      [API_ROUTES.tenantSecretDelete.method, API_PATHS.tenantSecretDelete.replace(':key', 'stripe.restrictedKey'), undefined],
      [API_ROUTES.stripeConfigure.method, API_ROUTES.stripeConfigure.path, { mode: 'live', restrictedKey: 'rk_live_escalated' }],
      [API_ROUTES.stripeProbePermissions.method, API_ROUTES.stripeProbePermissions.path, { mode: 'live' }],
      [API_ROUTES.storageConfigure.method, API_ROUTES.storageConfigure.path, storage],
      ['GET', API_PATHS.shipxSettings, undefined],
      ['POST', API_PATHS.shipxConfigure, { organizationId: '999' }],
    ] as const) {
      const response = await keyed(secret, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    for (const path of readRoutes) {
      const response = await keyed(secret, 'GET', path, undefined, studioHost);
      expect(response.status, path).toBe(401);
      expect(await errorOf(response)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
    }
    const foreign = await keyed(secret, 'POST', SHOP_INTEGRATION_ROUTES.setSecret.path, { key: 'ifirma.username', value: 'foreign' }, studioHost);
    expect(foreign.status).toBe(401);
    expect(await deps.tenantSecrets.listByTenant('acme')).toEqual(before);
    expect(await storedKeys('studio')).not.toContain('ifirma.username');
    const keys = await ownerRequest(API_ROUTES.apiKeys.method, API_ROUTES.apiKeys.path);
    expect(JSON.stringify(await keys.json())).not.toContain('Escalated');
  });
});
