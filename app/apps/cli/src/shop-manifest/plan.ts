import type { z } from 'zod';
import { isRedirectRefusal, type ApiClient } from '#core/client/index.js';
import {
  err, ok, validation,
  type AppError, type Product, type ProductPrice, type ProductStock, type ProvisionTenantInput, type Result, type StripeMode, type TenantSecretKey,
} from '#core/domain/index.js';
import {
  diffManifestProduct, diffShopSettings, effectiveShopIntegrations, effectiveShopSettings, integrationReferenceError, manifestWorkspaceSlug, productVatConvergenceError, shopManifestSchema,
  type ShopManifestIntegrations, type ShopManifestProduct, type ShopManifestSettings,
} from '#core/domain/shop-manifest.js';
import type { CredentialHolder } from './integrations.js';

export type ManifestReadClient = Pick<ApiClient, 'me' | 'getTenantSettings' | 'listProducts' | 'listProductPrices' | 'getProductStock' | 'listTenantSecrets'>;
export type ManifestClientFactory<C extends ManifestReadClient = ManifestReadClient> = (workspace: string) => C | null;
type CurrentManifestProduct = { product: Product; prices: ProductPrice[]; stock: ProductStock | null };
export type PreparedProduct = { desired: ShopManifestProduct; current: CurrentManifestProduct | null; diff: ReturnType<typeof diffManifestProduct> };
type WorkspaceAccess<C extends ManifestReadClient = ManifestReadClient> =
  | { state: 'ready'; api: C }
  | { state: 'provision'; input: ProvisionTenantInput }
  | { state: 'missing' };
export type PreparedShop<C extends ManifestReadClient = ManifestReadClient> = {
  workspace: string;
  access: WorkspaceAccess<C>;
  integrations: ShopManifestIntegrations;
  paymentConfigured: boolean;
  settings: ReturnType<typeof diffShopSettings>;
  products: PreparedProduct[];
};
export type ManifestReportOptions = { integrations?: boolean | undefined; reconfigurePayments?: boolean | undefined };

const STRIPE_SLOT_KEYS = {
  live: ['stripe.restrictedKey', 'stripe.webhookSecret', 'stripe.webhookEndpointId'],
  test: ['stripe.testRestrictedKey', 'stripe.testWebhookSecret', 'stripe.testWebhookEndpointId'],
} as const satisfies Record<StripeMode, readonly TenantSecretKey[]>;

export const paymentConfigurationDue = (shop: Pick<PreparedShop, 'paymentConfigured'>, options: ManifestReportOptions): boolean =>
  !shop.paymentConfigured || options.reconfigurePayments === true;

const FOREIGN_WORKSPACE_HOST_MESSAGE = 'The workspace host is not served by the instance of the API origin';

export const foreignWorkspaceHost = (): AppError => validation(FOREIGN_WORKSPACE_HOST_MESSAGE);

const operationFailureMessage = (error: AppError, operation: string): string => {
  if (isRedirectRefusal(error)) return `Shop operation refused a redirect: ${operation}`;
  if (error.code === 'validation' && error.message === FOREIGN_WORKSPACE_HOST_MESSAGE) {
    return `Shop operation refused a workspace host that the instance of the API origin does not serve: ${operation}`;
  }
  return `Shop operation failed: ${operation}`;
};

export const manifestOperationError = (error: AppError, workspace: string | null, operation: string): AppError => ({
  code: error.code,
  message: operationFailureMessage(error, operation),
  details: workspace === null ? { operation } : { workspace, operation },
});

const validateVatSettings = (desired: ShopManifestSettings, current: Record<string, unknown>): Result<true, AppError> => {
  const merged = { ...current, ...desired };
  if ((merged.invoiceVatMode === 'exempt' && desired.invoiceVatRatePercent != null) ||
    (merged.invoiceVatMode !== 'exempt' && (desired.invoiceExemptionBasisKind != null || desired.invoiceExemptionBasis != null))) {
    return err(validation('Manifest VAT fields conflict with the effective VAT mode'));
  }
  return ok(true);
};

type ShopManifest = z.output<typeof shopManifestSchema>;

const COMPANY_CREDENTIAL_SOURCE = 'company block';

export const manifestCredentialHolders = (manifest: ShopManifest): CredentialHolder[] => [
  ...(manifest.company?.integrations === undefined ? [] : [{ source: COMPANY_CREDENTIAL_SOURCE, integrations: manifest.company.integrations }]),
  ...manifest.shops.map((shop) => ({
    source: manifestWorkspaceSlug(shop.workspace),
    integrations: effectiveShopIntegrations(manifest.company?.integrations, shop.integrations),
  })),
];

export const parseShopManifest = (input: unknown): Result<ShopManifest, AppError> => {
  const parsed = shopManifestSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err(validation('Invalid shop manifest', {
    issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
  }));
};

export const preflightManifest = (input: unknown, workspace?: string) => {
  const parsed = parseShopManifest(input);
  if (!parsed.ok) return parsed;
  const shops = parsed.value.shops.filter((shop) => workspace === undefined || manifestWorkspaceSlug(shop.workspace) === workspace);
  if (shops.length === 0) return err(validation('Selected shop is not in the manifest'));
  const effective = shops.map((shop) => ({
    shop,
    slug: manifestWorkspaceSlug(shop.workspace),
    desired: effectiveShopSettings(parsed.value.company?.settings, shop.settings),
    integrations: effectiveShopIntegrations(parsed.value.company?.integrations, shop.integrations),
  }));
  for (const { shop, slug, desired, integrations } of effective) {
    if (integrations.parcelLocker != null && desired.inpostGeowidgetToken !== undefined) {
      return err(validation('Manage the parcel locker token through settings or integrations, not both'));
    }
    const referenceError = integrationReferenceError(integrations);
    if (referenceError !== null) return err(validation(referenceError, { workspace: slug }));
    for (const product of shop.products) {
      const vatError = productVatConvergenceError(product);
      if (vatError !== null) return err(validation(vatError, { workspace: slug, slug: product.slug }));
    }
  }
  return ok(effective);
};

