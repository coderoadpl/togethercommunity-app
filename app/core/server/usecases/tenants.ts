import {
  decideTenantCreation,
  err,
  isPlatformOwner,
  ok,
  type AppError,
  type Membership,
  type Tenant,
  type Result,
  type TenantCreationMode,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { AccountAvatarTenantReader, TenantAccessReader, TenantRepository } from '../ports.js';
import { authorize } from '../authorize.js';
import { tenantCreationPolicy } from './create-tenant.js';

export interface MyTenantsResult {
  tenants: Membership[];
  memberTenants: Tenant[];
  canCreateTenant: boolean;
  dataResetEnvironment: string | null;
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

const dataResetEnvironment = (
  ctx: Ctx,
  platformReset: { environment: string; ownerEmails: readonly string[] } | undefined,
): string | null =>
  platformReset !== undefined
  && ctx.identity.emailVerified
  && isPlatformOwner(ctx.identity.email, platformReset.ownerEmails)
    ? platformReset.environment
    : null;

export const listMyTenants = async (
  ctx: Ctx,
  deps: {
    tenantAccess: Pick<TenantAccessReader, 'listTenantsForStaff'>;
    accountAvatarTenants: AccountAvatarTenantReader;
    tenants: Pick<TenantRepository, 'hasAny' | 'findById'>;
    tenantCreationMode: TenantCreationMode;
    platformReset?: { environment: string; ownerEmails: readonly string[] };
  },
): Promise<Result<MyTenantsResult, AppError>> => {
  const denial = authorize(ctx, 'tenant:list-own');
  if (denial !== null) return err(denial);
  const tenants = await deps.tenantAccess.listTenantsForStaff(ctx.identity.userId);
  const memberTenantIds = await deps.accountAvatarTenants.listTenantIdsForUser(ctx.identity.userId);
  const staffTenantIds = new Set(tenants.map(({ tenant }) => tenant.id));
  const memberTenants = await Promise.all(memberTenantIds
    .filter((id) => !staffTenantIds.has(id))
    .map((id) => deps.tenants.findById(id)));
  return ok({
    tenants,
    memberTenants: memberTenants.filter((tenant): tenant is Tenant => tenant !== null),
    canCreateTenant: await canCreateTenant(ctx, deps),
    dataResetEnvironment: dataResetEnvironment(ctx, deps.platformReset),
  });
};
