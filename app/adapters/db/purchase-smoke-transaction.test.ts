import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { ok, SMOKE_TENANT_ID, type ShopManagementKey, type TenantSecretKey } from '#core/domain/index.js';
import { shopManagementKeyHash, startPurchaseSmokeCheckout } from '#core/server/index.js';
import type { PurchaseSmokeDeps } from '#core/server/usecases/purchase-smoke.js';

import { createApiKeyCrypto } from '../auth/api-key-crypto.js';
import { createSecretCrypto } from '../crypto/secret-crypto.js';
import { createTenantSecretResolver } from '../crypto/tenant-secret-resolver.js';
import { createFakePaymentProvider } from '../payment/fake.js';
import { closeDb, createDb } from './client.js';
import { createPurchaseSmokeRepository } from './purchase-smoke.js';
import { createPurchaseSmokeTransaction } from './purchase-smoke-transaction.js';
import { createTenantSecretRepository } from './repositories.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { runSmokeTenantReseed } from './smoke-tenant-reseed.js';
import { organizations, organizationSecrets, shopManagementKeys, tenantConfigSources, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const randomUUID = () => crypto.randomUUID();
const NOW = '2026-11-20T12:00:00.000Z';
const secretCrypto = createSecretCrypto(Buffer.alloc(32, 7).toString('base64'));
const apiKeyCrypto = createApiKeyCrypto();
const clock = { nowIso: () => NOW };
const ids = { nextId: randomUUID };
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let key: ShopManagementKey;
let deps: PurchaseSmokeDeps;
const paymentCreate = vi.fn(async () => ok({ sessionId: 'cs_test_fixture', url: 'https://checkout.stripe.com/fixture' }));
const setSecret = (name: TenantSecretKey, value: string) => createTenantSecretRepository(database.db).upsert(SMOKE_TENANT_ID, {
  id: randomUUID(), tenantId: SMOKE_TENANT_ID, key: name, ...secretCrypto.encrypt(value), maskedPreview: 'fixture', updatedAt: NOW,
});
const start = () => startPurchaseSmokeCheckout(key, { runId: 'transaction', scenario: 'digital-course' }, deps);

beforeAll(async () => {
  database = await createTestDatabase('together_purchase_transaction', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres');
});
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
  await database.db.delete(shopManagementKeys);
  await runSmokeTenantReseed(database.db, {
    passwords: { member: 'synthetic-member-test-password', creator: 'synthetic-creator-test-password' }, purchaseFixtures: true, nowIso: clock.nowIso,
  });
  const owner = await database.db.query.tenantAdmins.findFirst({ where: (table, { eq }) => eq(table.tenantId, SMOKE_TENANT_ID) });
  if (owner === undefined) throw new Error('Missing fixture owner');
  key = {
    id: randomUUID(), tenantId: SMOKE_TENANT_ID, name: 'Synthetic checkout automation', purpose: 'purchase-smoke', scopes: [], mode: 'direct',
    keyHash: shopManagementKeyHash(apiKeyCrypto, 'fixture-key', 'purchase-smoke'), issuedByUserId: owner.userId,
    createdAt: NOW, expiresAt: '2026-11-27T12:00:00.000Z', revokedAt: null,
  };
  await createShopManagementKeyRepository(database.db).create(SMOKE_TENANT_ID, key, {
    id: randomUUID(), tenantId: SMOKE_TENANT_ID, apiKeyId: key.id, kind: 'created', actorUserId: owner.userId, method: null, route: null, resourceId: null, at: NOW,
  });
  await setSecret('stripe.testRestrictedKey', 'rk_test_fixture');
  await setSecret('stripe.testWebhookSecret', 'whsec_fixture');
  await setSecret('stripe.testWebhookEndpointId', 'we_fixture');
  const payment = { ...createFakePaymentProvider(createTenantSecretResolver(createTenantSecretRepository(database.db), secretCrypto)), createCheckoutSession: paymentCreate };
  deps = {
    purchaseSmoke: createPurchaseSmokeRepository(database.db),
    purchaseSmokeTransaction: createPurchaseSmokeTransaction(database.db, { payment, secretCrypto, ids, clock }),
    fixtureBaseUrl: 'https://acme.example.test', clock,
  };
  paymentCreate.mockClear();
});

