import { describe, expect, it } from 'vitest';

import { err, notFound, validation, type Coupon, type Product, type ProductPrice } from '#core/domain/index.js';

import { createLegacyCheckoutHarness, legacyNow, legacyTenant } from '../testing/legacy-checkout-harness.js';
import { validateCartSelection } from './checkout-cart.js';
import { validateSelectionCoupon } from './checkout-coupon.js';
import { captureCheckoutSelection } from './checkout-lines.js';
import { COUPON_UNAVAILABLE_MESSAGE } from './coupon-checkout.js';

const id = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const BOOK = id(1);
const POSTER = id(2);
const EBOOK = id(3);
const CLUB = id(4);
const EURO = id(5);
const NO_VAT = id(6);
const DRAFT = id(7);
const TWO_PRICES = id(8);

const product = (productId: string, fields: Pick<Product, 'type' | 'title' | 'deliveryMethod' | 'vatRate'> & Partial<Product>): Product => ({
  tenantId: legacyTenant.id, description: '', coverUrl: null, currency: 'PLN', visibility: 'listed', salesChannel: 'any', published: true,
  accessItems: [], legacyId: null, createdAt: '2026-11-01T09:00:00.000Z', id: productId, slug: `product-${productId.slice(-2)}`, priceCents: 0,
  ...fields,
});

const products: Product[] = [
  product(BOOK, { type: 'physical', title: 'Printed book', deliveryMethod: 'shipping', vatRate: 5 }),
  product(POSTER, { type: 'physical', title: 'Poster', deliveryMethod: 'pickup', vatRate: 8 }),
  product(EBOOK, { type: 'digital_download', title: 'E-book', deliveryMethod: 'pickup', vatRate: 23 }),
  product(CLUB, { type: 'membership', title: 'Club', deliveryMethod: 'pickup', vatRate: 23 }),
  product(EURO, { type: 'physical', title: 'Imported mug', deliveryMethod: 'pickup', vatRate: 23 }),
  product(NO_VAT, { type: 'physical', title: 'Sticker', deliveryMethod: 'pickup', vatRate: null }),
  product(DRAFT, { type: 'physical', title: 'Draft', deliveryMethod: 'pickup', vatRate: 23, published: false }),
  product(TWO_PRICES, { type: 'physical', title: 'Bag', deliveryMethod: 'pickup', vatRate: 23 }),
];

const price = (priceId: string, productId: string, amountCents: number, fields: Partial<ProductPrice> = {}): ProductPrice => ({
  id: priceId, tenantId: legacyTenant.id, productId, kind: 'one_time', interval: null, amountCents,
  currency: 'PLN', active: true, createdAt: '2026-11-01T09:00:00.000Z', ...fields,
});

const prices: ProductPrice[] = [
  price('price-book', BOOK, 2500),
  price('price-book-monthly', BOOK, 900, { kind: 'recurring', interval: 'month' }),
  price('price-poster', POSTER, 3500),
  price('price-ebook', EBOOK, 1900),
  price('price-club', CLUB, 2000, { kind: 'recurring', interval: 'month' }),
  price('price-euro', EURO, 1000, { currency: 'EUR' }),
  price('price-sticker', NO_VAT, 500),
  price('price-draft', DRAFT, 500),
  price('price-bag-small', TWO_PRICES, 1000),
  price('price-bag-large', TWO_PRICES, 1200),
];

const coupon = (scope: Coupon['scope']): Coupon => ({
  id: 'coupon-1', tenantId: legacyTenant.id, code: 'SPRING', kind: 'percent', value: 10, scope, appliesTo: 'both',
  recurringDuration: 'first_invoice', startsAt: null, endsAt: null, maxRedemptions: null, maxRedemptionsPerMember: null,
  status: 'active', partnerLabel: null, stripeCouponId: null, stripePromotionCodeId: null, createdAt: '2026-11-01T09:00:00.000Z',
});

const lowestUnitCents: Record<string, number> = { [BOOK]: 2000, [EBOOK]: 1500, [POSTER]: 3500 };

const createCart = (couponScope: Coupon['scope'] = { kind: 'all' }) => {
  const h = createLegacyCheckoutHarness();
  const deps = {
    ...h.checkoutDeps,
    products: { ...h.checkoutDeps.products, findById: async (tenantId: string, productId: string) => products.find((item) => item.tenantId === tenantId && item.id === productId) ?? null },
    prices: { ...h.checkoutDeps.prices, listActiveByProducts: async (tenantId: string, productIds: string[]) => prices.filter((item) => item.tenantId === tenantId && item.active && productIds.includes(item.productId)) },
    coupons: { findByCode: async () => coupon(couponScope), findById: async () => coupon(couponScope), cacheStripeIds: async () => null },
    couponRedemptions: { counts: async () => ({ total: 0, member: 0 }), createOrderAndClaim: async () => true },
    priceHistory: { lowestSince: async (_tenantId: string, input: { productId: string; currentAmountCents: number }) => lowestUnitCents[input.productId] ?? input.currentAmountCents },
  };
  return { h, deps };
};