export const prepareManifest = async <C extends ManifestReadClient>(
  input: unknown, clientFor: ManifestClientFactory<C>, workspace?: string,
): Promise<Result<PreparedShop<C>[], AppError>> => {
  const effective = preflightManifest(input, workspace);
  if (!effective.ok) return effective;
  const prepared: PreparedShop<C>[] = [];
  for (const { shop, slug, desired, integrations } of effective.value) {
    const unavailable = (access: Exclude<WorkspaceAccess, { state: 'ready' }>): Result<PreparedShop<C>, AppError> => {
      const coherent = validateVatSettings(desired, {});
      if (!coherent.ok) return coherent;
      return ok({
        workspace: slug, access, integrations, paymentConfigured: false,
        settings: diffShopSettings(desired, {}),
        products: shop.products.map((product) => ({ desired: product, current: null, diff: diffManifestProduct(product, null) })),
      });
    };
    const provisioning = typeof shop.workspace === 'string' ? null : { slug, ...shop.workspace.provision };
    const api = clientFor(slug);
    if (api === null) {
      const entry = unavailable(provisioning === null ? { state: 'missing' } : { state: 'provision', input: provisioning });
      if (!entry.ok) return entry;
      prepared.push(entry.value);
      continue;
    }
    const identity = await api.me();
    if (!identity.ok) {
      if (identity.error.code !== 'tenant_not_found' || provisioning === null) {
        return err(manifestOperationError(identity.error, slug, 'identity:read'));
      }
      const entry = unavailable({ state: 'provision', input: provisioning });
      if (!entry.ok) return entry;
      prepared.push(entry.value);
      continue;
    }
    if (identity.value.tenant?.slug !== slug) return err(validation('API workspace does not match the manifest', { workspace: slug }));
    const settings = await api.getTenantSettings();
    if (!settings.ok) return err(manifestOperationError(settings.error, slug, 'settings:read'));
    const coherent = validateVatSettings(desired, settings.value.settings);
    if (!coherent.ok) return coherent;
    let paymentConfigured = false;
    if (integrations.stripe != null) {
      const secrets = await api.listTenantSecrets();
      if (!secrets.ok) return err(manifestOperationError(secrets.error, slug, 'payment:read'));
      const stored = new Set(secrets.value.secrets.map((secret) => secret.key));
      paymentConfigured = STRIPE_SLOT_KEYS[integrations.stripe.mode].every((key) => stored.has(key));
    }
    const products = await api.listProducts();
    if (!products.ok) return err(manifestOperationError(products.error, slug, 'products:read'));
    const preparedProducts: PreparedProduct[] = [];
    for (const desiredProduct of shop.products) {
      const product = products.value.products.find((candidate) => candidate.slug === desiredProduct.slug);
      if (product && product.type !== 'physical') return err(validation('A manifest slug belongs to a non-physical product', { workspace: slug, slug: desiredProduct.slug }));
      let current: CurrentManifestProduct | null = null;
      if (product) {
        const prices = await api.listProductPrices(product.id);
        if (!prices.ok) return err(manifestOperationError(prices.error, slug, 'prices:read'));
        const stock = await api.getProductStock(product.id);
        if (!stock.ok) return err(manifestOperationError(stock.error, slug, 'stock:read'));
        current = { product, prices: prices.value.prices, stock: stock.value.stock };
      }
      preparedProducts.push({ desired: desiredProduct, current, diff: diffManifestProduct(desiredProduct, current) });
    }
    prepared.push({ workspace: slug, access: { state: 'ready', api }, integrations, paymentConfigured, settings: diffShopSettings(desired, settings.value.settings), products: preparedProducts });
  }
  return ok(prepared);
};

const PROVISIONING_BY_ACCESS = { ready: 'unchanged', provision: 'create', missing: 'missing' } as const;

const integrationReport = (provider: string, shop: PreparedShop, options: ManifestReportOptions) => {
  const configure = options.integrations === true ? 'configure' : 'skipped without --integrations';
  if (provider !== 'stripe') return { provider, action: configure };
  return { provider, configured: shop.paymentConfigured, action: paymentConfigurationDue(shop, options) ? configure : 'unchanged' };
};

export const manifestPlanReport = (shops: PreparedShop[], options: ManifestReportOptions = {}) => ({
  shops: shops.map((shop) => ({
    workspace: shop.workspace,
    provisioning: PROVISIONING_BY_ACCESS[shop.access.state],
    integrations: Object.entries(shop.integrations).filter(([, value]) => value != null)
      .map(([provider]) => integrationReport(provider, shop, options)),
    settings: { change: Object.keys(shop.settings.changes), unchanged: shop.settings.unchanged },
    products: shop.products.map(({ desired, diff }) => ({
      ...diff,
      desiredPrice: desired.price,
      ...(desired.stock === undefined ? {} : { desiredOnHand: desired.stock.onHand }),
      desiredPublished: desired.published,
    })),
  })),
});

export const planManifest = async (input: unknown, clientFor: ManifestClientFactory, workspace?: string) => {
  const prepared = await prepareManifest(input, clientFor, workspace);
  return prepared.ok ? ok(manifestPlanReport(prepared.value)) : prepared;
};
