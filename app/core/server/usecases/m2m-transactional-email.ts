import {
  appError,
  emailEventSchema,
  err,
  integrationNotConfigured,
  m2mTransactionalMessageInputSchema,
  normalizeEmail,
  notFound,
  ok,
  validation,
  type AppError,
  type M2mTransactionalMessageInput,
  type Result,
  type TenantApiKey,
} from '#core/domain/index.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  ApiKeyRateLimitRepository,
  AutomationIdempotencyRepository,
  Clock,
  EmailEventRepository,
  EmailHmac,
  EmailIntegrationTransportResolver,
  EmailOutboxRepository,
  EmailSendRepository,
  IdGenerator,
  SuppressionRepository,
} from '../ports.js';

const requestPath = '/api/m2m/transactional/messages';
const idempotencyTtlSeconds = 86_400;

export interface M2mTransactionalEmailDeps {
  idempotency: AutomationIdempotencyRepository;
  rateLimits: ApiKeyRateLimitRepository;
  limits: { perMinute: number; perDay: number };
  transports: EmailIntegrationTransportResolver;
  suppressions: SuppressionRepository;
  hmac: EmailHmac;
  outbox: EmailOutboxRepository;
  events: EmailEventRepository;
  ids: IdGenerator;
  clock: Clock;
  hash: { compute(value: string): string };
}

const windowStart = (now: string, durationMs: number): string =>
  new Date(Math.floor(Date.parse(now) / durationMs) * durationMs).toISOString();

const claimRateLimit = async (
  apiKeyId: string,
  tenantId: string,
  now: string,
  deps: Pick<M2mTransactionalEmailDeps, 'rateLimits' | 'limits'>,
): Promise<Result<void, AppError>> => {
  const windows = [
    { period: 'day' as const, durationMs: 86_400_000, limit: deps.limits.perDay },
    { period: 'minute' as const, durationMs: 60_000, limit: deps.limits.perMinute },
  ];
  for (const window of windows) {
    const startedAt = windowStart(now, window.durationMs);
    if (await deps.rateLimits.claim(tenantId, {
      apiKeyId,
      period: window.period,
      windowStartedAt: startedAt,
      limit: window.limit,
    })) continue;
    const retryAfterSeconds = Math.max(1, Math.ceil(
      (Date.parse(startedAt) + window.durationMs - Date.parse(now)) / 1000,
    ));
    return err(appError('rate_limited', 'Transactional e-mail API rate limit exceeded', {
      period: window.period,
      retryAfterSeconds,
    }));
  }
  return ok(undefined);
};

const tenantTransportConfigured = async (
  tenantId: string,
  transports: EmailIntegrationTransportResolver,
): Promise<boolean> => {
  for (const transport of ['ses', 'smtp', 'resend'] as const) {
    if (await transports.resolve(tenantId, transport) !== null) return true;
  }
  return false;
};

export const sendM2mTransactionalMessage = async (
  ctx: Ctx,
  apiKey: TenantApiKey,
  input: M2mTransactionalMessageInput,
  deps: M2mTransactionalEmailDeps,
): Promise<Result<{ messageId: string; replayed: boolean }, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'transactional:message:send');
  if (!tenantId.ok) return tenantId;
  const parsed = m2mTransactionalMessageInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid transactional e-mail payload', parsed.error.flatten()));
  const now = deps.clock.nowIso();
  const messageId = deps.ids.nextId();
  const hash = deps.hash.compute(JSON.stringify(parsed.data));
  const existing = await deps.idempotency.claim(tenantId.value, {
    id: deps.ids.nextId(),
    tenantId: tenantId.value,
    key: parsed.data.idempotencyKey,
    requestMethod: 'POST',
    requestPath,
    requestHash: hash,
    resourceId: null,
    claimedAt: now,
    expiresAt: new Date(Date.parse(now) + idempotencyTtlSeconds * 1000).toISOString(),
  });
  if (existing !== null) {
    const matchesRequest =
      existing.requestMethod === 'POST'
      && existing.requestPath === requestPath
      && existing.requestHash === hash;
    if (matchesRequest && existing.resourceId !== null && existing.resourceId !== undefined) {
      return ok({ messageId: existing.resourceId, replayed: true });
    }
    if (matchesRequest) {
      return err(appError('conflict', 'Idempotent request is still being processed', {
        claimedAt: existing.claimedAt,
        retryable: true,
      }));
    }
    return err(appError('conflict', 'Idempotency key was already used', {
      requestMethod: existing.requestMethod,
      requestPath: existing.requestPath,
      requestHash: existing.requestHash,
      claimedAt: existing.claimedAt,
    }));
  }
  const release = async () => deps.idempotency.release(tenantId.value, parsed.data.idempotencyKey);
  const rateLimit = await claimRateLimit(apiKey.id, tenantId.value, now, deps);
  if (!rateLimit.ok) {
    await release();
    return rateLimit;
  }
  if (!await tenantTransportConfigured(tenantId.value, deps.transports)) {
    await release();
    return err(integrationNotConfigured('Configure tenant SES, SMTP or Resend before using the transactional e-mail API'));
  }
  const recipient = normalizeEmail(parsed.data.to);
  const suppression = await deps.suppressions.findActive(
    tenantId.value,
    deps.hmac.compute(tenantId.value, recipient),
  );
  if (suppression !== null && ['hard_bounce', 'complaint', 'erasure'].includes(suppression.reason)) {
    await deps.events.append(tenantId.value, emailEventSchema.parse({
      id: deps.ids.nextId(),
      tenantId: tenantId.value,
      mailKind: 'transactional',
      refId: messageId,
      type: 'skipped',
      occurredAt: now,
      meta: { reason: `suppressed:${suppression.reason}` },
      createdAt: now,
    }));
    await release();
    return err(appError('suppressed', 'Recipient is suppressed for transactional e-mail', {
      reason: suppression.reason,
    }));
  }
  const queued = await deps.outbox.enqueue({
    id: messageId,
    tenantId: tenantId.value,
    to: recipient,
    payload: {
      kind: 'm2m-transactional',
      subject: parsed.data.subject,
      ...(parsed.data.html === undefined ? {} : { html: parsed.data.html }),
      ...(parsed.data.text === undefined ? {} : { text: parsed.data.text }),
      ...(parsed.data.replyTo === undefined ? {} : { replyTo: parsed.data.replyTo }),
    },
    now,
    sourceApp: apiKey.name,
    tenantTransportRequired: true,
  });
  if (!queued.ok) {
    await release();
    return queued;
  }
  await deps.idempotency.complete(tenantId.value, parsed.data.idempotencyKey, queued.value.id);
  return ok({ messageId: queued.value.id, replayed: false });
};

export const getM2mTransactionalMessage = async (
  ctx: Ctx,
  apiKey: TenantApiKey,
  input: { id: string },
  deps: { sends: EmailSendRepository; events: EmailEventRepository },
) => {
  const tenantId = authorizeRequiredTenant(ctx, 'transactional:message:read');
  if (!tenantId.ok) return tenantId;
  const send = await deps.sends.findById(tenantId.value, 'transactional', input.id);
  if (send === null || send.sourceApp !== apiKey.name) return err(notFound('Transactional message was not found'));
  const events = await deps.events.listByRef(tenantId.value, 'transactional', input.id);
  return ok({ send, events });
};
