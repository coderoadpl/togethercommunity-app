import {
  DELETED_MEMBER_DISPLAY,
  err,
  memberTombstone,
  notFound,
  ok,
  type AppError,
  type MemberExportFile,
  type MemberExportFormat,
  type MemberWithProductIds,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  MemberErasurePort,
  MemberRepository,
  MemberSubscriptionRepository,
  PaymentProvider,
} from '../ports.js';

export interface MembersDeps {
  members: MemberRepository;
  memberErasure: MemberErasurePort;
  clock: Clock;
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
  return ok({ memberId: input.memberId, subscriptionCancellations });
};
