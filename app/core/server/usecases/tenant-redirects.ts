import { ok, type AppError, type Result, type TenantRedirect } from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { TenantRedirectReader } from '../ports.js';

export interface TenantRedirectDeps {
  redirects: TenantRedirectReader;
}

export const listTenantRedirects = async (
  ctx: Ctx,
  deps: TenantRedirectDeps,
): Promise<Result<TenantRedirect[], AppError>> => {
  const tenantId = authorizeTenant(ctx, 'tenant:domain:read');
  if (!tenantId.ok) return tenantId;
  return ok(await deps.redirects.listByTenant(tenantId.value));
};
