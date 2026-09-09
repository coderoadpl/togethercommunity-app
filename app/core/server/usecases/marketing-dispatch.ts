import type { MarketingContactRepository } from '../marketing-contact-ports.js';
import {
  appError, deriveConsentState, deriveMarketingEligibility, emailEventSchema, err, ok, tenantSesBroadcastsReady,
  type AppError, type CampaignSend, type Result,
} from '#core/domain/index.js';
import type { MarketingOutbox } from '#core/domain/marketing-outbox.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { MarketingDeliveryRepos, MarketingDeliveryTransaction, MarketingWaiter } from '../marketing-delivery-ports.js';
import type { Clock, ConsentDefinitionRepository, EmailHmac, IdGenerator, MarketingConsentRepository, MarketingSesCredentialResolver, MarketingThrottleRepository, SesMarketingSender } from '../ports.js';

export interface MarketingDispatchDeps extends MarketingDeliveryRepos {
  contacts?: MarketingContactRepository | undefined;
  delivery: MarketingDeliveryTransaction;
  definitions: ConsentDefinitionRepository;
  consents: MarketingConsentRepository;
  hmac: EmailHmac;
  credentials: MarketingSesCredentialResolver;
  throttle: MarketingThrottleRepository;
  ses: SesMarketingSender;
  clock: Clock;
  waiter: MarketingWaiter;
  ids: IdGenerator;
}

export const marketingSendBudget = (input: { ratePerSecond: number; sendSeconds: number; dailyRemaining: number; batchCap: number }): number =>
  Math.max(0, Math.min(Math.floor(0.9 * input.ratePerSecond * input.sendSeconds), Math.floor(input.dailyRemaining), input.batchCap));

const finish = (tenantId: string, row: MarketingOutbox, send: CampaignSend, deps: MarketingDispatchDeps, outcome: {
  errorThreshold?: number | undefined;
  status: 'sent' | 'skipped' | 'failed' | 'retry' | 'uncertain'; messageId?: string; error?: string; reason?: CampaignSend['skipReason'];
}) => deps.delivery.run(tenantId, async (repos) => {
  const now = deps.clock.nowIso();
  const status = outcome.status;
  const saved = await repos.marketingOutbox.save(tenantId, {
    ...row, status, lockedBy: null, lockedUntil: null, sesMessageId: outcome.messageId ?? null, lastError: outcome.error ?? null,
    updatedAt: now, nextAttemptAt: new Date(Date.parse(now) + Math.min(900_000, 1000 * 2 ** Math.min(row.attempts, 20))).toISOString(),
  });
  if (!saved) return err(appError('conflict', 'Marketing dispatch lease was replaced'));
  const type = status === 'sent' ? 'accepted' : status === 'skipped' ? 'skipped' : status === 'failed' ? 'failed' : status === 'uncertain' ? 'uncertain' : 'retried';
  await repos.sends.update(tenantId, {
    ...send, status: status === 'uncertain' ? 'sending' : status === 'retry' ? 'pending' : status,
    skipReason: outcome.reason ?? null, sesMessageId: outcome.messageId ?? send.sesMessageId,
    sentAt: status === 'sent' ? now : send.sentAt,
  }, [emailEventSchema.parse({
    id: deps.ids.nextId(), tenantId, mailKind: 'marketing', refId: send.id, type, occurredAt: now, createdAt: now,
    meta: status === 'sent' ? { sesMessageId: outcome.messageId, ...(send.runId === null ? {} : { runId: send.runId }) } : status === 'skipped' ? { reason: outcome.reason ?? outcome.error ?? 'cancelled' } : { error: outcome.error, status },
  })]);
  if (send.campaignId !== null && (status === 'sent' || status === 'failed' || status === 'skipped')) {
    await repos.campaigns.addDeliveryCounts(tenantId, send.campaignId, { sent: status === 'sent' ? 1 : 0, failed: status === 'failed' ? 1 : 0, skipped: status === 'skipped' ? 1 : 0 });
    const campaign = await repos.campaigns.findById(tenantId, send.campaignId);
    if (campaign !== null && campaign.errorCount >= (outcome.errorThreshold ?? 3)) await repos.campaigns.update(tenantId, { ...campaign, status: 'paused', pausedReason: outcome.error ?? 'Consecutive SES failures' });
  }
  return ok(undefined);
});

