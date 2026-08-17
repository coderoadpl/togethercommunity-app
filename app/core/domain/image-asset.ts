import { z } from 'zod';

export const IMAGE_ASSET_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_ASSET_KINDS = [
  'course-cover',
  'product-cover',
  'logo',
  'favicon',
] as const;

export const imageAssetKindSchema = z.enum(IMAGE_ASSET_KINDS);

export type ImageAssetKind = z.infer<typeof imageAssetKindSchema>;

export const IMAGE_ASSET_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export const IMAGE_ASSET_FAVICON_CONTENT_TYPES = [
  ...IMAGE_ASSET_CONTENT_TYPES,
  'image/x-icon',
  'image/vnd.microsoft.icon',
] as const;

export const IMAGE_ASSET_EXTENSION_BY_CONTENT_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
} as const;

export const IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
} as const;

const imageAssetContentTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export const imageAssetUploadInputSchema = z.object({
  kind: imageAssetKindSchema,
  fileName: z.string().trim().min(1).max(255),
  contentType: imageAssetContentTypeSchema,
  sizeBytes: z.number().int().positive().max(IMAGE_ASSET_MAX_BYTES),
}).superRefine((input, ctx) => {
  if (
    input.kind !== 'favicon'
    && !IMAGE_ASSET_CONTENT_TYPES.some((contentType) => contentType === input.contentType)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contentType'],
      message: 'Icon files are only supported for favicons',
    });
  }
});

export type ImageAssetUploadInput = z.input<typeof imageAssetUploadInputSchema>;
