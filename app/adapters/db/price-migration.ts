import type { ProductPrice } from '@core/domain/index.js';

export interface LegacyPricedProduct {
  id: string;
  tenantId: string;
  priceCents: number;
  currency: string;
  createdAt: string;
}

/**
 * The row-level transform the `0019` data migration performs in SQL (every
 * product's single `priceCents` becomes one active one-time price), expressed
 * once in TypeScript so its shape is unit-tested against the domain schema.
 */
export const legacyPriceToProductPrice = (product: LegacyPricedProduct): ProductPrice => ({
  id: `price-${product.id}`,
  tenantId: product.tenantId,
  productId: product.id,
  kind: 'one_time',
  interval: null,
  amountCents: product.priceCents,
  currency: product.currency,
  active: true,
  createdAt: product.createdAt,
});
