import { ok, type AppError, type Result, type TenantRouting } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { TenantDomainRepository } from '../ports.js';
import { tenantUrl, type TenantUrlDeps } from '../tenant-url.js';

export interface TenantRoutingDeps {
  tenantDomains: TenantDomainRepository;
  routing: TenantUrlDeps;
  customDomainTarget: string;
}

export const getTenantRouting = async (
  ctx: Ctx,
  deps: TenantRoutingDeps,
): Promise<Result<TenantRouting, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:domain:read');
  if (!tenant.ok) return tenant;
  const domains = await deps.tenantDomains.listByTenant(tenant.value);
  return ok({
    tenantHost: new URL(tenantUrl(ctx.identity.tenantSlug, '/', deps.routing)).host,
    customDomains: domains
      .filter((domain) => domain.kind === 'custom')
      .map((domain) => ({ domain: domain.domain, verified: domain.verified })),
    customDomainTarget: deps.customDomainTarget,
  });
};
