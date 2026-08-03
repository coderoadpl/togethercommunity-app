import { err, notFound, ok, validation, type AppError, type MemberEvent, type Result } from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { MemberEventRepository, MemberRepository } from '../ports.js';

export const listMemberTimeline = async (
  ctx: Ctx,
  input: { memberId: string },
  deps: { members: MemberRepository; memberEvents: MemberEventRepository },
): Promise<Result<MemberEvent[], AppError>> => {
  const tenantId = authorizeTenant(ctx, 'member:timeline:read');
  if (!tenantId.ok) return tenantId;
  if (input.memberId.trim().length === 0) return err(validation('memberId is required'));
  const member = await deps.members.findById(tenantId.value, input.memberId);
  if (member === null) return err(notFound('Member was not found'));
  return ok(await deps.memberEvents.listForMember(tenantId.value, member.id));
};
