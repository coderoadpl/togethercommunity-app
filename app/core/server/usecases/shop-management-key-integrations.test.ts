import { describe, expect, it } from 'vitest';

import {
  capabilitiesForPrincipal,
  ok,
  SHOP_MANAGEMENT_KEY_INTEGRATION_OPERATIONS,
  SHOP_MANAGEMENT_KEY_SECRET_KEYS,
  shopManagementCapabilities,
  shopManagementKeyMayWriteSecret,
  tenantSettingsSchema,
  type Identity,
  type TenantSecret,
  type TenantSecretKey,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { PaymentProvider, StorageProvider } from '../ports.js';
import { createShipxSettingsRepositoryFake } from '../testing/shipx-fakes.js';
import { createInMemoryTenantDomainRepository } from '../testing/tenant-domain-fakes.js';
import { createTenantSecretRepositoryFake } from '../testing/tenant-secret-fake.js';
import { configureStripe, removeStripeTestMode } from './configure-stripe.js';
import { probeStripePermissions } from './probe-stripe-permissions.js';
import { configureShipx } from './shipx.js';
import { configureStorageConnection } from './storage-configuration.js';
import { deleteTenantSecret, setTenantSecret } from './tenant-secrets.js';

const NOW = '2026-11-15T12:00:00.000Z';

const owner: Identity = {
  userId: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantAccess: 'staff',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
};

const ownerCapabilities = capabilitiesForPrincipal('owner');

const keyCtx: Ctx = {
  identity: owner,
  capabilities: shopManagementCapabilities(['shop:integrations:read', 'shop:integrations:write'], 'direct')
    .filter((capability) => ownerCapabilities.includes(capability)),
  machineActor: { kind: 'shop_management_key', apiKeyId: 'key-1', mode: 'direct' },
};

const sessionCtx: Ctx = { identity: owner };

const unused = async (): Promise<never> => { throw new Error('unused'); };

const harness = (initial: readonly TenantSecret[] = []) => {
  const secrets = createTenantSecretRepositoryFake(initial);
  const shipxSettings = createShipxSettingsRepositoryFake();
  let id = 0;
  const payment: PaymentProvider = {
    configureWebhook: async () => ok({ webhookEndpointId: 'we_live', webhookSecret: 'whsec_live' }),
    deleteWebhookEndpoint: async () => ok({ deleted: true }),
    probeStripePermissions: async () => ok([{ resource: 'Checkout Sessions', permission: 'write', status: 'ok' }]),
    createCheckoutSession: unused,
    expireCheckoutSession: unused,
    cancelSubscription: unused,
    verifyWebhookEvent: unused,
    test: unused,
  };
  const storage: StorageProvider = {
    putObject: async () => ok(undefined),
    list: async () => ok({ objects: [], continuationToken: null }),
    getObject: async () => ok(new Uint8Array()),
    objectUrl: (input, key) => new URL(`${input.endpoint}/${input.bucket}/${key}`),
    probe: async () => ok({ code: 'storage.available', message: 'probe complete' }),
    copyObject: () => Promise.reject(new Error('copyObject is not used here')),
    digestObject: () => Promise.reject(new Error('digestObject is not used here')),
    probeCors: async (_configuration, origins) => origins.map((origin) => ({ origin, status: 'ok' })),
    presignPut: (input) => ok(input.url),
    presignGet: (input) => ok(input.url),
    delete: async () => ok({ deleted: true }),
    head: async () => ok({ sizeBytes: 1 }),
    healthcheck: async () => ok({ healthy: true }),
    test: async () => ok({ code: 'storage.available', message: 'probe complete' }),
  };
  const deps = {
    appBaseUrl: 'https://app.example.test',
    baseDomain: 'example.test',
    singleTenantMode: false,
    payment,
    storage,
    shipxSettings: shipxSettings.repository,
    tenantSecrets: secrets.repository,
    tenantDomains: createInMemoryTenantDomainRepository([]),
    tenants: { findSettings: async () => tenantSettingsSchema.parse({ name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null }) },
    secretCrypto: {
      encrypt: (plaintext: string) => ({ ciphertext: `enc:${plaintext}`, iv: 'iv', authTag: 'tag' }),
      decrypt: (input: { ciphertext: string }) => ok(input.ciphertext.slice(4)),
    },
    ids: { nextId: () => `secret-${String(id += 1)}` },
    clock: { nowIso: () => NOW },
  };
  return { deps, rows: secrets.rows };
};

const stored = (key: TenantSecretKey): TenantSecret => ({
  id: `stored-${key}`,
  tenantId: 'tenant-1',
  key,
  ciphertext: `enc:${key}-value`,
  iv: 'iv',
  authTag: 'tag',
  maskedPreview: '••••alue',
  updatedAt: NOW,
});

const excludedSecrets: ReadonlyArray<readonly [string, TenantSecretKey]> = [
  ['a webhook signing secret', 'stripe.webhookSecret'],
  ['a test webhook signing secret', 'stripe.testWebhookSecret'],
  ['a webhook endpoint id', 'stripe.webhookEndpointId'],
  ['a test webhook endpoint id', 'stripe.testWebhookEndpointId'],
  ['the payment key written directly', 'stripe.restrictedKey'],
  ['the Meta Conversions API token', 'analyticsMetaCapiAccessToken'],
  ['a video credential', 'bunny.apiKey'],
  ['a video signing key', 'bunny.securityKey'],
  ['a marketing mail credential', 'resend.apiKey'],
  ['an SES secret', 'ses.secretAccessKey'],
  ['an SMTP password', 'smtp.password'],
  ['a carrier token written directly', 'shipx.token'],
  ['a sandbox carrier token written directly', 'shipx.sandbox.token'],
  ['a sandbox carrier organization written directly', 'shipx.sandbox.organizationId'],
  ['a production carrier token written directly', 'shipx.production.token'],
  ['a production carrier organization written directly', 'shipx.production.organizationId'],
];

describe('shop management key integration allow-list', () => {
  it('lists exactly the invoicing secrets and the configure operations the owner decision covers', () => {
    expect(SHOP_MANAGEMENT_KEY_SECRET_KEYS).toEqual([
      'ifirma.invoiceApiKey', 'ifirma.username', 'ksef.token', 'ksef.contextNip', 'ksef.test.token', 'ksef.test.contextNip',
    ]);
    expect(SHOP_MANAGEMENT_KEY_INTEGRATION_OPERATIONS).toEqual(['stripe:configure', 'stripe:probe', 'shipx:configure', 'storage:configure']);
    expect(shopManagementKeyMayWriteSecret('unknown.secret')).toBe(false);
  });

  it('gives the integration write scope no connection-test capability', () => {
    expect(keyCtx.capabilities).toEqual(['tenant:secret:read', 'tenant:secret:write']);
    expect(authorizeTenant(keyCtx, 'integration:test')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('refuses a key ctx a secret write that names no allow-listed operation or secret', () => {
    expect(authorizeTenant(keyCtx, 'tenant:secret:write')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(authorizeTenant(keyCtx, 'tenant:secret:write', { shopManagementKeyGrant: { secretKey: 'unknown.secret' } }))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(authorizeTenant(keyCtx, 'integration:test', { shopManagementKeyGrant: { operation: 'stripe:probe' } }))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(authorizeTenant(keyCtx, 'tenant:secret:read')).toEqual(ok('tenant-1'));
  });

  it.each(excludedSecrets)('refuses a key ctx writing or deleting %s', async (_label, key) => {
    const h = harness([stored(key)]);
    expect(await setTenantSecret(keyCtx, { key, value: 'override-value' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await deleteTenantSecret(keyCtx, key, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.rows).toEqual([stored(key)]);
  });

  it('refuses a key ctx deleting the telemetry connection and removing the Stripe test slot', async () => {
    const h = harness([stored('telemetry.mongodb'), stored('stripe.testRestrictedKey')]);
    expect(await deleteTenantSecret(keyCtx, 'telemetry.mongodb', h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await removeStripeTestMode(keyCtx, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.rows).toHaveLength(2);
  });

  it.each(SHOP_MANAGEMENT_KEY_SECRET_KEYS.filter((key) => !key.endsWith('contextNip')))(
    'lets a key ctx write and delete the invoicing secret %s',
    async (key) => {
      const h = harness();
      expect(await setTenantSecret(keyCtx, { key, value: 'credential-1234' }, h.deps)).toMatchObject({ ok: true, value: { key } });
      expect(await deleteTenantSecret(keyCtx, key, h.deps)).toEqual(ok({ key }));
      expect(h.rows).toEqual([]);
    },
  );

  it('lets a key ctx configure and probe the live payment slot', async () => {
    const h = harness();
    expect(await configureStripe(keyCtx, { mode: 'live', restrictedKey: 'rk_live_shop' }, h.deps)).toMatchObject({ ok: true, value: { mode: 'live' } });
    expect(h.rows.map((row) => row.key).sort()).toEqual(['stripe.restrictedKey', 'stripe.webhookEndpointId', 'stripe.webhookSecret']);
    expect(await probeStripePermissions(keyCtx, { mode: 'live' }, h.deps)).toMatchObject({ ok: true, value: { allOk: true } });
  });

  it('lets a key ctx configure the carrier credentials and sending method and the object storage connection', async () => {
    const h = harness();
    expect(await configureShipx(keyCtx, { sendingMethod: 'dispatch_order', sandbox: { organizationId: '5678', token: 'sandbox-token-4321' } }, h.deps))
      .toMatchObject({ ok: true, value: { sandbox: { token: { maskedPreview: '••••4321' }, configured: true }, production: { configured: false } } });
    expect(await configureShipx(keyCtx, { production: { organizationId: '1234', token: 'carrier-token-9876' } }, h.deps))
      .toMatchObject({ ok: true, value: { sendingMethod: 'dispatch_order', sandbox: { configured: true }, production: { token: { maskedPreview: '••••9876' }, configured: true } } });
    expect(await configureStorageConnection(keyCtx, {
      provider: 'minio', endpoint: 'http://127.0.0.1:19000', region: 'us-east-1', bucket: 'shop', accessKeyId: 'access', secretAccessKey: 'secret',
    }, h.deps)).toMatchObject({ ok: true, value: { secret: { key: 's3.configuration' } } });
    expect(h.rows.map((row) => row.key).sort()).toEqual([
      's3.configuration', 'shipx.production.organizationId', 'shipx.production.token', 'shipx.sandbox.organizationId', 'shipx.sandbox.token',
    ]);
    expect(await configureShipx(keyCtx, { sandbox: { clearCredentials: true } }, h.deps)).toMatchObject({ ok: true, value: { sandbox: { configured: false }, production: { configured: true } } });
    expect(h.rows.map((row) => row.key).sort()).toEqual(['s3.configuration', 'shipx.production.organizationId', 'shipx.production.token']);
  });

  it.each(excludedSecrets)('still lets an owner session write and delete %s', async (_label, key) => {
    const h = harness();
    const value = key === 'stripe.restrictedKey' ? 'rk_live_owner' : 'owner-value';
    expect(await setTenantSecret(sessionCtx, { key, value }, h.deps)).toMatchObject({ ok: true, value: { key } });
    expect(await deleteTenantSecret(sessionCtx, key, h.deps)).toEqual(ok({ key }));
  });

  it('still lets an owner session remove the Stripe test slot', async () => {
    const h = harness([stored('stripe.testRestrictedKey')]);
    expect(await removeStripeTestMode(sessionCtx, h.deps)).toEqual(ok({ removed: true }));
    expect(h.rows).toEqual([]);
  });
});
