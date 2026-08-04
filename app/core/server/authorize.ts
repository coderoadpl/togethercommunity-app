import {
  err,
  capabilitiesForPrincipal,
  forbidden,
  ok,
  requiresVerifiedEmail,
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

export const authorize = (
  ctx: Ctx,
  capability: Capability,
  options: { allowUnverifiedEmail?: boolean } = {},
): AppError | null => {
  const granted =
    ctx.capabilities?.includes(capability)
    ?? (
      capabilitiesForPrincipal(principalFor(ctx)).includes(capability)
      || (
        ctx.identity.memberId !== null
        && capabilitiesForPrincipal('member').includes(capability)
      )
    );
  if (!granted) return forbidden(`${capability} is not permitted`);
  return requiresVerifiedEmail(capability)
    && !ctx.identity.emailVerified
    && options.allowUnverifiedEmail !== true
    ? forbidden(`${capability} requires a verified email address`)
    : null;
};

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

export const authorizeRequiredTenant = (
  ctx: Ctx,
  capability: Capability,
): Result<string, AppError> => {
  const denial = authorize(ctx, capability);
  if (denial !== null) return err(denial);
  return ctx.identity.tenantId === null
    ? err(forbidden('Tenant context is required'))
    : ok(ctx.identity.tenantId);
};
