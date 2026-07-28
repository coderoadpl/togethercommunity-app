import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type Capability,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from './context.js';

export const authorize = (ctx: Ctx, capability: Capability): AppError | null =>
  ctx.capabilities?.includes(capability) === true
    ? null
    : forbidden(`${capability} is not permitted`);

export const authorizeTenant = (
  ctx: Ctx,
  capability: Capability,
): Result<string, AppError> => {
  const denial = authorize(ctx, capability);
  if (denial !== null) return err(denial);
  return ctx.identity.tenantId === null
    ? err(tenantNotFound('Select a tenant'))
    : ok(ctx.identity.tenantId);
};
