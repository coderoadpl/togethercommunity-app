import {
  err,
  ok,
  storageConfigurationSchema,
  validation,
  type AppError,
  type ProviderDiagnostic,
  type Result,
  type StorageConfiguration,
  type TenantSecretMasked,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { StorageProvider } from '../ports.js';
import type { TenantSecretDeps } from './tenant-secrets.js';

export interface StorageConfigurationDeps extends TenantSecretDeps {
  storage: StorageProvider;
}

const parseConfiguration = (input: StorageConfiguration) => {
  const parsed = storageConfigurationSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(validation('Invalid storage configuration', parsed.error.flatten()));
};

export const probeStorageConnection = async (
  ctx: Ctx,
  input: StorageConfiguration,
  deps: Pick<StorageConfigurationDeps, 'storage'>,
): Promise<Result<{ diagnostic: ProviderDiagnostic }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'integration:test');
  if (!tenant.ok) return tenant;
  const parsed = parseConfiguration(input);
  if (!parsed.ok) return parsed;
  const probed = await deps.storage.probe(parsed.value);
  return probed.ok ? ok({ diagnostic: probed.value }) : probed;
};

export const configureStorageConnection = async (
  ctx: Ctx,
  input: StorageConfiguration,
  deps: StorageConfigurationDeps,
): Promise<Result<{ diagnostic: ProviderDiagnostic; secret: TenantSecretMasked }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  const parsed = parseConfiguration(input);
  if (!parsed.ok) return parsed;
  const probed = await deps.storage.probe(parsed.value);
  if (!probed.ok) return probed;

  const encrypted = deps.secretCrypto.encrypt(JSON.stringify(parsed.value));
  const stored = await deps.tenantSecrets.upsert(tenant.value, {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    key: 's3.configuration',
    ...encrypted,
    maskedPreview: '••••',
    updatedAt: deps.clock.nowIso(),
  });
  return ok({
    diagnostic: probed.value,
    secret: {
      key: stored.key,
      maskedPreview: stored.maskedPreview,
      updatedAt: stored.updatedAt,
    },
  });
};
