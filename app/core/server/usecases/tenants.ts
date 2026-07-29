import { err, ok, type AppError, type Membership, type Result } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantAccessReader } from '../ports.js';
import { authorize } from '../authorize.js';

export const listMyTenants = async (
  ctx: Ctx,
  deps: { tenantAccess: TenantAccessReader },
): Promise<Result<Membership[], AppError>> => {
  const denial = authorize(ctx, 'tenant:list-own');
  return denial === null
    ? ok(await deps.tenantAccess.listTenantsForStaff(ctx.identity.userId))
    : err(denial);
};
