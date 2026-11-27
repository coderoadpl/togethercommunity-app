import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { exportOrdersQuerySchema, listOrdersQuerySchema } from './commerce.js';

// A frozen copy of the order list query as the previous release parses it; never update it to follow the live schema.
const previousReleaseListOrdersQuerySchema = z.object({
  source: z.string().trim().min(1).max(200).optional(),
  sourceMatch: z.literal('exact').optional(),
  mode: z.enum(['test', 'live']).optional(),
  status: z.enum(['paid', 'pending', 'failed', 'refunded', 'partially_refunded']).optional(),
  productId: z.string().min(1).optional(),
  kind: z.enum(['one_time', 'recurring']).optional(),
  couponId: z.string().min(1).optional(),
  fulfilmentStatus: z.enum(['to_pack', 'shipped']).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const query = { status: 'paid', invoice: 'without', billing: 'company', sortBy: 'amountCents', sortDirection: 'asc', page: '2' };

describe('order list query across releases', () => {
  it('lets the previous release parse a query with the new parameters and ignore them', () => {
    expect(previousReleaseListOrdersQuerySchema.parse(query)).toEqual({ status: 'paid', page: 2, pageSize: 20 });
  });

  it('keeps the new parameters in the current release', () => {
    expect(listOrdersQuerySchema.parse(query)).toEqual({
      status: 'paid', invoice: 'without', billing: 'company', sortBy: 'amountCents', sortDirection: 'asc', page: 2, pageSize: 20,
    });
    expect(exportOrdersQuerySchema.parse({ ...query, format: 'csv' })).toEqual({
      status: 'paid', invoice: 'without', billing: 'company', sortBy: 'amountCents', sortDirection: 'asc', format: 'csv',
    });
  });

  it('accepts every invoice and billing value and leaves the sort optional', () => {
    for (const invoice of ['with', 'without']) expect(listOrdersQuerySchema.safeParse({ invoice }).success).toBe(true);
    for (const billing of ['requested', 'company', 'private', 'none']) expect(listOrdersQuerySchema.safeParse({ billing }).success).toBe(true);
    expect(listOrdersQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });
});
