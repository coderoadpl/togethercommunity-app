import {
  DELETED_MEMBER_DISPLAY,
  err,
  memberTombstone,
  memberEventSchema,
  appError,
  notFound,
  ok,
  setMemberBannedInputSchema,
  validation,
  type AppError,
  type MemberExportFile,
  type MemberExportFormat,
  type MemberWithProductIds,
  type Member,
  type MemberErasureRequest,
  type MemberErasureRequestStatus,
  type MemberErasureRequestWithMember,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  IdGenerator,
  MemberErasurePort,
  MemberErasureRequestRepository,
  MemberRepository,
  MemberSubscriptionRepository,
  PaymentProvider,
} from '../ports.js';

export interface MembersDeps {
  members: MemberRepository;
  memberErasure: MemberErasurePort;
  clock: Clock;
  ids: IdGenerator;
}

export interface MemberRemovalDeps extends MembersDeps {
  subscriptions: MemberSubscriptionRepository;
  payment: PaymentProvider;
  logger: { error(message: string): void };
}

interface MemberSubscriptionCancellation {
  subscriptionId: string;
  providerSubscriptionId: string | null;
  outcome: 'canceled' | 'already_canceled' | 'skipped' | 'failed';
  message: string | null;
}

const neutralizeFormula = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

const quoteCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const serializeRecord = (value: Record<string, boolean> | Record<string, string>): string =>
  JSON.stringify(value);

const CSV_HEADER = [
  'id',
  'email',
  'displayName',
  'tags',
  'marketingConsents',
  'externalCustomerIds',
  'createdAt',
  'deletedAt',
  'productIds',
];

const toCsv = (members: MemberWithProductIds[]): string =>
  [
    CSV_HEADER.map(quoteCsv).join(','),
    ...members.map((member) =>
      [
        member.id,
        neutralizeFormula(member.email),
        neutralizeFormula(member.displayName ?? ''),
        neutralizeFormula(member.tags.join(';')),
        neutralizeFormula(serializeRecord(member.marketingConsents)),
        neutralizeFormula(serializeRecord(member.externalCustomerIds)),
        member.createdAt,
        member.deletedAt ?? '',
        member.productIds.join(';'),
      ]
        .map(quoteCsv)
        .join(','),
    ),
  ].join('\n');

export const listMembers = async (
  ctx: Ctx,
  deps: MembersDeps,
): Promise<Result<MemberWithProductIds[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:read');
  if (!tenant.ok) return tenant;
  return ok(await deps.members.listWithProductIds(tenant.value, deps.clock.nowIso()));
};

export const exportMembers = async (
  ctx: Ctx,
  input: { format: MemberExportFormat },
  deps: MembersDeps,
): Promise<Result<MemberExportFile, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:export');
  if (!tenant.ok) return tenant;

  const members = await deps.members.listWithProductIds(tenant.value, deps.clock.nowIso());
  const filename = `members-${ctx.identity.tenantSlug ?? tenant.value}.${input.format}`;

  return ok(
    input.format === 'csv'
      ? { filename, mimeType: 'text/csv; charset=utf-8', content: toCsv(members) }
      : { filename, mimeType: 'application/json; charset=utf-8', content: JSON.stringify(members) },
  );
};

