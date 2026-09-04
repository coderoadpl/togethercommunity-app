import {
  IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION,
  IMAGE_ASSET_EXTENSION_BY_CONTENT_TYPE,
  IMAGE_ASSET_MAX_BYTES,
  err,
  imageAssetKindSchema,
  imageAssetUploadInputSchema,
  notFound,
  ok,
  validation,
  type AppError,
  type ImageAssetKind,
  type ImageAssetUploadInput,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock,
  IdGenerator,
  StorageProvider,
  TenantSecretResolver,
} from '../ports.js';
import { resolveStorageConfiguration, storageAssetExpiresAt } from './storage-assets.js';

const BRANDING_ASSET_KINDS: readonly ImageAssetKind[] = ['logo', 'logo-dark', 'favicon', 'share-image'];

const IMAGE_ASSET_UPLOAD_TTL_SECONDS = 15 * 60;
export const IMAGE_ASSET_GET_TTL_SECONDS = 60 * 60;

const imageAssetFilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|svg|ico)$/;

const servePath = (kind: ImageAssetKind, file: string): string =>
  `/api/public/assets/${kind}/${file}`;

const parseStoredKey = (
  tenantId: string,
  key: string,
): { kind: ImageAssetKind; file: string } | null => {
  const parts = key.split('/');
  if (parts.length !== 4 || parts[0] !== 'image-assets' || parts[1] !== tenantId) return null;
  const kind = imageAssetKindSchema.safeParse(parts[2]);
  const file = parts[3];
  if (!kind.success || file === undefined || !imageAssetFilePattern.test(file)) return null;
  const id = file.slice(0, file.lastIndexOf('.'));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    return null;
  }
  return { kind: kind.data, file };
};

export interface ImageAssetDeps {
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  ids: IdGenerator;
  clock: Clock;
}

export interface ImageAssetUploadStart {
  key: string;
  servePath: string;
  uploadUrl: string;
  expiresAt: string;
}

const beginUpload = async (
  tenantId: string,
  allowedKinds: readonly ImageAssetKind[],
  input: ImageAssetUploadInput,
  deps: ImageAssetDeps,
): Promise<Result<ImageAssetUploadStart, AppError>> => {
  const parsed = imageAssetUploadInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid image asset', parsed.error.flatten()));
  if (!allowedKinds.includes(parsed.data.kind)) {
    return err(validation(`Image asset kind ${parsed.data.kind} is not accepted here`));
  }
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;

  const extension = IMAGE_ASSET_EXTENSION_BY_CONTENT_TYPE[parsed.data.contentType];
  const file = `${deps.ids.nextId()}.${extension}`;
  const key = `image-assets/${tenantId}/${parsed.data.kind}/${file}`;
  const signed = deps.storage.presignPut({
    url: deps.storage.objectUrl(configuration.value, key).toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
    expiresInSeconds: IMAGE_ASSET_UPLOAD_TTL_SECONDS,
  });
  if (!signed.ok) return signed;
  const createdAt = deps.clock.nowIso();
  return ok({
    key,
    servePath: servePath(parsed.data.kind, file),
    uploadUrl: signed.value,
    expiresAt: storageAssetExpiresAt(createdAt, IMAGE_ASSET_UPLOAD_TTL_SECONDS),
  });
};

const completeUpload = async (
  tenantId: string,
  allowedKinds: readonly ImageAssetKind[],
  input: { key: string },
  deps: Pick<ImageAssetDeps, 'secretResolver' | 'storage'>,
): Promise<Result<{ url: string }, AppError>> => {
  const parsed = parseStoredKey(tenantId, input.key);
  if (parsed === null || !allowedKinds.includes(parsed.kind)) {
    return err(notFound('Image asset not found'));
  }
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const target = deps.storage.objectUrl(configuration.value, input.key).toString();
  const storedObject = await deps.storage.head({
    url: target,
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
  });
  if (!storedObject.ok) return storedObject;
  if (storedObject.value.sizeBytes < 1 || storedObject.value.sizeBytes > IMAGE_ASSET_MAX_BYTES) {
    const removed = await deps.storage.delete({
      url: target,
      accessKeyId: configuration.value.accessKeyId,
      secretAccessKey: configuration.value.secretAccessKey,
      region: configuration.value.region,
    });
    if (!removed.ok) return removed;
    return err(validation(`Uploaded image must be between 1 and ${String(IMAGE_ASSET_MAX_BYTES)} bytes`));
  }
  return ok({ url: servePath(parsed.kind, parsed.file) });
};

export const beginCourseCoverUpload = async (
  ctx: Ctx,
  input: ImageAssetUploadInput,
  deps: ImageAssetDeps,
): Promise<Result<ImageAssetUploadStart, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  return beginUpload(tenant.value, ['course-cover'], input, deps);
};

export const completeCourseCoverUpload = async (
  ctx: Ctx,
  input: { key: string },
  deps: Pick<ImageAssetDeps, 'secretResolver' | 'storage'>,
): Promise<Result<{ url: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  return completeUpload(tenant.value, ['course-cover'], input, deps);
};

export const beginProductCoverUpload = async (
  ctx: Ctx,
  input: ImageAssetUploadInput,
  deps: ImageAssetDeps,
): Promise<Result<ImageAssetUploadStart, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  return beginUpload(tenant.value, ['product-cover'], input, deps);
};

export const completeProductCoverUpload = async (
  ctx: Ctx,
  input: { key: string },
  deps: Pick<ImageAssetDeps, 'secretResolver' | 'storage'>,
): Promise<Result<{ url: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  return completeUpload(tenant.value, ['product-cover'], input, deps);
};

export const beginBrandingAssetUpload = async (
  ctx: Ctx,
  input: ImageAssetUploadInput,
  deps: ImageAssetDeps,
): Promise<Result<ImageAssetUploadStart, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  return beginUpload(tenant.value, BRANDING_ASSET_KINDS, input, deps);
};

export const completeBrandingAssetUpload = async (
  ctx: Ctx,
  input: { key: string },
  deps: Pick<ImageAssetDeps, 'secretResolver' | 'storage'>,
): Promise<Result<{ url: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  return completeUpload(tenant.value, BRANDING_ASSET_KINDS, input, deps);
};

export const getPublicImageAssetUrl = async (
  tenantId: string,
  input: { kind: string; file: string },
  deps: Pick<ImageAssetDeps, 'secretResolver' | 'storage'>,
): Promise<Result<string, AppError>> => {
  const kind = imageAssetKindSchema.safeParse(input.kind);
  const fileMatch = imageAssetFilePattern.exec(input.file);
  if (!kind.success || fileMatch === null) return err(notFound('Image asset not found'));
  const contentType = Object.entries(IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION)
    .find(([extension]) => extension === fileMatch[1])?.[1];
  if (contentType === undefined) return err(notFound('Image asset not found'));
  try {
    const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
    if (!configuration.ok) return err(notFound('Image asset not found'));
    const key = `image-assets/${tenantId}/${kind.data}/${input.file}`;
    const target = deps.storage.objectUrl(configuration.value, key);
    target.searchParams.set('response-content-type', contentType);
    const signed = deps.storage.presignGet({
      url: target.toString(),
      accessKeyId: configuration.value.accessKeyId,
      secretAccessKey: configuration.value.secretAccessKey,
      region: configuration.value.region,
      expiresInSeconds: IMAGE_ASSET_GET_TTL_SECONDS,
    });
    return signed.ok ? signed : err(notFound('Image asset not found'));
  } catch {
    return err(notFound('Image asset not found'));
  }
};
