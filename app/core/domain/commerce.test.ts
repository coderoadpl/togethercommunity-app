import { describe, expect, it } from 'vitest';

import {
  SUBSCRIPTION_GRACE_DAYS,
  allocateOrderLineGross,
  billingDataSchema,
  checkoutSnapshotSchema,
  orderBillingDataSchema,
  orderLineLabel,
  orderLineQuantity,
  orderLineSchema,
  orderSchema,
  orderListItemSchema,
  exportOrdersQuerySchema,
  issueOrderLineInputSchema,
  graceExpiresAt,
  listOrdersQuerySchema,
  newProductPriceSchema,
  nextPeriodEnd,
  productPriceSchema,
} from './commerce.js';

describe('allocateOrderLineGross', () => {
  it.each([
    [[4900, 5400], 5149, [2450, 2699]],
    [[1, 1, 1], 2, [1, 0, 1]],
    [[101, 202, 303], 100, [17, 33, 50]],
  ])('allocates uneven splits %j to %i cents', (grossAmounts, amountCents, expected) => {
    const amounts = allocateOrderLineGross(grossAmounts.map((grossCents) => ({ grossCents })), amountCents);
    expect(amounts).toEqual(expected);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(amountCents);
  });

  it('returns zeros for a zero total', () => {
    expect(allocateOrderLineGross([{ grossCents: 0 }, { grossCents: 0 }], 100)).toEqual([0, 0]);
    expect(allocateOrderLineGross([], 100)).toEqual([]);
  });
});

describe('order line quantity', () => {
  const line = { productId: 'p1', name: 'Poster', productType: 'physical', grossCents: 9000, netCents: 7317, vatCents: 1683, vatRate: 23, vatExemptionBasis: null, issuedCount: 0 } as const;

  it('reads a stored line without a quantity as one unit', () => {
    const parsed = orderLineSchema.parse(line);
    expect(parsed).not.toHaveProperty('quantity');
    expect(orderLineQuantity(parsed)).toBe(1);
  });

  it('keeps a positive integer quantity on order and checkout snapshot lines', () => {
    expect(orderLineQuantity(orderLineSchema.parse({ ...line, quantity: 3 }))).toBe(3);
    expect(checkoutSnapshotSchema.parse({
      id: 'snapshot-1', tenantId: 'tenant-1', salesLinkId: null, currency: 'PLN', createdAt: '2026-11-15T10:00:00.000Z',
      lines: [{ ...line, quantity: 3 }],
    }).lines[0]?.quantity).toBe(3);
  });

  it.each([0, -1, 1.5])('rejects quantity %s', (quantity) => {
    expect(orderLineSchema.safeParse({ ...line, quantity }).success).toBe(false);
  });

  it('names the units only above one', () => {
    expect(orderLineLabel({ name: 'Poster' })).toBe('Poster');
    expect(orderLineLabel({ name: 'Poster', quantity: 1 })).toBe('Poster');
    expect(orderLineLabel({ name: 'Poster', quantity: 2 })).toBe('2 × Poster');
  });

  it('always carries the quantity on order list item lines', () => {
    const item = orderListItemSchema.parse({
      id: 'order-1', tenantId: 'tenant-1', memberId: 'member-1', productId: 'p1', priceId: null, kind: 'one_time', status: 'paid',
      amountCents: 9000, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0,
      createdAt: '2026-11-15T10:00:00.000Z', memberEmail: 'buyer@example.org', memberName: null, productTitle: 'Poster', couponCode: null,
      lines: [line, { ...line, productId: 'p2', quantity: 3 }],
    });
    expect(item.lines?.map((entry) => entry.quantity)).toEqual([1, 3]);
    expect(orderListItemSchema.safeParse({ ...item, lines: [{ ...line, quantity: 0 }] }).success).toBe(false);
  });

  it('defaults an issue to one unit and accepts only a positive integer count', () => {
    expect(issueOrderLineInputSchema.parse({ orderId: 'order-1', productId: 'p1' })).toEqual({ orderId: 'order-1', productId: 'p1', count: 1 });
    expect(issueOrderLineInputSchema.parse({ orderId: 'order-1', productId: 'p1', count: 2 }).count).toBe(2);
    for (const count of [0, -1, 1.5, '2']) expect(issueOrderLineInputSchema.safeParse({ orderId: 'order-1', productId: 'p1', count }).success).toBe(false);
  });
});

