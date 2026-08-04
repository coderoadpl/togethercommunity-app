import { describe, expect, it } from 'vitest';

import {
  calculateDiscount,
  couponCreateInputSchema,
  normalizeCouponCode,
  validateCoupon,
  type Coupon,
} from './coupon.js';

const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: 'coupon-1',
  tenantId: 'tenant-1',
  code: 'PARTNER20',
  kind: 'percent',
  value: 20,
  scope: { kind: 'all' },
  appliesTo: 'both',
  recurringDuration: 'first_invoice',
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  maxRedemptionsPerMember: null,
  status: 'active',
  partnerLabel: 'Partner',
  stripeCouponId: null,
  stripePromotionCodeId: null,
  createdAt: '1998-07-01T00:00:00.000Z',
  ...overrides,
});

describe('coupon discount math', () => {
  it.each([
    [0, 50, 0],
    [100, 0, 0],
    [1, 50, 1],
    [3, 50, 2],
    [100, 100, 100],
  ])('rounds %i cents at %i percent half-up to %i', (amountCents, percent, expected) => {
    expect(calculateDiscount(amountCents, { kind: 'percent', value: percent })).toBe(expected);
  });

  it('caps fixed discounts at the original amount', () => {
    expect(calculateDiscount(1, { kind: 'amount', value: 200 })).toBe(1);
  });
});

describe('coupon validation', () => {
  it('requires fixed discounts to declare their currency', () => {
    const input = {
      code: 'SAVE5',
      kind: 'amount',
      value: 500,
      scope: { kind: 'all' },
      appliesTo: 'both',
    };
    expect(couponCreateInputSchema.safeParse(input).success).toBe(false);
    expect(couponCreateInputSchema.safeParse({ ...input, currency: 'PLN' }).success).toBe(true);
  });

  it('rejects zero-value discounts and unsupported currencies', () => {
    const input = {
      code: 'SAVE',
      kind: 'percent',
      value: 0,
      scope: { kind: 'all' },
      appliesTo: 'both',
    };
    expect(couponCreateInputSchema.safeParse(input).success).toBe(false);
    expect(
      couponCreateInputSchema.safeParse({
        ...input,
        kind: 'amount',
        value: 500,
        currency: 'GBP',
      }).success,
    ).toBe(false);
  });

  it('requires the end date to be later than the start date', () => {
    const input = {
      code: 'SUMMER',
      kind: 'percent',
      value: 10,
      scope: { kind: 'all' },
      appliesTo: 'both',
      startsAt: '1998-08-20T00:00:00.000Z',
      endsAt: '1998-08-19T00:00:00.000Z',
    };
    expect(couponCreateInputSchema.safeParse(input).success).toBe(false);
    expect(
      couponCreateInputSchema.safeParse({
        ...input,
        endsAt: '1998-08-21T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('normalizes codes case-insensitively', () => {
    expect(normalizeCouponCode('  partner20 ')).toBe('PARTNER20');
  });

  it.each([
    ['archived', coupon({ status: 'archived' }), 'inactive'],
    ['not started', coupon({ startsAt: '1998-08-01T00:00:00.000Z' }), 'not_started'],
    ['expired', coupon({ endsAt: '1998-07-20T00:00:00.000Z' }), 'expired'],
    ['wrong product', coupon({ scope: { kind: 'products', productIds: ['other'] } }), 'scope'],
    ['wrong purchase kind', coupon({ appliesTo: 'recurring' }), 'purchase_kind'],
    ['wrong currency', coupon({ kind: 'amount', value: 500, currency: 'EUR' }), 'currency'],
    ['global limit', coupon({ maxRedemptions: 2 }), 'limit'],
    ['member limit', coupon({ maxRedemptionsPerMember: 1 }), 'member_limit'],
  ] as const)('rejects %s', (_label, candidate, reason) => {
    expect(
      validateCoupon(candidate, {
        now: '1998-07-27T00:00:00.000Z',
        productId: 'product-1',
        priceKind: 'one_time',
        currency: 'PLN',
        totalRedemptions: 2,
        memberRedemptions: 1,
      }),
    ).toEqual({ valid: false, reason });
  });

  it('honors expiry after a session started while still re-checking limits', () => {
    const expiring = coupon({ endsAt: '1998-07-26T00:00:00.000Z', maxRedemptions: 2 });
    expect(
      validateCoupon(expiring, {
        now: '1998-07-27T00:00:00.000Z',
        sessionStartedAt: '1998-07-25T00:00:00.000Z',
        productId: 'product-1',
        priceKind: 'one_time',
        currency: 'PLN',
        totalRedemptions: 1,
        memberRedemptions: 0,
      }),
    ).toEqual({ valid: true });
    expect(
      validateCoupon(expiring, {
        now: '1998-07-27T00:00:00.000Z',
        sessionStartedAt: '1998-07-25T00:00:00.000Z',
        productId: 'product-1',
        priceKind: 'one_time',
        currency: 'PLN',
        totalRedemptions: 2,
        memberRedemptions: 0,
      }),
    ).toEqual({ valid: false, reason: 'limit' });
  });
});
