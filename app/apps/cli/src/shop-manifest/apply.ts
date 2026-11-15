import type { ApiClient } from '#core/client/index.js';
import { err, internal, ok, validation, updateProductInputSchema, type AppError, type Result } from '#core/domain/index.js';
import { productMetadata, SHOP_OPERATOR_SECRET_ENV } from '#core/domain/shop-manifest.js';
import { resolveManifestIntegrations, type ResolvedManifestIntegrations } from './integrations.js';
import {
  manifestOperationError, manifestPlanReport, paymentConfigurationDue, prepareManifest,
  type ManifestClientFactory, type ManifestReadClient, type ManifestReportOptions, type PreparedProduct,
} from './plan.js';

type ManifestWriteClient = ManifestReadClient & Pick<ApiClient,
  'updateTenantSettings' | 'createProduct' | 'updateProduct' | 'createProductPrice' | 'deactivateProductPrice' |
  'enableProductStock' | 'adjustProductStock' | 'publishProduct' | 'unpublishProduct' | 'configureStripe' | 'shipxConfigure'>;
type AppliedOperation = { workspace: string; operation: string; slug?: string };

export type ManifestApplyOptions = ManifestReportOptions & {
  environment?: Readonly<Record<string, string | undefined>>;
  operator?: Pick<ApiClient, 'provisionOperatorTenant'>;
};

