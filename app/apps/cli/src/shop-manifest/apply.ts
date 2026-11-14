import type { ApiClient } from '#core/client/index.js';
import { err, internal, ok, updateProductInputSchema, type AppError, type Result } from '#core/domain/index.js';
import { productMetadata } from '#core/domain/shop-manifest.js';
import {
  manifestOperationError, manifestPlanReport, prepareManifest,
  type ManifestClientFactory, type ManifestReadClient, type PreparedProduct,
} from './plan.js';

type ManifestWriteClient = ManifestReadClient & Pick<ApiClient,
  'updateTenantSettings' | 'createProduct' | 'updateProduct' | 'createProductPrice' | 'deactivateProductPrice' |
  'enableProductStock' | 'adjustProductStock' | 'publishProduct' | 'unpublishProduct'>;
type AppliedOperation = { workspace: string; operation: string; slug?: string };

export const applyManifest = async (input: unknown, clientFor: ManifestClientFactory<ManifestWriteClient>, workspace?: string) => {
  const applied: AppliedOperation[] = [];
  const fail = (error: AppError) => err({
    ...error,
    message: `${error.message}. Applied: ${applied.length === 0 ? 'nothing' : applied.map((entry) => `${entry.workspace}/${entry.slug ?? 'settings'} ${entry.operation}`).join(', ')}`,
    details: { failure: error.details, applied: [...applied] },
  });
  const prepared = await prepareManifest(input, clientFor, workspace);
  if (!prepared.ok) return fail(prepared.error);
  for (const shop of prepared.value) {
    const write = async <T>(operation: string, action: () => Promise<Result<T, AppError>>, slug?: string): Promise<Result<T, AppError>> => {
      const result = await action();
      if (!result.ok) return err(manifestOperationError(result.error, shop.workspace, operation));
      applied.push({ workspace: shop.workspace, operation, ...(slug === undefined ? {} : { slug }) });
      return result;
    };
    if (Object.keys(shop.settings.changes).length > 0) {
      const result = await write('settings:update', () => shop.api.updateTenantSettings(shop.settings.changes));
      if (!result.ok) return fail(result.error);
    }
    const ids = new Map<PreparedProduct, string>();
    for (const entry of shop.products) {
      const { desired, diff, current } = entry;
      if (current) ids.set(entry, current.product.id);
      if (diff.product === 'create') {
        const result = await write('product:create', () => shop.api.createProduct({
          ...productMetadata(desired), slug: desired.slug, type: desired.type,
          priceCents: desired.price.amountCents, currency: desired.price.currency,
        }), desired.slug);
        if (!result.ok) return fail(result.error);
        ids.set(entry, result.value.product.id);
      } else if (diff.product === 'update' && current) {
        const changes = Object.fromEntries(Object.entries(productMetadata(desired)).filter(([key]) => diff.fields.includes(key)));
        const result = await write('product:update', () => shop.api.updateProduct(updateProductInputSchema.parse({ id: current.product.id, ...changes })), desired.slug);
        if (!result.ok) return fail(result.error);
      }
    }
    for (const entry of shop.products) {
      const productId = ids.get(entry);
      if (productId === undefined) return fail(internal('Missing reconciled product identifier'));
      if (entry.diff.price === 'add') {
        const result = await write('price:add', () => shop.api.createProductPrice({ productId, kind: 'one_time', ...entry.desired.price }), entry.desired.slug);
        if (!result.ok) return fail(result.error);
      }
      for (const id of entry.diff.deactivatePriceIds) {
        const result = await write('price:deactivate', () => shop.api.deactivateProductPrice({ id }), entry.desired.slug);
        if (!result.ok) return fail(result.error);
      }
    }
    for (const entry of shop.products) {
      const productId = ids.get(entry);
      const desired = entry.desired.stock;
      if (productId === undefined) return fail(internal('Missing reconciled product identifier'));
      if (desired === undefined) continue;
      if (entry.diff.stock === 'enable') {
        const result = await write('stock:enable', () => shop.api.enableProductStock({ productId, onHand: desired.onHand }), entry.desired.slug);
        if (!result.ok) return fail(result.error);
      } else if (entry.diff.stock === 'adjust' && entry.current?.stock) {
        const delta = desired.onHand - entry.current.stock.onHand;
        const result = await write('stock:adjust', () => shop.api.adjustProductStock({ productId, delta, reason: 'Shop manifest reconciliation' }), entry.desired.slug);
        if (!result.ok) return fail(result.error);
      }
    }
    for (const entry of shop.products) {
      const id = ids.get(entry);
      if (id === undefined) return fail(internal('Missing reconciled product identifier'));
      if (entry.diff.cover !== 'update' || entry.desired.coverUrl === undefined) continue;
      const coverUrl = entry.desired.coverUrl;
      const result = await write('cover:update', () => shop.api.updateProduct({ id, coverUrl }), entry.desired.slug);
      if (!result.ok) return fail(result.error);
    }
    for (const entry of shop.products) {
      const id = ids.get(entry);
      if (id === undefined) return fail(internal('Missing reconciled product identifier'));
      if (entry.diff.publication === 'unchanged') continue;
      const result = await write(`publication:${entry.diff.publication}`, () => entry.desired.published
        ? shop.api.publishProduct({ id }) : shop.api.unpublishProduct({ id }), entry.desired.slug);
      if (!result.ok) return fail(result.error);
    }
  }
  return ok({ ...manifestPlanReport(prepared.value), applied });
};