export const dispatchMarketingOutbox = async (
  ctx: Ctx,
  input: { workerId: string; deadlineAt: string; maxSends: number; errorThreshold?: number },
  deps: MarketingDispatchDeps,
): Promise<Result<{ sent: number; skipped: number; failed: number; uncertain: number }, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:campaign:dispatch');
  if (!tenantId.ok) return tenantId;
  const totals = { sent: 0, skipped: 0, failed: 0, uncertain: 0 };
  await deps.marketingOutbox.recoverExpired(tenantId.value, deps.clock.nowIso());
  let nextStart = Date.parse(deps.clock.nowIso());
  for (let attempted = 0; attempted < input.maxSends; attempted += 1) {
    const delay = Math.max(0, nextStart - Date.parse(deps.clock.nowIso()));
    if (Date.parse(deps.clock.nowIso()) + delay + 100 >= Date.parse(input.deadlineAt)) break;
    if (delay > 0) await deps.waiter.wait(delay);
    const now = deps.clock.nowIso();
    const row = await deps.marketingOutbox.claim(tenantId.value, { workerId: input.workerId, now, lockedUntil: new Date(Date.parse(input.deadlineAt) + 5000).toISOString() });
    if (row === null) break;
    const payload = row.payload;
    const send = await deps.sends.findById(tenantId.value, row.campaignSendId);
    if (payload === null || send === null) return err(appError('internal', 'Marketing outbox payload or send is missing'));
    const campaign = send.campaignId === null ? null : await deps.campaigns.findById(tenantId.value, send.campaignId);
    if (send.campaignId !== null && campaign?.status !== 'running' && !(send.source === 'api' && campaign?.status === 'finished')) {
      if (campaign === null || campaign.status === 'cancelled') {
        const completed = await finish(tenantId.value, row, send, deps, { status: 'skipped', error: 'Campaign cancelled' });
        if (!completed.ok) return completed;
        totals.skipped += 1;
      } else {
        await deps.marketingOutbox.save(tenantId.value, { ...row, lockedBy: null, lockedUntil: null, nextAttemptAt: new Date(Date.parse(now) + 60_000).toISOString() });
      }
      continue;
    }
    const settings = await deps.sesSettings.findByTenant(tenantId.value);
    const credentials = await deps.credentials.resolve(tenantId.value);
    if (settings === null || !tenantSesBroadcastsReady(settings) || !credentials.ok || settings.quotaRefreshedAt === null) {
      const deferred = await finish(tenantId.value, row, send, deps, { status: 'retry', error: 'Tenant SES is not ready' });
      if (!deferred.ok) return deferred;
      break;
    }
    if (send.contactId != null) {
      const contact = await deps.contacts?.findById(tenantId.value, send.contactId);
      const reason = contact == null || contact.archivedAt !== null ? 'contact_archived' : contact.email !== payload.to || contact.emailHmac !== deps.hmac.compute(tenantId.value, payload.to) ? 'contact_address_changed' : null;
      if (reason !== null) {
        const completed = await finish(tenantId.value, row, send, deps, { status: 'skipped', reason });
        if (!completed.ok) return completed;
        totals.skipped += 1;
        continue;
      }
    }
    const definition = await deps.definitions.findById(tenantId.value, payload.consentDefinitionId);
    const consent = definition === null || definition.status !== 'active'
      ? { state: 'none' as const, active: false, row: null }
      : deriveConsentState(await deps.consents.listByEmail(tenantId.value, payload.to, definition.id), definition);
    const suppressed = await deps.suppressions.isSuppressed(tenantId.value, deps.hmac.compute(tenantId.value, payload.to));
    const eligibility = deriveMarketingEligibility({ consent, suppressed });
    if (!eligibility.eligible) {
      const completed = await finish(tenantId.value, row, send, deps, { status: 'skipped', reason: eligibility.reason });
      if (!completed.ok) return completed;
      totals.skipped += 1;
      continue;
    }
    if (!await deps.throttle.claim(tenantId.value, { requested: 1, now: deps.clock.nowIso(), ratePerSecond: settings.quotaRatePerSec,
      dailyQuota: settings.quotaDaily, sentLast24Hours: settings.quotaSentLast24Hours, quotaSnapshotAt: settings.quotaRefreshedAt })) {
      const deferred = await finish(tenantId.value, row, send, deps, { status: 'retry', error: 'SES capacity exhausted' });
      if (!deferred.ok) return deferred;
      break;
    }
    if (Date.parse(deps.clock.nowIso()) + 100 >= Date.parse(input.deadlineAt)) break;
    const dispatching: MarketingOutbox = { ...row, status: 'dispatching', attempts: row.attempts + 1, updatedAt: deps.clock.nowIso() };
    const prepared = await deps.delivery.run(tenantId.value, async (repos) => {
      if (!await repos.marketingOutbox.save(tenantId.value, dispatching)) return err(appError('conflict', 'Marketing dispatch lease was replaced'));
      const saved = await repos.sends.update(tenantId.value, { ...send, status: 'sending' }, [emailEventSchema.parse({
        id: deps.ids.nextId(), tenantId: tenantId.value, mailKind: 'marketing', refId: send.id, type: 'claimed',
        meta: { attempt: dispatching.attempts, workerId: input.workerId }, occurredAt: deps.clock.nowIso(), createdAt: deps.clock.nowIso(),
      })]);
      return saved === null ? err(appError('conflict', 'Marketing send was removed')) : ok(undefined);
    });
    if (!prepared.ok) return prepared;
    nextStart = Date.parse(deps.clock.nowIso()) + Math.ceil(1000 / (0.9 * settings.quotaRatePerSec));
    let outcome: Parameters<typeof finish>[4];
    try {
      const result = await deps.ses.send({ ...payload, credentials: credentials.value, timeoutMs: Math.max(1, Date.parse(input.deadlineAt) - Date.parse(deps.clock.nowIso())) });
      outcome = result.ok ? { status: 'sent', messageId: result.value.messageId }
        : { status: result.error.code === 'rate_limited' ? 'retry' : ['validation', 'integration_auth'].includes(result.error.code) ? 'failed' : 'uncertain', error: result.error.message };
    } catch {
      outcome = { status: 'uncertain', error: 'SES acceptance could not be established' };
    }
    const completed = await finish(tenantId.value, dispatching, send, deps, { ...outcome, errorThreshold: input.errorThreshold });
    if (!completed.ok) return completed;
    if (outcome.status !== 'retry') totals[outcome.status] += 1;
  }
  return ok(totals);
};
