import {
  err,
  forbidden,
  notFound,
  ok,
  setTenantSecretInputSchema,
  tenantNotFound,
  validation,
  type AppError,
  type Result,
  type SetTenantSecretInput,
  type TenantSecret,
  type TenantSecretKey,
  type TenantSecretMasked,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, SecretCrypto, TenantSecretRepository } from '../ports.js';

export interface TenantSecretDeps {
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  ids: IdGenerator;
  clock: Clock;
}

const requireTenant = (ctx: Ctx, roles: ReadonlyArray<'owner' | 'admin'>): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to manage secrets'));
  if (!ctx.identity.staffRole || !roles.includes(ctx.identity.staffRole)) {
    return err(forbidden('You cannot manage secrets for this tenant'));
  }
  return ok(ctx.identity.tenantId);
};

const masked = (secret: TenantSecret): TenantSecretMasked => ({
  key: secret.key,
  maskedPreview: secret.maskedPreview,
  updatedAt: secret.updatedAt,
});

const maskValue = (value: string): string => {
  const suffix = value.slice(-4);
  return `••••${suffix}`;
};

export const setTenantSecret = async (
  ctx: Ctx,
  input: SetTenantSecretInput,
  deps: TenantSecretDeps,
): Promise<Result<TenantSecretMasked, AppError>> => {
  const tenant = requireTenant(ctx, ['owner']);
  if (!tenant.ok) return tenant;
  const parsed = setTenantSecretInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid tenant secret', parsed.error.flatten()));
  const encrypted = deps.secretCrypto.encrypt(parsed.data.value);
  const stored = await deps.tenantSecrets.upsert(tenant.value, {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    key: parsed.data.key,
    ...encrypted,
    maskedPreview: maskValue(parsed.data.value),
    updatedAt: deps.clock.nowIso(),
  });
  return ok(masked(stored));
};

export const getTenantSecretsMasked = async (
  ctx: Ctx,
  deps: TenantSecretDeps,
): Promise<Result<TenantSecretMasked[], AppError>> => {
  const tenant = requireTenant(ctx, ['owner', 'admin']);
  if (!tenant.ok) return tenant;
  return ok((await deps.tenantSecrets.listByTenant(tenant.value)).map(masked));
};

export const deleteTenantSecret = async (
  ctx: Ctx,
  key: TenantSecretKey,
  deps: TenantSecretDeps,
): Promise<Result<{ key: TenantSecretKey }, AppError>> => {
  const tenant = requireTenant(ctx, ['owner']);
  if (!tenant.ok) return tenant;
  if (!(await deps.tenantSecrets.delete(tenant.value, key))) {
    return err(notFound(`No secret "${key}" in this tenant`));
  }
  return ok({ key });
};
