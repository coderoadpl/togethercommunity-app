import { z } from 'zod';
import { checkoutAppearanceSchema } from './checkout-appearance.js';
import { provisionTenantInputSchema } from './operator-tenant.js';
import { stripeModeSchema } from './integration.js';
import { configureShipxInputSchema, shipxSenderSchema } from './shipx.js';
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

const shopManifestSettingsSchema = updateTenantSettingsInputSchema.pick({
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

export const SHOP_OPERATOR_SECRET_ENV = 'TOGETHER_SHOP_OPERATOR_SECRET';
const SHOP_ENVIRONMENT_NAME = /^SHOP_[A-Z0-9_]+$/;
const PUBLIC_ENVIRONMENT_NAME = /^SHOP_[A-Z0-9_]+_PUBLIC_TOKEN$/;
const PUBLIC_MARKER = /(^|_)PUBLIC(_|$)/;

const secretEnvironmentNameSchema = z.string()
  .regex(SHOP_ENVIRONMENT_NAME, 'Integration variables must be named SHOP_<NAME>')
  .refine((name) => !PUBLIC_MARKER.test(name), 'Secret integration variables must not carry the PUBLIC marker');
const publicEnvironmentNameSchema = z.string()
  .regex(PUBLIC_ENVIRONMENT_NAME, 'The parcel-locker token variable must be named SHOP_<NAME>_PUBLIC_TOKEN');

const shopManifestIntegrationsShape = z.object({
  stripe: z.object({ restrictedKeyEnv: secretEnvironmentNameSchema, mode: stripeModeSchema }).strict().nullable().optional(),
  shipx: z.object({
    environment: configureShipxInputSchema.shape.environment,
    sender: shipxSenderSchema.strict().nullable().optional(),
    organizationIdEnv: secretEnvironmentNameSchema.optional(),
    tokenEnv: secretEnvironmentNameSchema.optional(),
  }).strict().refine((value) => Object.values(value).some((field) => field !== undefined), 'ShipX settings must not be empty').nullable().optional(),
  parcelLocker: z.object({ tokenEnv: publicEnvironmentNameSchema }).strict().nullable().optional(),
}).strict();

export const integrationReferenceError = (integrations: z.output<typeof shopManifestIntegrationsShape>): string | null => {
  const secret = [integrations.stripe?.restrictedKeyEnv, integrations.shipx?.organizationIdEnv, integrations.shipx?.tokenEnv]
    .filter((name) => name !== undefined);
  const publicToken = integrations.parcelLocker?.tokenEnv;
  const references = publicToken === undefined ? secret : [...secret, publicToken];
  if (references.includes(SHOP_OPERATOR_SECRET_ENV)) return 'Integration variables must not reference the operator secret';
  if (secret.some((name) => !SHOP_ENVIRONMENT_NAME.test(name) || PUBLIC_MARKER.test(name))) {
    return 'Secret integration variables must be named SHOP_<NAME> without the PUBLIC marker';
  }
  if (publicToken !== undefined && !PUBLIC_ENVIRONMENT_NAME.test(publicToken)) {
    return 'The parcel-locker token variable must be named SHOP_<NAME>_PUBLIC_TOKEN';
  }
  if (new Set(references).size !== references.length) return 'Each integration variable may be referenced by one provider field only';
  return null;
};

const shopManifestIntegrationsSchema = shopManifestIntegrationsShape.superRefine((integrations, context) => {
  const message = integrationReferenceError(integrations);
  if (message !== null) context.addIssue({ code: z.ZodIssueCode.custom, message });
});

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
  integrations: shopManifestIntegrationsSchema.optional(),
  products: z.array(shopManifestProductSchema),
}).strict().refine((shop) => new Set(shop.products.map((product) => product.slug)).size === shop.products.length,
  'Product slugs must be unique within a shop');

export const shopManifestSchema = z.object({
  version: z.literal(1),
  company: z.object({ settings: shopManifestSettingsSchema.optional(), integrations: shopManifestIntegrationsSchema.optional() }).strict().optional(),
  shops: z.array(shopSchema).min(1),
}).strict().refine((manifest) => new Set(manifest.shops.map((shop) => manifestWorkspaceSlug(shop.workspace))).size === manifest.shops.length,
  'Shop workspaces must be unique');

export type ShopManifestProduct = z.output<typeof shopManifestProductSchema>;
export type ShopManifestSettings = z.output<typeof shopManifestSettingsSchema>;
export type ShopManifestIntegrations = z.output<typeof shopManifestIntegrationsSchema>;

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

export const effectiveShopIntegrations = (
  company: ShopManifestIntegrations = {}, shop: ShopManifestIntegrations = {},
): ShopManifestIntegrations => shopManifestIntegrationsShape.parse(mergeFields(company, shop));

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

const productMetadataSchema = shopManifestProductSchema.omit({
  slug: true, type: true, price: true, stock: true, published: true, coverUrl: true,
}).strip();

export const productMetadata = (product: ShopManifestProduct) => productMetadataSchema.parse(product);

export const productVatConvergenceError = (product: Pick<ShopManifestProduct, 'vatRate' | 'vatExemptionBasis'>): string | null => {
  if (product.vatExemptionBasis === undefined) return null;
  if (product.vatExemptionBasis === null) {
    return product.vatRate === undefined || product.vatRate === 'exempt'
      ? 'Product vatExemptionBasis null needs an explicit non-exempt vatRate; for an exempt product omit vatExemptionBasis to use the seller basis or set the basis'
      : null;
  }
  return product.vatRate === 'exempt' ? null : 'Product vatExemptionBasis requires vatRate "exempt"';
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
