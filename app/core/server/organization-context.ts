import { err, impersonationReadOnly, ok, type AppError, type Result } from '#core/domain/index.js';

import type { Ctx, OrganizationCtx } from './context.js';
import type { OrganizationMemberRepository, OrganizationRepository } from './ports.js';

export const organizationContext = async (
  ctx: Ctx,
  organizationId: string,
  deps: {
    organizationMembers: Pick<OrganizationMemberRepository, 'find'>;
    organizations: Pick<OrganizationRepository, 'findById'>;
  },
): Promise<Result<OrganizationCtx, AppError>> => {
  if (ctx.impersonation !== undefined) {
    return err(impersonationReadOnly('Organizations are unavailable while viewing as a member'));
  }
  const [member, organization] = await Promise.all([
    deps.organizationMembers.find(organizationId, ctx.identity.userId),
    deps.organizations.findById(organizationId),
  ]);
  return ok({
    identity: { userId: ctx.identity.userId, email: ctx.identity.email, emailVerified: ctx.identity.emailVerified },
    membership: member === null || organization === null
      ? null
      : { organizationId: member.organizationId, role: member.role, organizationStatus: organization.status },
  });
};
