import {
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { AuthPort } from '../ports.js';

export interface AccountSessionsDeps {
  auth: AuthPort;
}

export interface AccountSessionView {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  userAgent: string | null;
  current: boolean;
}

export interface CurrentSessionInput {
  currentSessionId: string;
}

export interface RevokeAccountSessionInput extends CurrentSessionInput {
  sessionId: string;
}

const byNewest = (left: AccountSessionView, right: AccountSessionView): number =>
  right.createdAt.localeCompare(left.createdAt);

export const listMyAccountSessions = async (
  ctx: Ctx,
  input: CurrentSessionInput,
  deps: AccountSessionsDeps,
): Promise<Result<{ sessions: AccountSessionView[] }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'account:session:self-read');
  if (!tenant.ok) return tenant;
  const sessions = await deps.auth.listSessions(ctx.identity.userId);
  return ok({
    sessions: sessions
      .map((session) => ({ ...session, current: session.id === input.currentSessionId }))
      .sort(byNewest),
  });
};

export const revokeMyAccountSession = async (
  ctx: Ctx,
  input: RevokeAccountSessionInput,
  deps: AccountSessionsDeps,
): Promise<Result<{ revoked: number }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'account:session:self-revoke');
  if (!tenant.ok) return tenant;
  if (input.sessionId === input.currentSessionId) {
    return err(validation('The current session cannot be revoked from this list'));
  }
  const sessions = await deps.auth.listSessions(ctx.identity.userId);
  if (!sessions.some((session) => session.id === input.sessionId)) {
    return err(notFound(`No session "${input.sessionId}" on this account`));
  }
  await deps.auth.revokeSessions(ctx.identity.userId, [input.sessionId]);
  return ok({ revoked: 1 });
};

export const revokeMyOtherAccountSessions = async (
  ctx: Ctx,
  input: CurrentSessionInput,
  deps: AccountSessionsDeps,
): Promise<Result<{ revoked: number }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'account:session:self-revoke');
  if (!tenant.ok) return tenant;
  const sessions = await deps.auth.listSessions(ctx.identity.userId);
  const others = sessions
    .filter((session) => session.id !== input.currentSessionId)
    .map((session) => session.id);
  if (others.length > 0) await deps.auth.revokeSessions(ctx.identity.userId, others);
  return ok({ revoked: others.length });
};
