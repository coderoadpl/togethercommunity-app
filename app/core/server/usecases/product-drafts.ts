import { err, notFound, ok, validation, type AppError, type Result } from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { ProductDraftRepository } from '../product-draft-ports.js';
import type { ProductDownloadDeps } from './product-downloads.js';
import { deleteStoredProductDownload } from './product-downloads.js';

export interface ProductDraftDeps extends Pick<ProductDownloadDeps, 'logger' | 'secretResolver' | 'storage'> {
  productDrafts: ProductDraftRepository;
}

const refusalMessages = {
  published: 'This product has been published and cannot be deleted',
  unknown_history: 'This product has no verified publication history and cannot be deleted',
  orders: 'This product has orders and cannot be deleted',
  grants: 'This product has grants and cannot be deleted',
  sales_links: 'This product is referenced by a sales link and cannot be deleted',
  checkout_snapshots: 'This product is referenced by a checkout snapshot and cannot be deleted',
};

export const deleteProductDraft = async (
  ctx: Ctx,
  input: { productId: string },
  deps: ProductDraftDeps,
): Promise<Result<{ deleted: true }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  if (input.productId.trim().length === 0) return err(validation('Product ID is required'));
  const result = await deps.productDrafts.deleteDraft(tenant.value, input.productId);
  if (result.kind === 'not_found') return err(notFound(`No product "${input.productId}" in this tenant`));
  if (result.kind === 'refused') return err(validation(refusalMessages[result.reason]));
  for (const asset of result.assets) await deleteStoredProductDownload(tenant.value, asset, deps);
  return ok({ deleted: true });
};
