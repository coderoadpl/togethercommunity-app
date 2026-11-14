import sharp from 'sharp';

import {
  AVATAR_IMAGE_MAX_BYTES,
  err,
  integrationUnavailable,
  ok,
  validation,
  type AppError,
  type Result,
  type StorageConfiguration,
} from '#core/domain/index.js';
import { imageContentMatches } from '#core/server/image-content.js';
import type { AvatarImageProcessor, StorageProvider } from '#core/server/index.js';

const AVATAR_SIZE = 256;
const ACCEPTED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const readLimited = async (response: Response): Promise<Result<Uint8Array, AppError>> => {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
    return err(validation('Avatar image must be PNG, JPEG, or WebP'));
  }
  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredSize) && declaredSize > AVATAR_IMAGE_MAX_BYTES) {
    return err(validation(`Avatar image must not exceed ${String(AVATAR_IMAGE_MAX_BYTES)} bytes`));
  }
  if (response.body === null) return err(validation('Avatar image is empty'));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > AVATAR_IMAGE_MAX_BYTES) {
      await reader.cancel();
      return err(validation(`Avatar image must not exceed ${String(AVATAR_IMAGE_MAX_BYTES)} bytes`));
    }
    chunks.push(chunk.value);
  }
  if (size === 0) return err(validation('Avatar image is empty'));
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(body);
};

const transform = async (body: Uint8Array): Promise<Result<Uint8Array, AppError>> => {
  try {
    const source = sharp(body, { failOn: 'warning', limitInputPixels: 40_000_000 });
    const metadata = await source.metadata();
    if (metadata.format !== 'jpeg' && metadata.format !== 'png' && metadata.format !== 'webp') {
      return err(validation('Avatar image must be PNG, JPEG, or WebP'));
    }
    return ok(await source
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer());
  } catch {
    return err(validation('Avatar image could not be processed'));
  }
};

const storageCredentials = (configuration: StorageConfiguration) => ({
  accessKeyId: configuration.accessKeyId,
  secretAccessKey: configuration.secretAccessKey,
  region: configuration.region,
});

const storeProcessed = (
  storage: StorageProvider,
  configuration: StorageConfiguration,
  targetKey: string,
  body: Uint8Array,
): Promise<Result<void, AppError>> => storage.putObject({
  url: storage.objectUrl(configuration, targetKey).toString(),
  ...storageCredentials(configuration),
  contentType: 'image/webp',
  body,
});

const processResponse = async (
  storage: StorageProvider,
  configuration: StorageConfiguration,
  targetKey: string,
  response: Response,
): Promise<Result<void, AppError>> => {
  if (!response.ok) return err(integrationUnavailable('Could not read the avatar source'));
  const source = await readLimited(response);
  if (!source.ok) return source;
  const processed = await transform(source.value);
  if (!processed.ok) return processed;
  return storeProcessed(storage, configuration, targetKey, processed.value);
};

export const isGoogleProfileImageUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'));
  } catch {
    return false;
  }
};

export const createAvatarImageProcessor = (
  storage: StorageProvider,
  fetchImage: typeof fetch = fetch,
): AvatarImageProcessor => ({
  processStored: async ({ configuration, sourceKey, targetKey }) => {
    const source = await storage.getObject({
      url: storage.objectUrl(configuration, sourceKey).toString(),
      ...storageCredentials(configuration),
    }, { maxBytes: AVATAR_IMAGE_MAX_BYTES, range: true });
    if (!source.ok) return source;
    if (!imageContentMatches(source.value, sourceKey.split('.').at(-1) ?? '')) {
      return err(validation('Avatar image does not match its declared format'));
    }
    const processed = await transform(source.value);
    if (!processed.ok) return processed;
    return storeProcessed(storage, configuration, targetKey, processed.value);
  },
  importRemote: async ({ configuration, sourceUrl, targetKey }) => {
    if (!isGoogleProfileImageUrl(sourceUrl)) return err(validation('Invalid Google profile image URL'));
    try {
      return await processResponse(
        storage,
        configuration,
        targetKey,
        await fetchImage(sourceUrl, { redirect: 'error' }),
      );
    } catch {
      return err(integrationUnavailable('Could not import the Google profile image'));
    }
  },
});
