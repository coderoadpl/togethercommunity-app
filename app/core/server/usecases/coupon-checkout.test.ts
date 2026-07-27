import { describe, expect, it } from 'vitest';

import { couponCheckoutBreakdownSchema, type Coupon } from '@core/domain/index.js';

import { validateCouponForCheckout, type CouponCheckoutDeps } from './coupon-checkout.js';

const baseCoupon: Coupon = {
  id: 'coupon-1',
  tenantId: 'tenant-1',
  code: 'SAVE50',
  kind: 'percent',
  value: 50,
  scope: { kind: 'all' },
  appliesTo: 'both',
  recurringDuration: 'first_invoice',
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  maxRedemptionsPerMember: null,
  status: 'active',
  partnerLabel: null,
  stripeCouponId: null,
  stripePromotionCodeId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const deps = (coupon: Coupon = baseCoupon): CouponCheckoutDeps => ({
  coupons: {
    findByCode: async () => coupon,
    findById: async () => coupon,
    cacheStripeIds: async () => coupon,
  },
  redemptions: {
    counts: async () => ({ total: 0, member: 0 }),
    createOrderAndClaim: async () => true,
  },
  priceHistory: {
    lowestSince: async (_tenantId, input) => Math.min(input.currentAmountCents, 800),
  },
  clock: { nowIso: () => '2026-07-27T12:00:00.000Z' },
});

describe('validateCouponForCheckout', () => {
  it('returns an integer-cents breakdown and Omnibus price', async () => {
    await expect(
      validateCouponForCheckout(
        'tenant-1',
        {
          code: ' save50 ',
          email: 'BUYER@example.test',
          productId: 'product-1',
          priceId: 'price-1',
          priceKind: 'one_time',
          amountCents: 1001,
          currency: 'PLN',
        },
        deps(),
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        coupon: baseCoupon,
        breakdown: {
          couponId: 'coupon-1',
          code: 'SAVE50',
          originalCents: 1001,
          discountCents: 501,
          finalCents: 500,
          lowestPriceLast30DaysCents: 800,
          currency: 'PLN',
        },
      },
    });
  });

  it('requires an email when a per-member limit applies', async () => {
    const result = await validateCouponForCheckout(
      'tenant-1',
      {
        code: 'SAVE50',
        productId: 'product-1',
        priceId: null,
        priceKind: 'one_time',
        amountCents: 1000,
        currency: 'PLN',
      },
      deps({ ...baseCoupon, maxRedemptionsPerMember: 1 }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects rendering a discounted payload without an Omnibus value', () => {
    const incomplete: unknown = {
      couponId: 'coupon-1',
      code: 'SAVE50',
      originalCents: 1000,
      discountCents: 500,
      finalCents: 500,
      currency: 'PLN',
    };
    expect(() => couponCheckoutBreakdownSchema.parse(incomplete)).toThrow();
  });
});
