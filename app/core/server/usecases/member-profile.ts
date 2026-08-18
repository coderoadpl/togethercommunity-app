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
import type { Clock, MemberRepository } from '../ports.js';

export interface MemberProfileDeps {
  members: MemberRepository;
  clock: Clock;
}

export interface MemberProfileInput {
  displayName: string | null;
  dmOptOut?: boolean | undefined;
}

export interface MemberProfile {
  displayName: string | null;
  dmOptOut: boolean;
}

export const updateMyProfile = async (
  ctx: Ctx,
  input: MemberProfileInput,
  deps: MemberProfileDeps,
): Promise<Result<MemberProfile, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:profile:self-write');
  if (!tenant.ok) return tenant;
  if (ctx.identity.memberId === null) {
    return err(forbidden('Only tenant members can edit their profile'));
  }
  if (ctx.identity.memberBannedAt !== null) {
    return err(banned('This account is suspended in this community'));
  }
  const renamed = await deps.members.updateDisplayName(
    tenant.value,
    ctx.identity.memberId,
    input.displayName,
  );
  const updated =
    input.dmOptOut === undefined
      ? renamed
      : await deps.members.updateDmOptOut(
          tenant.value,
          ctx.identity.memberId,
          input.dmOptOut ? deps.clock.nowIso() : null,
        );
  if (updated === null || updated.deletedAt !== null) {
    return err(notFound(`No member "${ctx.identity.memberId}" in this tenant`));
  }
  return ok({ displayName: updated.displayName, dmOptOut: updated.dmOptOutAt !== null });
};
