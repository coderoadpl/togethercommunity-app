import { z } from 'zod';

import { stripeModeSchema } from './integration.js';

import { currencySchema, productTypeSchema } from './product.js';
import { productVatRateSchema } from './product-vat.js';

export const priceKindSchema = z.enum(['one_time', 'recurring']);

export type PriceKind = z.infer<typeof priceKindSchema>;

export const priceIntervalSchema = z.enum(['day', 'week', 'month', 'year']);

export type PriceInterval = z.infer<typeof priceIntervalSchema>;

const requireIntervalMatchesKind = (
  price: { kind: PriceKind; interval?: PriceInterval | null | undefined },
  ctx: z.RefinementCtx,
): void => {
  if (price.kind === 'recurring' && (price.interval === null || price.interval === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['interval'],
      message: 'A recurring price requires an interval (month or year)',
    });
  }
  if (price.kind === 'one_time' && price.interval != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['interval'],
      message: 'A one-time price must not have an interval',
    });
  }
};

export const productPriceSchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    productId: z.string(),
    kind: priceKindSchema,
    interval: priceIntervalSchema.nullable(),
    amountCents: z.number().int().nonnegative(),
    currency: currencySchema,
    active: z.boolean(),
    providerPriceId: z.string().nullable().optional(),
    imported: z.boolean().optional(),
    intervalCount: z.number().int().positive().optional(),
    createdAt: z.string().datetime(),
  })
  .superRefine(requireIntervalMatchesKind);

export type ProductPrice = z.infer<typeof productPriceSchema>;

export const newProductPriceSchema = z
  .object({
    productId: z.string().min(1),
    kind: priceKindSchema,
    interval: z.enum(['month', 'year']).optional(),
    amountCents: z
      .number()
      .int('Amount must be a whole number of cents')
      .nonnegative('Amount must not be negative'),
    currency: currencySchema.default('PLN'),
  })
  .superRefine(requireIntervalMatchesKind);

export type NewProductPriceInput = z.input<typeof newProductPriceSchema>;

const orderStatusSchema = z.enum(['paid', 'pending', 'failed', 'refunded', 'partially_refunded']);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const ACCESS_RETAINING_ORDER_STATUSES: readonly OrderStatus[] = ['paid', 'partially_refunded'];

const orderProviderSchema = z.enum(['stripe', 'simulated']);

export type OrderProvider = z.infer<typeof orderProviderSchema>;

const hasValidNipChecksum = (nip: string): boolean => {
  if (!/^\d{10}$/.test(nip)) return false;
  const digits = [...nip].map(Number);
  const checksum = [6, 5, 7, 2, 3, 4, 5, 6, 7]
    .reduce((sum, weight, index) => sum + weight * (digits[index] ?? 0), 0) % 11;
  return checksum !== 10 && checksum === digits[9];
};

export const nipSchema = z.string().refine(hasValidNipChecksum, 'NIP must contain 10 digits and a valid checksum');

export const billingDataSchema = z.object({
  nip: nipSchema.nullable().default(null),
  companyName: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  postalCode: z.string().trim().min(1).max(30),
  city: z.string().trim().min(1).max(120),
  country: z.preprocess(
    (value) => value ?? 'PL',
    z.string().trim().transform((value) => value.toUpperCase()).refine(
      (value): boolean => value === 'PL',
      'Only Polish billing addresses are supported',
    ),
  ),
});

export type BillingData = z.output<typeof billingDataSchema>;

export const orderLineSchema = z.object({
  priceId: z.string().min(1).optional(),
  productId: z.string().min(1),
  name: z.string().min(1),
  productType: productTypeSchema,
  grossCents: z.number().int().nonnegative(),
  netCents: z.number().int().nonnegative(),
  vatRate: productVatRateSchema.nullable(),
  vatCents: z.number().int().nonnegative(),
  vatExemptionBasis: z.string().nullable(),
  vatExemptionBasisKind: z.enum(['art_113_1', 'art_113_9', 'art_43_1', 'other_statute', 'other']).nullable().optional(),
  issuedCount: z.number().int().nonnegative().nullable(),
  issuedAt: z.string().datetime().optional(),
  issuedBy: z.string().min(1).optional(),
});

export type OrderLine = z.infer<typeof orderLineSchema>;

export const checkoutSnapshotSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  salesLinkId: z.string().nullable(),
  lines: z.array(orderLineSchema).min(1),
  currency: currencySchema,
  createdAt: z.string().datetime(),
});

export type CheckoutSnapshot = z.infer<typeof checkoutSnapshotSchema>;

