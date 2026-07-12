import { ok, type AppError, type Member, type Result } from '@core/domain/index.js';

import type { AuthPort, Clock, IdGenerator, MemberRepository } from '../ports.js';

export interface EnsureMemberDeps {
  authPort: AuthPort;
  members: MemberRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const ensureMember = async (
  tenantId: string,
  email: string,
  deps: EnsureMemberDeps,
): Promise<Result<Member, AppError>> => {
  const existing = await deps.members.findByEmail(tenantId, email);
  if (existing) return ok(existing);

  const { userId } = await deps.authPort.ensureUser(email);
  const member: Member = {
    id: deps.ids.nextId(),
    tenantId,
    userId,
    email,
    displayName: null,
    createdAt: deps.clock.nowIso(),
  };
  await deps.members.create(tenantId, member);
  return ok(member);
};
