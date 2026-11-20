import { describe, expect, it } from 'vitest';

import { checkoutSessionInputSchema, ok, type CheckoutSessionInput, type CheckoutSnapshot, type OrderLine } from '#core/domain/index.js';

import type { PaymentProvider, PaymentWebhookEvent } from '../ports.js';
import { createLegacyCheckoutHarness, legacyBaseUrl, legacyTenant } from '../testing/legacy-checkout-harness.js';
import type { FakeStockReservation } from '../testing/stock-fake.js';
import { startCheckoutSession, validateCheckoutSelection } from './checkout.js';
import { createDirectSalesLinkCheckout } from './direct-sales-link-checkout.js';
import { releaseExpiredStockReservations } from './stock.js';
import { fulfillStripeWebhook } from './stripe-webhook.js';

type PortInput = Parameters<PaymentProvider['createCheckoutSession']>[0];
type Harness = ReturnType<typeof createLegacyCheckoutHarness>;

const publicCheckout = async (h: Harness, input: CheckoutSessionInput) => {
  const parsed = checkoutSessionInputSchema.parse(input);
  const selection = await validateCheckoutSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) return selection;
  return startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1');
};

const printedRequest: CheckoutSessionInput = { productId: 'printed-1', priceId: 'price-printed-1', email: 'buyer@example.com', language: 'en', termsAccepted: true, shipping: { rateId: 'courier' } };

