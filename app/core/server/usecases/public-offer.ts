import {
  EMPTY_LEGAL_URLS,
  EMPTY_TENANT_BRANDING,
  ok,
  type AppError,
  type LegalUrls,
  type PriceInterval,
  type PriceKind,
  type Product,
  type ProductPrice,
  type Result,
  type Tenant,
  type TenantBranding,
} from '@core/domain/index.js';

import type { ProductPriceRepository, ProductRepository, TenantRepository } from '../ports.js';

export interface PublicOffer {
  tenant: {
    slug: string;
    name: string;
    branding: TenantBranding;
    legal: LegalUrls;
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
  tenants: TenantRepository;
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
  const settings = await deps.tenants.findSettings(tenant.id);
  return ok({
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      branding:
        settings === null
          ? EMPTY_TENANT_BRANDING
          : { logoUrl: settings.logoUrl, accentColor: settings.accentColor, faviconUrl: settings.faviconUrl },
      legal:
        settings === null
          ? EMPTY_LEGAL_URLS
          : { termsUrl: settings.termsUrl, privacyUrl: settings.privacyUrl },
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
