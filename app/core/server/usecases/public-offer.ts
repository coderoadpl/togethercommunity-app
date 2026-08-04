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
  type ProductType,
  type Result,
  type Tenant,
  type TenantBranding,
  type TenantSocialLink,
  type TenantSupportPublic,
} from '#core/domain/index.js';

import type {
  ConsentDefinitionRepository,
  CourseLessonPreview,
  CourseLessonRepository,
  ProductPriceRepository,
  ProductRepository,
  TenantDocumentRepository,
  TenantRepository,
} from '../ports.js';

export interface PublicOffer {
  tenant: {
    slug: string;
    name: string;
    branding: TenantBranding;
    socialLinks: TenantSocialLink[];
    legal: LegalUrls;
    support: TenantSupportPublic;
  };
  contentVersion: number;
  previewLessons: CourseLessonPreview[];
  products: PublicOfferProduct[];
}

interface PublicOfferPrice {
  id: string;
  kind: PriceKind;
  interval: PriceInterval | null;
  amountCents: number;
  currency: string;
}

interface PublicOfferProduct {
  id: string;
  type: ProductType;
  slug: string;
  title: string;
  description: string;
  coverUrl: string | null;
  priceCents: number;
  currency: string;
  prices: PublicOfferPrice[];
  marketingConsents: Array<{
    definitionId: string;
    label: string;
    doubleOptIn: boolean;
    documentUrl: string | null;
  }>;
}

export interface PublicOfferDeps {
  lessons: Pick<CourseLessonRepository, 'listPreviews'>;
  products: ProductRepository;
  prices: ProductPriceRepository;
  tenants: TenantRepository;
  definitions?: ConsentDefinitionRepository | undefined;
  documents?: Pick<TenantDocumentRepository, 'findPublishedVersionById'> | undefined;
}

export const getPublicOffer = async (
  tenant: Tenant,
  deps: PublicOfferDeps,
): Promise<Result<PublicOffer, AppError>> => {
  const [products, lessons] = await Promise.all([
    deps.products.listPublishedByTenant(tenant.id),
    deps.lessons.listPreviews(tenant.id),
  ]);
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
      socialLinks: settings?.socialLinks ?? [],
      legal:
        settings === null
          ? EMPTY_LEGAL_URLS
          : { termsUrl: settings.termsUrl, privacyUrl: settings.privacyUrl },
      support: { url: settings?.supportUrl ?? null },
    },
    contentVersion: tenant.contentVersion,
    previewLessons: lessons,
    products: await Promise.all(products.map(async (product) => ({
      ...toPublicProduct(product, pricesByProduct.get(product.id) ?? []),
      marketingConsents: await checkoutConsents(tenant.id, product, deps.definitions, deps.documents),
    }))),
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
  type: product.type,
  slug: product.slug,
  title: product.title,
  description: product.description,
  coverUrl: product.coverUrl,
  priceCents: product.priceCents,
  currency: product.currency,
  prices,
  marketingConsents: [],
});

const checkoutConsents = async (
  tenantId: string,
  product: Product,
  definitions: ConsentDefinitionRepository | undefined,
  documents: Pick<TenantDocumentRepository, 'findPublishedVersionById'> | undefined,
): Promise<PublicOfferProduct['marketingConsents']> => {
  if (definitions === undefined) return [];
  const attached = product.checkoutConsentDefinitionIds ?? [];
  const result: PublicOfferProduct['marketingConsents'] = [];
  for (const definitionId of attached) {
    const definition = await definitions.findById(tenantId, definitionId);
    if (definition === null || definition.status !== 'active' || definition.kind !== 'optional_marketing') continue;
    const version = (await definitions.listVersions(tenantId, definition.id)).at(-1);
    if (version === undefined) continue;
    const hosted = version.documentVersionRef.mode === 'hosted'
      ? await documents?.findPublishedVersionById(tenantId, version.documentVersionRef.documentVersionId)
      : null;
    result.push({
      definitionId: definition.id,
      label: version.label,
      doubleOptIn: definition.doubleOptIn,
      documentUrl: version.documentVersionRef.mode === 'url'
        ? version.documentVersionRef.url
        : hosted === null || hosted === undefined
          ? null
          : `/legal/${encodeURIComponent(hosted.document.slug)}/v/${String(hosted.version.version)}`,
    });
  }
  return result;
};
