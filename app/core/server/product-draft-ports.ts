import type { ProductDownloadAsset } from '#core/domain/index.js';

export type ProductDraftDeletion =
  | { kind: 'deleted'; assets: ProductDownloadAsset[] }
  | { kind: 'not_found' }
  | { kind: 'refused'; reason: 'published' | 'unknown_history' | 'orders' | 'grants' | 'sales_links' | 'checkout_snapshots' };

export interface ProductDraftRepository {
  deleteDraft(tenantId: string, productId: string): Promise<ProductDraftDeletion>;
}
