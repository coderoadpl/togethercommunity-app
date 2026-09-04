import {
  err,
  capabilitiesForPrincipal,
  forbidden,
  impersonationReadOnly,
  isImpersonationReadCapability,
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

interface AuthorizeOptions {
  allowUnverifiedEmail?: boolean;
  /**
   * Decides the capability against the acting staff account instead of the
   * impersonated subject. Reserved for leaving the view, which has to work from
   * inside it; everything else stays on the subject's own read surface, so a
   * staff-only read is unreachable while viewing as a member.
   */
  asImpersonationActor?: boolean;
}

export const authorize = (
  ctx: Ctx,
  capability: Capability,
  options: AuthorizeOptions = {},
): AppError | null => {
  const impersonation = ctx.impersonation;
  if (impersonation !== undefined) {
    if (options.asImpersonationActor === true) {
      return capabilitiesForPrincipal(impersonation.actorStaffRole).includes(capability)
        ? null
        : forbidden(`${capability} is not permitted`);
    }
    if (!isImpersonationReadCapability(capability)) {
      return impersonationReadOnly(`${capability} is blocked while viewing as a member`);
    }
  }
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
  options: AuthorizeOptions = {},
): Result<string, AppError> => {
  if (ctx.identity.tenantId === null) {
    return err(tenantNotFound('Select a tenant'));
  }
  const denial = authorize(ctx, capability, options);
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
