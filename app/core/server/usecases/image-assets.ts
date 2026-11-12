import {
  AVATAR_IMAGE_MAX_BYTES,
  IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION,
  IMAGE_ASSET_EXTENSION_BY_CONTENT_TYPE,
  IMAGE_ASSET_MAX_BYTES,
  err,
  imageAssetKindSchema,
  imageAssetContentTypesFor,
  imageAssetUploadInputSchema,
  notFound,
  ok,
  validation,
  type AppError,
  type ImageAssetKind,
  type ImageAssetUploadInput,
  type Result,
  type StorageConfiguration,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { imageContentMatches } from '../image-content.js';
import type {
  Clock,
  AccountAvatarRepository,
  AvatarImageProcessor,
  IdGenerator,
  StorageProvider,
  TenantSecretResolver,
} from '../ports.js';
import { resolveStorageConfiguration, storageAssetExpiresAt } from './storage-assets.js';

const BRANDING_ASSET_KINDS: readonly ImageAssetKind[] = ['logo', 'logo-dark', 'favicon', 'share-image'];

const IMAGE_ASSET_UPLOAD_TTL_SECONDS = 15 * 60;
export const IMAGE_ASSET_GET_TTL_SECONDS = 60 * 60;

const imageAssetFilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|svg|ico)$/;
const avatarServePathPattern = /^\/api\/public\/assets\/avatar\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp)$/iu;

const servePath = (kind: ImageAssetKind, file: string): string =>
  `/api/public/assets/${kind}/${file}`;

const deleteAvatarObject = async (
  tenantId: string,
  image: string | null,
  configuration: StorageConfiguration,
  storage: StorageProvider,
): Promise<Result<void, AppError>> => {
  const file = image === null ? undefined : avatarServePathPattern.exec(image)?.[1];
  if (file === undefined) return ok(undefined);
  const removed = await storage.delete({
    url: storage.objectUrl(configuration, `image-assets/${tenantId}/avatar/${file}`).toString(),
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    region: configuration.region,
  });
  return removed.ok ? ok(undefined) : removed;
};

export const deleteAvatarImage = async (
  tenantId: string,
  image: string | null,
  deps: { secretResolver: TenantSecretResolver; storage: StorageProvider },
): Promise<Result<void, AppError>> => {
  if (image === null) return ok(undefined);
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  return deleteAvatarObject(tenantId, image, configuration.value, deps.storage);
};

const fileContentType = (file: string) => Object.entries(IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION)
  .find(([extension]) => file.endsWith(`.${extension}`))?.[1];

const parseCandidateKey = (
  tenantId: string,
  key: string,
): { kind: ImageAssetKind; file: string; contentType: string } | null => {
  const parts = key.split('/');
  if (parts.length !== 4 || parts[0] !== 'image-asset-candidates' || parts[1] !== tenantId) return null;
  const kind = imageAssetKindSchema.safeParse(parts[2]);
  const file = parts[3];
  if (!kind.success || file === undefined || !imageAssetFilePattern.test(file)) return null;
  const id = file.slice(0, file.lastIndexOf('.'));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    return null;
  }
  const contentType = fileContentType(file);
  if (contentType === undefined || !imageAssetContentTypesFor(kind.data).includes(contentType)) return null;
  return { kind: kind.data, file, contentType };
};

export interface ImageAssetDeps {
  logger: { error(message: string): void };
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  ids: IdGenerator;
  clock: Clock;
}

