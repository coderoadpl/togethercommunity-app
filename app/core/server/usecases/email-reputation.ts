import {
  DEFAULT_LANGUAGE,
  deriveEmailReputation,
  emailReputationSchema,
  err,
  notFound,
  ok,
  reputationAlertDecision,
  reputationWindow,
  type AppError,
  type EmailReputation,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type {
  Clock,
  EmailEventRepository,
  EmailOutboxRepository,
  IdGenerator,
  TenantAccessReader,
  TenantRepository,
  TenantSesSettingsRepository,
} from '../ports.js';
import { tenantStaffRecipients } from './tenant-staff-recipients.js';

export const getEmailReputation = async (
  ctx: Ctx,
  deps: { events: EmailEventRepository; clock: Clock },
): Promise<Result<EmailReputation, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:reputation:read');
  if (!tenantId.ok) return err(tenantId.error);
  const window = reputationWindow(deps.clock.nowIso());
  const counts = await deps.events.reputationCounts(tenantId.value, window);
  return ok(emailReputationSchema.parse({
    windowStart: window.since,
    windowEnd: window.until,
    ...deriveEmailReputation(counts),
  }));
};

export const REPUTATION_ALERT_REPEAT_MS = 24 * 60 * 60 * 1000;

export const runReputationAlerts = async (
  ctx: Ctx,
  deps: {
    events: EmailEventRepository;
    settings: TenantSesSettingsRepository;
    tenants: TenantRepository;
    tenantAccess: TenantAccessReader;
    emailOutbox: EmailOutboxRepository;
    ids: IdGenerator;
    clock: Clock;
    dashboardUrl(tenantSlug: string): string;
    dispatchEmail(): void;
  },
): Promise<Result<{ sent: number }, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'scheduler:dispatch');
  if (!tenantId.ok) return err(tenantId.error);
  const settings = await deps.settings.findByTenant(tenantId.value);
  if (settings === null) return ok({ sent: 0 });
  const now = deps.clock.nowIso();
  const window = reputationWindow(now);
  const counts = await deps.events.reputationCounts(tenantId.value, window);
  const reputation = emailReputationSchema.parse({
    windowStart: window.since,
    windowEnd: window.until,
    ...deriveEmailReputation(counts),
  });
  const decision = reputationAlertDecision({
    current: reputation.overallStatus,
    lastAlerted: settings.reputationAlertStatus,
    lastAlertedAt: settings.reputationAlertedAt,
    now,
    repeatAfterMs: REPUTATION_ALERT_REPEAT_MS,
  });
  if (!decision.notify) {
    if (
      decision.nextStatus !== settings.reputationAlertStatus ||
      decision.nextAlertedAt !== settings.reputationAlertedAt
    ) {
      await deps.settings.upsert(tenantId.value, {
        ...settings,
        reputationAlertStatus: decision.nextStatus,
        reputationAlertedAt: decision.nextAlertedAt,
      });
    }
    return ok({ sent: 0 });
  }
  if (
    reputation.overallStatus !== 'warn' &&
    reputation.overallStatus !== 'critical'
  ) {
    return ok({ sent: 0 });
  }
  const tenant = await deps.tenants.findById(tenantId.value);
  if (tenant === null) return err(notFound('Tenant not found'));
  const recipients = await tenantStaffRecipients(tenantId.value, deps);
  if (recipients.length === 0) {
    await deps.settings.upsert(tenantId.value, {
      ...settings,
      reputationAlertStatus: decision.nextStatus,
      reputationAlertedAt: decision.nextAlertedAt,
    });
    return ok({ sent: 0 });
  }
  for (const recipient of recipients) {
    const queued = await deps.emailOutbox.enqueue({
      id: deps.ids.nextId(),
      tenantId: tenantId.value,
      to: recipient,
      payload: {
        kind: 'reputation-alert',
        language: DEFAULT_LANGUAGE,
        tenantName: tenant.name,
        status: reputation.overallStatus,
        hardBounceRate: reputation.hardBounce.rate,
        complaintRate: reputation.complaint.rate,
        windowStart: reputation.windowStart,
        windowEnd: reputation.windowEnd,
        dashboardUrl: deps.dashboardUrl(tenant.slug),
      },
      now,
    });
    if (!queued.ok) return queued;
  }
  await deps.settings.upsert(tenantId.value, {
    ...settings,
    reputationAlertStatus: decision.nextStatus,
    reputationAlertedAt: decision.nextAlertedAt,
  });
  deps.dispatchEmail();
  return ok({ sent: recipients.length });
};
