import { err, forbidden, type AppError, type Result } from '#core/domain/index.js';

import type { Ctx } from './context.js';

export const ownerSessionTenant = (
  ctx: Ctx,
  tenant: Result<string, AppError>,
  refusal: string,
): Result<string, AppError> => {
  if (!tenant.ok) return tenant;
  const realOwnerSession = ctx.identity.staffRole === 'owner'
    && ctx.identity.emailVerified
    && ctx.impersonation === undefined
    && ctx.capabilities === undefined
    && ctx.machineActor === undefined;
  return realOwnerSession ? tenant : err(forbidden(refusal));
};
