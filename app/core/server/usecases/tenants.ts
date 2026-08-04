import {
  decideTenantCreation,
  err,
  ok,
  type AppError,
  type Membership,
  type Result,
  type TenantCreationMode,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantAccessReader, TenantRepository } from '../ports.js';
import { authorize } from '../authorize.js';
import { tenantCreationPolicy } from './create-tenant.js';

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
  const { allowUnverifiedEmail } = tenantCreationPolicy(
    deps.tenantCreationMode,
    hasAnyTenant,
    ctx.identity.emailVerified,
  );
  const principalAllowed = authorize(ctx, 'tenant:create', { allowUnverifiedEmail }) === null;
  return decideTenantCreation({
    principalAllowed,
    mode: deps.tenantCreationMode,
    hasAnyTenant,
  }).allowed;
};

export const listMyTenants = async (
  ctx: Ctx,
  deps: {
    tenantAccess: Pick<TenantAccessReader, 'listTenantsForStaff'>;
    tenants: Pick<TenantRepository, 'hasAny'>;
    tenantCreationMode: TenantCreationMode;
  },
): Promise<Result<MyTenantsResult, AppError>> => {
  const denial = authorize(ctx, 'tenant:list-own');
  if (denial !== null) return err(denial);
  const tenants = await deps.tenantAccess.listTenantsForStaff(ctx.identity.userId);
  return ok({ tenants, canCreateTenant: await canCreateTenant(ctx, deps) });
};