export interface AvatarImageAssetDeps extends ImageAssetDeps {
  avatars: AccountAvatarRepository;
  avatarImages: AvatarImageProcessor;
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
  const key = `image-asset-candidates/${tenantId}/${parsed.data.kind}/${file}`;
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
  const parsed = parseCandidateKey(tenantId, input.key);
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
  const credentials = {
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
  };
  const source = await deps.storage.getObject({ url: target, ...credentials }, {
    maxBytes: IMAGE_ASSET_MAX_BYTES,
    range: true,
  });
  if (!source.ok && source.error.code !== 'validation') return source;
  if (!source.ok || !imageContentMatches(source.value, parsed.file.split('.').at(-1) ?? '')) {
    const removed = await deps.storage.delete({ url: target, ...credentials });
    if (!removed.ok) return removed;
    return err(validation('Uploaded image does not match its declared format or size'));
  }
  const published = await deps.storage.putObject({
    url: deps.storage.objectUrl(configuration.value, `image-assets/${tenantId}/${parsed.kind}/${parsed.file}`).toString(),
    ...credentials,
    body: source.value,
    contentType: parsed.contentType,
  });
  if (!published.ok) return published;
  const removed = await deps.storage.delete({ url: target, ...credentials });
  if (!removed.ok) return removed;
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

export const beginAvatarUpload = async (
  ctx: Ctx,
  input: ImageAssetUploadInput,
  deps: ImageAssetDeps,
): Promise<Result<ImageAssetUploadStart, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:profile:self-write');
  if (!tenant.ok) return tenant;
  if (ctx.identity.memberId === null) return err(validation('Only tenant members can manage an avatar'));
  return beginUpload(tenant.value, ['avatar'], input, deps);
};

export const completeAvatarUpload = async (
  ctx: Ctx,
  input: { key: string },
  deps: Pick<AvatarImageAssetDeps, 'avatars' | 'avatarImages' | 'secretResolver' | 'storage' | 'logger'>,
): Promise<Result<{ url: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:profile:self-write');
  if (!tenant.ok) return tenant;
  if (ctx.identity.memberId === null) return err(validation('Only tenant members can manage an avatar'));
  const parsed = parseCandidateKey(tenant.value, input.key);
  if (parsed === null || parsed.kind !== 'avatar') return err(notFound('Image asset not found'));
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const sourceUrl = deps.storage.objectUrl(configuration.value, input.key).toString();
  const storedObject = await deps.storage.head({
    url: sourceUrl,
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
  });
  if (!storedObject.ok) return storedObject;
  if (storedObject.value.sizeBytes < 1 || storedObject.value.sizeBytes > AVATAR_IMAGE_MAX_BYTES) {
    const removed = await deps.storage.delete({
      url: sourceUrl,
      accessKeyId: configuration.value.accessKeyId,
      secretAccessKey: configuration.value.secretAccessKey,
      region: configuration.value.region,
    });
    if (!removed.ok) return removed;
    return err(validation(`Uploaded avatar must be between 1 and ${String(AVATAR_IMAGE_MAX_BYTES)} bytes`));
  }
  const id = parsed.file.slice(0, parsed.file.lastIndexOf('.'));
  const targetKey = `image-assets/${tenant.value}/avatar/${id}.webp`;
  const current = await deps.avatars.findState(tenant.value, ctx.identity.userId);
  const processed = await deps.avatarImages.processStored({
    configuration: configuration.value,
    sourceKey: input.key,
    targetKey,
  });
  if (!processed.ok) {
    if (processed.error.code === 'validation') {
      const removed = await deps.storage.delete({
        url: sourceUrl,
        accessKeyId: configuration.value.accessKeyId,
        secretAccessKey: configuration.value.secretAccessKey,
        region: configuration.value.region,
      });
      if (!removed.ok) return removed;
    }
    return processed;
  }
  const url = servePath('avatar', `${id}.webp`);
  if (targetKey !== input.key) {
    const removed = await deps.storage.delete({
      url: sourceUrl,
      accessKeyId: configuration.value.accessKeyId,
      secretAccessKey: configuration.value.secretAccessKey,
      region: configuration.value.region,
    });
    if (!removed.ok) {
      const compensation = await deleteAvatarObject(tenant.value, url, configuration.value, deps.storage);
      if (!compensation.ok) {
        deps.logger.error(`[avatar] tenant "${tenant.value}" could not delete storage object "${targetKey}": ${compensation.error.message}`);
      }
      return removed;
    }
  }
  if (current?.image !== url) {
    const removed = await deleteAvatarObject(
      tenant.value,
      current?.image ?? null,
      configuration.value,
      deps.storage,
    );
    if (!removed.ok) {
      const compensation = await deleteAvatarObject(tenant.value, url, configuration.value, deps.storage);
      if (!compensation.ok) {
        deps.logger.error(`[avatar] tenant "${tenant.value}" could not delete storage object "${targetKey}": ${compensation.error.message}`);
      }
      return removed;
    }
  }
  await deps.avatars.setAvatar(tenant.value, ctx.identity.userId, url);
  return ok({ url });
};

