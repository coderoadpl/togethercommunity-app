import { emailEventSchema, err, internal, ok, renderEmailOutboxPayload, type AppError, type Result } from '@core/domain/index.js';

import type { Clock, EmailEventRepository, EmailOutboxRepository, EmailPort } from '../ports.js';

export interface DispatchEmailBatchResult {
  attemptsMade: number;
  sentCount: number;
  failedCount: number;
}

export interface DispatchEmailBatchDeps {
  emailOutbox: EmailOutboxRepository;
  events: EmailEventRepository;
  email: EmailPort;
  clock: Clock;
  logger: { error(message: string): void };
  batchSize: number;
  attemptsCap: number;
  backoffBaseMs: number;
  backoffCapMs: number;
}

const nextAttemptAt = (now: string, attempts: number, deps: DispatchEmailBatchDeps): string => {
  const delay = Math.min(deps.backoffBaseMs * 2 ** Math.max(0, attempts - 1), deps.backoffCapMs);
  return new Date(Date.parse(now) + delay).toISOString();
};

export const dispatchEmailBatch = async (
  deps: DispatchEmailBatchDeps,
): Promise<Result<DispatchEmailBatchResult, AppError>> => {
  const claimed = await deps.emailOutbox.claimBatch({
    now: deps.clock.nowIso(),
    limit: deps.batchSize,
    attemptsCap: deps.attemptsCap,
  });
  if (!claimed.ok) return claimed;

  let sentCount = 0;
  let failedCount = 0;
  for (const item of claimed.value) {
    const rendered = renderEmailOutboxPayload(item.payload);
    if (rendered.success && item.tenantId !== null) {
      const now = deps.clock.nowIso();
      await deps.events.append(item.tenantId, emailEventSchema.parse({
        id: `${item.id}:rendered:${String(item.attempts)}`,
        tenantId: item.tenantId,
        mailKind: 'transactional',
        refId: item.id,
        type: 'rendered',
        occurredAt: now,
        meta: { attempt: item.attempts + 1 },
        createdAt: now,
      }));
    }
    const sent = rendered.success
      ? await deps.email.send({ to: item.to, ...rendered.data })
      : err(internal(`Invalid email outbox payload: ${rendered.error.message}`));
    if (sent.ok) {
      const marked = await deps.emailOutbox.markSent({
        id: item.id,
        sentAt: deps.clock.nowIso(),
        sesMessageId: sent.value.messageId,
      });
      if (!marked.ok) return marked;
      sentCount += 1;
      continue;
    }
    const attempts = item.attempts + 1;
    const marked = await deps.emailOutbox.markFailed({
      id: item.id,
      attempts,
      nextAttemptAt: nextAttemptAt(deps.clock.nowIso(), attempts, deps),
      failedAt: deps.clock.nowIso(),
      error: sent.error.message,
    });
    if (!marked.ok) return marked;
    failedCount += 1;
    if (attempts >= deps.attemptsCap) {
      deps.logger.error(`[email-outbox] terminal failure id=${item.id} to=${item.to} attempts=${String(attempts)} error=${sent.error.message}`);
    }
  }
  return ok({ attemptsMade: claimed.value.length, sentCount, failedCount });
};
