import { z } from 'zod';
import { checkoutAppearanceSchema } from './checkout-appearance.js';
import { provisionTenantInputSchema } from './operator-tenant.js';
import type { ProductPrice } from './commerce.js';
import { newProductSchema, productSlugSchema, type Product } from './product.js';
import { shippingRateSchema, SHIPPING_RATES_MAX } from './shipping.js';
import { MAX_STOCK_QUANTITY, type ProductStock } from './stock.js';
import { SOCIAL_LINKS_MAX_COUNT, tenantSocialLinkSchema, updateTenantSettingsInputSchema } from './tenant.js';

const deliveryEstimateSchema = z.object({ min: z.number().int().positive(), max: z.number().int().positive() })
  .strict().refine((value) => value.min <= value.max, 'Minimum delivery days must not exceed maximum');
const manifestShippingRatesSchema = z.array(shippingRateSchema.extend({
  deliveryEstimateDays: deliveryEstimateSchema.optional(),
}).strict()).max(SHIPPING_RATES_MAX)
  .refine((rates) => new Set(rates.map((rate) => rate.id)).size === rates.length, 'Shipping rate ids must be unique');

export const shopManifestSettingsSchema = updateTenantSettingsInputSchema.pick({
  name: true, defaultLanguage: true, logoUrl: true, logoDarkUrl: true, faviconUrl: true,
  accentColor: true, accentLight: true, ogTitle: true, ogDescription: true, ogImageUrl: true,
  supportEmail: true, supportUrl: true, termsUrl: true, privacyUrl: true,
  invoiceSellerName: true, invoiceSellerAddress: true, invoiceVatMode: true,
  invoiceVatRatePercent: true, invoiceExemptionBasisKind: true, invoiceExemptionBasis: true,
  invoicingProvider: true, autoIssueInvoices: true, autoIssueInvoiceScope: true, ksefSubmissionMode: true,
  inpostGeowidgetToken: true,
}).extend({
  checkoutAppearance: checkoutAppearanceSchema.strict().nullable().optional(),
  socialLinks: z.array(tenantSocialLinkSchema.strict()).max(SOCIAL_LINKS_MAX_COUNT).optional(),
  shippingRates: manifestShippingRatesSchema.optional(),
}).strict();

export const shopManifestProductSchema = newProductSchema.omit({
  priceCents: true, currency: true, accessItems: true, visibility: true,
}).extend({
  type: z.literal('physical').default('physical'),
  slug: productSlugSchema,
  coverUrl: newProductSchema.shape.coverUrl.removeDefault().optional(),
  price: z.object({ amountCents: z.number().int().nonnegative(), currency: newProductSchema.shape.currency.removeDefault() }).strict(),
  stock: z.object({ onHand: z.number().int().min(0).max(MAX_STOCK_QUANTITY) }).strict().optional(),
  published: z.boolean(),
}).strict();

const workspaceSchema = z.union([
  productSlugSchema,
  z.object({
    slug: provisionTenantInputSchema.shape.slug,
    provision: provisionTenantInputSchema.omit({ slug: true }),
  }).strict(),
]);

export const manifestWorkspaceSlug = (workspace: z.output<typeof workspaceSchema>): string =>
  typeof workspace === 'string' ? workspace : workspace.slug;

const shopSchema = z.object({
  workspace: workspaceSchema,
  settings: shopManifestSettingsSchema.optional(),
  products: z.array(shopManifestProductSchema),
}).strict().refine((shop) => new Set(shop.products.map((product) => product.slug)).size === shop.products.length,
  'Product slugs must be unique within a shop');

export const shopManifestSchema = z.object({
  version: z.literal(1),
  company: z.object({ settings: shopManifestSettingsSchema }).strict().optional(),
  shops: z.array(shopSchema).min(1),
}).strict().refine((manifest) => new Set(manifest.shops.map((shop) => manifestWorkspaceSlug(shop.workspace))).size === manifest.shops.length,
  'Shop workspaces must be unique');

export type ShopManifest = z.output<typeof shopManifestSchema>;
export type ShopManifestProduct = z.output<typeof shopManifestProductSchema>;
export type ShopManifestSettings = z.output<typeof shopManifestSettingsSchema>;

const objectSchema = z.record(z.unknown());
const mergeFields = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const left = objectSchema.safeParse(merged[key]);
    const right = objectSchema.safeParse(value);
    merged[key] = left.success && right.success ? mergeFields(left.data, right.data) : value;
  }
  return merged;
};

export const effectiveShopSettings = (
  company: ShopManifestSettings = {}, shop: ShopManifestSettings = {},
): ShopManifestSettings => shopManifestSettingsSchema.parse(mergeFields(company, shop));

export const manifestValuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value: unknown, index: number) => manifestValuesEqual(value, right[index]));
  }
  const a = objectSchema.safeParse(left);
  const b = objectSchema.safeParse(right);
  if (!a.success || !b.success) return false;
  const keys = Object.keys(a.data).filter((key) => a.data[key] !== undefined);
  return keys.length === Object.keys(b.data).filter((key) => b.data[key] !== undefined).length &&
    keys.every((key) => manifestValuesEqual(a.data[key], b.data[key]));
};

export const diffShopSettings = (desired: ShopManifestSettings, current: Record<string, unknown>) => {
  const changed = Object.fromEntries(Object.entries(desired)
    .filter(([key, value]) => value !== undefined && !manifestValuesEqual(value, current[key])));
  return { changes: shopManifestSettingsSchema.parse(changed), unchanged: Object.keys(desired).filter((key) => !(key in changed)) };
};

export const productMetadata = (product: ShopManifestProduct) => {
  const { slug: _slug, type: _type, price: _price, stock: _stock, published: _published, coverUrl: _coverUrl, ...metadata } = product;
  return metadata;
};

export const diffManifestProduct = (
  desired: ShopManifestProduct,
  current: { product: Product; prices: ProductPrice[]; stock: ProductStock | null } | null,
) => {
  const fields = Object.entries(productMetadata(desired)).filter(([key, value]) => {
    const stored = current?.product;
    const record: Record<string, unknown> = stored ?? {};
    return value !== undefined && !manifestValuesEqual(value, record[key] ?? (key === 'parcelTemplate' ? 'medium' : null));
  }).map(([key]) => key);
  const active = current?.prices.filter((price) => price.active) ?? [];
  const matching = active.find((price) => price.kind === 'one_time' && !price.imported &&
    price.amountCents === desired.price.amountCents && price.currency === desired.price.currency);
  const deactivatePriceIds = active.filter((price) => price.id !== matching?.id).map((price) => price.id);
  return {
    slug: desired.slug,
    product: current === null ? 'create' as const : fields.length > 0 ? 'update' as const : 'unchanged' as const,
    fields,
    price: matching ? 'unchanged' as const : 'add' as const,
    deactivatePriceIds,
    stock: desired.stock === undefined ? 'unmanaged' as const : current?.stock?.onHand === desired.stock.onHand
      ? 'unchanged' as const : current?.stock ? 'adjust' as const : 'enable' as const,
    cover: desired.coverUrl === undefined ? 'unmanaged' as const : (current?.product.coverUrl ?? null) === desired.coverUrl
      ? 'unchanged' as const : 'update' as const,
    publication: (current?.product.published ?? false) === desired.published ? 'unchanged' as const : desired.published ? 'publish' as const : 'unpublish' as const,
  };
};
