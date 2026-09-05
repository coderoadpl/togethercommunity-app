import {
  banned,
  err,
  forbidden,
  notFound,
  ok,
  type AppError,
  type Language,
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
  displayName?: string | null | undefined;
  dmOptOut?: boolean | undefined;
  language?: Language | null | undefined;
  videoAutoplay?: boolean | undefined;
}

export interface MemberProfile {
  displayName: string | null;
  dmOptOut: boolean;
  language: Language | null;
  videoAutoplay: boolean;
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
  const renamed =
    input.displayName === undefined
      ? await deps.members.findById(tenant.value, ctx.identity.memberId)
      : await deps.members.updateDisplayName(tenant.value, ctx.identity.memberId, input.displayName);
  const withOptOut =
    input.dmOptOut === undefined
      ? renamed
      : await deps.members.updateDmOptOut(
          tenant.value,
          ctx.identity.memberId,
          input.dmOptOut ? deps.clock.nowIso() : null,
        );
  const withLanguage =
    input.language === undefined
      ? withOptOut
      : await deps.members.updateLanguage(tenant.value, ctx.identity.memberId, input.language);
  const updated =
    input.videoAutoplay === undefined
      ? withLanguage
      : await deps.members.updateVideoAutoplay(
          tenant.value,
          ctx.identity.memberId,
          input.videoAutoplay,
        );
  if (updated === null || updated.deletedAt !== null) {
    return err(notFound(`No member "${ctx.identity.memberId}" in this tenant`));
  }
  return ok({
    displayName: updated.displayName,
    dmOptOut: updated.dmOptOutAt !== null,
    language: updated.language ?? null,
    videoAutoplay: updated.videoAutoplay ?? false,
  });
};
