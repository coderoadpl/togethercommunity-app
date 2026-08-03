import { z } from 'zod';

export const PRODUCT_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024;

const productDownloadStatusSchema = z.enum(['pending', 'ready']);

export const productDownloadAssetSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  productId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(PRODUCT_DOWNLOAD_MAX_BYTES),
  storageKey: z.string().min(1),
  status: productDownloadStatusSchema,
  createdAt: z.string().datetime(),
});

export type ProductDownloadAsset = z.infer<typeof productDownloadAssetSchema>;

export const productDownloadAssetMetadataSchema = productDownloadAssetSchema.omit({
  tenantId: true,
  storageKey: true,
});

export type ProductDownloadAssetMetadata = z.infer<typeof productDownloadAssetMetadataSchema>;

export const productDownloadAssetViewSchema = productDownloadAssetMetadataSchema.extend({
  downloadPath: z.string().startsWith('/'),
});

export type ProductDownloadAssetView = z.infer<typeof productDownloadAssetViewSchema>;

export const productDownloadUploadInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(PRODUCT_DOWNLOAD_MAX_BYTES),
});

export type ProductDownloadUploadInput = z.input<typeof productDownloadUploadInputSchema>;
