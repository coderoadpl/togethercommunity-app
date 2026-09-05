import {
  err,
  impersonationExpiresAt,
  internal,
  notFound,
  ok,
  type AppError,
  type Identity,
  type ImpersonationPrincipal,
  type ImpersonationSession,
  type ImpersonationView,
  type Result,
  type TenantAuditEventInput,
  type TenantAuditEventListQuery,
  type TenantAuditEventPage,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  AuthenticatedUser,
  Clock,
  IdGenerator,
  ImpersonationSessionRepository,
  ImpersonationTokenCodec,
  MemberRepository,
  TenantAuditEventRepository,
} from '../ports.js';

export interface ImpersonationDeps {
  impersonations: ImpersonationSessionRepository;
  auditEvents: TenantAuditEventRepository;
  members: MemberRepository;
  tokens: ImpersonationTokenCodec;
  ids: IdGenerator;
  clock: Clock;
}

export interface StartedImpersonation {
  token: string;
  impersonation: ImpersonationView;
}

const memberLabel = (member: { displayName: string | null; email: string }): string =>
  member.displayName ?? member.email;

interface EndedRecordAudit {
  tenantId: string;
  session: ImpersonationSession;
  actorEmail: string;
  at: string;
}

const endedEvent = (ids: IdGenerator, input: EndedRecordAudit): TenantAuditEventInput => ({
  id: ids.nextId(),
  tenantId: input.tenantId,
  kind: 'impersonation_ended',
  actorUserId: input.session.actorUserId,
  actorEmail: input.actorEmail,
  subjectMemberId: input.session.subjectMemberId,
  reason: input.session.reason,
  at: input.at,
});

export interface StartImpersonationInput {
  memberId: string;
  reason: string | null;
  actorSessionId: string;
}

export const startImpersonation = async (
  ctx: Ctx,
  input: StartImpersonationInput,
  deps: ImpersonationDeps,
): Promise<Result<StartedImpersonation, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:impersonate');
  if (!tenant.ok) return tenant;
  const member = await deps.members.findById(tenant.value, input.memberId);
  if (member === null || member.deletedAt !== null) {
    return err(notFound(`No member "${input.memberId}" in this tenant`));
  }
  const startedAt = deps.clock.nowIso();
  const session: ImpersonationSession = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    actorUserId: ctx.identity.userId,
    actorSessionId: input.actorSessionId,
    subjectMemberId: member.id,
    reason: input.reason,
    createdAt: startedAt,
    expiresAt: impersonationExpiresAt(startedAt),
    endedAt: null,
  };
  const issued = deps.tokens.issue(session.id);
  await deps.impersonations.open(tenant.value, session, issued.tokenHash, (superseded) => [
    ...superseded.map((previous) => endedEvent(deps.ids, {
      tenantId: tenant.value,
      session: previous,
      actorEmail: ctx.identity.email,
      at: startedAt,
    })),
    {
      id: deps.ids.nextId(),
      tenantId: tenant.value,
      kind: 'impersonation_started',
      actorUserId: ctx.identity.userId,
      actorEmail: ctx.identity.email,
      subjectMemberId: member.id,
      reason: input.reason,
      at: startedAt,
    },
  ]);
  return ok({
    token: issued.token,
    impersonation: {
      id: session.id,
      subjectMemberId: member.id,
      subjectName: memberLabel(member),
      actorName: ctx.identity.name,
      expiresAt: session.expiresAt,
    },
  });
};

export type EndImpersonationDeps = Pick<ImpersonationDeps, 'impersonations' | 'ids' | 'clock'>;

export const endImpersonationRecord = async (
  tenantId: string,
  impersonation: Pick<ImpersonationPrincipal, 'id' | 'actorEmail'>,
  deps: EndImpersonationDeps,
): Promise<boolean> => {
  const endedAt = deps.clock.nowIso();
  const ended = await deps.impersonations.end(tenantId, impersonation.id, endedAt, (session) =>
    endedEvent(deps.ids, {
      tenantId,
      session,
      actorEmail: impersonation.actorEmail,
      at: endedAt,
    }));
  return ended !== null;
};

export const stopImpersonation = async (
  ctx: Ctx,
  deps: ImpersonationDeps,
): Promise<Result<{ ended: boolean }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:impersonate', { asImpersonationActor: true });
  if (!tenant.ok) return tenant;
  const impersonation = ctx.impersonation;
  if (impersonation === undefined) return ok({ ended: false });
  return ok({ ended: await endImpersonationRecord(tenant.value, impersonation, deps) });
};

