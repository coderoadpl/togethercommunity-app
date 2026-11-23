import { z } from 'zod';

import { MY_PRODUCTS_PATH } from './member-routes.js';

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
}).extend({
  personalisationSizeExceeded: z.boolean(),
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

export const copyIdentifierSchema = z.string().regex(/^copy_[A-Z2-7]{25}[AEIMQUY4]$/);

export const downloadCopySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  copyIdentifier: copyIdentifierSchema,
  memberId: z.string().min(1),
  orderId: z.string().min(1).nullable(),
  productId: z.string().min(1),
  assetId: z.string().min(1),
  lineageId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  fileName: z.string().min(1),
  personalised: z.boolean(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
});

export type DownloadCopy = z.infer<typeof downloadCopySchema>;

export const DOWNLOAD_COPY_PAGE_SIZE = 50;

const downloadCopyCursorSchema = z.string().transform((value, ctx) => {
  const [createdAt, id, extra] = value.split('~');
  if (extra !== undefined || !z.string().datetime().safeParse(createdAt).success || !id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid copy cursor' });
    return z.NEVER;
  }
  try {
    return { createdAt: z.string().datetime().parse(createdAt), id: decodeURIComponent(id) };
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid copy cursor' });
    return z.NEVER;
  }
});

export const downloadCopyQuerySchema = z.object({
  cursor: downloadCopyCursorSchema.optional(),
  orderId: z.string().min(1).optional(),
  memberId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  copyIdentifier: copyIdentifierSchema.optional(),
}).refine((value) => value.orderId !== undefined || value.memberId !== undefined ||
  (value.productId !== undefined && value.copyIdentifier !== undefined));

export type DownloadCopyQuery = z.infer<typeof downloadCopyQuerySchema>;

const MEMBER_DOWNLOAD_FAILURE_CODES = ['no_access', 'not_found', 'failed'] as const;

export type MemberDownloadFailureCode = (typeof MEMBER_DOWNLOAD_FAILURE_CODES)[number];

export const MEMBER_DOWNLOAD_FAILURE_PARAMS = { code: 'downloadError', productId: 'product', assetId: 'asset' } as const;

const downloadFailureReferenceSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

interface MemberDownloadFailure {
  code: MemberDownloadFailureCode;
  productId: string | null;
  assetId: string | null;
}

const referenceOrNull = (value: string | null): string | null => {
  const parsed = downloadFailureReferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const parseMemberDownloadFailure = (search: URLSearchParams): MemberDownloadFailure | null => {
  const code = z.enum(MEMBER_DOWNLOAD_FAILURE_CODES).safeParse(search.get(MEMBER_DOWNLOAD_FAILURE_PARAMS.code));
  if (!code.success) return null;
  const productId = referenceOrNull(search.get(MEMBER_DOWNLOAD_FAILURE_PARAMS.productId));
  return {
    code: code.data,
    productId,
    assetId: productId === null ? null : referenceOrNull(search.get(MEMBER_DOWNLOAD_FAILURE_PARAMS.assetId)),
  };
};

export const memberDownloadFailurePath = (failure: {
  code: MemberDownloadFailureCode;
  productId: string;
  assetId: string;
}): string => {
  const search = new URLSearchParams({ [MEMBER_DOWNLOAD_FAILURE_PARAMS.code]: failure.code });
  const productId = referenceOrNull(failure.productId);
  const assetId = referenceOrNull(failure.assetId);
  if (productId !== null) {
    search.set(MEMBER_DOWNLOAD_FAILURE_PARAMS.productId, productId);
    if (assetId !== null) search.set(MEMBER_DOWNLOAD_FAILURE_PARAMS.assetId, assetId);
  }
  return `${MY_PRODUCTS_PATH}?${search.toString()}`;
};

export const MEMBER_DOWNLOAD_SIGN_IN_PATH = `/login?${new URLSearchParams({ returnTo: MY_PRODUCTS_PATH }).toString()}`;