describe('cart selection', () => {
  it('rejects a second line for the same product', async () => {
    const { deps } = createCart();
    const selected = await validateCartSelection(legacyTenant.id, { lines: [{ productId: POSTER, quantity: 1 }, { productId: POSTER, quantity: 2 }] }, deps);
    expect(selected.ok ? null : selected.error.code).toBe('validation');
  });

  it('rejects 21 lines', async () => {
    const { deps } = createCart();
    const lines = Array.from({ length: 21 }, (_, index) => ({ productId: id(100 + index), quantity: 1 }));
    const selected = await validateCartSelection(legacyTenant.id, { lines }, deps);
    expect(selected.ok ? null : selected.error.code).toBe('validation');
  });

  it('rejects an unknown line field such as an amount', async () => {
    const { deps } = createCart();
    const tamperedLines = [{ productId: POSTER, quantity: 1, amountCents: 1 }];
    const selected = await validateCartSelection(legacyTenant.id, { lines: tamperedLines }, deps);
    expect(selected.ok ? null : selected.error.code).toBe('validation');
  });

  it('rejects quantity 2 on a download', async () => {
    const { deps } = createCart();
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: EBOOK, quantity: 2 }] }, deps))
      .toStrictEqual(err(validation('"E-book" can be ordered in a quantity of at most 1')));
  });

  it('accepts 10 and rejects 11 on a physical line while the stock hold applies', async () => {
    const { deps } = createCart();
    const ten = await validateCartSelection(legacyTenant.id, { lines: [{ productId: POSTER, quantity: 10 }] }, deps);
    expect(ten.ok && ten.value.cartLines).toStrictEqual([{ productId: POSTER, quantity: 10 }]);
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: POSTER, quantity: 11 }] }, deps))
      .toStrictEqual(err(validation('"Poster" can be ordered in a quantity of at most 10')));
  });

  it('rejects mixed currencies', async () => {
    const { deps } = createCart();
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: POSTER, quantity: 1 }, { productId: EURO, quantity: 1 }] }, deps))
      .toStrictEqual(err(validation('Cart products must use the same currency')));
  });

  it('rejects a recurring price and a membership product', async () => {
    const { deps } = createCart();
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: BOOK, priceId: 'price-book-monthly', quantity: 1 }] }, deps))
      .toStrictEqual(err(validation('Cart products require a one-time price')));
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: CLUB, quantity: 1 }] }, deps))
      .toStrictEqual(err(validation('Subscriptions cannot be included in a cart')));
  });

  it('needs exactly one one-time price unless the line names an active price of its product', async () => {
    const { deps } = createCart();
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: TWO_PRICES, quantity: 1 }] }, deps))
      .toStrictEqual(err(validation('Every cart product requires exactly one active one-time price')));
    const named = await validateCartSelection(legacyTenant.id, { lines: [{ productId: TWO_PRICES, priceId: 'price-bag-large', quantity: 1 }] }, deps);
    expect(named.ok && named.value.productPrices?.map((item) => item.id)).toStrictEqual(['price-bag-large']);
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: TWO_PRICES, priceId: 'price-poster', quantity: 1 }] }, deps))
      .toStrictEqual(err(notFound('No active price "price-poster" for this product')));
  });

  it('rejects an unpublished product and a product without a resolvable VAT rate', async () => {
    const { deps } = createCart();
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: DRAFT, quantity: 1 }] }, deps))
      .toStrictEqual(err(notFound(`No published product "${DRAFT}" in this tenant`)));
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: NO_VAT, quantity: 1 }] }, deps))
      .toStrictEqual(err(validation('Configure a VAT rate for every cart product')));
  });

  it('checks tracked stock against the line quantity', async () => {
    const { h, deps } = createCart();
    h.stockFake.track(legacyTenant.id, POSTER, 2);
    const short = await validateCartSelection(legacyTenant.id, { lines: [{ productId: POSTER, quantity: 3 }] }, deps);
    expect(short.ok ? null : short.error.code).toBe('sold_out');
    expect((await validateCartSelection(legacyTenant.id, { lines: [{ productId: POSTER, quantity: 2 }] }, deps)).ok).toBe(true);
  });

  it('asks for delivery when any line ships and refuses it when none does', async () => {
    const { deps } = createCart();
    const missing = await validateCartSelection(legacyTenant.id, { lines: [{ productId: EBOOK, quantity: 1 }, { productId: BOOK, quantity: 2 }] }, deps);
    expect(missing.ok ? null : missing.error.code).toBe('shipping_required');
    expect(await validateCartSelection(legacyTenant.id, { lines: [{ productId: EBOOK, quantity: 1 }, { productId: POSTER, quantity: 2 }], shipping: { rateId: 'courier' } }, deps))
      .toStrictEqual(err(validation('Shipping is not available for the selected products')));
  });
});

