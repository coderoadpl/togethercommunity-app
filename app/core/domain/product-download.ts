import { z } from 'zod';

export const PRODUCT_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024;

const versionNoteSchema = z.string().trim().max(500);

export const productDownloadCompleteInputSchema = z.object({
  replacesAssetId: z.string().min(1).optional(),
  versionNote: versionNoteSchema.optional(),
});

export type ProductDownloadCompleteInput = z.input<typeof productDownloadCompleteInputSchema>;

const productDownloadStatusSchema = z.enum(['pending', 'ready']);

export const productDownloadAssetSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  lineageId: z.string().min(1),
  versionNumber: z.number().int().positive().default(1),
  versionNote: versionNoteSchema.nullable().default(null),
  supersededAt: z.string().datetime().nullable().default(null),
  replacesAssetId: z.string().min(1).nullable().default(null),
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
  replacesAssetId: true,
});

export type ProductDownloadAssetMetadata = z.infer<typeof productDownloadAssetMetadataSchema>;

const productDownloadVersionViewSchema = productDownloadAssetMetadataSchema.extend({
  downloadPath: z.string().startsWith('/'),
});

export const productDownloadAssetViewSchema = productDownloadVersionViewSchema.extend({
  previousVersions: z.array(productDownloadVersionViewSchema).default([]),
});

export type ProductDownloadAssetView = z.infer<typeof productDownloadAssetViewSchema>;

export const productDownloadUploadInputSchema = productDownloadCompleteInputSchema.extend({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(PRODUCT_DOWNLOAD_MAX_BYTES),
});

export type ProductDownloadUploadInput = z.input<typeof productDownloadUploadInputSchema>;
