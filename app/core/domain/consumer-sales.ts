import { z } from 'zod';

import { currencySchema } from './product.js';
import { productVatRateSchema } from './product-vat.js';
import { SALES_LINK_TIME_ZONE } from './sales-link.js';

const calendarDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  'Invalid calendar day',
);

export const consumerSalesQuerySchema = z.object({
  from: calendarDaySchema,
  to: calendarDaySchema,
}).strict().refine((value) => value.from <= value.to, 'Date range is reversed');

export type ConsumerSalesQuery = z.infer<typeof consumerSalesQuerySchema>;

const consumerSalesAmountsSchema = z.object({
  orderCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  netCents: z.number().int().nonnegative(),
  vatCents: z.number().int().nonnegative(),
  grossCents: z.number().int().nonnegative(),
});

const consumerSalesRateSchema = consumerSalesAmountsSchema.extend({ rate: productVatRateSchema });
export type ConsumerSalesRate = z.infer<typeof consumerSalesRateSchema>;

export const consumerSalesSummarySchema = z.object({
  from: calendarDaySchema,
  to: calendarDaySchema,
  timezone: z.literal(SALES_LINK_TIME_ZONE),
  currency: currencySchema,
  rates: z.array(consumerSalesRateSchema),
  totals: consumerSalesAmountsSchema,
  orderIds: z.array(z.string()),
  orders: z.array(z.object({
    id: z.string(),
    date: calendarDaySchema,
    grossCents: z.number().int().nonnegative(),
    rates: z.array(consumerSalesRateSchema),
  })),
});

export type ConsumerSalesSummary = z.infer<typeof consumerSalesSummarySchema>;
