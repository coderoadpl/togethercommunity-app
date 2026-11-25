import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { checkoutCartInputSchema, ok, type CheckoutCartInput, type Product, type ProductPrice } from '#core/domain/index.js';
import { fulfillStripeWebhook, startCheckoutSession, validateCartSelection, type PaymentProvider } from '#core/server/index.js';
import { createLegacyCheckoutHarness, legacyBaseUrl, legacyNow, legacyTenant } from '#core/server/testing/legacy-checkout-harness.js';

import { checkoutProductIdsMetadata } from './metadata.js';
import { createStripePaymentProvider, stripeCheckoutSessionParams } from './stripe.js';
import { withWorkspaceOnlyResolver } from '#core/server/testing/payment-source-fake.js';

type PortInput = Parameters<PaymentProvider['createCheckoutSession']>[0];

const POSTER = '00000000-0000-4000-8000-000000000001';
const MUG = '00000000-0000-4000-8000-000000000002';
const webhookSecret = 'whsec_cart';
const signer = new Stripe('sk_test_unused');

const product = (id: string, title: string, vatRate: Product['vatRate']): Product => ({
  id, tenantId: legacyTenant.id, type: 'physical', slug: `product-${id.slice(-1)}`, title, description: '', coverUrl: null,
  priceCents: 0, currency: 'PLN', visibility: 'listed', salesChannel: 'any', published: true, accessItems: [], legacyId: null,
  deliveryMethod: 'pickup', vatRate, createdAt: '2026-11-01T09:00:00.000Z',
});

const price = (id: string, productId: string, amountCents: number): ProductPrice => ({
  id, tenantId: legacyTenant.id, productId, kind: 'one_time', interval: null, amountCents, currency: 'PLN', active: true, createdAt: '2026-11-01T09:00:00.000Z',
});

const cartProducts = [product(POSTER, 'Poster', 8), product(MUG, 'Mug', 23)];
const cartPrices = [price('price-poster', POSTER, 3500), price('price-mug', MUG, 2500)];

const createCartHarness = () => {
  const h = createLegacyCheckoutHarness();
  const findById = async (tenantId: string, id: string) => cartProducts.find((item) => item.tenantId === tenantId && item.id === id) ?? null;
  h.checkoutDeps.products = { ...h.checkoutDeps.products, findById };
  h.webhookDeps.products = { ...h.webhookDeps.products, findById };
  h.checkoutDeps.prices = { ...h.checkoutDeps.prices, listActiveByProducts: async (tenantId, productIds) => cartPrices.filter((item) => item.tenantId === tenantId && productIds.includes(item.productId)) };
  h.captures.set('capture-1', {
    termsAccepted: true, termsUrl: 'https://acme.togethercommunity.app/terms', privacyUrl: 'https://acme.togethercommunity.app/privacy',
    selectedDefinitionIds: [], attachedDefinitionIds: [], collectedAt: legacyNow, confirmationBaseUrl: `${legacyBaseUrl}/marketing/confirm`,
  });
  const bodies: string[] = [];
  const inputs: PortInput[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    bodies.push(await new Request(input, init).text());
    return new Response(JSON.stringify({ id: 'cs_live_cart1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_live_cart1' }), {
      status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_cart' },
    });
  };
  const provider = createStripePaymentProvider(withWorkspaceOnlyResolver({
    resolver: { resolve: async () => ok('rk_live_cart') },
    clientFactory: (key) => new Stripe(key, { maxNetworkRetries: 0, httpClient: Stripe.createFetchHttpClient(fetchImpl) }),
  }));
  h.checkoutDeps.payment = {
    ...provider,
    createCheckoutSession: async (input) => {
      inputs.push(structuredClone(input));
      return provider.createCheckoutSession(input);
    },
  };
  return { h, bodies, inputs, provider };
};

const cartCheckout = async (h: ReturnType<typeof createLegacyCheckoutHarness>, input: CheckoutCartInput) => {
  const parsed = checkoutCartInputSchema.parse(input);
  const selection = await validateCartSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) return selection;
  return startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1');
};

const signedCompletion = (provider: PaymentProvider, metadata: Record<string, string>, amountTotal: number) => {
  const payloadRaw = JSON.stringify({
    id: 'evt_cart', object: 'event', api_version: '2025-03-31.basil', created: Math.floor(Date.parse(legacyNow) / 1000),
    livemode: true, type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_live_cart1', object: 'checkout.session', livemode: true, mode: 'payment', status: 'complete', payment_status: 'paid',
        currency: 'pln', customer: null, customer_email: 'buyer@example.com', payment_intent: 'pi_cart1', subscription: null, invoice: null,
        amount_total: amountTotal, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
        customer_details: { email: 'buyer@example.com', name: 'Buyer Example', phone: null, address: null, tax_ids: [] },
        metadata,
      },
    },
  });
  return provider.verifyWebhookEvent({
    tenantId: legacyTenant.id, mode: 'live', webhookSecret, payloadRaw,
    signatureHeader: signer.webhooks.generateTestHeaderString({ payload: payloadRaw, secret: webhookSecret }),
  });
};

