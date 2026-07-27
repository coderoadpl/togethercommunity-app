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
} from '@core/domain/index.js';

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

const validationMessage = {
  inactive: 'This coupon is inactive',
  not_started: 'This coupon is not valid yet',
  expired: 'This coupon has expired',
  scope: 'This coupon does not apply to this product',
  purchase_kind: 'This coupon does not apply to this price',
  limit: 'This coupon has reached its redemption limit',
  member_limit: 'This coupon has reached its per-member redemption limit',
} as const;

export const validateCouponForCheckout = async (
  tenantId: string,
  input: CouponCheckoutInput,
  deps: CouponCheckoutDeps,
): Promise<Result<{ coupon: Coupon; breakdown: CouponCheckoutBreakdown }, AppError>> => {
  const coupon = await deps.coupons.findByCode(tenantId, normalizeCouponCode(input.code));
  if (!coupon) return err(validation('Coupon code is invalid'));
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
    totalRedemptions: counts.total,
    memberRedemptions: counts.member,
  });
  if (!validated.valid) return err(validation(validationMessage[validated.reason]));

  const discountCents = calculateDiscount(input.amountCents, coupon);
  if (discountCents === 0) return err(validation('This coupon does not reduce the selected price'));
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
