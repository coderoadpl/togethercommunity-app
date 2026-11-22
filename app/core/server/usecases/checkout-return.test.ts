import { describe, expect, it } from 'vitest';

import { checkoutCartInputSchema, checkoutSessionInputSchema, type CheckoutCartInput, type CheckoutSessionInput, type Product, type ProductPrice } from '#core/domain/index.js';

import { createLegacyCheckoutHarness, legacyBaseUrl, legacyProducts, legacyTenant } from '../testing/legacy-checkout-harness.js';
import { validateCartSelection } from './checkout-cart.js';
import { startCheckoutSession, validateCheckoutSelection } from './checkout.js';

const posterRequest: CheckoutSessionInput = { productId: 'poster-1', priceId: 'price-poster-1', email: 'buyer@example.com', language: 'en', termsAccepted: true };
const CART_POSTER = '00000000-0000-4000-8000-000000000002';
const posterCart: CheckoutCartInput = { lines: [{ productId: CART_POSTER, quantity: 2 }], email: 'buyer@example.com', language: 'en', termsAccepted: true };

const legacyPoster = legacyProducts.find((product) => product.id === 'poster-1');
if (legacyPoster === undefined) throw new Error('The legacy harness has no poster');
const cartPoster: Product = { ...legacyPoster, id: CART_POSTER };
const cartPosterPrice: ProductPrice = {
  id: 'price-cart-poster', tenantId: legacyTenant.id, productId: CART_POSTER, kind: 'one_time', interval: null, amountCents: 3500,
  currency: 'PLN', active: true, createdAt: '2026-11-01T09:00:00.000Z',
};

const harness = (origins?: string[]) => {
  const h = createLegacyCheckoutHarness();
  const { products, prices } = h.checkoutDeps;
  h.checkoutDeps.products = { ...products, findById: async (tenantId, id) => id === CART_POSTER ? cartPoster : products.findById(tenantId, id) };
  h.checkoutDeps.prices = {
    ...prices,
    listActiveByProducts: async (tenantId, ids) => [...await prices.listActiveByProducts(tenantId, ids), ...ids.includes(CART_POSTER) ? [cartPosterPrice] : []],
  };
  const tenants = h.checkoutDeps.tenants;
  if (tenants === undefined) throw new Error('The legacy harness has no tenant repository');
  if (origins !== undefined) {
    h.checkoutDeps.tenants = {
      ...tenants,
      findSettings: async (tenantId) => {
        const settings = await tenants.findSettings(tenantId);
        return settings === null ? null : { ...settings, checkoutReturnOrigins: origins };
      },
    };
  }
  return h;
};

type Harness = ReturnType<typeof harness>;

const legacyCheckout = async (h: Harness, input: CheckoutSessionInput) => {
  const parsed = checkoutSessionInputSchema.parse(input);
  const selection = await validateCheckoutSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) return selection;
  return startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1');
};

const cartCheckout = async (h: Harness, input: CheckoutCartInput) => {
  const parsed = checkoutCartInputSchema.parse(input);
  const selection = await validateCartSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) return selection;
  return startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1');
};

const ORIGINS = ['https://shop.example.test'];

