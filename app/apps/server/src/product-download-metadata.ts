import type { ProductDownloadAsset, ProductDownloadAssetMetadata } from '#core/domain/index.js';

export const productDownloadMetadata = (asset: ProductDownloadAsset, personalisationMaxBytes: number): ProductDownloadAssetMetadata => ({
  lineageId: asset.lineageId,
  versionNumber: asset.versionNumber,
  versionNote: asset.versionNote,
  supersededAt: asset.supersededAt,
  id: asset.id,
  productId: asset.productId,
  fileName: asset.fileName,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  status: asset.status,
  createdAt: asset.createdAt,
  personalisationSizeExceeded: asset.sizeBytes > personalisationMaxBytes,
});
