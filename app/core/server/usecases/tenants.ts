import { err, ok, type AppError, type Membership, type Result } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantAccessReader, TenantRepository } from '../ports.js';
import { authorize } from '../authorize.js';
import { tenantCreationPolicy, type TenantCreationMode } from './create-tenant.js';

export interface MyTenantsResult {
  tenants: Membership[];
  canCreateTenant: boolean;
}

const canCreateTenant = async (
  ctx: Ctx,
  deps: {
    tenants: Pick<TenantRepository, 'hasAny'>;
    tenantCreationMode: TenantCreationMode;
  },
): Promise<boolean> => {
  const hasAnyTenant = deps.tenantCreationMode === 'closed' ? false : await deps.tenants.hasAny();
  const policy = tenantCreationPolicy(
    deps.tenantCreationMode,
    hasAnyTenant,
    ctx.identity.emailVerified,
  );
  return policy.available
    && authorize(ctx, 'tenant:create', {
      allowUnverifiedEmail: policy.allowUnverifiedEmail,
    }) === null;
};

export const listMyTenants = async (
  ctx: Ctx,
  deps: {
    tenantAccess: TenantAccessReader;
    tenants: Pick<TenantRepository, 'hasAny'>;
    tenantCreationMode: TenantCreationMode;
  },
): Promise<Result<MyTenantsResult, AppError>> => {
  const denial = authorize(ctx, 'tenant:list-own');
  if (denial !== null) return err(denial);
  const tenants = await deps.tenantAccess.listTenantsForStaff(ctx.identity.userId);
  return ok({ tenants, canCreateTenant: await canCreateTenant(ctx, deps) });
};
