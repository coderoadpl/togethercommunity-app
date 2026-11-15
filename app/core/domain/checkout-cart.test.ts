import { describe, expect, it } from 'vitest';

import {
  CART_LINE_MAX_QUANTITY_WITH_HOLD,
  CART_MAX_LINES,
  CART_MAX_UNITS,
  CART_PHYSICAL_LINE_MAX_QUANTITY,
  cartLineMaxQuantity,
  cartLineQuantityError,
  cartLinesSchema,
  formatCartLinesParam,
  parseCartLinesParam,
} from './checkout-cart.js';
import { checkoutCartInputSchema } from './payment.js';

const productId = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('cart lines schema', () => {
  it('accepts lines with a quantity and an optional price', () => {
    expect(cartLinesSchema.safeParse([
      { productId: productId(1), quantity: 2 },
      { productId: productId(2), priceId: 'price-2', quantity: 1 },
    ]).success).toBe(true);
  });

  it('rejects a second line for the same product', () => {
    const parsed = cartLinesSchema.safeParse([{ productId: productId(1), quantity: 1 }, { productId: productId(1), quantity: 2 }]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain('Each product may appear in one cart line only');
  });

  it('accepts 20 lines and rejects 21', () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => ({ productId: productId(index + 1), quantity: 1 }));
    expect(CART_MAX_LINES).toBe(20);
    expect(cartLinesSchema.safeParse(lines(20)).success).toBe(true);
    expect(cartLinesSchema.safeParse(lines(21)).success).toBe(false);
  });

  it('rejects an empty cart, a fractional or zero quantity, and more than 99 per line', () => {
    expect(cartLinesSchema.safeParse([]).success).toBe(false);
    expect(cartLinesSchema.safeParse([{ productId: productId(1), quantity: 1.5 }]).success).toBe(false);
    expect(cartLinesSchema.safeParse([{ productId: productId(1), quantity: 0 }]).success).toBe(false);
    expect(cartLinesSchema.safeParse([{ productId: productId(1), quantity: CART_PHYSICAL_LINE_MAX_QUANTITY }]).success).toBe(true);
    expect(cartLinesSchema.safeParse([{ productId: productId(1), quantity: CART_PHYSICAL_LINE_MAX_QUANTITY + 1 }]).success).toBe(false);
  });

  it('accepts 200 units and rejects 201 units in one order', () => {
    expect(CART_MAX_UNITS).toBe(200);
    expect(cartLinesSchema.safeParse([
      { productId: productId(1), quantity: 99 }, { productId: productId(2), quantity: 99 }, { productId: productId(3), quantity: 2 },
    ]).success).toBe(true);
    const parsed = cartLinesSchema.safeParse([
      { productId: productId(1), quantity: 99 }, { productId: productId(2), quantity: 99 }, { productId: productId(3), quantity: 3 },
    ]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain('A cart may hold at most 200 units');
  });

  it('rejects unknown line fields such as a price or an amount', () => {
    expect(cartLinesSchema.safeParse([{ productId: productId(1), quantity: 1, amountCents: 1 }]).success).toBe(false);
    expect(cartLinesSchema.safeParse([{ productId: productId(1), quantity: 1, price: 1 }]).success).toBe(false);
  });

  it('rejects a product id that is not a UUID', () => {
    expect(cartLinesSchema.safeParse([{ productId: 'product-1', quantity: 1 }]).success).toBe(false);
  });
});

describe('cart request schema', () => {
  const request = { lines: [{ productId: productId(1), quantity: 2 }], email: 'buyer@example.test', termsAccepted: true };

  it('accepts the cart form with the shared checkout fields', () => {
    expect(checkoutCartInputSchema.safeParse({ ...request, couponCode: 'SPRING', shipping: { rateId: 'courier' } }).success).toBe(true);
  });

  it.each(['productId', 'priceId', 'salesLinkId', 'salesLinkSlug'])('rejects %s next to lines', (field) => {
    expect(checkoutCartInputSchema.safeParse({ ...request, [field]: 'value' }).success).toBe(false);
  });

  it('rejects variant selections and unknown top-level fields next to lines', () => {
    expect(checkoutCartInputSchema.safeParse({ ...request, variantSelections: [] }).success).toBe(false);
    expect(checkoutCartInputSchema.safeParse({ ...request, totalCents: 100 }).success).toBe(false);
  });
});

describe('cart line quantity per product', () => {
  it('caps a physical line at the hold maximum: 10 accepted, 11 rejected', () => {
    expect(CART_LINE_MAX_QUANTITY_WITH_HOLD).toBe(10);
    expect(cartLineQuantityError({ title: 'Poster', type: 'physical' }, 10)).toBeNull();
    expect(cartLineQuantityError({ title: 'Poster', type: 'physical' }, 11)).toBe('"Poster" can be ordered in a quantity of at most 10');
  });

  it('allows 99 on a physical line once the hold cap is lifted', () => {
    expect(cartLineQuantityError({ title: 'Poster', type: 'physical' }, 99, CART_PHYSICAL_LINE_MAX_QUANTITY)).toBeNull();
  });

  it.each(['digital_download', 'course', 'membership'] as const)('allows only one unit of a %s product', (type) => {
    expect(cartLineQuantityError({ title: 'Item', type }, 1)).toBeNull();
    expect(cartLineQuantityError({ title: 'Item', type }, 2, CART_PHYSICAL_LINE_MAX_QUANTITY)).toBe('"Item" can be ordered in a quantity of at most 1');
  });
});

describe('cart lines URL parameter', () => {
  it('round-trips product IDs and quantities', () => {
    const lines = [{ productId: productId(1), quantity: 2 }, { productId: productId(2), quantity: 1 }];
    const value = formatCartLinesParam(lines);
    expect(value).toBe(`${productId(1)}.2~${productId(2)}.1`);
    expect(encodeURIComponent(value)).toBe(value);
    expect(parseCartLinesParam(new URLSearchParams(`lines=${value}`).get('lines'))).toEqual(lines);
    expect(parseCartLinesParam(value)).toEqual(lines);
  });

  it.each([
    ['a missing parameter', null],
    ['an empty parameter', ''],
    ['a trailing separator', `${productId(1)}.1~`],
    ['a product ID that is not a UUID', 'product-1.1'],
    ['a missing quantity', productId(1)],
    ['a zero quantity', `${productId(1)}.0`],
    ['a quantity above 99', `${productId(1)}.100`],
    ['a fractional quantity', `${productId(1)}.1.5`],
    ['a duplicate product', `${productId(1)}.1~${productId(1)}.2`],
    ['21 lines', Array.from({ length: 21 }, (_, index) => `${productId(index + 1)}.1`).join('~')],
  ])('rejects %s', (_case, value) => {
    expect(parseCartLinesParam(value)).toBeNull();
  });

  it('gives a physical line the hold maximum and any other line one unit', () => {
    expect(cartLineMaxQuantity('physical')).toBe(CART_LINE_MAX_QUANTITY_WITH_HOLD);
    expect(cartLineMaxQuantity('digital_download')).toBe(1);
    expect(cartLineMaxQuantity('course')).toBe(1);
  });
});
