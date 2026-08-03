import {
  PRODUCT_DOWNLOAD_MAX_BYTES,
  err,
  forbidden,
  integrationNotConfigured,
  notFound,
  ok,
  productDownloadUploadInputSchema,
  storageConfigurationSchema,
  validation,
  type AppError,
  type Product,
  type ProductDownloadAsset,
  type ProductDownloadUploadInput,
  type Result,
  type StorageConfiguration,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock,
  IdGenerator,
  ProductDownloadAssetRepository,
  ProductGrantRepository,
  ProductRepository,
  StorageProvider,
  TenantSecretResolver,
} from '../ports.js';

const PRODUCT_DOWNLOAD_UPLOAD_TTL_SECONDS = 15 * 60;
export const PRODUCT_DOWNLOAD_TTL_SECONDS = 60 * 60;

export interface ProductDownloadDeps {
  downloadAssets: ProductDownloadAssetRepository;
  products: ProductRepository;
  grants: ProductGrantRepository;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  ids: IdGenerator;
  clock: Clock;
}

const resolveStorageConfiguration = async (
  tenantId: string,
  secretResolver: TenantSecretResolver,
): Promise<Result<StorageConfiguration, AppError>> => {
  const stored = await secretResolver.resolve(tenantId, 's3.configuration');
  if (!stored.ok) {
    return stored.error.code === 'not_found'
      ? err(integrationNotConfigured('Storage is not configured.'))
      : stored;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(stored.value);
  } catch {
    return err(integrationNotConfigured('The stored storage configuration is invalid.'));
  }
  const parsed = storageConfigurationSchema.safeParse(decoded);
  return parsed.success
    ? ok(parsed.data)
    : err(integrationNotConfigured('The stored storage configuration is invalid.'));
};

const storageFileName = (fileName: string): string => {
  const normalized = fileName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120);
  return normalized.length > 0 ? normalized : 'download';
};

const expiresAt = (nowIso: string, ttlSeconds: number): string =>
  new Date(Date.parse(nowIso) + ttlSeconds * 1000).toISOString();

const requireDigitalProduct = async (
  tenantId: string,
  productId: string,
  products: ProductRepository,
): Promise<Result<Product, AppError>> => {
  const product = await products.findById(tenantId, productId);
  if (product === null) return err(notFound(`No product "${productId}" in this tenant`));
  return product.type === 'digital_download'
    ? ok(product)
    : err(validation('Files can only be attached to digital-download products'));
};

export const beginProductDownloadUpload = async (
  ctx: Ctx,
  productId: string,
  input: ProductDownloadUploadInput,
  deps: ProductDownloadDeps,
): Promise<Result<{ asset: ProductDownloadAsset; uploadUrl: string; expiresAt: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const parsed = productDownloadUploadInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid download asset', parsed.error.flatten()));
  const product = await requireDigitalProduct(tenant.value, productId, deps.products);
  if (!product.ok) return product;
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;

  const id = deps.ids.nextId();
  const storageKey = `product-downloads/${productId}/${id}/${storageFileName(parsed.data.fileName)}`;
  const signed = deps.storage.presignPut({
    url: deps.storage.objectUrl(configuration.value, storageKey).toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
    expiresInSeconds: PRODUCT_DOWNLOAD_UPLOAD_TTL_SECONDS,
  });
  if (!signed.ok) return signed;
  const createdAt = deps.clock.nowIso();
  const asset: ProductDownloadAsset = {
    id,
    tenantId: tenant.value,
    productId,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    storageKey,
    status: 'pending',
    createdAt,
  };
  await deps.downloadAssets.create(tenant.value, asset);
  return ok({
    asset,
    uploadUrl: signed.value,
    expiresAt: expiresAt(createdAt, PRODUCT_DOWNLOAD_UPLOAD_TTL_SECONDS),
  });
};