describe('billingDataSchema', () => {
  it.each([
    ['5555555555', true],
    ['8567346215', true],
    ['1234567890', false],
    ['5261040829', false],
    ['526-104-08-28', false],
    ['123456789', false],
    ['12345678901', false],
    ['', false],
  ])('validates Polish NIP %s', (nip, valid) => {
    const result = billingDataSchema.safeParse({
      nip,
      companyName: 'Acme sp. z o.o.',
      address: 'Prosta 1',
      postalCode: '00-001',
      city: 'Warszawa',
      country: 'PL',
    });
    expect(result.success).toBe(valid);
  });

  it('allows a B2C billing snapshot without NIP and defaults country to PL', () => {
    expect(
      billingDataSchema.parse({
        companyName: 'Jan Kowalski',
        address: 'Prosta 1',
        postalCode: '00-001',
        city: 'Warszawa',
      }),
    ).toEqual({
      nip: null,
      companyName: 'Jan Kowalski',
      address: 'Prosta 1',
      postalCode: '00-001',
      city: 'Warszawa',
      country: 'PL',
    });
  });

  it('rejects non-Polish billing addresses in the domestic-invoice flow', () => {
    expect(billingDataSchema.safeParse({
      companyName: 'Acme GmbH',
      address: 'Hauptstrasse 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
    }).success).toBe(false);
  });
});

describe('orderBillingDataSchema', () => {
  it('preserves a provider billing NIP without weakening checkout billing validation', () => {
    const billing = { nip: '5260250274', companyName: 'Example Company', address: '', postalCode: '00-001', city: '', country: 'PL' };
    expect(orderBillingDataSchema.parse(billing)).toEqual(billing);
    expect(billingDataSchema.safeParse(billing).success).toBe(false);
    expect(orderBillingDataSchema.parse({ ...billing, country: 'DE' }).country).toBe('DE');
    expect(orderBillingDataSchema.safeParse({ ...billing, nip: '1234567890' }).success).toBe(false);
  });
});

describe('graceExpiresAt', () => {
  it('adds exactly the grace window to the period end', () => {
    expect(graceExpiresAt('1998-08-14T10:00:00.000Z')).toBe('1998-08-17T10:00:00.000Z');
    expect(SUBSCRIPTION_GRACE_DAYS).toBe(3);
  });

  it('crosses a month boundary correctly', () => {
    expect(graceExpiresAt('1998-01-30T00:00:00.000Z')).toBe('1998-02-02T00:00:00.000Z');
  });
});

describe('nextPeriodEnd', () => {
  it.each([
    ['1998-12-31T10:15:30.000Z', 'day', 1, '1999-01-01T10:15:30.000Z'],
    ['2000-02-28T10:15:30.000Z', 'day', 2, '2000-03-01T10:15:30.000Z'],
    ['1998-12-28T10:15:30.000Z', 'week', 1, '1999-01-04T10:15:30.000Z'],
    ['1998-12-28T10:15:30.000Z', 'week', 2, '1999-01-11T10:15:30.000Z'],
    ['1998-11-14T10:15:30.000Z', 'month', 3, '1999-02-14T10:15:30.000Z'],
    ['1998-01-31T10:15:30.000Z', 'month', 3, '1998-05-01T10:15:30.000Z'],
    ['1998-02-28T10:15:30.000Z', 'year', 2, '2000-02-28T10:15:30.000Z'],
  ] as const)('advances %s by %s intervals with count %i to %s', (from, interval, count, expected) => {
    expect(nextPeriodEnd(from, interval, count)).toBe(expected);
  });

  it('advances one month', () => {
    expect(nextPeriodEnd('1998-07-14T10:00:00.000Z', 'month')).toBe('1998-08-14T10:00:00.000Z');
  });

  it('advances one year across a leap boundary', () => {
    expect(nextPeriodEnd('1998-02-28T00:00:00.000Z', 'year')).toBe('1999-02-28T00:00:00.000Z');
  });

  it('rolls a month-end that overflows the next month into the following month (JS Date semantics)', () => {
    expect(nextPeriodEnd('1998-01-31T00:00:00.000Z', 'month')).toBe('1998-03-03T00:00:00.000Z');
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
      createdAt: '1998-07-14T10:00:00.000Z',
    };
    expect(productPriceSchema.safeParse(stored).success).toBe(false);
    expect(productPriceSchema.safeParse({ ...stored, interval: 'month' }).success).toBe(true);
  });
});

describe('order list / export queries', () => {
  it('preserves exact source matching for lists and exports', () => {
    expect(listOrdersQuerySchema.parse({ source: 'none', sourceMatch: 'exact' })).toMatchObject({ source: 'none', sourceMatch: 'exact' });
    expect(exportOrdersQuerySchema.parse({ format: 'csv', source: 'none', sourceMatch: 'exact' })).toMatchObject({ source: 'none', sourceMatch: 'exact' });
    expect(listOrdersQuerySchema.safeParse({ source: 'none', sourceMatch: 'partial' }).success).toBe(false);
  });

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

describe('order payment timestamp schemas', () => {
  it.each([orderSchema, orderListItemSchema])('accepts an ISO payment timestamp and historical null or missing values', (schema) => {
    expect(schema.shape.paidAt.parse('2026-10-13T18:38:00.000Z')).toBe('2026-10-13T18:38:00.000Z');
    expect(schema.shape.paidAt.parse(null)).toBeNull();
    expect(schema.shape.paidAt.parse(undefined)).toBeUndefined();
    expect(schema.shape.paidAt.safeParse('2026-10-13').success).toBe(false);
    expect(schema.shape.paidAt.safeParse('invalid').success).toBe(false);
  });
});