const printedEvent = (paymentStatus: 'paid' | 'unpaid'): PaymentWebhookEvent => ({
  id: 'evt_legacy_golden', type: 'checkout.session.completed', objectId: 'cs_live_golden1',
  checkoutSession: {
    email: 'buyer@example.com', customerName: 'Jane Buyer', customerCountry: null, billing: null, termsAccepted: false, paymentStatus,
    subscriptionId: null, paymentIntentId: 'pi_golden1', invoiceId: null, amountTotalCents: 4099, discountTotalCents: 0,
    shipping: { name: 'Jane Buyer', phone: '+48600100200', address: { line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL', state: null } },
    shippingCostCents: 1999,
    metadata: { attribution: null, tenantId: 'tenant-a', productId: 'printed-1', priceId: 'price-printed-1', memberEmail: 'buyer@example.com', language: 'en', checkoutConsentCaptureId: 'capture-1', couponCheckoutSessionId: null, checkoutSnapshotId: 'checkout-id-1' },
  },
  tenantIds: ['tenant-a'], livemode: true,
});

const sweep = (h: Harness, now: string) => {
  h.setNow(now);
  return releaseExpiredStockReservations({ stock: h.stockFake.repository, clock: { nowIso: () => now }, logger: h.checkoutDeps.logger });
};

const bundleLines: OrderLine[] = [
  {
    productId: 'course-1',
    name: 'Course One',
    productType: 'course',
    priceId: 'price-course-1',
    grossCents: 4900,
    netCents: 3984,
    vatCents: 916,
    vatRate: 23,
    vatExemptionBasis: null,
    vatExemptionBasisKind: null,
    issuedCount: null,
  },
  {
    productId: 'poster-1',
    name: 'Poster',
    productType: 'physical',
    priceId: 'price-poster-1',
    grossCents: 3500,
    netCents: 3241,
    vatCents: 259,
    vatRate: 8,
    vatExemptionBasis: null,
    vatExemptionBasisKind: null,
    issuedCount: 0,
  },
];

const heldReservation = (productId: string): FakeStockReservation[] => [
  { id: 'reservation-1', tenantId: 'tenant-a', productId, checkoutSnapshotId: 'checkout-id-1', quantity: 1, status: 'active', expiresAt: '2026-11-15T10:36:00.000Z' },
];

const stockLevel = (productId: string, onHand: number, reserved: number, updatedAt = '2026-11-15T10:00:00.000Z') => ({
  tenantId: 'tenant-a', productId, onHand, reserved, lowStockThreshold: null, lowStockNotifiedAt: null, soldOutNotifiedAt: null, updatedAt,
});

describe('legacy checkout session start', () => {
  it('pins a single product without a price: payment input and snapshot, no stock hold', async () => {
    const h = createLegacyCheckoutHarness();
    expect(await publicCheckout(h, { productId: 'course-1', email: 'buyer@example.com', language: 'pl', termsAccepted: true }))
      .toStrictEqual(ok({ url: 'https://checkout.stripe.test/cs_live_golden1', free: false }));
    const expectedInput: PortInput[] = [
      {
        tenantId: 'tenant-a',
        checkoutBranding: { displayName: 'Acme', buttonColor: '#112233' },
        mode: 'live',
        productId: 'course-1',
        productName: 'Course One',
        checkoutSnapshotId: 'checkout-id-1',
        priceCents: 4900,
        currency: 'PLN',
        successUrl: 'https://acme.togethercommunity.app/checkout/course-1?status=success&purchase_kind=one_time&session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'https://acme.togethercommunity.app/checkout/course-1?status=cancelled',
        customerEmail: 'buyer@example.com',
        language: 'pl',
        checkoutConsentCaptureId: 'capture-1',
      },
    ];
    expect(h.paymentInputs).toStrictEqual(expectedInput);
    const expectedSnapshots: CheckoutSnapshot[] = [
      {
        attribution: null,
        id: 'checkout-id-1',
        tenantId: 'tenant-a',
        salesLinkId: null,
        lines: [
          {
            productId: 'course-1',
            name: 'Course One',
            productType: 'course',
            grossCents: 4900,
            netCents: 3984,
            vatCents: 916,
            vatRate: 23,
            vatExemptionBasis: null,
            vatExemptionBasisKind: null,
            issuedCount: null,
          },
        ],
        currency: 'PLN',
        createdAt: '2026-11-15T10:00:00.000Z',
        providerSessionId: 'cs_live_golden1',
      },
    ];
    expect(h.snapshotRows).toStrictEqual(expectedSnapshots);
    expect(h.stockFake.reservations).toStrictEqual([]);
    expect(h.stockFake.events).toStrictEqual([]);
  });

  it('pins a single product with a price and delivery: payment input, snapshot and a one-piece hold', async () => {
    const h = createLegacyCheckoutHarness();
    h.stockFake.track(legacyTenant.id, 'printed-1', 3);
    expect(await publicCheckout(h, printedRequest)).toStrictEqual(ok({ url: 'https://checkout.stripe.test/cs_live_golden1', free: false }));
    const expectedInput: PortInput[] = [
      {
        tenantId: 'tenant-a',
        checkoutBranding: { displayName: 'Acme', buttonColor: '#112233' },
        mode: 'live',
        productId: 'printed-1',
        productName: 'Printed book',
        checkoutSnapshotId: 'checkout-id-1',
        shipping: {
          allowedCountries: ['PL'],
          phone: true,
          option: { label: 'Courier', amountCents: 1999, currency: 'PLN', deliveryEstimateDays: { min: 1, max: 3 } },
        },
        priceCents: 2100,
        currency: 'PLN',
        successUrl: 'https://acme.togethercommunity.app/checkout/printed-1?status=success&purchase_kind=one_time&session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'https://acme.togethercommunity.app/checkout/printed-1?status=cancelled',
        customerEmail: 'buyer@example.com',
        language: 'en',
        priceId: 'price-printed-1',
        checkoutConsentCaptureId: 'capture-1',
        expiresAt: '2026-11-15T10:31:00.000Z',
      },
    ];
    expect(h.paymentInputs).toStrictEqual(expectedInput);
    const expectedSnapshots: CheckoutSnapshot[] = [
      {
        attribution: null,
        id: 'checkout-id-1',
        tenantId: 'tenant-a',
        salesLinkId: null,
        lines: [
          {
            productId: 'printed-1',
            name: 'Printed book',
            productType: 'physical',
            grossCents: 2100,
            netCents: 2000,
            vatCents: 100,
            vatRate: 5,
            vatExemptionBasis: null,
            vatExemptionBasisKind: null,
            issuedCount: 0,
          },
          {
            productId: 'shipping:courier',
            name: 'Courier',
            productType: 'shipping',
            grossCents: 1999,
            netCents: 1851,
            vatCents: 148,
            vatRate: 8,
            vatExemptionBasis: null,
            vatExemptionBasisKind: null,
            issuedCount: null,
          },
        ],
        shipping: {
          rateId: 'courier',
          label: 'Courier',
          amountCents: 1999,
          vatRatePercent: 8,
          carrier: 'other',
          pickupPoint: null,
          allowedCountries: ['PL'],
        },
        currency: 'PLN',
        createdAt: '2026-11-15T10:00:00.000Z',
        providerSessionId: 'cs_live_golden1',
      },
    ];
    expect(h.snapshotRows).toStrictEqual(expectedSnapshots);
    expect(h.stockFake.reservations).toStrictEqual(heldReservation('printed-1'));
    expect(h.stockFake.events).toStrictEqual([
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'reserved',
        quantity: 1,
        reference: { checkoutSnapshotId: 'checkout-id-1', reservationId: 'reservation-1' },
      },
    ]);
    expect(h.stockFake.levels.get(legacyTenant.id, 'printed-1')).toStrictEqual(stockLevel('printed-1', 3, 1));
  });

  it('pins a bundle sales link through the public checkout session', async () => {
    const h = createLegacyCheckoutHarness();
    h.stockFake.track(legacyTenant.id, 'poster-1', 2);
    expect(await publicCheckout(h, { productId: 'course-1', salesLinkId: 'link-1', email: 'buyer@example.com', termsAccepted: true }))
      .toStrictEqual(ok({ url: 'https://checkout.stripe.test/cs_live_golden1', free: false }));
    expect(h.paymentInputs).toStrictEqual([{
      tenantId: 'tenant-a',
      checkoutBranding: { displayName: 'Acme', buttonColor: '#112233' },
      mode: 'live',
      productId: 'course-1',
      productName: 'Course One',
      salesLinkId: 'link-1',
      checkoutSnapshotId: 'checkout-id-1',
      priceCents: 8400,
      currency: 'PLN',
      successUrl: 'https://acme.togethercommunity.app/offer/collection?status=success&purchase_kind=one_time&salesLinkId=link-1&session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://acme.togethercommunity.app/offer/collection?status=cancelled&checkout=together&salesLinkId=link-1',
      customerEmail: 'buyer@example.com',
      checkoutConsentCaptureId: 'capture-1',
      expiresAt: '2026-11-15T10:31:00.000Z',
      lines: bundleLines,
    }]);
    expect(h.snapshotRows).toStrictEqual([{
      attribution: null,
      id: 'checkout-id-1',
      tenantId: 'tenant-a',
      salesLinkId: 'link-1',
      currency: 'PLN',
      createdAt: '2026-11-15T10:00:00.000Z',
      providerSessionId: 'cs_live_golden1',
      lines: bundleLines,
    }]);
    expect(h.stockFake.reservations).toStrictEqual(heldReservation('poster-1'));
    expect(h.stockFake.levels.get(legacyTenant.id, 'poster-1')).toStrictEqual(stockLevel('poster-1', 2, 1));
  });

  it('pins the direct sales-link checkout', async () => {
    const h = createLegacyCheckoutHarness();
    h.stockFake.track(legacyTenant.id, 'poster-1', 2);
    expect(await createDirectSalesLinkCheckout(legacyTenant, legacyBaseUrl, {
      slug: 'collection',
      termsAcceptanceMessage: ({ termsUrl, privacyUrl }, language) => `${language}: I accept the [Terms](${termsUrl}) and the [Privacy policy](${privacyUrl}).`,
      couponDisclosureMessage: () => 'unused',
    }, h.checkoutDeps)).toStrictEqual(ok({ url: 'https://checkout.stripe.test/cs_live_golden1' }));
    expect(h.paymentInputs).toStrictEqual([{
      tenantId: 'tenant-a',
      mode: 'live',
      productId: 'course-1',
      productName: 'Course One',
      salesLinkId: 'link-1',
      checkoutSnapshotId: 'checkout-id-1',
      priceCents: 8400,
      currency: 'PLN',
      language: 'pl',
      successUrl: 'https://acme.togethercommunity.app/offer/collection?status=success&purchase_kind=one_time&salesLinkId=link-1&session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://acme.togethercommunity.app/offer/collection?status=cancelled&salesLinkId=link-1',
      directCheckout: {
        termsUrl: 'https://acme.togethercommunity.app/terms',
        privacyUrl: 'https://acme.togethercommunity.app/privacy',
        termsAcceptanceMessage: 'pl: I accept the [Terms](https://acme.togethercommunity.app/terms) and the [Privacy policy](https://acme.togethercommunity.app/privacy).',
      },
      checkoutBranding: { displayName: 'Acme', buttonColor: '#112233' },
      expiresAt: '2026-11-15T10:31:00.000Z',
      lines: bundleLines,
    }]);
    expect(h.snapshotRows).toStrictEqual([{
      id: 'checkout-id-1',
      tenantId: 'tenant-a',
      salesLinkId: 'link-1',
      attribution: null,
      currency: 'PLN',
      mode: 'live',
      providerSessionId: 'cs_live_golden1',
      createdAt: '2026-11-15T10:00:00.000Z',
      lines: bundleLines,
    }]);
    expect(h.stockFake.reservations).toStrictEqual(heldReservation('poster-1'));
    expect(h.stockFake.levels.get(legacyTenant.id, 'poster-1')).toStrictEqual(stockLevel('poster-1', 2, 1));
  });
});

describe('legacy stock effects at payment', () => {
  it('keeps the hold and commits nothing while the completed session is unpaid', async () => {
    const h = createLegacyCheckoutHarness();
    h.stockFake.track(legacyTenant.id, 'printed-1', 3);
    await publicCheckout(h, printedRequest);
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent('unpaid'), h.webhookDeps)).toStrictEqual(ok({ processed: false }));
    expect(h.orders).toStrictEqual([]);
    expect(h.stockFake.reservations).toStrictEqual(heldReservation('printed-1'));
    expect(h.stockFake.levels.get(legacyTenant.id, 'printed-1')).toStrictEqual(stockLevel('printed-1', 3, 1));
  });

  it('commits one piece late after the expiry sweep released the hold', async () => {
    const h = createLegacyCheckoutHarness();
    h.stockFake.track(legacyTenant.id, 'printed-1', 3);
    await publicCheckout(h, printedRequest);
    expect(await sweep(h, '2026-11-15T10:40:00.000Z')).toStrictEqual(ok({ released: 1 }));
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent('paid'), h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(h.stockFake.reservations).toStrictEqual([
      {
        id: 'reservation-1',
        tenantId: 'tenant-a',
        productId: 'printed-1',
        checkoutSnapshotId: 'checkout-id-1',
        quantity: 1,
        status: 'committed',
        expiresAt: '2026-11-15T10:36:00.000Z',
      },
    ]);
    expect(h.stockFake.events).toStrictEqual([
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'reserved',
        quantity: 1,
        reference: { checkoutSnapshotId: 'checkout-id-1', reservationId: 'reservation-1' },
      },
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'released',
        quantity: -1,
        reference: { checkoutSnapshotId: 'checkout-id-1', reservationId: 'reservation-1', reason: 'expired' },
      },
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'committed_late',
        quantity: -1,
        reference: { checkoutSnapshotId: 'checkout-id-1', orderId: 'webhook-id-3', reservationId: 'reservation-1' },
      },
    ]);
    expect(h.stockFake.levels.get(legacyTenant.id, 'printed-1')).toStrictEqual(stockLevel('printed-1', 2, 0, '2026-11-15T10:40:00.000Z'));
    expect(h.warnings).toStrictEqual(['[stock] released 1 expired checkout reservation(s)']);
  });

  it('cancels a late payment for goods that ran out and queues one refund instead of clamping at zero', async () => {
    const h = createLegacyCheckoutHarness();
    h.stockFake.track(legacyTenant.id, 'printed-1', 1);
    await publicCheckout(h, printedRequest);
    await sweep(h, '2026-11-15T10:40:00.000Z');
    expect((await h.stockFake.repository.adjust(legacyTenant.id, { productId: 'printed-1', delta: -1, reason: 'damaged', actorUserId: 'staff', now: '2026-11-15T10:41:00.000Z' })).ok).toBe(true);
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent('paid'), h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(h.stockFake.events).toStrictEqual([
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'reserved',
        quantity: 1,
        reference: { checkoutSnapshotId: 'checkout-id-1', reservationId: 'reservation-1' },
      },
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'released',
        quantity: -1,
        reference: { checkoutSnapshotId: 'checkout-id-1', reservationId: 'reservation-1', reason: 'expired' },
      },
      { tenantId: 'tenant-a', productId: 'printed-1', type: 'adjusted', quantity: -1, reference: { reason: 'damaged' } },
    ]);
    expect(h.stockFake.levels.get(legacyTenant.id, 'printed-1')).toStrictEqual(stockLevel('printed-1', 0, 0, '2026-11-15T10:41:00.000Z'));
    expect(h.orders).toStrictEqual([expect.objectContaining({ id: 'webhook-id-3', status: 'paid', cancelReason: 'out_of_stock', amountCents: 4099 })]);
    expect(h.orders[0]).not.toHaveProperty('fulfilmentStatus');
    expect(h.refundJobs).toStrictEqual([expect.objectContaining({ orderId: 'webhook-id-3', paymentIntentId: 'pi_golden1', amountCents: 4099, idempotencyKey: 'oos-refund-webhook-id-3', status: 'pending' })]);
    expect(h.autoInvoiceJobs).toStrictEqual([]);
    expect(h.warnings).toStrictEqual(['[stock] released 1 expired checkout reservation(s)', '[stock] out of stock tenant=tenant-a order=webhook-id-3 products=printed-1 refund=oos-refund-webhook-id-3']);
  });

  it('records a committed one-piece reservation when the snapshot never held stock', async () => {
    const h = createLegacyCheckoutHarness();
    await publicCheckout(h, printedRequest);
    h.stockFake.track(legacyTenant.id, 'printed-1', 2);
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent('paid'), h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(h.stockFake.reservations).toStrictEqual([
      {
        id: 'reservation-1',
        tenantId: 'tenant-a',
        productId: 'printed-1',
        checkoutSnapshotId: 'checkout-id-1',
        quantity: 1,
        status: 'committed',
        expiresAt: '2026-11-15T10:00:00.000Z',
      },
    ]);
    expect(h.stockFake.events).toStrictEqual([
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'committed_late',
        quantity: -1,
        reference: { checkoutSnapshotId: 'checkout-id-1', orderId: 'webhook-id-3' },
      },
    ]);
    expect(h.stockFake.levels.get(legacyTenant.id, 'printed-1')).toStrictEqual(stockLevel('printed-1', 1, 0));
  });
});
