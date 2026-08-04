import {
  createApiKeyInputSchema,
  err,
  IMPORT_API_KEY_MAX_LIFETIME_MS,
  isImportApiKeyScope,
  notFound,
  ok,
  toTenantApiKeyPublic,
  validation,
  type AppError,
  type CreateApiKeyInput,
  type Result,
  type TenantApiKey,
  type TenantApiKeyPublic,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { ApiKeyCrypto, Clock, IdGenerator, TenantApiKeyRepository } from '../ports.js';

export interface ApiKeyDeps {
  tenantApiKeys: TenantApiKeyRepository;
  apiKeyCrypto: ApiKeyCrypto;
  ids: IdGenerator;
  clock: Clock;
}

export interface CreatedApiKey {
  apiKey: TenantApiKeyPublic;
  secret: string;
}

export const createTenantApiKey = async (
  ctx: Ctx,
  input: CreateApiKeyInput,
  deps: ApiKeyDeps,
): Promise<Result<CreatedApiKey, AppError>> => {
  const tenant = authorizeTenant(ctx, 'api-key:write');
  if (!tenant.ok) return tenant;

  const parsed = createApiKeyInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid API key', parsed.error.flatten()));

  const createdAt = deps.clock.nowIso();
  const expiresAt = parsed.data.expiresAt ?? null;
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(createdAt)) {
    return err(validation('API key expiry must be in the future'));
  }
  if (
    expiresAt !== null
    && parsed.data.scopes?.some(isImportApiKeyScope) === true
    && Date.parse(expiresAt) - Date.parse(createdAt) > IMPORT_API_KEY_MAX_LIFETIME_MS
  ) {
    return err(validation('Import API key expiry cannot exceed 30 days'));
  }

  const secret = deps.apiKeyCrypto.generateSecret();
  const apiKey: TenantApiKey = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    keyHash: deps.apiKeyCrypto.hash(secret),
    scopes: parsed.data.scopes ?? null,
    createdAt,
    expiresAt,
    revokedAt: null,
  };
  await deps.tenantApiKeys.create(tenant.value, apiKey);
  return ok({ apiKey: toTenantApiKeyPublic(apiKey), secret });
};

export const listTenantApiKeys = async (
  ctx: Ctx,
  deps: ApiKeyDeps,
): Promise<Result<TenantApiKeyPublic[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'api-key:read');
  if (!tenant.ok) return tenant;
  const keys = await deps.tenantApiKeys.listByTenant(tenant.value);
  return ok(keys.map(toTenantApiKeyPublic));
};

export const revokeTenantApiKey = async (
  ctx: Ctx,
  input: { id: string },
  deps: ApiKeyDeps,
): Promise<Result<TenantApiKeyPublic, AppError>> => {
  const tenant = authorizeTenant(ctx, 'api-key:write');
  if (!tenant.ok) return tenant;

  const revoked = await deps.tenantApiKeys.revoke(tenant.value, input.id, deps.clock.nowIso());
  if (!revoked) return err(notFound(`No API key "${input.id}" in this tenant`));
  return ok(toTenantApiKeyPublic(revoked));
};
