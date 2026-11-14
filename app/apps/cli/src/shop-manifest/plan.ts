import type { ApiClient } from '#core/client/index.js';
import { err, ok, validation, type AppError, type Product, type ProductPrice, type ProductStock, type ProvisionTenantInput, type Result } from '#core/domain/index.js';
import {
  diffManifestProduct, diffShopSettings, effectiveShopSettings, manifestWorkspaceSlug, shopManifestSchema,
  type ShopManifestProduct, type ShopManifestSettings,
} from '#core/domain/shop-manifest.js';

export type ManifestReadClient = Pick<ApiClient, 'me' | 'getTenantSettings' | 'listProducts' | 'listProductPrices' | 'getProductStock'>;
export type ManifestClientFactory<C extends ManifestReadClient = ManifestReadClient> = (workspace: string) => C;
export type CurrentManifestProduct = { product: Product; prices: ProductPrice[]; stock: ProductStock | null };
export type PreparedProduct = { desired: ShopManifestProduct; current: CurrentManifestProduct | null; diff: ReturnType<typeof diffManifestProduct> };
export type PreparedShop<C extends ManifestReadClient = ManifestReadClient> = {
  workspace: string;
  api: C;
  provision: ProvisionTenantInput | null;
  settings: ReturnType<typeof diffShopSettings>;
  products: PreparedProduct[];
};

export const manifestOperationError = (error: AppError, workspace: string, operation: string): AppError => ({
  code: error.code, message: `Shop operation failed: ${operation}`,
  details: { workspace, operation },
});

const validateVatSettings = (desired: ShopManifestSettings, current: Record<string, unknown>): Result<true, AppError> => {
  const merged = { ...current, ...desired };
  if ((merged.invoiceVatMode === 'exempt' && desired.invoiceVatRatePercent != null) ||
    (merged.invoiceVatMode !== 'exempt' && (desired.invoiceExemptionBasisKind != null || desired.invoiceExemptionBasis != null))) {
    return err(validation('Manifest VAT fields conflict with the effective VAT mode'));
  }
  return ok(true);
};

export const prepareManifest = async <C extends ManifestReadClient>(
  input: unknown, clientFor: ManifestClientFactory<C>, workspace?: string,
): Promise<Result<PreparedShop<C>[], AppError>> => {
  const parsed = shopManifestSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid shop manifest', {
    issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
  }));
  const shops = parsed.data.shops.filter((shop) => workspace === undefined || manifestWorkspaceSlug(shop.workspace) === workspace);
  if (shops.length === 0) return err(validation('Selected shop is not in the manifest'));
  const prepared: PreparedShop<C>[] = [];
  for (const shop of shops) {
    const slug = manifestWorkspaceSlug(shop.workspace);
    const api = clientFor(slug);
    const desired = effectiveShopSettings(parsed.data.company?.settings, shop.settings);
    const identity = await api.me();
    if (!identity.ok) {
      if (identity.error.code !== 'tenant_not_found' || typeof shop.workspace === 'string') {
        return err(manifestOperationError(identity.error, slug, 'identity:read'));
      }
      const coherent = validateVatSettings(desired, {});
      if (!coherent.ok) return coherent;
      prepared.push({
        workspace: slug, api, provision: { slug, ...shop.workspace.provision },
        settings: diffShopSettings(desired, {}),
        products: shop.products.map((product) => ({ desired: product, current: null, diff: diffManifestProduct(product, null) })),
      });
      continue;
    }
    if (identity.value.tenant?.slug !== slug) return err(validation('API workspace does not match the manifest', { workspace: slug }));
    const settings = await api.getTenantSettings();
    if (!settings.ok) return err(manifestOperationError(settings.error, slug, 'settings:read'));
    const coherent = validateVatSettings(desired, settings.value.settings);
    if (!coherent.ok) return coherent;
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
    prepared.push({ workspace: slug, api, provision: null, settings: diffShopSettings(desired, settings.value.settings), products: preparedProducts });
  }
  return ok(prepared);
};

export const manifestPlanReport = (shops: PreparedShop[]) => ({
  shops: shops.map((shop) => ({
    workspace: shop.workspace,
    provisioning: shop.provision === null ? 'unchanged' : 'create',
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
