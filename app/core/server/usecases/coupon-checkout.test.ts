import { describe, expect, it } from 'vitest';

import { couponCheckoutBreakdownSchema, type Coupon } from '#core/domain/index.js';

import {
  validateCouponForCheckout,
  type CouponCheckoutDeps,
  type CouponCheckoutInput,
} from './coupon-checkout.js';

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

const deps = (
  coupon: Coupon = baseCoupon,
  counts = { total: 0, member: 0 },
  lowestSince: CouponCheckoutDeps['priceHistory']['lowestSince'] =
    async (_tenantId, input) => Math.min(input.currentAmountCents, 800),
): CouponCheckoutDeps => ({
  coupons: {
    findByCode: async () => coupon,
    findById: async () => coupon,
    cacheStripeIds: async () => coupon,
  },
  redemptions: {
    counts: async () => counts,
    createOrderAndClaim: async () => true,
  },
  priceHistory: {
    lowestSince,
  },
  clock: { nowIso: () => '2026-07-27T12:00:00.000Z' },
});

const validInput: CouponCheckoutInput = {
  code: 'SAVE50',
  email: 'buyer@example.test',
  productId: 'product-1',
  priceId: 'price-1',
  priceKind: 'one_time',
  amountCents: 1000,
  currency: 'PLN',
};

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

  it.each([
    [
      { ...baseCoupon, status: 'archived' },
      { total: 0, member: 0 },
      validInput,
      'This coupon is inactive',
    ],
    [
      { ...baseCoupon, startsAt: '2026-08-01T00:00:00.000Z' },
      { total: 0, member: 0 },
      validInput,
      'This coupon is not valid yet',
    ],
    [
      { ...baseCoupon, endsAt: '2026-07-20T00:00:00.000Z' },
      { total: 0, member: 0 },
      validInput,
      'This coupon has expired',
    ],
    [
      { ...baseCoupon, scope: { kind: 'products', productIds: ['other-product'] } },
      { total: 0, member: 0 },
      validInput,
      'This coupon does not apply to this product',
    ],
    [
      { ...baseCoupon, appliesTo: 'recurring' },
      { total: 0, member: 0 },
      validInput,
      'This coupon does not apply to this price',
    ],
    [
      { ...baseCoupon, kind: 'amount', value: 500, currency: 'EUR' },
      { total: 0, member: 0 },
      validInput,
      'This coupon does not apply to this currency',
    ],
    [
      { ...baseCoupon, maxRedemptions: 2 },
      { total: 2, member: 0 },
      validInput,
      'This coupon has reached its redemption limit',
    ],
    [
      { ...baseCoupon, maxRedemptionsPerMember: 1 },
      { total: 0, member: 1 },
      validInput,
      'This coupon has reached its per-member redemption limit',
    ],
  ] satisfies Array<[
    Coupon,
    { total: number; member: number },
    CouponCheckoutInput,
    string,
  ]>)('maps coupon rejection to "%s"', async (coupon, counts, input, message) => {
    let priceHistoryCalls = 0;
    const result = await validateCouponForCheckout(
      'tenant-1',
      input,
      deps(coupon, counts, async () => {
        priceHistoryCalls += 1;
        return 800;
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'validation', message },
    });
    expect(priceHistoryCalls).toBe(0);
  });

  it('rejects a coupon that rounds to zero discount before reading price history', async () => {
    let priceHistoryCalls = 0;
    const result = await validateCouponForCheckout(
      'tenant-1',
      { ...validInput, amountCents: 1 },
      deps({ ...baseCoupon, value: 1 }, { total: 0, member: 0 }, async () => {
        priceHistoryCalls += 1;
        return 1;
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'validation',
        message: 'This coupon does not reduce the selected price',
      },
    });
    expect(priceHistoryCalls).toBe(0);
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