export const removeMember = async (
  ctx: Ctx,
  input: { memberId: string },
  deps: MemberRemovalDeps,
): Promise<Result<{
  memberId: string;
  subscriptionCancellations: MemberSubscriptionCancellation[];
  erasureRequestId: string | null;
}, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:remove');
  if (!tenant.ok) return tenant;

  const subscriptions = await deps.subscriptions.listForMember(tenant.value, input.memberId);
  const subscriptionCancellations: MemberSubscriptionCancellation[] = [];
  for (const subscription of subscriptions) {
    const providerSubscriptionId = subscription.providerSubscriptionId;
    if (subscription.provider !== 'stripe' || providerSubscriptionId === null) {
      subscriptionCancellations.push({
        subscriptionId: subscription.id,
        providerSubscriptionId,
        outcome: 'skipped',
        message: null,
      });
      continue;
    }
    const cancellation = await deps.payment.cancelSubscription({
      tenantId: tenant.value,
      providerSubscriptionId,
      idempotencyKey: `member-removal-${subscription.id}`,
    });
    if (!cancellation.ok) {
      deps.logger.error(
        `[member-removal] provider cancel failed tenant=${tenant.value} member=${input.memberId} subscription=${subscription.id} providerSubscriptionId=${providerSubscriptionId} error=${cancellation.error.message}`,
      );
      subscriptionCancellations.push({
        subscriptionId: subscription.id,
        providerSubscriptionId,
        outcome: 'failed',
        message: cancellation.error.message,
      });
      continue;
    }
    subscriptionCancellations.push({
      subscriptionId: subscription.id,
      providerSubscriptionId,
      outcome: cancellation.value.alreadySettled ? 'already_canceled' : 'canceled',
      message: null,
    });
  }

  const tombstone = memberTombstone(input.memberId);
  const result = await deps.memberErasure.pseudonymize(tenant.value, {
    memberId: input.memberId,
    deletedAt: deps.clock.nowIso(),
    tombstoneEmail: tombstone.email,
    severedUserId: tombstone.userId,
    postAuthorDisplay: DELETED_MEMBER_DISPLAY,
  });
  if (result === null) return err(notFound(`No member "${input.memberId}" in this tenant`));
  return ok({
    memberId: input.memberId,
    subscriptionCancellations,
    erasureRequestId: result.erasureRequestId,
  });
};

export const listErasureRequests = async (
  ctx: Ctx,
  input: { status?: MemberErasureRequestStatus },
  deps: { erasureRequests: MemberErasureRequestRepository },
): Promise<Result<MemberErasureRequestWithMember[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:erasure:read');
  if (!tenant.ok) return tenant;
  return ok(await deps.erasureRequests.list(tenant.value, input));
};

export const rejectErasureRequest = async (
  ctx: Ctx,
  input: { requestId: string; note: string },
  deps: {
    erasureRequests: MemberErasureRequestRepository;
    ids: IdGenerator;
    clock: Clock;
  },
): Promise<Result<MemberErasureRequest, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:remove');
  if (!tenant.ok) return tenant;
  const resolvedAt = deps.clock.nowIso();
  const resolved = await deps.erasureRequests.resolve(
    tenant.value,
    {
      id: input.requestId,
      status: 'rejected',
      resolvedAt,
      resolvedByUserId: ctx.identity.userId,
      resolutionNote: input.note,
    },
    {
      id: deps.ids.nextId(),
      tenantId: tenant.value,
      requestId: input.requestId,
      type: 'rejected',
      actorUserId: ctx.identity.userId,
      meta: { note: input.note },
      occurredAt: resolvedAt,
      createdAt: resolvedAt,
    },
  );
  return resolved === null
    ? err(appError('conflict', 'The erasure request is no longer open'))
    : ok(resolved);
};

export const setMemberBanned = async (
  ctx: Ctx,
  input: unknown,
  deps: MembersDeps,
): Promise<Result<Member, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:ban');
  if (!tenant.ok) return tenant;
  const parsed = setMemberBannedInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid member ban payload', parsed.error.flatten()));
  const member = await deps.members.findById(tenant.value, parsed.data.memberId);
  if (member === null || member.deletedAt !== null) {
    return err(notFound(`No member "${parsed.data.memberId}" in this tenant`));
  }
  if ((member.bannedAt !== null) === parsed.data.banned) return ok(member);
  const now = deps.clock.nowIso();
  const reason = parsed.data.banned ? parsed.data.reason?.trim() || null : null;
  const event = memberEventSchema.parse({
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    memberId: member.id,
    type: parsed.data.banned ? 'banned' : 'unbanned',
    reason,
    actorUserId: ctx.identity.userId,
    occurredAt: now,
  });
  const updated = await deps.members.setBanned(tenant.value, {
    memberId: member.id,
    bannedAt: parsed.data.banned ? now : null,
    reason,
    actorUserId: ctx.identity.userId,
  }, event);
  return updated === null
    ? err(notFound(`No member "${parsed.data.memberId}" in this tenant`))
    : ok(updated);
};
