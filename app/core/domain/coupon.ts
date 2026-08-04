import { z } from 'zod';

import type { PriceKind } from './commerce.js';
import { SUPPORTED_CURRENCIES } from './product.js';

const couponCurrencySchema = z.enum(SUPPORTED_CURRENCIES);

const couponKindSchema = z.enum(['percent', 'amount']);
export type CouponKind = z.infer<typeof couponKindSchema>;

const couponScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('products'), productIds: z.array(z.string().min(1)).min(1) }),
]);
export type CouponScope = z.infer<typeof couponScopeSchema>;

const couponAppliesToSchema = z.enum(['one_time', 'recurring', 'both']);
export type CouponAppliesTo = z.infer<typeof couponAppliesToSchema>;

export const couponRecurringDurationSchema = z.enum(['first_invoice', 'forever']);
export type CouponRecurringDuration = z.infer<typeof couponRecurringDurationSchema>;

const couponStatusSchema = z.enum(['active', 'archived']);

export const couponSchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    code: z.string().min(1),
    kind: couponKindSchema,
    value: z.number().int().positive(),
    currency: couponCurrencySchema.nullable().optional(),
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
    if (value.kind === 'amount' && value.currency == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currency'],
        message: 'A fixed discount requires a currency',
      });
    }
    if (value.kind === 'percent' && value.currency != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currency'],
        message: 'A percentage discount cannot declare a currency',
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

export const couponCreateInputSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    kind: couponKindSchema,
    value: z.number().int().positive(),
    currency: couponCurrencySchema.nullable().default(null),
    scope: couponScopeSchema,
    appliesTo: couponAppliesToSchema,
    recurringDuration: couponRecurringDurationSchema.default('first_invoice'),
    startsAt: z.string().datetime().nullable().default(null),
    endsAt: z.string().datetime().nullable().default(null),
    maxRedemptions: z.number().int().positive().nullable().default(null),
    maxRedemptionsPerMember: z.number().int().positive().nullable().default(null),
    partnerLabel: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'percent' && value.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'A percentage discount cannot exceed 100',
      });
    }
    if (value.kind === 'amount' && value.currency === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currency'],
        message: 'A fixed discount requires a currency',
      });
    }
    if (value.kind === 'percent' && value.currency !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currency'],
        message: 'A percentage discount cannot declare a currency',
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
export type CouponCreateInput = z.input<typeof couponCreateInputSchema>;

export const couponEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  couponId: z.string(),
  type: z.enum(['created', 'archived']),
  occurredAt: z.string().datetime(),
});
export type CouponEvent = z.infer<typeof couponEventSchema>;

export type CouponRedemption = {
  id: string;
  tenantId: string;
  couponId: string;
  orderId: string;
  memberId: string;
  email: string;
  discountCents: number;
  createdAt: string;
};

export type CouponRedemptionEvent = {
  id: string;
  tenantId: string;
  redemptionId: string;
  couponId: string;
  orderId: string;
  type: 'redeemed';
  occurredAt: string;
};

export const couponCheckoutSessionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  couponId: z.string(),
  providerSessionId: z.string().nullable(),
  memberEmail: z.string().email(),
  productId: z.string(),
  priceId: z.string().nullable(),
  originalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  finalCents: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  startedAt: z.string().datetime(),
});
export type CouponCheckoutSession = z.infer<typeof couponCheckoutSessionSchema>;

export const couponCheckoutBreakdownSchema = z
  .object({
    couponId: z.string(),
    code: z.string(),
    originalCents: z.number().int().nonnegative(),
    discountCents: z.number().int().positive(),
    finalCents: z.number().int().nonnegative(),
    lowestPriceLast30DaysCents: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .superRefine((value, ctx) => {
    if (value.originalCents - value.discountCents !== value.finalCents) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Discount breakdown is inconsistent' });
    }
  });
export type CouponCheckoutBreakdown = z.infer<typeof couponCheckoutBreakdownSchema>;

const couponMoneyTotalSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountCents: z.number().int().nonnegative(),
});

const couponStatsPointSchema = z.object({
  date: z.string().date(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  redemptions: z.number().int().nonnegative(),
  grossAttributedCents: z.number().int().nonnegative(),
  discountGivenCents: z.number().int().nonnegative(),
});

export const couponStatsItemSchema = z.object({
  coupon: couponSchema,
  redemptions: z.number().int().nonnegative(),
  sessionsWithCode: z.number().int().nonnegative(),
  conversionRate: z.number().min(0).max(1),
  grossAttributed: z.array(couponMoneyTotalSchema),
  discountGiven: z.array(couponMoneyTotalSchema),
  timeSeries: z.array(couponStatsPointSchema),
});
export type CouponStatsItem = z.infer<typeof couponStatsItemSchema>;

export const couponOptionSchema = z.object({
  id: z.string(),
  code: z.string(),
});
export type CouponOption = z.infer<typeof couponOptionSchema>;

export type CouponStatsCursor = {
  createdAt: string;
  id: string;
};

type CouponValidationFailure =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'scope'
  | 'purchase_kind'
  | 'currency'
  | 'limit'
  | 'member_limit';

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
    priceKind: PriceKind;
    currency: string;
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
  if (coupon.kind === 'amount' && coupon.currency !== input.currency) {
    return { valid: false, reason: 'currency' };
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
