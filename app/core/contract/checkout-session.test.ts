import { describe, expect, it } from 'vitest';

import { envelopeSchema } from './envelope.js';
import { checkoutSessionOutputSchema } from './routes.js';

const coupon = {
  couponId: 'coupon-1',
  code: 'FREE100',
  originalCents: 4900,
  discountCents: 4900,
  finalCents: 0,
  lowestPriceLast30DaysCents: 4900,
  currency: 'PLN',
};

describe('checkout session answer', () => {
  it('keeps free and coupon of a free answer', () => {
    const free = {
      url: 'https://workspace.example.test/checkout/product-1?status=success&purchase_kind=product',
      free: true,
      coupon,
    };
    expect(checkoutSessionOutputSchema.parse(free)).toEqual(free);
    expect(envelopeSchema(checkoutSessionOutputSchema).parse({ ok: true, data: free })).toEqual({ ok: true, data: free });
  });

  it('still parses an answer that goes to payment', () => {
    const paid = { url: 'https://payments.example.test/session/1', free: false };
    expect(checkoutSessionOutputSchema.parse(paid)).toEqual(paid);
    expect(checkoutSessionOutputSchema.parse({ url: paid.url })).toEqual({ url: paid.url });
  });
});