export const orderSchema = z.object({
  mode: stripeModeSchema.default('live'),
  id: z.string(),
  tenantId: z.string(),
  memberId: z.string(),
  productId: z.string(),
  priceId: z.string().nullable(),
  kind: priceKindSchema,
  status: orderStatusSchema,
  amountCents: z.number().int().nonnegative(),
  currency: currencySchema,
  provider: orderProviderSchema,
  providerObjectIds: z.record(z.string()),
  couponId: z.string().nullable(),
  discountCents: z.number().int().nonnegative(),
  billing: billingDataSchema.nullable().optional(),
  salesLinkId: z.string().nullable().optional(),
  lines: z.array(orderLineSchema).optional(),
  verificationToken: z.string().regex(/^[A-Za-z0-9_-]{22,}$/).optional(),
  createdAt: z.string().datetime(),
});

export type Order = z.infer<typeof orderSchema>;

export const orderListItemSchema = orderSchema.extend({
  lines: z.array(orderLineSchema.extend({ issuedByDisplayName: z.string().min(1).optional() })).optional(),
  salesLinkTitle: z.string().optional(),
  memberEmail: z.string(),
  memberName: z.string().nullable(),
  productTitle: z.string(),
  couponCode: z.string().nullable(),
});

export type OrderListItem = z.infer<typeof orderListItemSchema>;

export const orderVerificationReferenceSchema = z.string().trim().min(1).max(256);
export const issueOrderLineInputSchema = z.object({ orderId: z.string().min(1), productId: z.string().min(1) }).strict();

const orderExportFormatSchema = z.enum(['csv', 'json']);

export type OrderExportFormat = z.infer<typeof orderExportFormatSchema>;

export const orderExportFileSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  content: z.string(),
});

export type OrderExportFile = z.infer<typeof orderExportFileSchema>;

export const listOrdersQuerySchema = z.object({
  mode: stripeModeSchema.optional(),
  status: orderStatusSchema.optional(),
  productId: z.string().min(1).optional(),
  kind: priceKindSchema.optional(),
  couponId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const exportOrdersQuerySchema = listOrdersQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: orderExportFormatSchema });

export const paidWithoutGrantRowSchema = z.object({
  orderId: z.string(),
  createdAt: z.string().datetime(),
  memberId: z.string(),
  memberEmail: z.string(),
  productId: z.string(),
  productTitle: z.string(),
  kind: priceKindSchema,
  provider: orderProviderSchema,
  amountCents: z.number().int().nonnegative(),
  currency: currencySchema,
  providerObjectIds: z.record(z.string()),
});

export type PaidWithoutGrantRow = z.infer<typeof paidWithoutGrantRowSchema>;

export const orderReconciliationQuerySchema = z.object({
  minAgeMinutes: z.coerce.number().int().min(0).max(1440).default(15),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const subscriptionStatusSchema = z.enum(['active', 'past_due', 'canceled']);

export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const memberSubscriptionSchema = z.object({
  mode: stripeModeSchema.default('live'),
  id: z.string(),
  tenantId: z.string(),
  memberId: z.string(),
  productId: z.string(),
  priceId: z.string(),
  provider: orderProviderSchema,
  providerSubscriptionId: z.string().nullable(),
  status: subscriptionStatusSchema,
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  couponId: z.string().nullable(),
  couponDiscountCents: z.number().int().nonnegative(),
  couponRecurringDuration: z.enum(['first_invoice', 'forever']).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MemberSubscription = z.infer<typeof memberSubscriptionSchema>;

export const memberSubscriptionListItemSchema = memberSubscriptionSchema.extend({
  productTitle: z.string(),
});

export type MemberSubscriptionListItem = z.infer<typeof memberSubscriptionListItemSchema>;

export const memberSubscriptionSummarySchema = z.object({
  id: z.string(),
  status: subscriptionStatusSchema,
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
});

export type MemberSubscriptionSummary = z.infer<typeof memberSubscriptionSummarySchema>;

export const salesSummarySchema = z.object({
  revenueLast30Days: z.array(
    z.object({
      currency: currencySchema,
      amountCents: z.number().int().nonnegative(),
    }),
  ),
  ordersLast30Days: z.number().int().nonnegative(),
  activeSubscriptions: z.number().int().nonnegative(),
});

export type SalesSummary = z.infer<typeof salesSummarySchema>;

/** Retry window: a paid period keeps access this many days past its end. */
export const SUBSCRIPTION_GRACE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export const graceExpiresAt = (currentPeriodEnd: string): string =>
  new Date(Date.parse(currentPeriodEnd) + SUBSCRIPTION_GRACE_DAYS * DAY_MS).toISOString();

export const nextPeriodEnd = (from: string, interval: PriceInterval, count = 1): string => {
  const date = new Date(from);
  if (interval === 'day' || interval === 'week') date.setUTCDate(date.getUTCDate() + count * (interval === 'week' ? 7 : 1));
  else if (interval === 'month') date.setUTCMonth(date.getUTCMonth() + count);
  else date.setUTCFullYear(date.getUTCFullYear() + count);
  return date.toISOString();
};
