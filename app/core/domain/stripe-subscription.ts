import { z } from 'zod';

import { appError, type AppError, type ErrorCode } from './errors.js';
import { currencySchema } from './product.js';
import { memberSubscriptionSchema, productPriceSchema } from './commerce.js';

export const STRIPE_ADOPTION_REFUSALS = [
  'email-mismatch', 'status', 'not-found', 'unsupported', 'conflict', 'price',
] as const;

export type StripeAdoptionRefusal = (typeof STRIPE_ADOPTION_REFUSALS)[number];

export const adoptionRefusal = (
  code: ErrorCode,
  refusal: StripeAdoptionRefusal,
  message: string,
): AppError => appError(code, message, { adoptionRefusal: refusal });

export const adoptStripeSubscriptionInputSchema = z.object({
  subscriptionId: z.string().trim().regex(/^sub_[A-Za-z0-9]+$/),
  memberId: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  productId: z.string().min(1),
  priceId: z.string().min(1).optional(),
  allowEmailMismatch: z.boolean().optional(),
}).refine((input) => (input.memberId === undefined) !== (input.email === undefined), {
  message: 'Provide exactly one of memberId or email',
});

export type AdoptStripeSubscriptionInput = z.infer<typeof adoptStripeSubscriptionInputSchema>;

export const stripeSubscriptionSnapshotSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  customerEmail: z.string().email().nullable(),
  price: z.object({
    id: z.string().min(1),
    amountCents: z.number().int().nonnegative(),
    currency: currencySchema,
    interval: z.enum(['day', 'week', 'month', 'year']),
    intervalCount: z.number().int().positive(),
  }),
});

export type StripeSubscriptionSnapshot = z.infer<typeof stripeSubscriptionSnapshotSchema>;

export const listStripeSubscriptionsInputSchema = z.object({
  status: z.enum(['active', 'past_due', 'canceled', 'unpaid', 'trialing', 'incomplete', 'incomplete_expired', 'paused', 'all']).optional(),
  unadopted: z.boolean().optional(),
  startingAfter: z.string().regex(/^sub_[A-Za-z0-9]+$/).optional(),
});

export type ListStripeSubscriptionsInput = z.infer<typeof listStripeSubscriptionsInputSchema>;

const stripeSubscriptionListItemSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  providerPriceId: z.string().nullable(),
  adopted: z.boolean(),
});

export const listStripeSubscriptionsOutputSchema = z.object({
  subscriptions: z.array(stripeSubscriptionListItemSchema),
  nextCursor: z.string().nullable(),
});

export const adoptStripeSubscriptionOutputSchema = z.object({
  subscription: memberSubscriptionSchema,
  price: productPriceSchema,
  subscriptionCreated: z.boolean(),
  priceCreated: z.boolean(),
  grantId: z.string(),
  grantCreated: z.boolean(),
  grantExtended: z.boolean(),
});

export type AdoptStripeSubscriptionResult = z.infer<typeof adoptStripeSubscriptionOutputSchema>;

export const stripeAdoptionObjectSchema = z.object({
  id: z.string(),
  status: z.string(),
  cancel_at_period_end: z.boolean(),
  current_period_end: z.number().int().optional(),
  customer: z.object({ email: z.string().email().nullable().optional(), deleted: z.boolean().optional() }),
  items: z.object({ data: z.array(z.object({
    current_period_end: z.number().int().optional(),
    price: z.object({
      id: z.string(), unit_amount: z.number().int().nonnegative(), currency: z.string(),
      recurring: z.object({ interval: z.enum(['day', 'week', 'month', 'year']), interval_count: z.number().int().positive() }),
    }),
  })).length(1) }),
});
