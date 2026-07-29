import {
  appError,
  DEFAULT_LANGUAGE,
  erasureRequestDueAt,
  err,
  forbidden,
  normalizeEmail,
  notFound,
  ok,
  validation,
  type AppError,
  type MemberErasureRequest,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock,
  IdGenerator,
  EmailOutboxRepository,
  MemberErasureRequestRepository,
  MemberRepository,
  TenantAccessReader,
  TenantRepository,
} from '../ports.js';
import { tenantStaffRecipients } from './tenant-staff-recipients.js';

export interface MemberErasureRequestDeps {
  members: MemberRepository;
  erasureRequests: MemberErasureRequestRepository;
  ids: IdGenerator;
  clock: Clock;
  notifications?: {
    tenants: TenantRepository;
    tenantAccess: TenantAccessReader;
    emailOutbox: EmailOutboxRepository;
    appBaseUrl: string;
    baseDomain: string;
    dispatchEmail(): void;
  };
}

const liveMember = async (
  ctx: Ctx,
  tenantId: string,
  deps: MemberErasureRequestDeps,
) => {
  if (ctx.identity.memberId === null) {
    return err(forbidden('Only tenant members can manage erasure requests'));
  }
  const member = await deps.members.findById(tenantId, ctx.identity.memberId);
  if (member === null || member.deletedAt !== null) {
    return err(notFound(`No member "${ctx.identity.memberId}" in this tenant`));
  }
  return ok(member);
};

export const requestMyErasure = async (
  ctx: Ctx,
  input: { confirmEmail: string; reason?: string },
  deps: MemberErasureRequestDeps,
): Promise<Result<MemberErasureRequest, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:erasure:self-request');
  if (!tenant.ok) return tenant;
  const member = await liveMember(ctx, tenant.value, deps);
  if (!member.ok) return member;
  if (normalizeEmail(input.confirmEmail) !== normalizeEmail(member.value.email)) {
    return err(validation('Confirmation e-mail does not match the member account'));
  }
  const requestedAt = deps.clock.nowIso();
  const request: MemberErasureRequest = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    memberId: member.value.id,
    status: 'open',
    reason: input.reason?.trim() || null,
    requestedAt,
    dueAt: erasureRequestDueAt(requestedAt),
    resolvedAt: null,
    resolvedByUserId: null,
    resolutionNote: null,
  };
  const created = await deps.erasureRequests.create(tenant.value, request, {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    requestId: request.id,
    type: 'requested',
    actorUserId: ctx.identity.userId,
    meta: null,
    occurredAt: requestedAt,
    createdAt: requestedAt,
  });
  if (created === 'already-open') {
    return err(appError('conflict', 'An erasure request is already open'));
  }
  if (deps.notifications !== undefined) {
    try {
      const recipients = await tenantStaffRecipients(tenant.value, deps.notifications);
      const panelUrl = new URL('/panel/members', deps.notifications.appBaseUrl);
      if (ctx.identity.tenantSlug !== null) {
        panelUrl.hostname = `${ctx.identity.tenantSlug}.${deps.notifications.baseDomain}`;
      }
      let queuedCount = 0;
      for (const recipient of recipients) {
        const queued = await deps.notifications.emailOutbox.enqueue({
          id: deps.ids.nextId(),
          tenantId: tenant.value,
          to: recipient,
          payload: {
            kind: 'member-erasure-request',
            language: DEFAULT_LANGUAGE,
            tenantName: ctx.identity.tenantName ?? '',
            memberEmail: member.value.email,
            requestedAt,
            dueAt: request.dueAt,
            panelUrl: panelUrl.toString(),
          },
          now: requestedAt,
        });
        if (queued.ok) queuedCount += 1;
      }
      if (queuedCount > 0) deps.notifications.dispatchEmail();
    } catch {
      return ok(request);
    }
  }
  return ok(request);
};

export const getMyErasureRequest = async (
  ctx: Ctx,
  deps: MemberErasureRequestDeps,
): Promise<Result<MemberErasureRequest | null, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:erasure:self-request');
  if (!tenant.ok) return tenant;
  const member = await liveMember(ctx, tenant.value, deps);
  if (!member.ok) return member;
  return ok(await deps.erasureRequests.findLatestForMember(tenant.value, member.value.id));
};

export const cancelMyErasureRequest = async (
  ctx: Ctx,
  deps: MemberErasureRequestDeps,
): Promise<Result<MemberErasureRequest, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:erasure:self-request');
  if (!tenant.ok) return tenant;
  const member = await liveMember(ctx, tenant.value, deps);
  if (!member.ok) return member;
  const openRequest = await deps.erasureRequests.findOpenForMember(
    tenant.value,
    member.value.id,
  );
  if (openRequest === null) return err(notFound('No open erasure request'));
  const resolvedAt = deps.clock.nowIso();
  const resolved = await deps.erasureRequests.resolve(
    tenant.value,
    {
      id: openRequest.id,
      status: 'cancelled',
      resolvedAt,
      resolvedByUserId: ctx.identity.userId,
      resolutionNote: null,
    },
    {
      id: deps.ids.nextId(),
      tenantId: tenant.value,
      requestId: openRequest.id,
      type: 'cancelled',
      actorUserId: ctx.identity.userId,
      meta: null,
      occurredAt: resolvedAt,
      createdAt: resolvedAt,
    },
  );
  return resolved === null
    ? err(appError('conflict', 'The erasure request is no longer open'))
    : ok(resolved);
};
