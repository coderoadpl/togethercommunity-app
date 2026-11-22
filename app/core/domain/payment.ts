import { z } from 'zod';
import { salesLinkVariantSelectionSchema } from './sales-link-variants.js';
import { attributionSchema } from './attribution.js';

import { languageSchema } from './language.js';
import { billingDataSchema, clientReferenceSchema, type BillingData } from './commerce.js';
import { COUPON_CODE_MAX_LENGTH } from './coupon.js';
import { checkoutShippingInputSchema, type CollectedShipping } from './shipping.js';
import { cartLinesSchema } from './checkout-cart.js';
import { checkoutReturnUrlSchema } from './checkout-return.js';
import { checkoutPersonalizationsSchema } from './personalization.js';
import { integrationNotConfigured, type AppError } from './errors.js';

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
  clientReference: clientReferenceSchema.optional(),
  returnUrl: checkoutReturnUrlSchema.optional(),
  cancelUrl: checkoutReturnUrlSchema.optional(),
  personalizations: checkoutPersonalizationsSchema.optional(),
  termsOnPage: z.literal(true).optional(),
});

export type CheckoutSessionInput = z.input<typeof checkoutSessionInputSchema>;

export const checkoutCartInputSchema = checkoutSessionInputSchema.omit({
  productId: true,
  priceId: true,
  salesLinkId: true,
  salesLinkSlug: true,
  variantSelections: true,
  personalizations: true,
  termsOnPage: true,
}).extend({ lines: cartLinesSchema }).strict();

export type CheckoutCartInput = z.input<typeof checkoutCartInputSchema>;

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

const stripeShippingLocationSchema = z.object({
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

const stripeShippingCostSchema = z.object({ amount_total: z.number().int() }).nullable().optional();

const stripeTotalDetailsSchema = z.object({
  amount_discount: z.number().int().nullable().optional(),
  amount_shipping: z.number().int().nullable().optional(),
}).nullable().optional();

const parsedOrNull = <S extends z.ZodTypeAny>(schema: S, value: unknown): NonNullable<z.output<S>> | null => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data ?? null : null;
};

const stripeSessionFieldsSchema = z.record(z.unknown());
const stripeCollectedInformationSchema = z.object({ shipping_details: z.unknown() });
const stripePhoneSchema = z.object({ phone: stripeNullableText });
const stripeShippingAmountSchema = z.object({ amount_shipping: z.number().int().nullable().optional() });

/**
 * Tenant webhook endpoints registered before endpoints were pinned to the
 * library's API version follow the account default, so a Checkout Session can
 * carry its delivery in any of three places:
 * `collected_information.shipping_details` (2025-03-31.basil and later),
 * `shipping_details` (2022-08-01 to basil) or `shipping` (before 2022-08-01).
 * `shipping_cost` replaced the `shipping_rate` id in 2022-08-01;
 * `total_details.amount_shipping` is present in every version and stands in for
 * it once a delivery address was collected. The location, the phone and each
 * cost field are parsed on their own so one unexpected shape cannot drop the
 * others.
 */
export const checkoutShippingFromStripe = (
  session: unknown,
): { shipping: CollectedShipping | null; shippingCostCents: number | null } => {
  const fields = parsedOrNull(stripeSessionFieldsSchema, session) ?? {};
  const location = [
    parsedOrNull(stripeCollectedInformationSchema, fields['collected_information'])?.shipping_details,
    fields['shipping_details'],
    fields['shipping'],
  ].map((raw) => ({ raw, details: parsedOrNull(stripeShippingLocationSchema, raw) })).find((candidate) => candidate.details !== null);
  const shippingCostCents = parsedOrNull(stripeShippingCostSchema, fields['shipping_cost'])?.amount_total ?? null;
  if (location === undefined || location.details === null) return { shipping: null, shippingCostCents };
  const details = location.details;
  return {
    shipping: {
      name: details.name,
      phone: parsedOrNull(stripePhoneSchema, fields['customer_details'])?.phone ?? parsedOrNull(stripePhoneSchema, location.raw)?.phone ?? null,
      address: {
        line1: details.address.line1,
        line2: details.address.line2,
        postalCode: details.address.postal_code,
        city: details.address.city,
        country: details.address.country,
        state: details.address.state,
      },
    },
    shippingCostCents: shippingCostCents ?? parsedOrNull(stripeShippingAmountSchema, fields['total_details'])?.amount_shipping ?? null,
  };
};

export const stripeWebhookPayloadSchema = z.object({
  livemode: z.boolean().optional(),
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      collected_information: z.unknown().optional(),
      shipping_details: z.unknown().optional(),
      shipping: z.unknown().optional(),
      shipping_cost: z.unknown().optional(),
      customer_email: z.string().email().nullable().optional(),
      customer_details: z.object({ email: z.string().email().nullable(), phone: stripeNullableText }).nullable().optional(),
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
      total_details: stripeTotalDetailsSchema,
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

export const stripeRequestErrorSchema = z.object({
  rawType: z.string(),
  param: z.string().optional(),
  message: z.string(),
});

const STRIPE_TERMS_URL_MISSING = 'stripe_terms_url_missing';
export const CHECKOUT_TERMS_PARAM = 'terms';
export const CHECKOUT_TERMS_ON_PAGE = 'page';

const stripeTermsUrlMissingDetailsSchema = z.object({ paymentRefusal: z.literal(STRIPE_TERMS_URL_MISSING) });

export const stripeTermsUrlMissing = (): AppError => integrationNotConfigured(
  'Stripe needs a terms of service URL in its Dashboard public details before it can collect the terms',
  { paymentRefusal: STRIPE_TERMS_URL_MISSING },
);

export const isStripeTermsUrlMissing = (error: Pick<AppError, 'code' | 'details'>): boolean =>
  error.code === 'integration_not_configured' && stripeTermsUrlMissingDetailsSchema.safeParse(error.details).success;

export type ProcessedPaymentEvent = {
  id: string;
  tenantId: string;
  type: string;
  objectId: string;
  processedAt: string;
};
