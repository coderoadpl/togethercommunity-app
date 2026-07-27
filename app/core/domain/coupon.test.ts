import { describe, expect, it } from 'vitest';

import {
  calculateDiscount,
  deriveLowestPriceLast30Days,
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
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

describe('coupon discount math', () => {
  it.each([
    [0, 50, 0],
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
  it('normalizes codes case-insensitively', () => {
    expect(normalizeCouponCode('  partner20 ')).toBe('PARTNER20');
  });

  it.each([
    ['archived', coupon({ status: 'archived' }), 'inactive'],
    ['not started', coupon({ startsAt: '2026-08-01T00:00:00.000Z' }), 'not_started'],
    ['expired', coupon({ endsAt: '2026-07-20T00:00:00.000Z' }), 'expired'],
    ['wrong product', coupon({ scope: { kind: 'products', productIds: ['other'] } }), 'scope'],
    ['wrong purchase kind', coupon({ appliesTo: 'recurring' }), 'purchase_kind'],
    ['global limit', coupon({ maxRedemptions: 2 }), 'limit'],
    ['member limit', coupon({ maxRedemptionsPerMember: 1 }), 'member_limit'],
  ] as const)('rejects %s', (_label, candidate, reason) => {
    expect(
      validateCoupon(candidate, {
        now: '2026-07-27T00:00:00.000Z',
        productId: 'product-1',
        priceKind: 'one_time',
        totalRedemptions: 2,
        memberRedemptions: 1,
      }),
    ).toEqual({ valid: false, reason });
  });

  it('honors expiry after a session started while still re-checking limits', () => {
    const expiring = coupon({ endsAt: '2026-07-26T00:00:00.000Z', maxRedemptions: 2 });
    expect(
      validateCoupon(expiring, {
        now: '2026-07-27T00:00:00.000Z',
        sessionStartedAt: '2026-07-25T00:00:00.000Z',
        productId: 'product-1',
        priceKind: 'one_time',
        totalRedemptions: 1,
        memberRedemptions: 0,
      }),
    ).toEqual({ valid: true });
    expect(
      validateCoupon(expiring, {
        now: '2026-07-27T00:00:00.000Z',
        sessionStartedAt: '2026-07-25T00:00:00.000Z',
        productId: 'product-1',
        priceKind: 'one_time',
        totalRedemptions: 2,
        memberRedemptions: 0,
      }),
    ).toEqual({ valid: false, reason: 'limit' });
  });
});

describe('Omnibus lowest price', () => {
  it('includes the exact 30-day edge and current base price but excludes older and future rows', () => {
    expect(
      deriveLowestPriceLast30Days(
        1200,
        [
          { amountCents: 800, effectiveFrom: '2026-06-27T12:00:00.000Z' },
          { amountCents: 700, effectiveFrom: '2026-06-27T11:59:59.999Z' },
          { amountCents: 600, effectiveFrom: '2026-07-27T12:00:00.001Z' },
          { amountCents: 900, effectiveFrom: '2026-07-20T00:00:00.000Z' },
        ],
        '2026-07-27T12:00:00.000Z',
      ),
    ).toBe(800);
  });
});
