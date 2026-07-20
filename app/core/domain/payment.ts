import { z } from 'zod';

import { languageSchema } from './language.js';

export const checkoutSessionInputSchema = z.object({
  productId: z.string().min(1),
  priceId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  language: languageSchema.optional(),
  termsAccepted: z.boolean().optional(),
});

export type CheckoutSessionInput = z.input<typeof checkoutSessionInputSchema>;

export const stripeWebhookPayloadSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      customer_email: z.string().email().nullable().optional(),
      customer_details: z.object({ email: z.string().email().nullable() }).nullable().optional(),
      metadata: z.record(z.string()).nullable().optional(),
      subscription: z.string().nullable().optional(),
      invoice: z.string().nullable().optional(),
      payment_intent: z.string().nullable().optional(),
      charge: z.string().nullable().optional(),
      amount_total: z.number().int().nullable().optional(),
      currency: z.string().nullable().optional(),
      period_end: z.number().nullable().optional(),
      cancel_at_period_end: z.boolean().optional(),
      current_period_end: z.number().nullable().optional(),
      status: z.string().optional(),
    }),
  }),
});

/**
 * Tolerant shapes for raw Stripe webhook objects: Stripe moved fields across
 * recent API versions (for example `invoice.subscription` into
 * `parent.subscription_details`), so adapters parse the raw event with these
 * instead of trusting a single SDK version's types.
 */
export const stripeInvoiceObjectSchema = z.object({
  id: z.string(),
  subscription: z.unknown().optional(),
  parent: z
    .object({
      subscription_details: z.object({ subscription: z.unknown() }).nullable().optional(),
    })
    .nullable()
    .optional(),
  amount_paid: z.number().int().optional(),
  amount_due: z.number().int().optional(),
  charge: z.unknown().optional(),
  payment_intent: z.unknown().optional(),
  currency: z.string().optional(),
  period_end: z.number().nullable().optional(),
  lines: z
    .object({
      data: z.array(z.object({ period: z.object({ end: z.number() }).optional() })),
    })
    .optional(),
});

export const stripeChargeObjectSchema = z.object({
  id: z.string(),
  invoice: z.unknown().optional(),
  payment_intent: z.unknown().optional(),
});

export const stripeDisputeObjectSchema = z.object({
  id: z.string(),
  charge: z.unknown().optional(),
  payment_intent: z.unknown().optional(),
});

export const stripeSubscriptionObjectSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  cancel_at_period_end: z.boolean().optional(),
  current_period_end: z.number().nullable().optional(),
  items: z
    .object({
      data: z.array(z.object({ current_period_end: z.number().optional() })),
    })
    .optional(),
});

export const processedPaymentEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  type: z.string().min(1),
  objectId: z.string().min(1),
  processedAt: z.string().datetime(),
});

export type ProcessedPaymentEvent = z.infer<typeof processedPaymentEventSchema>;