describe('cart checkout through the Stripe adapter and a signed completion', () => {
  it('charges each line at its unit price times its quantity and commits the line quantities at payment', async () => {
    const { h, bodies, inputs, provider } = createCartHarness();
    h.stockFake.track(legacyTenant.id, POSTER, 5);
    h.stockFake.track(legacyTenant.id, MUG, 4);
    expect(await cartCheckout(h, { lines: [{ productId: POSTER, quantity: 2 }, { productId: MUG, quantity: 1 }], email: 'buyer@example.com', termsAccepted: true }))
      .toStrictEqual(ok({ url: 'https://checkout.stripe.com/c/pay/cs_live_cart1', free: false }));
    const [input] = inputs;
    if (input === undefined) throw new Error('Expected one payment request');
    expect(input).toMatchObject({ productId: POSTER, priceCents: 9500, lines: [{ productId: POSTER, quantity: 2, grossCents: 7000 }, { productId: MUG, quantity: 1, grossCents: 2500 }] });
    const params = stripeCheckoutSessionParams(input);
    expect(params.line_items).toStrictEqual([
      { quantity: 2, price_data: { currency: 'pln', unit_amount: 3500, product_data: { name: 'Poster' } } },
      { quantity: 1, price_data: { currency: 'pln', unit_amount: 2500, product_data: { name: 'Mug' } } },
    ]);
    expect(params).not.toHaveProperty('line_items.0.adjustable_quantity');
    const body = new URLSearchParams(bodies[0]);
    expect([body.get('line_items[0][quantity]'), body.get('line_items[0][price_data][unit_amount]'), body.get('line_items[1][quantity]'), body.get('line_items[1][price_data][unit_amount]')])
      .toStrictEqual(['2', '3500', '1', '2500']);
    expect(h.stockFake.reservations.map((row) => [row.productId, row.quantity, row.status])).toStrictEqual([[POSTER, 2, 'active'], [MUG, 1, 'active']]);

    const metadata = Object.fromEntries(Object.entries(params.metadata ?? {}).map(([key, value]) => [key, String(value)]));
    const event = await signedCompletion(provider, metadata, 9500);
    if (!event.ok) throw new Error(event.error.message);
    expect(await fulfillStripeWebhook(legacyTenant, event.value, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(h.orders).toHaveLength(1);
    expect(h.orders[0]).toMatchObject({
      status: 'paid', productId: POSTER, amountCents: 9500, currency: 'PLN',
      lines: [
        { productId: POSTER, quantity: 2, grossCents: 7000, priceId: 'price-poster' },
        { productId: MUG, quantity: 1, grossCents: 2500, priceId: 'price-mug' },
      ],
    });
    expect(h.stockFake.events.filter((row) => row.type === 'committed').map((row) => [row.productId, row.quantity]))
      .toStrictEqual([[POSTER, -2], [MUG, -1]]);
    expect(h.stockFake.levels.get(legacyTenant.id, POSTER)).toMatchObject({ onHand: 3, reserved: 0 });
    expect(h.stockFake.levels.get(legacyTenant.id, MUG)).toMatchObject({ onHand: 3, reserved: 0 });
    expect(h.errors).toStrictEqual([]);
  });

  it('refuses a line quantity above the per-line hold maximum before calling Stripe', async () => {
    const { h, inputs } = createCartHarness();
    const refused = await cartCheckout(h, { lines: [{ productId: POSTER, quantity: 11 }], email: 'buyer@example.com', termsAccepted: true });
    expect(refused.ok ? null : refused.error.code).toBe('validation');
    expect(inputs).toStrictEqual([]);
  });
});

describe('cart metadata within Stripe limits', () => {
  it('keeps 20 lines of 36-character product IDs within 50 keys and 500 characters per value', () => {
    const lines = Array.from({ length: 20 }, (_, index) => ({
      productId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `Product ${String(index)}`, grossCents: 1000 * (index + 1), quantity: index + 1,
    }));
    const params = stripeCheckoutSessionParams({
      tenantId: legacyTenant.id, productId: lines[0]?.productId ?? '', productName: 'Product 0', checkoutSnapshotId: 'checkout-id-1',
      attribution: { utmSource: 's'.repeat(100), utmMedium: 'm'.repeat(100), utmCampaign: 'c'.repeat(100), utmContent: 't'.repeat(100), utmTerm: 'k'.repeat(100), fbclid: 'f'.repeat(200), gclid: 'g'.repeat(200), capturedAt: legacyNow },
      lines, priceCents: lines.reduce((total, line) => total + line.grossCents, 0), currency: 'PLN',
      successUrl: `${legacyBaseUrl}/checkout/x?status=success`, cancelUrl: `${legacyBaseUrl}/checkout/x?status=cancelled`,
      customerEmail: 'buyer@example.com', language: 'pl', checkoutConsentCaptureId: 'capture-1', couponCheckoutSessionId: 'coupon-session-1',
    });
    const metadata = Object.fromEntries(Object.entries(params.metadata ?? {}).map(([key, value]) => [key, String(value)]));
    expect(Object.keys(metadata).length).toBeLessThanOrEqual(50);
    expect(Math.max(...Object.values(metadata).map((value) => value.length))).toBeLessThanOrEqual(500);
    expect(Object.keys(metadata).filter((key) => key.startsWith('productIds'))).toStrictEqual(['productIds_0', 'productIds_1']);
    expect(checkoutProductIdsMetadata(metadata)).toStrictEqual({ productIds: JSON.stringify(lines.map((line) => line.productId)) });
    expect(params.line_items?.map((item) => [item.quantity, item.price_data?.unit_amount])).toStrictEqual(lines.map((line) => [line.quantity, 1000]));
  });
});