it.each(['payments_live', 'payments_test'] as const)('refuses inherited %s even with a valid local test slot', async (group) => {
  const organizationId = randomUUID();
  await database.db.insert(organizations).values({ id: organizationId, slug: organizationId, name: 'Fixture organization', createdAt: NOW, updatedAt: NOW });
  await database.db.update(tenants).set({ organizationId }).where(eq(tenants.id, SMOKE_TENANT_ID));
  const keys = group === 'payments_test'
    ? ['stripe.testRestrictedKey', 'stripe.testWebhookSecret', 'stripe.testWebhookEndpointId']
    : ['stripe.restrictedKey'];
  await database.db.insert(organizationSecrets).values(keys.map((name) => ({
    id: randomUUID(), organizationId, key: name,
    ...secretCrypto.encrypt(name === 'stripe.testRestrictedKey' ? 'rk_test_organization' : name === 'stripe.restrictedKey' ? 'rk_live_organization' : 'organization-fixture'),
    maskedPreview: 'fixture', updatedAt: NOW,
  })));
  await database.db.insert(tenantConfigSources).values({ tenantId: SMOKE_TENANT_ID, configGroup: group, source: 'organization', updatedAt: NOW, updatedByUserId: key.issuedByUserId });
  expect(await start()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(paymentCreate).not.toHaveBeenCalled();
  expect(await database.db.query.purchaseSmokeCheckouts.findMany()).toEqual([]);
});

it.each([false, true])('uses one pooled connection including checkout cleanup (failure: %s)', async (failOrderWrite) => {
  const single = createDb('node-postgres', database.url, { max: 1, connectionTimeoutMillis: 500 });
  const resolver = createTenantSecretResolver(createTenantSecretRepository(single), secretCrypto);
  const resolve = vi.spyOn(resolver, 'resolve');
  const fake = createFakePaymentProvider(resolver);
  const createCheckoutSession: typeof fake.createCheckoutSession = async (input, credential) => {
    const result = await fake.createCheckoutSession(input, credential);
    return result.ok ? ok({ ...result.value, sessionId: 'cs_test_single' }) : result;
  };
  const payment = { ...fake, createCheckoutSession: vi.fn(createCheckoutSession), expireCheckoutSession: vi.fn(fake.expireCheckoutSession) };
  const transaction = createPurchaseSmokeTransaction(single, { payment, secretCrypto, ids, clock });
  try {
    const result = startPurchaseSmokeCheckout(key, { runId: 'single-pool', scenario: 'digital-course' }, {
      ...deps,
      purchaseSmokeTransaction: failOrderWrite ? {
        run: (operationTenantId, operation) => transaction.run(operationTenantId, (repositories) => operation({
          ...repositories, orders: { ...repositories.orders, create: async () => { throw new Error('Injected order failure'); } },
        })),
      } : transaction,
    });
    if (failOrderWrite) {
      await expect(result).rejects.toThrow('Injected order failure');
      expect(payment.expireCheckoutSession).toHaveBeenCalledExactlyOnceWith(
        { tenantId: SMOKE_TENANT_ID, mode: 'test', sessionId: 'cs_test_single' }, { restrictedKey: 'rk_test_fixture' },
      );
      expect(await database.db.query.purchaseSmokeCheckouts.findMany()).toEqual([]);
    } else {
      expect(await result).toMatchObject({ ok: true, value: { sessionId: 'cs_test_single' } });
    }
    expect(payment.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ mode: 'test' }), { restrictedKey: 'rk_test_fixture' });
    expect(resolve).not.toHaveBeenCalled();
  } finally {
    await closeDb(single);
  }
});
