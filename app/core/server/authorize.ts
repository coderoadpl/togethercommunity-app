import {
  err,
  capabilitiesForPrincipal,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type Capability,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from './context.js';

const principalFor = (ctx: Ctx) => {
  if (ctx.identity.staffRole === 'owner') return 'owner';
  if (ctx.identity.staffRole === 'admin') return 'admin';
  if (ctx.identity.memberId !== null) return 'member';
  return 'authenticated';
};

export const authorize = (ctx: Ctx, capability: Capability): AppError | null =>
  (ctx.capabilities ?? capabilitiesForPrincipal(principalFor(ctx))).includes(capability)
    ? null
    : forbidden(`${capability} is not permitted`);

export const authorizeTenant = (
  ctx: Ctx,
  capability: Capability,
): Result<string, AppError> => {
  if (ctx.identity.tenantId === null) {
    return err(tenantNotFound('Select a tenant'));
  }
  const denial = authorize(ctx, capability);
  if (denial !== null) return err(denial);
  return ok(ctx.identity.tenantId);
};
