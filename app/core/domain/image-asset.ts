import { z } from 'zod';

export const IMAGE_ASSET_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_ASSET_KINDS = [
  'course-cover',
  'product-cover',
  'logo',
  'logo-dark',
  'favicon',
  'share-image',
] as const;

export const imageAssetKindSchema = z.enum(IMAGE_ASSET_KINDS);

export type ImageAssetKind = z.infer<typeof imageAssetKindSchema>;

const IMAGE_ASSET_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

const IMAGE_ASSET_FAVICON_CONTENT_TYPES = [
  ...IMAGE_ASSET_CONTENT_TYPES,
  'image/x-icon',
  'image/vnd.microsoft.icon',
] as const;

/** Social crawlers do not render SVG, so the share image is raster only. */
const IMAGE_ASSET_SHARE_IMAGE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const SHARE_IMAGE_RECOMMENDED_WIDTH = 1200;
export const SHARE_IMAGE_RECOMMENDED_HEIGHT = 630;

const CONTENT_TYPES_BY_KIND: Record<ImageAssetKind, readonly string[]> = {
  'course-cover': IMAGE_ASSET_CONTENT_TYPES,
  'product-cover': IMAGE_ASSET_CONTENT_TYPES,
  logo: IMAGE_ASSET_CONTENT_TYPES,
  'logo-dark': IMAGE_ASSET_CONTENT_TYPES,
  favicon: IMAGE_ASSET_FAVICON_CONTENT_TYPES,
  'share-image': IMAGE_ASSET_SHARE_IMAGE_CONTENT_TYPES,
};

export const imageAssetContentTypesFor = (kind: ImageAssetKind): readonly string[] =>
  CONTENT_TYPES_BY_KIND[kind];

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
  if (!imageAssetContentTypesFor(input.kind).includes(input.contentType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contentType'],
      message: `${input.contentType} is not accepted for ${input.kind}`,
    });
  }
});

export type ImageAssetUploadInput = z.input<typeof imageAssetUploadInputSchema>;
