import { z } from 'zod';
import { salesLinkVariantSelectionSchema } from './sales-link-variants.js';
import { attributionSchema } from './attribution.js';

import { languageSchema } from './language.js';
import { billingDataSchema, type BillingData } from './commerce.js';
import { COUPON_CODE_MAX_LENGTH } from './coupon.js';
import { checkoutShippingInputSchema, type CollectedShipping } from './shipping.js';

export const checkoutSessionStatusInputSchema = z.object({
  session_id: z.string().regex(/^cs_(live|test)_[A-Za-z0-9]{1,200}$/),
  locale: languageSchema.optional(),
});

export const checkoutSessionInputSchema = z.object({
  attribution: attributionSchema,
  productId: z.string().min(1),
  salesLinkId: z.string().min(1).optional(),
  salesLinkSlug: z.string().min(1).optional(),
  variantSelections: z.array(salesLinkVariantSelectionSchema).max(50).default([]),
  priceId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  language: languageSchema.optional(),
  termsAccepted: z.boolean().optional(),
  marketingConsentDefinitionIds: z.array(z.string().min(1)).default([]),
  couponCode: z.string().trim().min(1).max(COUPON_CODE_MAX_LENGTH).optional(),
  billing: billingDataSchema.optional(),
  shipping: checkoutShippingInputSchema.optional(),
});

export type CheckoutSessionInput = z.input<typeof checkoutSessionInputSchema>;

export type CheckoutConsentCapture = {
  termsUrl?: string;
  privacyUrl?: string;
  termsAccepted: boolean;
  selectedDefinitionIds: string[];
  attachedDefinitionIds: string[];
  collectedAt: string;
  confirmationBaseUrl: string;
  ip?: string;
  userAgent?: string;
  billing?: BillingData;
};

const stripeNullableText = z.string().nullable().optional().transform((value) => value ?? null);

const stripeShippingDetailsSchema = z.object({
  name: stripeNullableText,
  address: z.object({
    line1: stripeNullableText,
    line2: stripeNullableText,
    postal_code: stripeNullableText,
    city: stripeNullableText,
    country: stripeNullableText,
    state: stripeNullableText,
  }),
}).nullable().optional();

const stripeCollectedInformationSchema = z.object({
  shipping_details: stripeShippingDetailsSchema,
}).nullable().optional();

const stripeShippingCostSchema = z.object({ amount_total: z.number().int() }).nullable().optional();

export const stripeCheckoutShippingSchema = z.object({
  collected_information: stripeCollectedInformationSchema,
  shipping_details: stripeShippingDetailsSchema,
  customer_details: z.object({ phone: stripeNullableText }).nullable().optional(),
  shipping_cost: stripeShippingCostSchema,
});

/**
 * Stripe API versions before 2025-03-31.basil put the delivery address in the
 * session's top-level `shipping_details`; tenant webhook endpoints are not
 * pinned to an API version, so both locations have to be read.
 */
export const collectedShippingFromStripe = (
  session: {
    collected_information?: z.output<typeof stripeCollectedInformationSchema>;
    shipping_details?: z.output<typeof stripeShippingDetailsSchema>;
  },
  phone: string | null,
): CollectedShipping | null => {
  const details = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
  return details === null ? null : {
    name: details.name,
    phone,
    address: {
      line1: details.address.line1,
      line2: details.address.line2,
      postalCode: details.address.postal_code,
      city: details.address.city,
      country: details.address.country,
      state: details.address.state,
    },
  };
};

export const stripeWebhookPayloadSchema = z.object({
  livemode: z.boolean().optional(),
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      customer_email: z.string().email().nullable().optional(),
      customer_details: z.object({ email: z.string().email().nullable(), phone: stripeNullableText }).nullable().optional(),
      collected_information: stripeCollectedInformationSchema,
      shipping_details: stripeShippingDetailsSchema,
      shipping_cost: stripeShippingCostSchema,
      metadata: z.record(z.string()).nullable().optional(),
      subscription: z.string().nullable().optional(),
      invoice: z.string().nullable().optional(),
      payment_intent: z.string().nullable().optional(),
      charge: z.string().nullable().optional(),
      amount_total: z.number().int().nullable().optional(),
      amount: z.number().int().nullable().optional(),
      amount_refunded: z.number().int().nullable().optional(),
      refunded: z.boolean().nullable().optional(),
      payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']).nullable().optional(),
      total_details: z
        .object({ amount_discount: z.number().int().nullable().optional() })
        .nullable()
        .optional(),
      currency: z.string().nullable().optional(),
      period_end: z.number().nullable().optional(),
      cancel_at_period_end: z.boolean().optional(),
      current_period_end: z.number().nullable().optional(),
      ended_at: z.number().nullable().optional(),
      status: z.string().optional(),
    }),
  }),
  created: z.number().int().nullable().optional(),
});

const stripeTenantMetadataSchema = z.object({
  metadata: z.object({ tenantId: z.string().nullish() }).nullish(),
});

export const stripeWebhookOwnershipSchema = stripeTenantMetadataSchema.extend({
  customer: z.union([z.string(), stripeTenantMetadataSchema.extend({ id: z.string().optional() })]).nullish(),
  subscription: z.union([z.string(), stripeTenantMetadataSchema]).nullish(),
  subscription_details: stripeTenantMetadataSchema.nullish(),
  parent: z.object({ subscription_details: stripeTenantMetadataSchema.nullish() }).nullish(),
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
  payments: z.object({
    data: z.array(z.object({
      status: z.string(),
      created: z.number().optional(),
      payment: z.object({
        charge: z.unknown().optional(),
        payment_intent: z.unknown().optional(),
      }),
    })),
  }).nullable().optional(),
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
  refunded: z.boolean().optional(),
  amount: z.number().int().optional(),
  amount_refunded: z.number().int().optional(),
});

export const refundCoverage = (input: {
  refunded?: boolean | null;
  amount?: number | null;
  amountRefunded?: number | null;
}): { full: boolean; amountRefundedCents: number | null; amountCents: number | null } => {
  const amountCents = input.amount ?? null;
  const amountRefundedCents = input.amountRefunded ?? null;
  const full =
    input.refunded === true ||
    amountCents === null ||
    amountRefundedCents === null ||
    amountRefundedCents >= amountCents;
  return { full, amountRefundedCents, amountCents };
};

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
  ended_at: z.number().nullable().optional(),
  items: z
    .object({
      data: z.array(z.object({ current_period_end: z.number().optional() })),
    })
    .optional(),
});

export const stripeCancelErrorSchema = z.object({
  code: z.string().optional(),
  statusCode: z.number().optional(),
  message: z.string().optional(),
});

export type ProcessedPaymentEvent = {
  id: string;
  tenantId: string;
  type: string;
  objectId: string;
  processedAt: string;
};
