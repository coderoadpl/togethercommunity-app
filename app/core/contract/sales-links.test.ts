import { describe, expect, it } from 'vitest';
import { salesLinkContracts } from './sales-links.js';

describe('direct sales-link checkout contract', () => {
  it('accepts an optional coupon code up to the coupon code length limit in the checkout payload', () => {
    const input = salesLinkContracts.directSalesLinkCheckout.input;
    expect(input.parse({})).toEqual({});
    expect(input.parse({ couponCode: 'SAVE' })).toEqual({ couponCode: 'SAVE' });
    expect(input.safeParse({ couponCode: 'x'.repeat(100) }).success).toBe(true);
    expect(input.safeParse({ couponCode: 'x'.repeat(101) }).success).toBe(false);
    expect(input.safeParse({ couponCode: 123 }).success).toBe(false);
  });
});