export type SweepLapsedImpersonationsDeps = Pick<
  ImpersonationDeps,
  'impersonations' | 'ids' | 'clock'
>;

/**
 * A view whose tab was closed is never rejected by `resolveImpersonation`,
 * because the cookie lapses with the record: without this sweep the trail keeps
 * a start with no matching end.
 */
const endLapsedViews = async (
  tenantId: string,
  deps: SweepLapsedImpersonationsDeps,
): Promise<number> =>
  deps.impersonations.endLapsed(tenantId, deps.clock.nowIso(), (lapsed) =>
    lapsed.map(({ session, actorEmail }) =>
      endedEvent(deps.ids, { tenantId, session, actorEmail, at: session.expiresAt })));

export const sweepLapsedImpersonations = async (
  deps: SweepLapsedImpersonationsDeps,
): Promise<Result<{ ended: number }, AppError>> => {
  try {
    const tenantIds = await deps.impersonations.listLapsedTenantIds(deps.clock.nowIso());
    let ended = 0;
    for (const tenantId of tenantIds) ended += await endLapsedViews(tenantId, deps);
    return ok({ ended });
  } catch (cause) {
    return err(internal(cause instanceof Error ? cause.message : String(cause)));
  }
};

export type ListTenantAuditEventsDeps = SweepLapsedImpersonationsDeps
  & Pick<ImpersonationDeps, 'auditEvents'>;

export const listTenantAuditEvents = async (
  ctx: Ctx,
  query: TenantAuditEventListQuery,
  deps: ListTenantAuditEventsDeps,
): Promise<Result<TenantAuditEventPage, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:impersonate');
  if (!tenant.ok) return tenant;
  await endLapsedViews(tenant.value, deps);
  return ok(await deps.auditEvents.list(tenant.value, query));
};

export type ResolveImpersonationDeps = Pick<
  ImpersonationDeps,
  'impersonations' | 'members' | 'tokens' | 'ids' | 'clock'
>;

export interface ImpersonationActor {
  user: AuthenticatedUser;
  identity: Identity;
}

export interface ResolvedImpersonation {
  tenantId: string;
  identity: Identity;
  principal: ImpersonationPrincipal;
}

/**
 * The record is bound to the acting session, so revoking or replacing the
 * operator's login invalidates the view without a separate revocation path.
 */
export const resolveImpersonation = async (
  actor: ImpersonationActor,
  token: string,
  deps: ResolveImpersonationDeps,
): Promise<ResolvedImpersonation | null> => {
  const verified = deps.tokens.verify(token);
  if (verified === null) return null;
  const tenantId = actor.identity.tenantId;
  const actorStaffRole = actor.identity.staffRole;
  if (tenantId === null || actorStaffRole === null) return null;
  const session = await deps.impersonations.findById(tenantId, verified.sessionId);
  if (session === null) return null;
  if (session.tokenHash !== verified.tokenHash) return null;
  if (session.endedAt !== null) return null;
  if (session.actorUserId !== actor.user.userId) return null;
  if (session.actorSessionId !== actor.user.sessionId) return null;
  if (Date.parse(session.expiresAt) <= Date.parse(deps.clock.nowIso())) {
    await deps.impersonations.end(tenantId, session.id, session.expiresAt, (ended) =>
      endedEvent(deps.ids, {
        tenantId,
        session: ended,
        actorEmail: actor.identity.email,
        at: session.expiresAt,
      }));
    return null;
  }
  const member = await deps.members.findById(tenantId, session.subjectMemberId);
  if (member === null || member.deletedAt !== null) return null;
  return {
    tenantId,
    identity: {
      userId: member.userId,
      email: member.email,
      name: memberLabel(member),
      // The member row carries no auth-account fields and the view never signs in
      // as the subject, so these stay at their least-privileged value: no
      // allowlisted capability requires a verified email, and the avatar falls
      // back to the subject's own e-mail hash.
      emailVerified: false,
      image: null,
      tenantId,
      tenantSlug: actor.identity.tenantSlug,
      tenantName: actor.identity.tenantName,
      staffRole: null,
      memberId: member.id,
      memberDisplayName: member.displayName,
      memberBannedAt: member.bannedAt,
      memberDmOptOutAt: member.dmOptOutAt,
      memberLanguage: member.language ?? null,
      memberVideoAutoplay: member.videoAutoplay ?? false,
    },
    principal: {
      id: session.id,
      actorUserId: actor.user.userId,
      actorEmail: actor.identity.email,
      actorName: actor.identity.name,
      actorStaffRole,
      subjectMemberId: member.id,
      subjectName: memberLabel(member),
      expiresAt: session.expiresAt,
    },
  };
};
