import {
  err,
  capabilitiesForPrincipal,
  forbidden,
  impersonationReadOnly,
  isImpersonationReadCapability,
  notFound,
  ok,
  requiresVerifiedEmail,
  shopManagementKeyGrantCovers,
  tenantNotFound,
  type AppError,
  type Capability,
  type OrganizationRole,
  type Result,
  type ShopManagementKeyIntegrationGrant,
} from '#core/domain/index.js';

import type { Ctx, OrganizationCtx } from './context.js';

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
  /**
   * Required for a shop management key ctx to use `tenant:secret:write`, so a
   * future use-case that names no allow-listed grant stays closed to keys.
   */
  shopManagementKeyGrant?: ShopManagementKeyIntegrationGrant;
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
  if (ctx.machineActor !== undefined && !shopManagementKeyGrantCovers(capability, options.shopManagementKeyGrant)) {
    return forbidden(`${capability} is not permitted for a shop management key on this operation`);
  }
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
    const visitorDenial = ctx.identity.tenantAccess === 'none' ? authorize(ctx, capability, options) : null;
    return err(visitorDenial ?? tenantNotFound('Select a tenant'));
  }
  const denial = authorize(ctx, capability, options);
  if (denial !== null) return err(denial);
  return ok(ctx.identity.tenantId);
};

/**
 * An organization-derived role ends with the organization link or membership, so operations whose
 * result outlives the request (credentials, team grants) stay with roles granted in the workspace.
 */
export const requireDirectGrant = (
  ctx: Ctx,
  tenant: Result<string, AppError>,
  refusal: string,
): Result<string, AppError> => {
  if (!tenant.ok) return tenant;
  return ctx.identity.staffGrantSource === 'direct' && ctx.machineActor === undefined
    ? tenant
    : err(forbidden(refusal));
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

export const authorizeOrganization = (
  octx: OrganizationCtx,
  organizationId: string,
  capability: Capability,
): Result<{ organizationId: string; role: OrganizationRole }, AppError> => {
  const membership = octx.membership;
  if (membership === null || membership.organizationId !== organizationId) {
    return err(notFound('Organization not found'));
  }
  const roleGrants = capabilitiesForPrincipal(membership.role === 'owner' ? 'organization-owner' : 'organization-admin');
  const granted = roleGrants.includes(capability) && (octx.capabilities?.includes(capability) ?? true);
  if (!granted) return err(forbidden(`${capability} is not permitted`));
  return ok({ organizationId, role: membership.role });
};
