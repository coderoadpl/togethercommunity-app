import {
  ok,
  type AppError,
  type PriceInterval,
  type PriceKind,
  type Product,
  type ProductPrice,
  type Result,
  type Tenant,
} from '@core/domain/index.js';

import type { ProductPriceRepository, ProductRepository } from '../ports.js';

export interface PublicOffer {
  tenant: {
    slug: string;
    name: string;
  };
  contentVersion: number;
  products: PublicOfferProduct[];
}

export interface PublicOfferPrice {
  id: string;
  kind: PriceKind;
  interval: PriceInterval | null;
  amountCents: number;
  currency: string;
}

export interface PublicOfferProduct {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  prices: PublicOfferPrice[];
}

export interface PublicOfferDeps {
  products: ProductRepository;
  prices: ProductPriceRepository;
}

export const getPublicOffer = async (
  tenant: Tenant,
  deps: PublicOfferDeps,
): Promise<Result<PublicOffer, AppError>> => {
  const products = await deps.products.listPublishedByTenant(tenant.id);
  const activePrices = await deps.prices.listActiveByProducts(
    tenant.id,
    products.map((product) => product.id),
  );
  const pricesByProduct = new Map<string, PublicOfferPrice[]>();
  for (const price of activePrices) {
    const bucket = pricesByProduct.get(price.productId) ?? [];
    bucket.push(toPublicPrice(price));
    pricesByProduct.set(price.productId, bucket);
  }
  return ok({
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
    },
    contentVersion: tenant.contentVersion,
    products: products.map((product) => toPublicProduct(product, pricesByProduct.get(product.id) ?? [])),
  });
};

const toPublicPrice = (price: ProductPrice): PublicOfferPrice => ({
  id: price.id,
  kind: price.kind,
  interval: price.interval,
  amountCents: price.amountCents,
  currency: price.currency,
});

const toPublicProduct = (product: Product, prices: PublicOfferPrice[]): PublicOfferProduct => ({
  id: product.id,
  title: product.title,
  description: product.description,
  priceCents: product.priceCents,
  currency: product.currency,
  prices,
});
