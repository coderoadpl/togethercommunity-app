import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { checkoutSessionInputSchema, type CheckoutSessionInput, type Order } from '#core/domain/index.js';
import { fulfillStripeWebhook, startCheckoutSession, validateCheckoutSelection, type PaymentWebhookEvent } from '#core/server/index.js';
import { createLegacyCheckoutHarness, legacyBaseUrl, legacyProducts, legacyTenant } from '#core/server/testing/legacy-checkout-harness.js';

import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { createOrderRepository } from './repositories.js';
import { checkoutSnapshots, memberEvents, members, orders, productPrices, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const posterRequest: CheckoutSessionInput = { productId: 'poster-1', priceId: 'price-poster-1', email: 'buyer@example.com', language: 'en', termsAccepted: true };

const posterCompleted: PaymentWebhookEvent = {
  id: 'evt_client_reference', type: 'checkout.session.completed', objectId: 'cs_live_golden1', tenantIds: [legacyTenant.id], livemode: true,
  checkoutSession: {
    email: 'buyer@example.com', customerName: 'Buyer Example', customerCountry: null, billing: null, termsAccepted: false, paymentStatus: 'paid',
    subscriptionId: null, paymentIntentId: 'pi_client_reference', invoiceId: null, amountTotalCents: 3500, discountTotalCents: 0, shipping: null, shippingCostCents: null,
    metadata: { attribution: null, tenantId: legacyTenant.id, productId: 'poster-1', priceId: 'price-poster-1', memberEmail: 'buyer@example.com', language: 'en', checkoutConsentCaptureId: 'capture-1', couponCheckoutSessionId: null, checkoutSnapshotId: 'checkout-id-1' },
  },
};

const harness = () => {
  const h = createLegacyCheckoutHarness({ checkoutSnapshots: createCheckoutSnapshotRepository(database.db) });
  h.captures.set('capture-1', {
    termsAccepted: true, termsUrl: `${legacyBaseUrl}/terms`, privacyUrl: `${legacyBaseUrl}/privacy`,
    selectedDefinitionIds: [], attachedDefinitionIds: [], collectedAt: '2026-11-15T10:00:00.000Z', confirmationBaseUrl: `${legacyBaseUrl}/marketing/confirm`,
  });
  return h;
};

const payPoster = async (request: CheckoutSessionInput) => {
  const h = harness();
  const parsed = checkoutSessionInputSchema.parse(request);
  const selection = await validateCheckoutSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) throw new Error(selection.error.message);
  const started = await startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1');
  if (!started.ok) throw new Error(started.error.message);
  const [snapshotRow] = await database.db.select({ clientReference: checkoutSnapshots.clientReference }).from(checkoutSnapshots)
    .where(eq(checkoutSnapshots.id, 'checkout-id-1'));
  const storedReference = snapshotRow?.clientReference;
  const snapshot = await createCheckoutSnapshotRepository(database.db).findById(legacyTenant.id, 'checkout-id-1');
  expect(await fulfillStripeWebhook(legacyTenant, posterCompleted, h.webhookDeps)).toStrictEqual({ ok: true, value: { processed: true } });
  const [order] = h.orders;
  if (order === undefined) throw new Error('No order was recorded');
  return { h, storedReference, snapshot, order };
};

const persist = async (order: Order) => {
  await database.db.insert(user).values({ id: `user-${order.memberId}`, email: 'buyer@example.com', name: 'Buyer' });
  await database.db.insert(members).values({ id: order.memberId, tenantId: legacyTenant.id, userId: `user-${order.memberId}`, email: 'buyer@example.com', createdAt: order.createdAt });
  const repository = createOrderRepository(database.db);
  await repository.create(legacyTenant.id, order);
  const [stored] = await database.db.select({ clientReference: orders.clientReference }).from(orders).where(eq(orders.id, order.id));
  return { stored: stored?.clientReference, detail: await repository.findById(legacyTenant.id, order.id), list: await repository.list(legacyTenant.id, { page: 1, pageSize: 10 }) };
};

beforeAll(async () => {
  database = await createTestDatabase('together_checkout_client_reference', baseDatabaseUrl);
  await database.db.insert(tenants).values({ id: legacyTenant.id, slug: legacyTenant.slug, name: legacyTenant.name, createdAt: '2026-11-01T09:00:00.000Z' });
  await database.db.insert(products).values(legacyProducts.map((product) => ({
    id: product.id, tenantId: product.tenantId, type: product.type, slug: product.slug, title: product.title, description: product.description,
    priceCents: product.priceCents, currency: product.currency, published: product.published, deliveryMethod: product.deliveryMethod ?? 'pickup',
    vatRate: typeof product.vatRate === 'number' ? product.vatRate : null, createdAt: product.createdAt,
  })));
  await database.db.insert(productPrices).values({ id: 'price-poster-1', tenantId: legacyTenant.id, productId: 'poster-1', kind: 'one_time', amountCents: 3500, currency: 'PLN', createdAt: '2026-11-01T09:00:00.000Z' });
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
  await database.db.delete(orders);
  await database.db.delete(memberEvents);
  await database.db.delete(members);
  await database.db.delete(user);
  await database.db.delete(checkoutSnapshots);
});

it('stores a trimmed client reference on the snapshot and the paid order and returns it in the order DTOs', async () => {
  const paid = await payPoster({ ...posterRequest, clientReference: '  shop-cart-8812  ' });
  expect(paid.storedReference).toBe('shop-cart-8812');
  expect(paid.snapshot?.clientReference).toBe('shop-cart-8812');
  expect(paid.order.clientReference).toBe('shop-cart-8812');
  expect(paid.h.paymentInputs).toHaveLength(1);
  expect(paid.h.paymentInputs[0]).not.toHaveProperty('clientReference');
  expect(JSON.stringify(paid.h.paymentInputs[0])).not.toContain('shop-cart-8812');
  const persisted = await persist(paid.order);
  expect(persisted.stored).toBe('shop-cart-8812');
  expect(persisted.detail?.clientReference).toBe('shop-cart-8812');
  expect(persisted.list.orders.map((order) => order.clientReference)).toEqual(['shop-cart-8812']);
});

it('sends Stripe the same parameters with and without a client reference', async () => {
  const legacy = await payPoster(posterRequest);
  await database.db.delete(checkoutSnapshots);
  const referenced = await payPoster({ ...posterRequest, clientReference: 'shop-cart-8812' });
  expect(referenced.h.paymentInputs).toStrictEqual(legacy.h.paymentInputs);
});

it('keeps a request without a client reference free of the field on the snapshot, the order and the DTOs', async () => {
  const paid = await payPoster(posterRequest);
  expect(paid.storedReference).toBeNull();
  expect(paid.snapshot).not.toHaveProperty('clientReference');
  expect(paid.order).not.toHaveProperty('clientReference');
  const persisted = await persist(paid.order);
  expect(persisted.stored).toBeNull();
  expect(persisted.detail).not.toHaveProperty('clientReference');
  expect(persisted.list.orders[0]).not.toHaveProperty('clientReference');
});
