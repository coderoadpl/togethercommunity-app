import { z } from 'zod';

import { consumerSalesQuerySchema } from '#core/domain/index.js';

export const consumerSalesRequestSchema = z.object({
  from: z.string(),
  to: z.string(),
  format: z.enum(['json', 'csv']).default('json'),
}).strict().superRefine((value, ctx) => {
  const parsed = consumerSalesQuerySchema.safeParse({ from: value.from, to: value.to });
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue(issue);
});

export { consumerSalesSummarySchema } from '#core/domain/index.js';