describe('cart snapshot and coupon', () => {
  const cartWithDelivery = { lines: [{ productId: BOOK, quantity: 2 }, { productId: EBOOK, quantity: 1 }], shipping: { rateId: 'courier' } };

  it('stores line quantities, line totals of unit times quantity and one delivery fee', async () => {
    const { h, deps } = createCart();
    const selected = await validateCartSelection(legacyTenant.id, cartWithDelivery, deps);
    if (!selected.ok) throw new Error(selected.error.message);
    const captured = await captureCheckoutSelection(legacyTenant.id, selected.value, deps);
    expect(captured.ok && { totalCents: captured.value.totalCents, shippingCents: captured.value.shippingCents, currency: captured.value.currency })
      .toStrictEqual({ totalCents: 6900, shippingCents: 1999, currency: 'PLN' });
    expect(h.snapshotRows.map((row) => row.lines)).toStrictEqual([[
      {
        productId: BOOK, name: 'Printed book', productType: 'physical', priceId: 'price-book', quantity: 2,
        grossCents: 5000, netCents: 4762, vatCents: 238, vatRate: 5, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: 0,
      },
      {
        productId: EBOOK, name: 'E-book', productType: 'digital_download', priceId: 'price-ebook', quantity: 1,
        grossCents: 1900, netCents: 1545, vatCents: 355, vatRate: 23, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null,
      },
      {
        productId: 'shipping:courier', name: 'Courier', productType: 'shipping',
        grossCents: 1999, netCents: 1851, vatCents: 148, vatRate: 8, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null,
      },
    ]]);
    expect(h.snapshotRows[0]?.createdAt).toBe(legacyNow);
  });

  it('keeps the delivery fee independent of quantity', async () => {
    const { deps } = createCart();
    const selected = await validateCartSelection(legacyTenant.id, { ...cartWithDelivery, lines: [{ productId: BOOK, quantity: 7 }] }, deps);
    if (!selected.ok) throw new Error(selected.error.message);
    const captured = await captureCheckoutSelection(legacyTenant.id, selected.value, deps);
    expect(captured.ok && [captured.value.totalCents, captured.value.shippingCents]).toStrictEqual([17500, 1999]);
  });

  it('discounts the product subtotal without delivery and sums the Omnibus price as unit lowest times quantity', async () => {
    const { deps } = createCart();
    const selected = await validateCartSelection(legacyTenant.id, cartWithDelivery, deps);
    if (!selected.ok) throw new Error(selected.error.message);
    const validated = await validateSelectionCoupon(legacyTenant.id, { code: 'SPRING', email: 'buyer@example.test', amountCents: 6900, currency: 'PLN' }, selected.value, deps);
    expect(validated.ok && validated.value.breakdown).toStrictEqual({
      couponId: 'coupon-1', code: 'SPRING', originalCents: 6900, discountCents: 690, finalCents: 6210,
      lowestPriceLast30DaysCents: 2 * 2000 + 1500, currency: 'PLN',
    });
  });

  it('accepts a product-scoped coupon only when every cart product is in scope', async () => {
    const partial = createCart({ kind: 'products', productIds: [BOOK] });
    const selected = await validateCartSelection(legacyTenant.id, cartWithDelivery, partial.deps);
    if (!selected.ok) throw new Error(selected.error.message);
    expect(await validateSelectionCoupon(legacyTenant.id, { code: 'SPRING', email: 'buyer@example.test', amountCents: 6900, currency: 'PLN' }, selected.value, partial.deps))
      .toStrictEqual(err(validation(COUPON_UNAVAILABLE_MESSAGE)));
    const full = createCart({ kind: 'products', productIds: [BOOK, EBOOK] });
    expect((await validateSelectionCoupon(legacyTenant.id, { code: 'SPRING', email: 'buyer@example.test', amountCents: 6900, currency: 'PLN' }, selected.value, full.deps)).ok).toBe(true);
  });
});
