import { marketingSnsJsonValue, parseMarketingSesEvents, storedSnsEnvelopeSchema, marketingSnsReceiptSchema } from '#core/domain/marketing-sns-inbox.js';
import { appError, err, forbidden, notFound, ok, type AppError, type Result } from '#core/domain/index.js';
import type { MarketingSnsInbox, SesEventApplication } from '#core/domain/marketing-sns-inbox.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { MarketingDeliveryRepos, MarketingDeliveryTransaction } from '../marketing-delivery-ports.js';
import type { Clock, EmailHmac, IdGenerator, MarketingSesCredentialResolver, SnsVerifier, VerifiedSnsEnvelope } from '../ports.js';
import { applyVerifiedSesEvent } from './marketing-email.js';

interface InboxDeps extends MarketingDeliveryRepos {
  delivery: MarketingDeliveryTransaction;
  clock: Clock;
  ids: IdGenerator;
  hmac: EmailHmac;
  sns: SnsVerifier;
  credentials: MarketingSesCredentialResolver;
}

export const recordVerifiedMarketingSnsEnvelope = async (
  ctx: Ctx,
  input: { envelope: VerifiedSnsEnvelope; rawBody: string; bodySha256: string },
  deps: Pick<InboxDeps, 'snsInbox' | 'sesSettings' | 'clock' | 'ids'>,
): Promise<Result<MarketingSnsInbox, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'webhook:process');
  if (!tenantId.ok) return tenantId;
  const settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (settings?.snsTopicArn !== input.envelope.topicArn) return err(forbidden('SNS topic does not match this tenant'));
  const now = deps.clock.nowIso();
  const envelope = storedSnsEnvelopeSchema.safeParse(marketingSnsJsonValue(input.rawBody));
  const unsupported = !envelope.success || (input.envelope.type === 'SubscriptionConfirmation' && envelope.data.SubscribeURL === undefined) || (input.envelope.type === 'Notification' && parseMarketingSesEvents(marketingSnsJsonValue(envelope.data.Message), input.envelope.topicArn).length === 0);
  return deps.snsInbox.record(tenantId.value, {
    id: deps.ids.nextId(), tenantId: tenantId.value, topicArn: input.envelope.topicArn, snsMessageId: input.envelope.messageId,
    messageType: input.envelope.type, rawBody: input.rawBody, bodySha256: input.bodySha256,
    verifiedAt: now, receivedAt: now, status: unsupported ? 'ignored' : 'pending', attempts: 0, nextAttemptAt: now,
    lockedBy: null, lockedUntil: null, claimVersion: 0, processedAt: unsupported ? now : null, lastError: null, ignoreReason: unsupported ? 'Unsupported verified payload' : null,
  });
};

const processReceipt = async (ctx: Ctx, row: MarketingSnsInbox, deps: InboxDeps, repos: MarketingDeliveryRepos): Promise<Result<SesEventApplication, AppError>> => {
  const envelope = storedSnsEnvelopeSchema.safeParse(marketingSnsJsonValue(row.rawBody ?? ''));
  if (!envelope.success) return ok({ kind: 'ignored', reason: 'Unsupported verified envelope' });
  if (row.messageType === 'SubscriptionConfirmation') {
    if (envelope.data.SubscribeURL === undefined) return ok({ kind: 'ignored', reason: 'Missing subscription URL' });
    const credentials = await deps.credentials.resolve(row.tenantId);
    if (!credentials.ok) return credentials;
    const confirmed = await deps.sns.confirmSubscription({ subscribeUrl: envelope.data.SubscribeURL, region: credentials.value.region });
    if (!confirmed.ok) return confirmed;
    const settings = await repos.sesSettings.findByTenant(row.tenantId);
    if (settings !== null) await repos.sesSettings.upsert(row.tenantId, { ...settings, snsSubscriptionConfirmedAt: deps.clock.nowIso() });
    return ok({ kind: 'applied' });
  }
  const events = parseMarketingSesEvents(marketingSnsJsonValue(envelope.data.Message), row.topicArn);
  if (events.length === 0) return ok({ kind: 'ignored', reason: 'Unsupported SES event' });
  let result: SesEventApplication = { kind: 'ignored', reason: 'No applicable recipients' };
  for (const event of events) {
    const applied = await applyVerifiedSesEvent(ctx, event, { ...deps, ...repos });
    if (!applied.ok) return applied;
    if (applied.value.kind === 'awaiting_correlation') {
      // The SES simulator probe has no send record but proves the feedback path is working.
      if (event.kind === 'bounce' && event.recipient === 'bounce@simulator.amazonses.com') result = { kind: 'applied' };
      else return err(appError('not_found', 'SES send correlation is not yet available'));
    }
    if (applied.value.kind === 'applied') result = applied.value;
  }
  if (result.kind === 'applied') {
    const settings = await repos.sesSettings.findByTenant(row.tenantId);
    if (settings !== null && settings.webhookVerifiedAt === null) await repos.sesSettings.upsert(row.tenantId, { ...settings, webhookVerifiedAt: deps.clock.nowIso() });
  }
  return ok(result);
};

