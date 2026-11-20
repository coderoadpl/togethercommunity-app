import { describe, expect, it } from 'vitest';

import { productsCreateInputSchema, productsCreateOutputSchema, productsUpdateInputSchema } from './routes.js';

const product = {
  id: 'p1', tenantId: 't1', type: 'course', slug: 'workshop', title: 'Workshop', description: '', coverUrl: null,
  priceCents: 4900, currency: 'PLN', published: true, accessItems: [], legacyId: null, createdAt: '2026-11-01T10:00:00.000Z',
};

describe('product route sales channel', () => {
  it('defaults a created product to any, carries an explicit channel and leaves an update without it unchanged', () => {
    expect(productsCreateInputSchema.parse({ title: 'Workshop', priceCents: 4900 }).salesChannel).toBe('any');
    expect(productsCreateInputSchema.parse({ title: 'Workshop', priceCents: 4900, salesChannel: 'sales_links_only' }).salesChannel)
      .toBe('sales_links_only');
    expect(productsUpdateInputSchema.parse({ id: 'p1', title: 'Renamed' })).not.toHaveProperty('salesChannel');
    expect(productsUpdateInputSchema.parse({ id: 'p1', salesChannel: 'sales_links_only' }).salesChannel).toBe('sales_links_only');
  });

  it('refuses an unknown channel and returns the stored channel in the product output', () => {
    expect(productsCreateInputSchema.safeParse({ title: 'Workshop', priceCents: 4900, salesChannel: 'catalogue' }).success).toBe(false);
    expect(productsUpdateInputSchema.safeParse({ id: 'p1', salesChannel: 'catalogue' }).success).toBe(false);
    expect(productsCreateOutputSchema.parse({ product: { ...product, salesChannel: 'sales_links_only' } }).product.salesChannel)
      .toBe('sales_links_only');
    expect(productsCreateOutputSchema.parse({ product }).product.salesChannel).toBe('any');
  });
});
