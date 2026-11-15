import {
  err,
  ok,
  shopIntegrationSecretDeleteInputSchema,
  shopIntegrationSecretInputSchema,
  validation,
  type AppError,
  type Result,
  type ShopIntegrationSecretInput,
  type ShopIntegrationSecretKey,
  type TenantSecretMasked,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { TenantUrlDeps } from '../tenant-url.js';
import {
  deleteTenantSecret,
  getTenantSecretsMasked,
  setTenantSecret,
  type TenantSecretDeps,
  type TenantSecretsView,
} from './tenant-secrets.js';

export const getShopIntegrationSecrets = async (
  ctx: Ctx,
  deps: TenantSecretDeps & TenantUrlDeps,
): Promise<Result<TenantSecretsView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:read');
  if (!tenant.ok) return tenant;
  return getTenantSecretsMasked(ctx, deps);
};

export const setShopIntegrationSecret = async (
  ctx: Ctx,
  input: ShopIntegrationSecretInput,
  deps: TenantSecretDeps,
): Promise<Result<TenantSecretMasked, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  const parsed = shopIntegrationSecretInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid integration secret', parsed.error.flatten()));
  return setTenantSecret(ctx, parsed.data, deps);
};

export const deleteShopIntegrationSecret = async (
  ctx: Ctx,
  key: string,
  deps: TenantSecretDeps,
): Promise<Result<{ key: ShopIntegrationSecretKey }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  const parsed = shopIntegrationSecretDeleteInputSchema.safeParse({ key });
  if (!parsed.success) return err(validation('Invalid integration secret key', parsed.error.flatten()));
  const deleted = await deleteTenantSecret(ctx, parsed.data.key, deps);
  return deleted.ok ? ok({ key: parsed.data.key }) : deleted;
};
