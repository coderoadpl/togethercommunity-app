import { describe, expect, it } from 'vitest';

import {
  checkoutCartSessionRequestSchema,
  couponCartCheckoutValidationRequestSchema,
  isCheckoutCartRequest,
} from './routes.js';

const lines = [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 2 }];
const forbiddenNextToLines = [
  ['productId', { productId: '00000000-0000-4000-8000-000000000001' }],
  ['priceId', { priceId: 'price-1' }],
  ['salesLinkId', { salesLinkId: 'link-1' }],
  ['salesLinkSlug', { salesLinkSlug: 'bundle' }],
  ['variantSelections', { variantSelections: [] }],
] as const;

describe('cart coupon validation request', () => {
  const bare = { lines, email: 'buyer@example.test', couponCode: 'SPRING' };

  it('accepts the bare cart form with and without an email', () => {
    expect(couponCartCheckoutValidationRequestSchema.parse(bare)).toEqual(bare);
    expect(couponCartCheckoutValidationRequestSchema.safeParse({ lines, couponCode: 'SPRING' }).success).toBe(true);
  });

  it.each(forbiddenNextToLines)('rejects %s next to lines', (_field, extra) => {
    expect(couponCartCheckoutValidationRequestSchema.safeParse({ ...bare, ...extra }).success).toBe(false);
  });

  it('rejects session-only fields, an unknown field and a missing coupon code', () => {
    expect(couponCartCheckoutValidationRequestSchema.safeParse({ ...bare, termsAccepted: true }).success).toBe(false);
    expect(couponCartCheckoutValidationRequestSchema.safeParse({ ...bare, shipping: { rateId: 'courier' } }).success).toBe(false);
    expect(couponCartCheckoutValidationRequestSchema.safeParse({ ...bare, amountCents: 1 }).success).toBe(false);
    expect(couponCartCheckoutValidationRequestSchema.safeParse({ lines, email: 'buyer@example.test' }).success).toBe(false);
  });
});

describe('cart checkout session request', () => {
  const bare = { lines, email: 'buyer@example.test', termsAccepted: true };

  it('keeps the locker phone in nested shipping without relaxing the strict cart request', () => {
    const shipping = { rateId: 'locker', phone: '+48500000000', pickupPoint: { provider: 'inpost', code: 'ABC01M' } };
    expect(checkoutCartSessionRequestSchema.parse({ ...bare, shipping }).shipping).toEqual(shipping);
    expect(checkoutCartSessionRequestSchema.safeParse({ ...bare, shipping, unknown: true }).success).toBe(false);
  });

  it('accepts the bare cart form and is recognised as a cart request', () => {
    expect(checkoutCartSessionRequestSchema.safeParse(bare).success).toBe(true);
    expect(isCheckoutCartRequest(bare)).toBe(true);
    expect(isCheckoutCartRequest({ productId: 'product-1' })).toBe(false);
  });

  it.each(forbiddenNextToLines)('rejects %s next to lines', (_field, extra) => {
    expect(checkoutCartSessionRequestSchema.safeParse({ ...bare, ...extra }).success).toBe(false);
  });
});
