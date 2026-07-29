import {
  appError,
  err,
  notFound,
  ok,
  type AppError,
  type Member,
  type Result,
} from '#core/domain/index.js';

export const requireLiveMember = (
  member: Member | null,
  memberId: string,
): Result<Member, AppError> =>
  member === null
    ? err(notFound(`No member "${memberId}" in this tenant`))
    : member.deletedAt !== null
      ? err(appError('conflict', 'Member account was erased; it can no longer be modified'))
      : ok(member);
