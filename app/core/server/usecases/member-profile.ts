import {
  banned,
  err,
  forbidden,
  notFound,
  ok,
  type AppError,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { MemberRepository } from '../ports.js';

export interface MemberProfileDeps {
  members: MemberRepository;
}

export interface MemberProfileUpdate {
  displayName: string | null;
}

export const updateMyProfile = async (
  ctx: Ctx,
  input: MemberProfileUpdate,
  deps: MemberProfileDeps,
): Promise<Result<MemberProfileUpdate, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:profile:self-write');
  if (!tenant.ok) return tenant;
  if (ctx.identity.memberId === null) {
    return err(forbidden('Only tenant members can edit their profile'));
  }
  if (ctx.identity.memberBannedAt !== null) {
    return err(banned('This account is suspended in this community'));
  }
  const updated = await deps.members.updateDisplayName(
    tenant.value,
    ctx.identity.memberId,
    input.displayName,
  );
  if (updated === null || updated.deletedAt !== null) {
    return err(notFound(`No member "${ctx.identity.memberId}" in this tenant`));
  }
  return ok({ displayName: updated.displayName });
};
