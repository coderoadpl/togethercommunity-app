import { z } from 'zod';

import { currencySchema } from './product.js';

export const priceKindSchema = z.enum(['one_time', 'recurring']);

export type PriceKind = z.infer<typeof priceKindSchema>;

export const priceIntervalSchema = z.enum(['month', 'year']);

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
    createdAt: z.string().datetime(),
  })
  .superRefine(requireIntervalMatchesKind);

export type ProductPrice = z.infer<typeof productPriceSchema>;

export const newProductPriceSchema = z
  .object({
    productId: z.string().min(1),
    kind: priceKindSchema,
    interval: priceIntervalSchema.optional(),
    amountCents: z
      .number()
      .int('Amount must be a whole number of cents')
      .nonnegative('Amount must not be negative'),
    currency: currencySchema.default('PLN'),
  })
  .superRefine(requireIntervalMatchesKind);

export type NewProductPrice = z.infer<typeof newProductPriceSchema>;
export type NewProductPriceInput = z.input<typeof newProductPriceSchema>;

export const orderStatusSchema = z.enum(['paid', 'pending', 'failed', 'refunded']);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderProviderSchema = z.enum(['stripe', 'simulated']);

export type OrderProvider = z.infer<typeof orderProviderSchema>;

export const orderSchema = z.object({
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
  createdAt: z.string().datetime(),
});

export type Order = z.infer<typeof orderSchema>;

export const orderListItemSchema = orderSchema.extend({
  memberEmail: z.string(),
  memberName: z.string().nullable(),
  productTitle: z.string(),
});

export type OrderListItem = z.infer<typeof orderListItemSchema>;

export const orderExportFormatSchema = z.enum(['csv', 'json']);

export type OrderExportFormat = z.infer<typeof orderExportFormatSchema>;

export const orderExportFileSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  content: z.string(),
});

export type OrderExportFile = z.infer<typeof orderExportFileSchema>;

export const listOrdersQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  productId: z.string().min(1).optional(),
  kind: priceKindSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const exportOrdersQuerySchema = listOrdersQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: orderExportFormatSchema });

export type ExportOrdersQueryInput = z.input<typeof exportOrdersQuerySchema>;

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
export type ListOrdersQueryInput = z.input<typeof listOrdersQuerySchema>;

export const subscriptionStatusSchema = z.enum(['active', 'past_due', 'canceled']);

export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const memberSubscriptionSchema = z.object({
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MemberSubscription = z.infer<typeof memberSubscriptionSchema>;

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

export const nextPeriodEnd = (from: string, interval: PriceInterval): string => {
  const date = new Date(from);
  if (interval === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
};