describe('checkout return and cancel addresses', () => {
  it('sends an allowed cancelUrl verbatim minus its fragment as the Stripe cancel URL and stores the returnUrl', async () => {
    const plain = harness(ORIGINS);
    expect((await legacyCheckout(plain, posterRequest)).ok).toBe(true);
    const h = harness(ORIGINS);
    const started = await legacyCheckout(h, {
      ...posterRequest,
      returnUrl: 'https://shop.example.test/thanks?order=8812#top',
      cancelUrl: 'https://shop.example.test/cart?step=2#summary',
    });
    expect(started.ok).toBe(true);
    expect(h.paymentInputs).toHaveLength(1);
    expect(h.paymentInputs[0]?.cancelUrl).toBe('https://shop.example.test/cart?step=2');
    expect(h.paymentInputs[0]?.successUrl).toBe(plain.paymentInputs[0]?.successUrl);
    expect(h.paymentInputs[0]?.successUrl).toBe('https://acme.togethercommunity.app/checkout/poster-1?status=success&purchase_kind=one_time&session_id={CHECKOUT_SESSION_ID}');
    expect({ ...h.paymentInputs[0], cancelUrl: undefined }).toStrictEqual({ ...plain.paymentInputs[0], cancelUrl: undefined });
    expect(h.snapshotRows[0]?.returnUrl).toBe('https://shop.example.test/thanks?order=8812');
    expect({ ...h.snapshotRows[0], returnUrl: undefined }).toStrictEqual({ ...plain.snapshotRows[0], returnUrl: undefined });
  });

  it.each([
    ['single product', '/checkout/poster-1', null],
    ['cart', '/checkout/cart/pay', `${CART_POSTER}.2`],
  ])('keeps the return address on the workspace cancel URL for %s', async (flow, pathname, lines) => {
    const h = harness(ORIGINS);
    const addresses = { returnUrl: 'https://shop.example.test/thanks?order=88&lang=en#top', attribution: { utmSource: 'shop' } };
    const started = flow === 'cart' ? await cartCheckout(h, { ...posterCart, ...addresses }) : await legacyCheckout(h, { ...posterRequest, ...addresses });
    expect(started.ok).toBe(true);
    const cancelUrl = new URL(h.paymentInputs[0]?.cancelUrl ?? '');
    expect(cancelUrl.origin).toBe(new URL(legacyBaseUrl).origin);
    expect(cancelUrl.pathname).toBe(pathname);
    expect(cancelUrl.searchParams.get('status')).toBe('cancelled');
    expect(cancelUrl.searchParams.get('lines')).toBe(lines);
    expect(cancelUrl.searchParams.get('utm_source')).toBe('shop');
    expect(cancelUrl.searchParams.get('return')).toBe('https://shop.example.test/thanks?order=88&lang=en');
    expect(cancelUrl.searchParams.has('lang')).toBe(false);
    expect(h.snapshotRows[0]?.returnUrl).toBe(cancelUrl.searchParams.get('return'));
  });

  it('accepts both addresses on the cart form', async () => {
    const plain = harness(ORIGINS);
    expect((await cartCheckout(plain, posterCart)).ok).toBe(true);
    const h = harness(ORIGINS);
    expect((await cartCheckout(h, { ...posterCart, returnUrl: 'https://shop.example.test/thanks', cancelUrl: 'https://shop.example.test/cart' })).ok).toBe(true);
    expect(h.paymentInputs[0]?.cancelUrl).toBe('https://shop.example.test/cart');
    expect(h.paymentInputs[0]?.successUrl).toBe(plain.paymentInputs[0]?.successUrl);
    expect(plain.paymentInputs[0]?.cancelUrl).toBe(`https://acme.togethercommunity.app/checkout/cart/pay?status=cancelled&lines=${CART_POSTER}.2`);
    expect(h.snapshotRows[0]?.returnUrl).toBe('https://shop.example.test/thanks');
  });

  it('stores and sends exactly the same without the new fields', async () => {
    const without = harness();
    const configured = harness(ORIGINS);
    expect((await legacyCheckout(without, posterRequest)).ok).toBe(true);
    expect((await legacyCheckout(configured, posterRequest)).ok).toBe(true);
    expect(configured.paymentInputs).toStrictEqual(without.paymentInputs);
    expect(configured.snapshotRows).toStrictEqual(without.snapshotRows);
    expect(without.snapshotRows[0]).not.toHaveProperty('returnUrl');
  });

  it.each([
    ['the http scheme', 'http://shop.example.test/cart'],
    ['a foreign origin', 'https://elsewhere.example.test/cart'],
    ['the same host on another port', 'https://shop.example.test:8443/cart'],
    ['a credentials part', 'https://buyer:secret@shop.example.test/cart'],
    ['2001 characters', `https://shop.example.test/${'a'.repeat(2001 - 'https://shop.example.test/'.length)}`],
    ['a javascript: URL', 'javascript:alert(document.cookie)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
  ])('refuses %s with a validation error before anything is stored or sent', async (_label, url) => {
    for (const field of ['returnUrl', 'cancelUrl'] as const) {
      const h = harness(ORIGINS);
      const input = { ...posterRequest, [field]: url };
      const parsed = checkoutSessionInputSchema.safeParse(input);
      const result = parsed.success
        ? await validateCheckoutSelection(legacyTenant.id, parsed.data, h.checkoutDeps)
        : { ok: false as const, error: { code: 'validation', message: 'Invalid checkout payload', details: parsed.error.flatten() } };
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('validation');
      expect(JSON.stringify(result.error)).not.toContain(url);
      expect(h.paymentInputs).toStrictEqual([]);
      expect(h.snapshotRows).toStrictEqual([]);
    }
  });

  it('refuses an otherwise valid address when the workspace allows no origin', async () => {
    const h = harness();
    const result = await legacyCheckout(h, { ...posterRequest, cancelUrl: 'https://shop.example.test/cart' });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.paymentInputs).toStrictEqual([]);
    expect(h.snapshotRows).toStrictEqual([]);
  });

  it('refuses a foreign origin on the cart form', async () => {
    const h = harness(ORIGINS);
    const result = await cartCheckout(h, { ...posterCart, returnUrl: 'https://elsewhere.example.test/thanks' });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(JSON.stringify(result)).not.toContain('elsewhere.example.test');
    expect(h.paymentInputs).toStrictEqual([]);
  });
});
