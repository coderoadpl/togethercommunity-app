import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkoutSessionInputSchema, ok, type CheckoutSessionInput } from '#core/domain/index.js';
import { createDirectSalesLinkCheckout, fulfillStripeWebhook, releaseExpiredStockReservations, startCheckoutSession, validateCheckoutSelection, type PaymentWebhookEvent } from '#core/server/index.js';
import { createLegacyCheckoutHarness, legacyBaseUrl, legacyProducts, legacyTenant } from '#core/server/testing/legacy-checkout-harness.js';

import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { checkoutSnapshots, products, productStock, stockEvents, stockReservations, tenants } from './schema.js';
import { createStockRepository } from './stock.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

type Harness = ReturnType<typeof createLegacyCheckoutHarness>;

const harness = () => {
  const h = createLegacyCheckoutHarness({ stock: createStockRepository(database.db), checkoutSnapshots: createCheckoutSnapshotRepository(database.db) });
  h.captures.set('capture-1', {
    termsAccepted: true, termsUrl: 'https://acme.togethercommunity.app/terms', privacyUrl: 'https://acme.togethercommunity.app/privacy',
    selectedDefinitionIds: [], attachedDefinitionIds: [], collectedAt: '2026-11-15T10:00:00.000Z', confirmationBaseUrl: `${legacyBaseUrl}/marketing/confirm`,
  });
  return h;
};

const track = async (productId: string, onHand: number) => {
  const enabled = await createStockRepository(database.db).enableTracking(legacyTenant.id, { productId, onHand, lowStockThreshold: null, actorUserId: 'staff', now: '2026-11-15T09:00:00.000Z' });
  if (!enabled.ok) throw new Error(enabled.error.message);
};

const publicCheckout = async (h: Harness, input: CheckoutSessionInput) => {
  const parsed = checkoutSessionInputSchema.parse(input);
  const selection = await validateCheckoutSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) return selection;
  return startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1');
};

const directCheckout = (h: Harness) => createDirectSalesLinkCheckout(legacyTenant, legacyBaseUrl, {
  slug: 'collection',
  termsAcceptanceMessage: ({ termsUrl, privacyUrl }, language) => `${language}: I accept the [Terms](${termsUrl}) and the [Privacy policy](${privacyUrl}).`,
  couponDisclosureMessage: () => 'unused',
}, h.checkoutDeps);

const printedRequest: CheckoutSessionInput = { productId: 'printed-1', priceId: 'price-printed-1', email: 'buyer@example.com', language: 'en', termsAccepted: true, shipping: { rateId: 'courier' } };

const completed = (checkoutSession: NonNullable<PaymentWebhookEvent['checkoutSession']>): PaymentWebhookEvent => ({
  id: 'evt_legacy_golden', type: 'checkout.session.completed', objectId: 'cs_live_golden1', checkoutSession, tenantIds: ['tenant-a'], livemode: true,
});

const sessionBase = {
  email: 'buyer@example.com', customerName: 'Buyer Example', customerCountry: null, billing: null, termsAccepted: false, paymentStatus: 'paid',
  subscriptionId: null, paymentIntentId: 'pi_golden1', invoiceId: null, discountTotalCents: 0, shipping: null, shippingCostCents: null,
} as const;

