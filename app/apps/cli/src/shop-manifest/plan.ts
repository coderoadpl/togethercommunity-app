import type { ApiClient } from '#core/client/index.js';
import { err, ok, validation, type AppError, type Product, type ProductPrice, type ProductStock, type Result } from '#core/domain/index.js';
import {
  diffManifestProduct, diffShopSettings, effectiveShopSettings, shopManifestSchema,
  type ShopManifestProduct, type ShopManifestSettings,
} from '#core/domain/shop-manifest.js';

export type ManifestReadClient = Pick<ApiClient, 'me' | 'getTenantSettings' | 'listProducts' | 'listProductPrices' | 'getProductStock'>;
export type ManifestClientFactory<C extends ManifestReadClient = ManifestReadClient> = (workspace: string) => C;
export type CurrentManifestProduct = { product: Product; prices: ProductPrice[]; stock: ProductStock | null };
export type PreparedProduct = { desired: ShopManifestProduct; current: CurrentManifestProduct | null; diff: ReturnType<typeof diffManifestProduct> };
export type PreparedShop<C extends ManifestReadClient = ManifestReadClient> = {
  workspace: string;
  api: C;
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
  const shops = parsed.data.shops.filter((shop) => workspace === undefined || shop.workspace === workspace);
  if (shops.length === 0) return err(validation('Selected shop is not in the manifest'));
  const prepared: PreparedShop<C>[] = [];
  for (const shop of shops) {
    const api = clientFor(shop.workspace);
    const identity = await api.me();
    if (!identity.ok) return err(manifestOperationError(identity.error, shop.workspace, 'identity:read'));
    if (identity.value.tenant?.slug !== shop.workspace) return err(validation('API workspace does not match the manifest', { workspace: shop.workspace }));
    const settings = await api.getTenantSettings();
    if (!settings.ok) return err(manifestOperationError(settings.error, shop.workspace, 'settings:read'));
    const desired = effectiveShopSettings(parsed.data.company?.settings, shop.settings);
    const coherent = validateVatSettings(desired, settings.value.settings);
    if (!coherent.ok) return coherent;
    const products = await api.listProducts();
    if (!products.ok) return err(manifestOperationError(products.error, shop.workspace, 'products:read'));
    const preparedProducts: PreparedProduct[] = [];
    for (const desiredProduct of shop.products) {
      const product = products.value.products.find((candidate) => candidate.slug === desiredProduct.slug);
      if (product && product.type !== 'physical') return err(validation('A manifest slug belongs to a non-physical product', { workspace: shop.workspace, slug: desiredProduct.slug }));
      let current: CurrentManifestProduct | null = null;
      if (product) {
        const prices = await api.listProductPrices(product.id);
        if (!prices.ok) return err(manifestOperationError(prices.error, shop.workspace, 'prices:read'));
        const stock = await api.getProductStock(product.id);
        if (!stock.ok) return err(manifestOperationError(stock.error, shop.workspace, 'stock:read'));
        current = { product, prices: prices.value.prices, stock: stock.value.stock };
      }
      preparedProducts.push({ desired: desiredProduct, current, diff: diffManifestProduct(desiredProduct, current) });
    }
    prepared.push({ workspace: shop.workspace, api, settings: diffShopSettings(desired, settings.value.settings), products: preparedProducts });
  }
  return ok(prepared);
};

export const manifestPlanReport = (shops: PreparedShop[]) => ({
  shops: shops.map((shop) => ({
    workspace: shop.workspace,
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
