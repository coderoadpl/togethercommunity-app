import {
  err,
  integrationNotConfigured,
  ok,
  storageConfigurationSchema,
  type AppError,
  type Result,
  type StorageConfiguration,
} from '#core/domain/index.js';

import type { TenantSecretResolver } from '../ports.js';

export const resolveStorageConfiguration = async (
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

export const storageFileName = (fileName: string, fallback: string): string => {
  const normalized = fileName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120);
  return normalized.length > 0 ? normalized : fallback;
};

export const storageAssetExpiresAt = (nowIso: string, ttlSeconds: number): string =>
  new Date(Date.parse(nowIso) + ttlSeconds * 1000).toISOString();
