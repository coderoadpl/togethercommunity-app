import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { checkoutSessionInputSchema, type CheckoutSessionInput } from '#core/domain/index.js';
import { startCheckoutSession, validateCheckoutSelection } from '#core/server/index.js';
import { createLegacyCheckoutHarness, legacyBaseUrl, legacyTenant } from '#core/server/testing/legacy-checkout-harness.js';

import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { createTenantRepository } from './repositories.js';
import { checkoutSnapshots, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const posterRequest: CheckoutSessionInput = { productId: 'poster-1', priceId: 'price-poster-1', email: 'buyer@example.com', language: 'en', termsAccepted: true };

const startPoster = async (request: CheckoutSessionInput) => {
  const h = createLegacyCheckoutHarness({ checkoutSnapshots: createCheckoutSnapshotRepository(database.db) });
  const tenantRepository = createTenantRepository(database.db);
  const legacyTenants = h.checkoutDeps.tenants;
  if (legacyTenants === undefined) throw new Error('The legacy harness has no tenant repository');
  h.checkoutDeps.tenants = {
    ...legacyTenants,
    findSettings: async (tenantId) => {
      const [legacy, stored] = await Promise.all([legacyTenants.findSettings(tenantId), tenantRepository.findSettings(tenantId)]);
      return legacy === null ? null : { ...legacy, checkoutReturnOrigins: stored?.checkoutReturnOrigins ?? [] };
    },
  };
  const parsed = checkoutSessionInputSchema.parse(request);
  const selection = await validateCheckoutSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) return { h, result: selection };
  return { h, result: await startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1') };
};

const storedReturnUrl = async () => {
  const [row] = await database.db.select({ returnUrl: sql<string | null>`return_url` }).from(checkoutSnapshots)
    .where(eq(checkoutSnapshots.id, 'checkout-id-1'));
  return row?.returnUrl;
};

beforeAll(async () => {
  database = await createTestDatabase('together_checkout_return', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: legacyTenant.id, slug: legacyTenant.slug, name: legacyTenant.name, createdAt: '2026-11-01T09:00:00.000Z' },
    { id: 'tenant-b', slug: 'studio', name: 'Studio', createdAt: '2026-11-01T09:00:00.000Z' },
  ]);
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
  await database.db.delete(checkoutSnapshots);
  await database.db.update(tenants).set({ checkoutReturnOrigins: [] });
});

it('stores the checkout return origins per workspace and starts every workspace with none', async () => {
  const repository = createTenantRepository(database.db);
  const current = await repository.findSettings(legacyTenant.id);
  if (current === null) throw new Error('The workspace has no settings');
  expect(current.checkoutReturnOrigins).toEqual([]);
  await repository.updateSettings(legacyTenant.id, { ...current, checkoutReturnOrigins: ['https://shop.example.test', 'https://shop.example.test:8443'] });
  expect((await repository.findSettings(legacyTenant.id))?.checkoutReturnOrigins).toEqual(['https://shop.example.test', 'https://shop.example.test:8443']);
  expect((await repository.findSettings('tenant-b'))?.checkoutReturnOrigins).toEqual([]);
});

it('stores a validated return address on the snapshot without its fragment and reads it back', async () => {
  await database.db.update(tenants).set({ checkoutReturnOrigins: ['https://shop.example.test'] }).where(eq(tenants.id, legacyTenant.id));
  const { h, result } = await startPoster({ ...posterRequest, returnUrl: 'https://shop.example.test/thanks?order=8812#top', cancelUrl: 'https://shop.example.test/cart#lines' });
  expect(result.ok).toBe(true);
  expect(await storedReturnUrl()).toBe('https://shop.example.test/thanks?order=8812');
  expect((await createCheckoutSnapshotRepository(database.db).findById(legacyTenant.id, 'checkout-id-1'))?.returnUrl).toBe('https://shop.example.test/thanks?order=8812');
  expect(h.paymentInputs[0]?.cancelUrl).toBe('https://shop.example.test/cart');
});

it('refuses a return address when the stored origins do not allow it and stores nothing', async () => {
  await database.db.update(tenants).set({ checkoutReturnOrigins: ['https://shop.example.test'] }).where(eq(tenants.id, 'tenant-b'));
  const { h, result } = await startPoster({ ...posterRequest, returnUrl: 'https://shop.example.test/thanks' });
  expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  expect(h.paymentInputs).toStrictEqual([]);
  expect(await database.db.select({ id: checkoutSnapshots.id }).from(checkoutSnapshots)).toStrictEqual([]);
});

it('leaves the snapshot return address empty for a request without one', async () => {
  const { result } = await startPoster(posterRequest);
  expect(result.ok).toBe(true);
  expect(await storedReturnUrl()).toBeNull();
  expect(await createCheckoutSnapshotRepository(database.db).findById(legacyTenant.id, 'checkout-id-1')).not.toHaveProperty('returnUrl');
});

it('finds the return address by its own provider session and workspace only', async () => {
  await database.db.update(tenants).set({ checkoutReturnOrigins: ['https://shop.example.test'] }).where(eq(tenants.id, legacyTenant.id));
  const { result } = await startPoster({ ...posterRequest, returnUrl: 'https://shop.example.test/thanks' });
  if (!result.ok) throw new Error('The checkout did not start');
  const [row] = await database.db.select({ providerSessionId: checkoutSnapshots.providerSessionId }).from(checkoutSnapshots)
    .where(eq(checkoutSnapshots.id, 'checkout-id-1'));
  const sessionId = row?.providerSessionId;
  if (sessionId == null) throw new Error('The snapshot has no provider session');
  const repository = createCheckoutSnapshotRepository(database.db);
  expect(await repository.findByProviderSession(legacyTenant.id, sessionId)).toMatchObject({ id: 'checkout-id-1', returnUrl: 'https://shop.example.test/thanks' });
  expect(await repository.findByProviderSession('tenant-b', sessionId)).toBeNull();
  expect(await repository.findByProviderSession(legacyTenant.id, `${sessionId}x`)).toBeNull();
});
