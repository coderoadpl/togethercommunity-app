import { ok, type AppError, type Product, type Result, type Tenant } from '@core/domain/index.js';

import type { ProductRepository } from '../ports.js';

export interface PublicOffer {
  tenant: {
    slug: string;
    name: string;
  };
  contentVersion: number;
  products: PublicOfferProduct[];
}

export interface PublicOfferProduct {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
}

export interface PublicOfferDeps {
  products: ProductRepository;
}

export const getPublicOffer = async (
  tenant: Tenant,
  deps: PublicOfferDeps,
): Promise<Result<PublicOffer, AppError>> => {
  const products = await deps.products.listPublishedByTenant(tenant.id);
  return ok({
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
    },
    contentVersion: tenant.contentVersion,
    products: products.map(toPublicProduct),
  });
};

const toPublicProduct = (product: Product): PublicOfferProduct => ({
  id: product.id,
  title: product.title,
  description: product.description,
  priceCents: product.priceCents,
  currency: product.currency,
});