export const completeProductDownloadUpload = async (
  ctx: Ctx,
  productId: string,
  assetId: string,
  deps: Pick<ProductDownloadDeps, 'downloadAssets' | 'secretResolver' | 'storage'>,
): Promise<Result<ProductDownloadAsset, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const asset = await deps.downloadAssets.findById(tenant.value, assetId);
  if (asset === null || asset.productId !== productId) {
    return err(notFound(`No download asset "${assetId}" on this product`));
  }
  if (asset.status === 'ready') return ok(asset);
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const storedObject = await deps.storage.head({
    url: deps.storage.objectUrl(configuration.value, asset.storageKey).toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
  });
  if (!storedObject.ok) return storedObject;
  if (storedObject.value.sizeBytes < 1 || storedObject.value.sizeBytes > PRODUCT_DOWNLOAD_MAX_BYTES) {
    return err(validation(`Uploaded file must be between 1 and ${String(PRODUCT_DOWNLOAD_MAX_BYTES)} bytes`));
  }
  const ready = await deps.downloadAssets.markReady(tenant.value, assetId, storedObject.value.sizeBytes);
  return ready === null
    ? err(notFound(`No download asset "${assetId}" on this product`))
    : ok(ready);
};

export const listProductDownloadAssets = async (
  ctx: Ctx,
  productId: string,
  deps: Pick<ProductDownloadDeps, 'downloadAssets' | 'products'>,
): Promise<Result<ProductDownloadAsset[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:read');
  if (!tenant.ok) return tenant;
  const product = await requireDigitalProduct(tenant.value, productId, deps.products);
  return product.ok
    ? ok(await deps.downloadAssets.listByProduct(tenant.value, productId))
    : product;
};

export const getProductDownload = async (
  ctx: Ctx,
  productId: string,
  assetId: string,
  deps: Pick<ProductDownloadDeps, 'clock' | 'downloadAssets' | 'grants' | 'secretResolver' | 'storage'>,
): Promise<Result<string, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:product:read');
  if (!tenant.ok) return tenant;
  if (!ctx.identity.memberId) return err(forbidden('Only members can download purchased files'));
  const grants = await deps.grants.listActiveForMember(
    tenant.value,
    ctx.identity.memberId,
    deps.clock.nowIso(),
  );
  if (!grants.some((grant) => grant.productId === productId)) {
    return err(forbidden('This member has no active grant for the requested product'));
  }
  const asset = await deps.downloadAssets.findById(tenant.value, assetId);
  if (asset === null || asset.productId !== productId || asset.status !== 'ready') {
    return err(notFound(`No download asset "${assetId}" on this product`));
  }
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const target = deps.storage.objectUrl(configuration.value, asset.storageKey);
  target.searchParams.set(
    'response-content-disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
  );
  target.searchParams.set('response-content-type', asset.contentType);
  return deps.storage.presignGet({
    url: target.toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
    expiresInSeconds: PRODUCT_DOWNLOAD_TTL_SECONDS,
  });
};

export const deleteProductDownloadAsset = async (
  ctx: Ctx,
  productId: string,
  assetId: string,
  deps: Pick<ProductDownloadDeps, 'downloadAssets' | 'secretResolver' | 'storage'>,
): Promise<Result<{ deleted: true }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const asset = await deps.downloadAssets.findById(tenant.value, assetId);
  if (asset === null || asset.productId !== productId) {
    return err(notFound(`No download asset "${assetId}" on this product`));
  }
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const deletedObject = await deps.storage.delete({
    url: deps.storage.objectUrl(configuration.value, asset.storageKey).toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
  });
  const deleted = await deps.downloadAssets.delete(tenant.value, assetId);
  if (!deleted) return err(notFound(`No download asset "${assetId}" on this product`));
  return deletedObject.ok
    ? ok({ deleted: true })
    : err({
        ...deletedObject.error,
        message: `Download detached, but storage object "${asset.storageKey}" could not be deleted: ${deletedObject.error.message}`,
      });
};