const printedEvent = completed({
  ...sessionBase, customerName: 'Jane Buyer', amountTotalCents: 4099, shippingCostCents: 1999,
  shipping: { name: 'Jane Buyer', phone: '+48600100200', address: { line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL', state: null } },
  metadata: { attribution: null, tenantId: 'tenant-a', productId: 'printed-1', priceId: 'price-printed-1', memberEmail: 'buyer@example.com', language: 'en', checkoutConsentCaptureId: 'capture-1', couponCheckoutSessionId: null, checkoutSnapshotId: 'checkout-id-1' },
});

const bundleEvent = completed({
  ...sessionBase, amountTotalCents: 8400,
  metadata: { attribution: null, tenantId: 'tenant-a', productId: 'course-1', priceId: null, memberEmail: 'buyer@example.com', language: null, checkoutConsentCaptureId: 'capture-1', couponCheckoutSessionId: null, checkoutSnapshotId: 'checkout-id-1', salesLinkId: 'link-1', productIds: '["course-1","poster-1"]' },
});

const directEvent = completed({
  ...sessionBase, customerName: 'Buyer Company', customerCountry: 'PL', termsAccepted: true, amountTotalCents: 8400,
  billing: { nip: '5260250274', companyName: 'Buyer Company', address: 'Main 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' },
  metadata: { attribution: null, tenantId: 'tenant-a', directCheckout: true, termsUrl: 'https://acme.togethercommunity.app/terms', privacyUrl: 'https://acme.togethercommunity.app/privacy', productId: 'course-1', priceId: null, memberEmail: null, language: 'pl', checkoutConsentCaptureId: null, couponCheckoutSessionId: null, checkoutSnapshotId: 'checkout-id-1', salesLinkId: 'link-1', productIds: '["course-1","poster-1"]' },
});

const state = async () => {
  const reservationIds = await database.db.select({ id: stockReservations.id, productId: stockReservations.productId }).from(stockReservations).where(eq(stockReservations.tenantId, legacyTenant.id));
  const label = new Map(reservationIds.map((row) => [row.id, `reservation:${row.productId}`]));
  const reservations = await database.db.select({
    tenantId: stockReservations.tenantId, productId: stockReservations.productId, checkoutSnapshotId: stockReservations.checkoutSnapshotId,
    quantity: stockReservations.quantity, status: stockReservations.status, expiresAt: stockReservations.expiresAt,
    createdAt: stockReservations.createdAt, updatedAt: stockReservations.updatedAt,
  }).from(stockReservations).where(eq(stockReservations.tenantId, legacyTenant.id)).orderBy(asc(stockReservations.productId));
  const events = await database.db.select({
    tenantId: stockEvents.tenantId, productId: stockEvents.productId, type: stockEvents.type, quantity: stockEvents.quantity,
    actorUserId: stockEvents.actorUserId, occurredAt: stockEvents.occurredAt, reference: stockEvents.reference,
  }).from(stockEvents).where(eq(stockEvents.tenantId, legacyTenant.id)).orderBy(asc(stockEvents.occurredAt), asc(stockEvents.type));
  return {
    reservations,
    events: events.map((row) => ({
      ...row,
      reference: row.reference.reservationId === undefined ? row.reference : { ...row.reference, reservationId: label.get(row.reference.reservationId) ?? 'unknown' },
    })),
    levels: await database.db.select().from(productStock).where(eq(productStock.tenantId, legacyTenant.id)).orderBy(asc(productStock.productId)),
    snapshots: await database.db.select().from(checkoutSnapshots).where(eq(checkoutSnapshots.tenantId, legacyTenant.id)),
  };
};

beforeAll(async () => {
  database = await createTestDatabase('together_checkout_legacy_golden', baseDatabaseUrl);
  await database.db.insert(tenants).values({ id: legacyTenant.id, slug: legacyTenant.slug, name: legacyTenant.name, createdAt: '2026-11-01T09:00:00.000Z' });
  await database.db.insert(products).values(legacyProducts.map((product) => ({
    id: product.id, tenantId: product.tenantId, type: product.type, slug: product.slug, title: product.title, description: product.description,
    priceCents: product.priceCents, currency: product.currency, published: product.published, deliveryMethod: product.deliveryMethod ?? 'pickup',
    vatRate: typeof product.vatRate === 'number' ? product.vatRate : null, createdAt: product.createdAt,
  })));
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
  await database.db.delete(stockReservations);
  await database.db.delete(stockEvents);
  await database.db.delete(productStock);
  await database.db.delete(checkoutSnapshots);
});

const sweep = (h: Harness, now: string) => {
  h.setNow(now);
  return releaseExpiredStockReservations({ stock: createStockRepository(database.db), clock: { nowIso: () => now }, logger: h.checkoutDeps.logger });
};

describe('legacy checkout stock on Postgres', () => {
  it('holds one piece of a single product with delivery and commits it at payment', async () => {
    const h = harness();
    await track('printed-1', 3);
    expect(await publicCheckout(h, printedRequest)).toStrictEqual(ok({ url: 'https://checkout.stripe.test/cs_live_golden1', free: false }));
    const start = await state();
    expect(start).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'active',
          expiresAt: '2026-11-15 10:36:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'tracking_enabled',
          quantity: 3,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'reserved',
          quantity: 1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          onHand: 3,
          reserved: 1,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      snapshots: [
        {
          attribution: null,
          mode: null,
          providerSessionId: 'cs_live_golden1',
          id: 'checkout-id-1',
          tenantId: 'tenant-a',
          salesLinkId: null,
          lines: [
            {
              name: 'Printed book',
              vatRate: 5,
              netCents: 2000,
              vatCents: 100,
              productId: 'printed-1',
              grossCents: 2100,
              issuedCount: 0,
              productType: 'physical',
              vatExemptionBasis: null,
              vatExemptionBasisKind: null,
            },
            {
              name: 'Courier',
              vatRate: 8,
              netCents: 1851,
              vatCents: 148,
              productId: 'shipping:courier',
              grossCents: 1999,
              issuedCount: null,
              productType: 'shipping',
              vatExemptionBasis: null,
              vatExemptionBasisKind: null,
            },
          ],
          shipping: {
            label: 'Courier',
            rateId: 'courier',
            carrier: 'other',
            amountCents: 1999,
            pickupPoint: null,
            vatRatePercent: 8,
            allowedCountries: ['PL'],
          },
          currency: 'PLN',
          createdAt: '2026-11-15T10:00:00.000Z',
        },
      ],
    });
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(await state()).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'committed',
          expiresAt: '2026-11-15 10:36:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'tracking_enabled',
          quantity: 3,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'committed',
          quantity: -1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { orderId: 'webhook-id-3', reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'reserved',
          quantity: 1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          onHand: 2,
          reserved: 0,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      snapshots: start.snapshots,
    });
    expect(h.errors).toStrictEqual([]);
  });

  it('holds and commits the tracked product of a bundle sales link', async () => {
    const h = harness();
    await track('poster-1', 2);
    expect(await publicCheckout(h, { productId: 'course-1', salesLinkId: 'link-1', email: 'buyer@example.com', termsAccepted: true }))
      .toStrictEqual(ok({ url: 'https://checkout.stripe.test/cs_live_golden1', free: false }));
    const start = await state();
    expect(start).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'active',
          expiresAt: '2026-11-15 10:36:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'tracking_enabled',
          quantity: 2,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'reserved',
          quantity: 1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { reservationId: 'reservation:poster-1', checkoutSnapshotId: 'checkout-id-1' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          onHand: 2,
          reserved: 1,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      snapshots: [
        {
          attribution: null,
          mode: null,
          providerSessionId: 'cs_live_golden1',
          id: 'checkout-id-1',
          tenantId: 'tenant-a',
          salesLinkId: 'link-1',
          lines: [
            {
              name: 'Course One',
              priceId: 'price-course-1',
              vatRate: 23,
              netCents: 3984,
              vatCents: 916,
              productId: 'course-1',
              grossCents: 4900,
              issuedCount: null,
              productType: 'course',
              vatExemptionBasis: null,
              vatExemptionBasisKind: null,
            },
            {
              name: 'Poster',
              priceId: 'price-poster-1',
              vatRate: 8,
              netCents: 3241,
              vatCents: 259,
              productId: 'poster-1',
              grossCents: 3500,
              issuedCount: 0,
              productType: 'physical',
              vatExemptionBasis: null,
              vatExemptionBasisKind: null,
            },
          ],
          shipping: null,
          currency: 'PLN',
          createdAt: '2026-11-15T10:00:00.000Z',
        },
      ],
    });
    expect(await fulfillStripeWebhook(legacyTenant, bundleEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(await state()).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'committed',
          expiresAt: '2026-11-15 10:36:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'tracking_enabled',
          quantity: 2,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'committed',
          quantity: -1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { orderId: 'webhook-id-4', reservationId: 'reservation:poster-1', checkoutSnapshotId: 'checkout-id-1' },
        },
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'reserved',
          quantity: 1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { reservationId: 'reservation:poster-1', checkoutSnapshotId: 'checkout-id-1' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          onHand: 1,
          reserved: 0,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      snapshots: start.snapshots,
    });
  });

  it('holds and commits the tracked product of the direct sales-link checkout', async () => {
    const h = harness();
    await track('poster-1', 2);
    expect(await directCheckout(h)).toStrictEqual(ok({ url: 'https://checkout.stripe.test/cs_live_golden1' }));
    const start = await state();
    expect(start).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'active',
          expiresAt: '2026-11-15 10:36:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'tracking_enabled',
          quantity: 2,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'reserved',
          quantity: 1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { reservationId: 'reservation:poster-1', checkoutSnapshotId: 'checkout-id-1' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          onHand: 2,
          reserved: 1,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      snapshots: [
        {
          attribution: null,
          mode: 'live',
          providerSessionId: 'cs_live_golden1',
          id: 'checkout-id-1',
          tenantId: 'tenant-a',
          salesLinkId: 'link-1',
          lines: [
            {
              name: 'Course One',
              priceId: 'price-course-1',
              vatRate: 23,
              netCents: 3984,
              vatCents: 916,
              productId: 'course-1',
              grossCents: 4900,
              issuedCount: null,
              productType: 'course',
              vatExemptionBasis: null,
              vatExemptionBasisKind: null,
            },
            {
              name: 'Poster',
              priceId: 'price-poster-1',
              vatRate: 8,
              netCents: 3241,
              vatCents: 259,
              productId: 'poster-1',
              grossCents: 3500,
              issuedCount: 0,
              productType: 'physical',
              vatExemptionBasis: null,
              vatExemptionBasisKind: null,
            },
          ],
          shipping: null,
          currency: 'PLN',
          createdAt: '2026-11-15T10:00:00.000Z',
        },
      ],
    });
    expect(await fulfillStripeWebhook(legacyTenant, directEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(await state()).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'committed',
          expiresAt: '2026-11-15 10:36:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'tracking_enabled',
          quantity: 2,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'committed',
          quantity: -1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { orderId: 'webhook-id-4', reservationId: 'reservation:poster-1', checkoutSnapshotId: 'checkout-id-1' },
        },
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          type: 'reserved',
          quantity: 1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { reservationId: 'reservation:poster-1', checkoutSnapshotId: 'checkout-id-1' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'poster-1',
          onHand: 1,
          reserved: 0,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      snapshots: start.snapshots,
    });
  });

  it('commits one piece late after the expiry sweep released the hold', async () => {
    const h = harness();
    await track('printed-1', 3);
    await publicCheckout(h, printedRequest);
    const start = await state();
    expect(await sweep(h, '2026-11-15T10:40:00.000Z')).toStrictEqual(ok({ released: 1 }));
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(await state()).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'committed',
          expiresAt: '2026-11-15 10:36:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:40:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'tracking_enabled',
          quantity: 3,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'reserved',
          quantity: 1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'committed_late',
          quantity: -1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:40:00+00',
          reference: { orderId: 'webhook-id-3', reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'released',
          quantity: -1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:40:00+00',
          reference: { reason: 'expired', reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          onHand: 2,
          reserved: 0,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:40:00+00',
        },
      ],
      snapshots: start.snapshots,
    });
  });

  it('cancels a late payment for goods that ran out and leaves the stock untouched instead of clamping at zero', async () => {
    const h = harness();
    await track('printed-1', 1);
    await publicCheckout(h, printedRequest);
    const start = await state();
    await sweep(h, '2026-11-15T10:40:00.000Z');
    expect((await createStockRepository(database.db).adjust(legacyTenant.id, { productId: 'printed-1', delta: -1, reason: 'damaged', actorUserId: 'staff', now: '2026-11-15T10:41:00.000Z' })).ok).toBe(true);
    h.setNow('2026-11-15T10:42:00.000Z');
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(await state()).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'released',
          expiresAt: '2026-11-15 10:36:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:40:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'tracking_enabled',
          quantity: 1,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'reserved',
          quantity: 1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'released',
          quantity: -1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:40:00+00',
          reference: { reason: 'expired', reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'adjusted',
          quantity: -1,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 10:41:00+00',
          reference: { reason: 'damaged' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          onHand: 0,
          reserved: 0,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:41:00+00',
        },
      ],
      snapshots: start.snapshots,
    });
    expect(h.orders).toStrictEqual([expect.objectContaining({ id: 'webhook-id-3', status: 'paid', cancelReason: 'out_of_stock', amountCents: 4099 })]);
    expect(h.refundJobs).toStrictEqual([expect.objectContaining({ orderId: 'webhook-id-3', paymentIntentId: 'pi_golden1', amountCents: 4099, idempotencyKey: 'oos-refund-webhook-id-3', status: 'pending' })]);
    expect(h.warnings).toStrictEqual(['[stock] released 1 expired checkout reservation(s)', '[stock] out of stock tenant=tenant-a order=webhook-id-3 products=printed-1 refund=oos-refund-webhook-id-3']);
  });

  it('inserts a committed one-piece reservation when the snapshot never held stock', async () => {
    const h = harness();
    await publicCheckout(h, printedRequest);
    await track('printed-1', 2);
    const start = await state();
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(await state()).toStrictEqual({
      reservations: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          checkoutSnapshotId: 'checkout-id-1',
          quantity: 1,
          status: 'committed',
          expiresAt: '2026-11-15 10:00:00+00',
          createdAt: '2026-11-15 10:00:00+00',
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      events: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'tracking_enabled',
          quantity: 2,
          actorUserId: 'staff',
          occurredAt: '2026-11-15 09:00:00+00',
          reference: {},
        },
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          type: 'committed_late',
          quantity: -1,
          actorUserId: null,
          occurredAt: '2026-11-15 10:00:00+00',
          reference: { orderId: 'webhook-id-3', reservationId: 'reservation:printed-1', checkoutSnapshotId: 'checkout-id-1' },
        },
      ],
      levels: [
        {
          tenantId: 'tenant-a',
          productId: 'printed-1',
          onHand: 1,
          reserved: 0,
          lowStockThreshold: null,
          lowStockNotifiedAt: null,
          soldOutNotifiedAt: null,
          updatedAt: '2026-11-15 10:00:00+00',
        },
      ],
      snapshots: start.snapshots,
    });
  });
});
