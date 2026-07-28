import {
  DEFAULT_LANGUAGE,
  err,
  integrationNotConfigured,
  notFound,
  ok,
  sendSupportMessageInputSchema,
  validation,
  type AppError,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  EmailOutboxRepository,
  IdGenerator,
  MemberRepository,
  TenantAccessReader,
  TenantRepository,
} from '../ports.js';
import { requireMemberOrStaff } from './community-access.js';

export interface SupportMessageDeps {
  tenants: TenantRepository;
  members: MemberRepository;
  tenantAccess: TenantAccessReader;
  emailOutbox: EmailOutboxRepository;
  ids: IdGenerator;
  clock: Clock;
  dispatchEmail(): void;
}

export const sendSupportMessage = async (
  ctx: Ctx,
  input: unknown,
  deps: SupportMessageDeps,
): Promise<Result<{ queued: true }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'support:request');
  if (!actor.ok) return actor;
  const parsed = sendSupportMessageInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid support message', parsed.error.flatten()));
  const settings = await deps.tenants.findSettings(actor.value.tenantId);
  if (settings === null || settings.supportEmail === null || settings.supportEmail === undefined) {
    return err(integrationNotConfigured('This creator has not set up a support address'));
  }
  const member =
    ctx.identity.memberId === null
      ? null
      : await deps.members.findById(actor.value.tenantId, ctx.identity.memberId);
  if (member?.deletedAt !== null && member !== null) return err(notFound('Member not found'));
  const staff =
    member === null
      ? (await deps.tenantAccess.listStaffForTenant(actor.value.tenantId)).find(
          (candidate) => candidate.userId === ctx.identity.userId,
        ) ?? null
      : null;
  if (member === null && staff === null) return err(notFound('Sender not found'));
  const memberEmail = member?.email ?? staff?.email ?? ctx.identity.email;
  const queued = await deps.emailOutbox.enqueue({
    id: deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    to: settings.supportEmail,
    payload: {
      kind: 'support-message',
      language: DEFAULT_LANGUAGE,
      tenantName: ctx.identity.tenantName ?? '',
      memberEmail,
      memberDisplay: member?.displayName ?? ctx.identity.name,
      subject: parsed.data.subject,
      body: parsed.data.body,
      branding: { logoUrl: settings.logoUrl, accentColor: settings.accentColor },
    },
    now: deps.clock.nowIso(),
  });
  if (!queued.ok) return queued;
  deps.dispatchEmail();
  return ok({ queued: true });
};