export const applyManifest = async (
  input: unknown, clientFor: ManifestClientFactory<ManifestWriteClient>, workspace?: string, options: ManifestApplyOptions = {},
) => {
  const applied: AppliedOperation[] = [];
  const fail = (error: AppError) => err({
    ...error,
    message: `${error.message}. Applied: ${applied.length === 0 ? 'nothing' : applied.map((entry) => `${entry.workspace}/${entry.slug ?? 'settings'} ${entry.operation}`).join(', ')}`,
    details: { failure: error.details, applied: [...applied] },
  });
  if (options.reconfigurePayments === true && options.integrations !== true) return fail(validation('--reconfigure-payments requires --integrations'));
  let prepared = await prepareManifest(input, clientFor, workspace);
  if (!prepared.ok) return fail(prepared.error);
  const integrationsByWorkspace = new Map<string, ResolvedManifestIntegrations>();
  if (options.integrations === true) {
    for (const shop of prepared.value) {
      const resolved = resolveManifestIntegrations(shop.integrations, options.environment ?? {});
      if (!resolved.ok) return fail(resolved.error);
      integrationsByWorkspace.set(shop.workspace, resolved.value);
    }
  }
  const unconfirmed = prepared.value.filter((shop) => shop.access.state === 'missing').map((shop) => shop.workspace);
  if (unconfirmed.length > 0) {
    return fail(validation('The API origin does not list these workspaces for the signed-in account; provision them or sign in with an account that has them', { workspaces: unconfirmed }));
  }
  const missing = prepared.value.flatMap((shop) => shop.access.state === 'provision' ? [{ workspace: shop.workspace, input: shop.access.input }] : []);
  if (missing.length > 0) {
    const secret = options.environment?.[SHOP_OPERATOR_SECRET_ENV];
    if (!secret?.trim()) return fail(validation(`Missing environment variable ${SHOP_OPERATOR_SECRET_ENV}`));
    if (options.operator === undefined) return fail(validation('Operator provisioning client is required'));
    for (const shop of missing) {
      const result = await options.operator.provisionOperatorTenant(shop.input, secret);
      if (!result.ok) return fail(manifestOperationError(result.error, shop.workspace, 'workspace:provision'));
      applied.push({ workspace: shop.workspace, operation: 'workspace:provision' });
    }
    prepared = await prepareManifest(input, clientFor, workspace);
    if (!prepared.ok) return fail(prepared.error);
    if (prepared.value.some((shop) => shop.access.state !== 'ready')) return fail(validation('Provisioned workspace is not accessible to the current session'));
  }
  for (const shop of prepared.value) {
    if (shop.access.state !== 'ready') return fail(internal('Missing reconciled workspace client'));
    const api = shop.access.api;
    const write = async <T>(operation: string, action: () => Promise<Result<T, AppError>>, slug?: string): Promise<Result<T, AppError>> => {
      const result = await action();
      if (!result.ok) return err(manifestOperationError(result.error, shop.workspace, operation));
      applied.push({ workspace: shop.workspace, operation, ...(slug === undefined ? {} : { slug }) });
      return result;
    };
    if (Object.keys(shop.settings.changes).length > 0) {
      const result = await write('settings:update', () => api.updateTenantSettings(shop.settings.changes));
      if (!result.ok) return fail(result.error);
    }
    const integrations = integrationsByWorkspace.get(shop.workspace);
    if (integrations !== undefined) {
      const configure = async <T>(operation: string, action: () => Promise<Result<T, AppError>>) => {
        try { return await write(operation, action); }
        catch { return err(manifestOperationError(internal(), shop.workspace, operation)); }
      };
      if (integrations.stripe !== undefined && paymentConfigurationDue(shop, options)) {
        const stripe = integrations.stripe;
        const result = await configure('integration:stripe', () => api.configureStripe(stripe));
        if (!result.ok) return fail(result.error);
      }
      if (integrations.shipx !== undefined) {
        const shipx = integrations.shipx;
        const result = await configure('integration:shipx', () => api.shipxConfigure(shipx));
        if (!result.ok) return fail(result.error);
      }
      if (integrations.parcelLocker !== undefined) {
        const parcelLocker = integrations.parcelLocker;
        const result = await configure('integration:parcelLocker', () => api.updateTenantSettings(parcelLocker));
        if (!result.ok) return fail(result.error);
      }
    }
    const ids = new Map<PreparedProduct, string>();
    for (const entry of shop.products) {
      const { desired, diff, current } = entry;
      if (current) ids.set(entry, current.product.id);
      if (diff.product === 'create') {
        const result = await write('product:create', () => api.createProduct({
          ...productMetadata(desired), slug: desired.slug, type: desired.type,
          priceCents: desired.price.amountCents, currency: desired.price.currency,
        }), desired.slug);
        if (!result.ok) return fail(result.error);
        ids.set(entry, result.value.product.id);
      } else if (diff.product === 'update' && current) {
        const changes = Object.fromEntries(Object.entries(productMetadata(desired)).filter(([key]) => diff.fields.includes(key)));
        const result = await write('product:update', () => api.updateProduct(updateProductInputSchema.parse({ id: current.product.id, ...changes })), desired.slug);
        if (!result.ok) return fail(result.error);
      }
    }
    for (const entry of shop.products) {
      const productId = ids.get(entry);
      if (productId === undefined) return fail(internal('Missing reconciled product identifier'));
      if (entry.diff.price === 'add') {
        const result = await write('price:add', () => api.createProductPrice({ productId, kind: 'one_time', ...entry.desired.price }), entry.desired.slug);
        if (!result.ok) return fail(result.error);
      }
      for (const id of entry.diff.deactivatePriceIds) {
        const result = await write('price:deactivate', () => api.deactivateProductPrice({ id }), entry.desired.slug);
        if (!result.ok) return fail(result.error);
      }
    }
    for (const entry of shop.products) {
      const productId = ids.get(entry);
      const desired = entry.desired.stock;
      if (productId === undefined) return fail(internal('Missing reconciled product identifier'));
      if (desired === undefined) continue;
      if (entry.diff.stock === 'enable') {
        const result = await write('stock:enable', () => api.enableProductStock({ productId, onHand: desired.onHand }), entry.desired.slug);
        if (!result.ok) return fail(result.error);
      } else if (entry.diff.stock === 'adjust' && entry.current?.stock) {
        const delta = desired.onHand - entry.current.stock.onHand;
        const result = await write('stock:adjust', () => api.adjustProductStock({ productId, delta, reason: 'Shop manifest reconciliation' }), entry.desired.slug);
        if (!result.ok) return fail(result.error);
      }
    }
    for (const entry of shop.products) {
      const id = ids.get(entry);
      if (id === undefined) return fail(internal('Missing reconciled product identifier'));
      if (entry.diff.cover !== 'update' || entry.desired.coverUrl === undefined) continue;
      const coverUrl = entry.desired.coverUrl;
      const result = await write('cover:update', () => api.updateProduct({ id, coverUrl }), entry.desired.slug);
      if (!result.ok) return fail(result.error);
    }
    for (const entry of shop.products) {
      const id = ids.get(entry);
      if (id === undefined) return fail(internal('Missing reconciled product identifier'));
      if (entry.diff.publication === 'unchanged') continue;
      const result = await write(`publication:${entry.diff.publication}`, () => entry.desired.published
        ? api.publishProduct({ id }) : api.unpublishProduct({ id }), entry.desired.slug);
      if (!result.ok) return fail(result.error);
    }
  }
  return ok({ ...manifestPlanReport(prepared.value, options), applied });
};
