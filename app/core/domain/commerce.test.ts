import { describe, expect, it } from 'vitest';

import {
  SUBSCRIPTION_GRACE_DAYS,
  exportOrdersQuerySchema,
  graceExpiresAt,
  listOrdersQuerySchema,
  newProductPriceSchema,
  nextPeriodEnd,
  productPriceSchema,
} from './commerce.js';

describe('graceExpiresAt', () => {
  it('adds exactly the grace window to the period end', () => {
    expect(graceExpiresAt('2026-08-14T10:00:00.000Z')).toBe('2026-08-17T10:00:00.000Z');
    expect(SUBSCRIPTION_GRACE_DAYS).toBe(3);
  });

  it('crosses a month boundary correctly', () => {
    expect(graceExpiresAt('2026-01-30T00:00:00.000Z')).toBe('2026-02-02T00:00:00.000Z');
  });
});

describe('nextPeriodEnd', () => {
  it('advances one month', () => {
    expect(nextPeriodEnd('2026-07-14T10:00:00.000Z', 'month')).toBe('2026-08-14T10:00:00.000Z');
  });

  it('advances one year across a leap boundary', () => {
    expect(nextPeriodEnd('2026-02-28T00:00:00.000Z', 'year')).toBe('2027-02-28T00:00:00.000Z');
  });

  it('rolls a month-end that overflows the next month into the following month (JS Date semantics)', () => {
    expect(nextPeriodEnd('2026-01-31T00:00:00.000Z', 'month')).toBe('2026-03-03T00:00:00.000Z');
  });
});

describe('price interval / kind refinement', () => {
  const base = { productId: 'p1', amountCents: 1000, currency: 'PLN' as const };

  it('requires an interval for a recurring price', () => {
    expect(newProductPriceSchema.safeParse({ ...base, kind: 'recurring' }).success).toBe(false);
    expect(newProductPriceSchema.safeParse({ ...base, kind: 'recurring', interval: 'month' }).success).toBe(true);
  });

  it('forbids an interval on a one-time price', () => {
    expect(newProductPriceSchema.safeParse({ ...base, kind: 'one_time', interval: 'month' }).success).toBe(false);
    expect(newProductPriceSchema.safeParse({ ...base, kind: 'one_time' }).success).toBe(true);
  });

  it('defaults currency to PLN and rejects negative or fractional cents', () => {
    const parsed = newProductPriceSchema.parse({ productId: 'p1', kind: 'one_time', amountCents: 0 });
    expect(parsed.currency).toBe('PLN');
    expect(newProductPriceSchema.safeParse({ ...base, kind: 'one_time', amountCents: -1 }).success).toBe(false);
    expect(newProductPriceSchema.safeParse({ ...base, kind: 'one_time', amountCents: 10.5 }).success).toBe(false);
  });

  it('enforces the same rule on the stored productPriceSchema (recurring needs interval)', () => {
    const stored = {
      id: 'price-1',
      tenantId: 't1',
      productId: 'p1',
      kind: 'recurring' as const,
      interval: null,
      amountCents: 2900,
      currency: 'PLN' as const,
      active: true,
      createdAt: '2026-07-14T10:00:00.000Z',
    };
    expect(productPriceSchema.safeParse(stored).success).toBe(false);
    expect(productPriceSchema.safeParse({ ...stored, interval: 'month' }).success).toBe(true);
  });
});

describe('order list / export queries', () => {
  it('applies page and pageSize defaults and coerces numeric strings', () => {
    expect(listOrdersQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(listOrdersQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({ page: 3, pageSize: 50 });
  });

  it('caps pageSize at 100 and rejects a blank search', () => {
    expect(listOrdersQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(listOrdersQuerySchema.safeParse({ search: '   ' }).success).toBe(false);
  });

  it('requires an export format and drops pagination', () => {
    expect(exportOrdersQuerySchema.safeParse({ status: 'paid' }).success).toBe(false);
    const parsed = exportOrdersQuerySchema.parse({ format: 'csv', status: 'paid' });
    expect(parsed).toMatchObject({ format: 'csv', status: 'paid' });
    expect('page' in parsed).toBe(false);
  });
});
