import { z } from 'zod';

import { priceKindSchema } from './commerce.js';

export const couponKindSchema = z.enum(['percent', 'amount']);
export type CouponKind = z.infer<typeof couponKindSchema>;

export const couponScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('products'), productIds: z.array(z.string().min(1)).min(1) }),
]);
export type CouponScope = z.infer<typeof couponScopeSchema>;

export const couponAppliesToSchema = z.enum(['one_time', 'recurring', 'both']);
export type CouponAppliesTo = z.infer<typeof couponAppliesToSchema>;

export const couponRecurringDurationSchema = z.enum(['first_invoice', 'forever']);
export type CouponRecurringDuration = z.infer<typeof couponRecurringDurationSchema>;

export const couponStatusSchema = z.enum(['active', 'archived']);
export type CouponStatus = z.infer<typeof couponStatusSchema>;

export const couponSchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    code: z.string().min(1),
    kind: couponKindSchema,
    value: z.number().int().nonnegative(),
    scope: couponScopeSchema,
    appliesTo: couponAppliesToSchema,
    recurringDuration: couponRecurringDurationSchema,
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
    maxRedemptions: z.number().int().positive().nullable(),
    maxRedemptionsPerMember: z.number().int().positive().nullable(),
    status: couponStatusSchema,
    partnerLabel: z.string().trim().min(1).nullable(),
    stripeCouponId: z.string().nullable(),
    stripePromotionCodeId: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'percent' && value.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'A percentage discount cannot exceed 100',
      });
    }
    if (value.startsAt !== null && value.endsAt !== null && value.startsAt >= value.endsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'Coupon end must be after its start',
      });
    }
  });
export type Coupon = z.infer<typeof couponSchema>;

export const couponRedemptionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  couponId: z.string(),
  orderId: z.string(),
  memberId: z.string(),
  email: z.string().email(),
  discountCents: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type CouponRedemption = z.infer<typeof couponRedemptionSchema>;

export const productPriceHistorySchema = z.object({
  id: z.number().int().positive(),
  tenantId: z.string(),
  productId: z.string(),
  priceId: z.string().nullable(),
  amountCents: z.number().int().nonnegative(),
  effectiveFrom: z.string().datetime(),
});
export type ProductPriceHistory = z.infer<typeof productPriceHistorySchema>;

export const couponValidationFailureSchema = z.enum([
  'inactive',
  'not_started',
  'expired',
  'scope',
  'purchase_kind',
  'limit',
  'member_limit',
]);
export type CouponValidationFailure = z.infer<typeof couponValidationFailureSchema>;

export type CouponValidationResult =
  | { valid: true }
  | { valid: false; reason: CouponValidationFailure };

export const normalizeCouponCode = (code: string): string => code.trim().toLocaleUpperCase('en-US');

export const calculateDiscount = (
  originalCents: number,
  discount: Pick<Coupon, 'kind' | 'value'>,
): number => {
  if (discount.kind === 'amount') return Math.min(originalCents, discount.value);
  return Math.min(originalCents, Math.floor((originalCents * discount.value + 50) / 100));
};

export const validateCoupon = (
  coupon: Coupon,
  input: {
    now: string;
    sessionStartedAt?: string;
    productId: string;
    priceKind: z.infer<typeof priceKindSchema>;
    totalRedemptions: number;
    memberRedemptions: number;
  },
): CouponValidationResult => {
  if (coupon.status !== 'active') return { valid: false, reason: 'inactive' };
  const validityTime = input.sessionStartedAt ?? input.now;
  if (coupon.startsAt !== null && validityTime < coupon.startsAt) {
    return { valid: false, reason: 'not_started' };
  }
  if (coupon.endsAt !== null && validityTime >= coupon.endsAt) {
    return { valid: false, reason: 'expired' };
  }
  if (coupon.scope.kind === 'products' && !coupon.scope.productIds.includes(input.productId)) {
    return { valid: false, reason: 'scope' };
  }
  if (coupon.appliesTo !== 'both' && coupon.appliesTo !== input.priceKind) {
    return { valid: false, reason: 'purchase_kind' };
  }
  if (coupon.maxRedemptions !== null && input.totalRedemptions >= coupon.maxRedemptions) {
    return { valid: false, reason: 'limit' };
  }
  if (
    coupon.maxRedemptionsPerMember !== null &&
    input.memberRedemptions >= coupon.maxRedemptionsPerMember
  ) {
    return { valid: false, reason: 'member_limit' };
  }
  return { valid: true };
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const deriveLowestPriceLast30Days = (
  currentBasePriceCents: number,
  history: Array<Pick<ProductPriceHistory, 'amountCents' | 'effectiveFrom'>>,
  now: string,
): number => {
  const nowMs = Date.parse(now);
  const windowStart = nowMs - THIRTY_DAYS_MS;
  return history.reduce(
    (lowest, row) => {
      const effectiveMs = Date.parse(row.effectiveFrom);
      return effectiveMs >= windowStart && effectiveMs <= nowMs
        ? Math.min(lowest, row.amountCents)
        : lowest;
    },
    currentBasePriceCents,
  );
};
