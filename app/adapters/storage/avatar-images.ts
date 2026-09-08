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

const storeProcessed = async (
  storage: StorageProvider,
  configuration: StorageConfiguration,
  targetKey: string,
  body: Uint8Array,
  fetchImage: typeof fetch,
): Promise<Result<void, AppError>> => {
  const signed = storage.presignPut({
    url: storage.objectUrl(configuration, targetKey).toString(),
    ...storageCredentials(configuration),
    expiresInSeconds: 60,
  });
  if (!signed.ok) return signed;
  try {
    const response = await fetchImage(signed.value, {
      method: 'PUT',
      headers: { 'content-type': 'image/webp' },
      body: Buffer.from(body),
      redirect: 'error',
    });
    if (!response.ok) return err(integrationUnavailable('S3 rejected the processed avatar'));
    return ok(undefined);
  } catch {
    return err(integrationUnavailable('Could not store the processed avatar'));
  }
};

const processResponse = async (
  storage: StorageProvider,
  configuration: StorageConfiguration,
  targetKey: string,
  response: Response,
  fetchImage: typeof fetch,
): Promise<Result<void, AppError>> => {
  if (!response.ok) return err(integrationUnavailable('Could not read the avatar source'));
  const source = await readLimited(response);
  if (!source.ok) return source;
  const processed = await transform(source.value);
  if (!processed.ok) return processed;
  return storeProcessed(storage, configuration, targetKey, processed.value, fetchImage);
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
    const signed = storage.presignGet({
      url: storage.objectUrl(configuration, sourceKey).toString(),
      ...storageCredentials(configuration),
      expiresInSeconds: 60,
    });
    if (!signed.ok) return signed;
    try {
      return await processResponse(
        storage,
        configuration,
        targetKey,
        await fetchImage(signed.value, { redirect: 'error' }),
        fetchImage,
      );
    } catch {
      return err(integrationUnavailable('Could not read the uploaded avatar'));
    }
  },
  importRemote: async ({ configuration, sourceUrl, targetKey }) => {
    if (!isGoogleProfileImageUrl(sourceUrl)) return err(validation('Invalid Google profile image URL'));
    try {
      return await processResponse(
        storage,
        configuration,
        targetKey,
        await fetchImage(sourceUrl, { redirect: 'error' }),
        fetchImage,
      );
    } catch {
      return err(integrationUnavailable('Could not import the Google profile image'));
    }
  },
});