export const removeAvatar = async (
  ctx: Ctx,
  deps: Pick<AvatarImageAssetDeps, 'avatars' | 'secretResolver' | 'storage'>,
): Promise<Result<{ removed: true }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:profile:self-write');
  if (!tenant.ok) return tenant;
  if (ctx.identity.memberId === null) return err(validation('Only tenant members can manage an avatar'));
  const current = await deps.avatars.findState(tenant.value, ctx.identity.userId);
  const removed = await deleteAvatarImage(tenant.value, current?.image ?? null, deps);
  if (!removed.ok) return removed;
  await deps.avatars.removeAvatar(tenant.value, ctx.identity.userId);
  return ok({ removed: true });
};

export const importGoogleAvatar = async (
  input: { tenantId: string; userId: string; sourceUrl: string },
  deps: Pick<AvatarImageAssetDeps, 'avatars' | 'avatarImages' | 'ids' | 'secretResolver' | 'storage' | 'logger'>,
): Promise<void> => {
  const state = await deps.avatars.findState(input.tenantId, input.userId);
  if (state === null || !state.canImport) return;
  const configuration = await resolveStorageConfiguration(input.tenantId, deps.secretResolver);
  if (!configuration.ok) return;
  const file = `${deps.ids.nextId()}.webp`;
  const targetKey = `image-assets/${input.tenantId}/avatar/${file}`;
  const imported = await deps.avatarImages.importRemote({
    configuration: configuration.value,
    sourceUrl: input.sourceUrl,
    targetKey,
  });
  if (!imported.ok) return;
  const stored = await deps.avatars.setAvatarIfMissing(
    input.tenantId,
    input.userId,
    servePath('avatar', file),
  );
  if (!stored) {
    const removed = await deleteAvatarObject(
      input.tenantId,
      servePath('avatar', file),
      configuration.value,
      deps.storage,
    );
    if (!removed.ok) {
      deps.logger.error(`[avatar] tenant "${input.tenantId}" could not delete storage object "${targetKey}": ${removed.error.message}`);
    }
  }
};

export const getPublicImageAssetUrl = async (
  tenantId: string,
  input: { kind: string; file: string },
  deps: Pick<ImageAssetDeps, 'secretResolver' | 'storage'>,
): Promise<Result<string, AppError>> => {
  const kind = imageAssetKindSchema.safeParse(input.kind);
  const fileMatch = imageAssetFilePattern.exec(input.file);
  if (!kind.success || fileMatch === null) return err(notFound('Image asset not found'));
  const contentType = fileContentType(input.file);
  if (contentType === undefined || !imageAssetContentTypesFor(kind.data).includes(contentType)
    || (kind.data === 'avatar' && contentType !== 'image/webp')) {
    return err(notFound('Image asset not found'));
  }
  try {
    const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
    if (!configuration.ok) return err(notFound('Image asset not found'));
    const key = `image-assets/${tenantId}/${kind.data}/${input.file}`;
    const target = deps.storage.objectUrl(configuration.value, key);
    target.searchParams.set('response-content-type', contentType);
    target.searchParams.set('response-content-disposition', contentType === 'image/svg+xml' ? 'attachment' : 'inline');
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