export const processMarketingSnsInbox = async (
  ctx: Ctx,
  input: { workerId: string; deadlineAt: string; maxEvents: number },
  deps: InboxDeps,
): Promise<Result<{ processed: number; retried: number }, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'webhook:process');
  if (!tenantId.ok) return tenantId;
  const totals = { processed: 0, retried: 0 };
  for (let i = 0; i < input.maxEvents && deps.clock.nowIso() < input.deadlineAt; i += 1) {
    const row = await deps.snsInbox.claim(tenantId.value, { workerId: input.workerId, now: deps.clock.nowIso(), lockedUntil: new Date(Date.parse(input.deadlineAt) + 5000).toISOString() });
    if (row === null) break;
    let failure: AppError | null = null;
    try {
      const result = await deps.delivery.run(tenantId.value, async (repos) => {
        const applied = await processReceipt(ctx, row, deps, repos);
        if (!applied.ok) return applied;
        const saved = await repos.snsInbox.save(tenantId.value, { ...row,
          status: applied.value.kind === 'ignored' ? 'ignored' : 'processed', processedAt: deps.clock.nowIso(),
          lockedBy: null, lockedUntil: null, lastError: null, ignoreReason: applied.value.kind === 'ignored' ? applied.value.reason : null,
        });
        return saved ? ok(undefined) : err(appError('conflict', 'SNS inbox lease was replaced'));
      });
      if (!result.ok) failure = result.error;
    } catch {
      failure = appError('internal', 'SNS application failed; the durable receipt will be retried');
    }
    if (failure === null) totals.processed += 1;
    else {
      const now = deps.clock.nowIso();
      const saved = await deps.snsInbox.save(tenantId.value, { ...row, status: Date.parse(now) - Date.parse(row.receivedAt) >= 86_400_000 ? 'dead_letter' : 'retry',
        lockedBy: null, lockedUntil: null, lastError: failure.message,
        nextAttemptAt: new Date(Date.parse(now) + Math.min(900_000, 1000 * 2 ** Math.min(row.attempts, 20))).toISOString(),
      });
      if (!saved) return err(appError('conflict', 'SNS inbox lease was replaced'));
      if (failure.code === 'internal') return err(failure);
      totals.retried += 1;
    }
  }
  return ok(totals);
};

export const retryMarketingSnsInbox = async (ctx: Ctx, input: { inboxId: string }, deps: Pick<InboxDeps, 'snsInbox' | 'clock'>): Promise<Result<{ retried: true }, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:ses:write');
  if (!tenantId.ok) return tenantId;
  return await deps.snsInbox.retry(tenantId.value, input.inboxId, deps.clock.nowIso(), ctx.identity.userId)
    ? ok({ retried: true }) : err(notFound('Retryable SNS receipt was not found'));
};

export const listMarketingSnsInbox = async (ctx: Ctx, deps: Pick<InboxDeps, 'snsInbox'>): Promise<Result<{ receipts: Array<Omit<MarketingSnsInbox, 'rawBody'>> }, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:ses:read');
  if (!tenantId.ok) return tenantId;
  return ok({ receipts: (await deps.snsInbox.list(tenantId.value)).map((receipt) => marketingSnsReceiptSchema.parse(receipt)) });
};
