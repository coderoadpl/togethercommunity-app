import { describe, expect, it } from 'vitest';

import { productPriceSchema } from '@core/domain/index.js';

import { legacyPriceToProductPrice } from './price-migration.js';

describe('legacyPriceToProductPrice', () => {
  it('turns the single priceCents into one active one-time price', () => {
    const price = legacyPriceToProductPrice({
      id: 'product-1',
      tenantId: 'tenant-1',
      priceCents: 19900,
      currency: 'PLN',
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    expect(price).toEqual({
      id: 'price-product-1',
      tenantId: 'tenant-1',
      productId: 'product-1',
      kind: 'one_time',
      interval: null,
      amountCents: 19900,
      currency: 'PLN',
      active: true,
      createdAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('produces rows that satisfy the domain price schema, including free products', () => {
    const free = legacyPriceToProductPrice({
      id: 'product-free',
      tenantId: 'tenant-1',
      priceCents: 0,
      currency: 'PLN',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    expect(() => productPriceSchema.parse(free)).not.toThrow();
  });
});
