import { err, impersonationReadOnly, ok, type AppError, type Result } from '#core/domain/index.js';

import type { Ctx, OrganizationCtx } from './context.js';
import type { OrganizationMemberRepository } from './ports.js';

export const organizationContext = async (
  ctx: Ctx,
  organizationId: string,
  deps: { organizationMembers: Pick<OrganizationMemberRepository, 'find'> },
): Promise<Result<OrganizationCtx, AppError>> => {
  if (ctx.impersonation !== undefined) {
    return err(impersonationReadOnly('Organizations are unavailable while viewing as a member'));
  }
  const member = await deps.organizationMembers.find(organizationId, ctx.identity.userId);
  return ok({
    identity: { userId: ctx.identity.userId, email: ctx.identity.email, emailVerified: ctx.identity.emailVerified },
    membership: member === null ? null : { organizationId: member.organizationId, role: member.role },
  });
};
