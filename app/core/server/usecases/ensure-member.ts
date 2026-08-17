import { normalizeEmail, ok, type AppError, type Member, type Result } from '#core/domain/index.js';

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
  const normalizedEmail = normalizeEmail(email);
  const existing = await deps.members.findByEmail(tenantId, normalizedEmail);
  if (existing) return ok(existing);

  const { userId } = await deps.authPort.ensureUser(normalizedEmail);
  const member: Member = {
    id: deps.ids.nextId(),
    tenantId,
    userId,
    email: normalizedEmail,
    displayName: null,
    tags: [],
    marketingConsents: {},
    externalCustomerIds: {},
    createdAt: deps.clock.nowIso(),
    deletedAt: null,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
    dmOptOutAt: null,
  };
  await deps.members.create(tenantId, member);
  const stored = await deps.members.findByEmail(tenantId, normalizedEmail);
  return ok(stored ?? member);
};
