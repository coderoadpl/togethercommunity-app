import {
  calculateDiscount,
  couponCheckoutBreakdownSchema,
  err,
  normalizeCouponCode,
  normalizeEmail,
  ok,
  validateCoupon,
  validation,
  type AppError,
  type Coupon,
  type CouponCheckoutBreakdown,
  type PriceKind,
  type Result,
} from '#core/domain/index.js';

import type {
  Clock,
  CouponRedemptionRepository,
  CouponRepository,
  ProductPriceHistoryRepository,
} from '../ports.js';

export interface CouponCheckoutDeps {
  coupons: CouponRepository;
  redemptions: CouponRedemptionRepository;
  priceHistory: ProductPriceHistoryRepository;
  clock: Clock;
}

export interface CouponCheckoutInput {
  code: string;
  email?: string;
  productId: string;
  priceId: string | null;
  priceKind: PriceKind;
  amountCents: number;
  currency: string;
  sessionStartedAt?: string;
}

/**
 * One message for every rejection so a probe cannot tell an unknown code from an existing one that
 * is expired, out of scope or exhausted.
 */
export const COUPON_UNAVAILABLE_MESSAGE = 'Coupon cannot be applied';

export const validateCouponForCheckout = async (
  tenantId: string,
  input: CouponCheckoutInput,
  deps: CouponCheckoutDeps,
): Promise<Result<{ coupon: Coupon; breakdown: CouponCheckoutBreakdown }, AppError>> => {
  const coupon = await deps.coupons.findByCode(tenantId, normalizeCouponCode(input.code));
  if (!coupon) return err(validation(COUPON_UNAVAILABLE_MESSAGE));
  if (coupon.maxRedemptionsPerMember !== null && input.email === undefined) {
    return err(validation('An email is required to validate this coupon'));
  }
  const email = input.email === undefined ? '' : normalizeEmail(input.email);
  const counts = await deps.redemptions.counts(tenantId, coupon.id, email);
  const validated = validateCoupon(coupon, {
    now: deps.clock.nowIso(),
    ...(input.sessionStartedAt === undefined ? {} : { sessionStartedAt: input.sessionStartedAt }),
    productId: input.productId,
    priceKind: input.priceKind,
    currency: input.currency,
    totalRedemptions: counts.total,
    memberRedemptions: counts.member,
  });
  if (!validated.valid) return err(validation(COUPON_UNAVAILABLE_MESSAGE));

  const discountCents = calculateDiscount(input.amountCents, coupon);
  if (discountCents === 0) return err(validation(COUPON_UNAVAILABLE_MESSAGE));
  const now = deps.clock.nowIso();
  const since = new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString();
  const lowestPriceLast30DaysCents = await deps.priceHistory.lowestSince(tenantId, {
    productId: input.productId,
    priceId: input.priceId,
    since,
    through: now,
    currentAmountCents: input.amountCents,
  });
  const breakdown = couponCheckoutBreakdownSchema.parse({
    couponId: coupon.id,
    code: normalizeCouponCode(coupon.code),
    originalCents: input.amountCents,
    discountCents,
    finalCents: input.amountCents - discountCents,
    lowestPriceLast30DaysCents,
    currency: input.currency,
  });
  return ok({ coupon, breakdown });
};
