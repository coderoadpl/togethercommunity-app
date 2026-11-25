import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { z } from 'zod';

import { imageAssetUploadRequestSchema } from '#core/contract/index.js';
import {
  err,
  IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION,
  ok,
  productImagesSchema,
  strictInput,
  validation,
  type AppError,
  type ImageAssetKind,
  type ProductImage,
  type Result,
} from '#core/domain/index.js';

import { readStdin } from './secret-input.js';

const imageExtensionSchema = z.enum(['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'])
  .transform((extension) => IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION[extension === 'jpeg' ? 'jpg' : extension]);

const strictProductImagesSchema = strictInput(productImagesSchema);

const IMAGE_UPLOAD_MESSAGES: Record<ImageAssetKind, string> = {
  'course-cover': 'Invalid course cover image',
  'product-cover': 'Invalid product cover image',
  'product-image': 'Invalid product gallery image',
  logo: 'Invalid branding image',
  'logo-dark': 'Invalid branding image',
  favicon: 'Invalid branding image',
  'share-image': 'Invalid branding image',
  avatar: 'Invalid avatar image',
};

export const imageUploadInput = async (kind: ImageAssetKind, file: string) => {
  const contentType = imageExtensionSchema.safeParse(extname(file).slice(1).toLowerCase());
  if (!contentType.success) return err(validation('The image file must end in .png, .jpg, .jpeg, .webp, .svg or .ico'));
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch (cause) {
    return err(validation(`Could not read the image file "${file}": ${String(cause)}`));
  }
  const input = imageAssetUploadRequestSchema.safeParse({
    kind, fileName: basename(file), contentType: contentType.data, sizeBytes: bytes.byteLength,
  });
  return input.success
    ? ok({ ...input.data, body: bytes })
    : err(validation(IMAGE_UPLOAD_MESSAGES[kind], input.error.flatten()));
};

const readSource = async (source: string): Promise<Result<string, AppError>> => {
  try {
    return ok(source === '-' ? await readStdin() : await readFile(source, 'utf8'));
  } catch (cause) {
    return err(validation(`Could not read the product images JSON from "${source}": ${String(cause)}`));
  }
};

export const parseProductImagesJson = (raw: string): Result<ProductImage[], AppError> => {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (cause) {
    return err(validation(`Invalid product images JSON: ${String(cause)}`));
  }
  const parsed = strictProductImagesSchema.safeParse(payload);
  return parsed.success ? ok(parsed.data) : err(validation('Invalid product images', parsed.error.flatten()));
};

export const productImagesFileOption = async (
  source: string | undefined,
): Promise<Result<{ images?: ProductImage[] }, AppError>> => {
  if (source === undefined) return ok({});
  const raw = await readSource(source);
  if (!raw.ok) return raw;
  const images = parseProductImagesJson(raw.value);
  return images.ok ? ok({ images: images.value }) : images;
};
