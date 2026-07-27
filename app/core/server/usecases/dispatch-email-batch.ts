import { emailEventSchema, err, internal, ok, renderEmailOutboxPayload, type AppError, type Result } from '@core/domain/index.js';

import type {
  Clock,
  EmailEventRepository,
  EmailOutboxRepository,
  IdGenerator,
  SchedulerRunRepository,
  TransactionalEmailSender,
} from '../ports.js';

export interface DispatchEmailBatchResult {
  attemptsMade: number;
  sentCount: number;
  failedCount: number;
}

export interface DispatchEmailBatchDeps {
  emailOutbox: EmailOutboxRepository;
  events: EmailEventRepository;
  email: TransactionalEmailSender;
  clock: Clock;
  logger: { error(message: string): void };
  batchSize: number;
  attemptsCap: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  ids: IdGenerator;
  runs: SchedulerRunRepository;
  trigger: 'cron' | 'dev' | 'manual';
}

const nextAttemptAt = (now: string, attempts: number, deps: DispatchEmailBatchDeps): string => {
  const delay = Math.min(deps.backoffBaseMs * 2 ** Math.max(0, attempts - 1), deps.backoffCapMs);
  return new Date(Date.parse(now) + delay).toISOString();
};

const transportFromError = (details: unknown) => {
  if (typeof details !== 'object' || details === null) return null;
  const transport = Reflect.get(details, 'transport');
  return transport === 'tenant-ses' || transport === 'smtp' || transport === 'platform'
    ? transport
    : null;
};

export const dispatchEmailBatch = async (
  deps: DispatchEmailBatchDeps,
): Promise<Result<DispatchEmailBatchResult, AppError>> => {
  const startedAt = deps.clock.nowIso();
  const runId = deps.ids.nextId();
  const emptyTotals = {
    campaignsTouched: 0,
    sendsAttempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    reEnqueued: false,
  };
  await deps.runs.start({
    id: runId,
    kind: 'outbox_dispatch',
    trigger: deps.trigger,
    startedAt,
    finishedAt: null,
    durationMs: null,
    status: 'running',
    error: null,
    totals: emptyTotals,
    createdAt: startedAt,
  });
  const tenantMetrics = new Map<string, {
    batchSize: number;
    sent: number;
    failed: number;
    errors: string[];
  }>();
  let attemptsMade = 0;
  let sentCount = 0;
  let failedCount = 0;
  let result: Result<DispatchEmailBatchResult, AppError> | undefined;
  let thrown: unknown;
  try {
    const claimed = await deps.emailOutbox.claimBatch({
      now: deps.clock.nowIso(),
      limit: deps.batchSize,
      attemptsCap: deps.attemptsCap,
      runId,
    });
    if (!claimed.ok) {
      result = claimed;
    } else {
      attemptsMade = claimed.value.length;
      for (const item of claimed.value) {
        if (item.tenantId === null) continue;
        const current = tenantMetrics.get(item.tenantId) ?? { batchSize: 0, sent: 0, failed: 0, errors: [] };
        current.batchSize += 1;
        tenantMetrics.set(item.tenantId, current);
      }
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
          meta: { attempt: item.attempts + 1, runId },
            createdAt: now,
          }));
        }
        const sent = rendered.success
          ? await deps.email.send({ tenantId: item.tenantId, to: item.to, ...rendered.data })
          : err(internal(`Invalid email outbox payload: ${rendered.error.message}`));
        if (sent.ok) {
          const marked = await deps.emailOutbox.markSent({
            id: item.id,
            sentAt: deps.clock.nowIso(),
            sesMessageId: sent.value.messageId,
            transport: sent.value.transport,
            runId,
          });
          if (!marked.ok) {
            result = marked;
            break;
          }
          sentCount += 1;
          if (item.tenantId !== null) {
            const metrics = tenantMetrics.get(item.tenantId);
            if (metrics !== undefined) metrics.sent += 1;
          }
          continue;
        }
        const attempts = item.attempts + 1;
        const marked = await deps.emailOutbox.markFailed({
          id: item.id,
          attempts,
          nextAttemptAt: nextAttemptAt(deps.clock.nowIso(), attempts, deps),
          failedAt: deps.clock.nowIso(),
          error: sent.error.message,
          errorCode: sent.error.code,
          transport: transportFromError(sent.error.details) ?? item.transport,
          runId,
        });
        if (!marked.ok) {
          result = marked;
          break;
        }
        failedCount += 1;
        if (item.tenantId !== null) {
          const metrics = tenantMetrics.get(item.tenantId);
          if (metrics !== undefined) {
            metrics.failed += 1;
            metrics.errors.push(sent.error.message);
          }
        }
        if (attempts >= deps.attemptsCap) {
          deps.logger.error(`[email-outbox] terminal failure id=${item.id} to=${item.to} attempts=${String(attempts)} error=${sent.error.message}`);
        }
      }
      result ??= ok({ attemptsMade, sentCount, failedCount });
    }
  } catch (cause) {
    thrown = cause;
  } finally {
    const finishedAt = deps.clock.nowIso();
    const resultError = result !== undefined && !result.ok ? result.error.message : null;
    const thrownError = thrown instanceof Error ? thrown.message : thrown === undefined ? null : String(thrown);
    const error = thrownError ?? resultError;
    await deps.runs.finalize(runId, {
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      status: error === null ? 'completed' : 'failed',
      error,
      totals: {
        campaignsTouched: 0,
        sendsAttempted: attemptsMade,
        sent: sentCount,
        failed: failedCount,
        skipped: 0,
        reEnqueued: false,
      },
      tenants: [...tenantMetrics.entries()].map(([tenantId, metrics]) => ({
        id: deps.ids.nextId(),
        runId,
        tenantId,
        campaignsTouched: 0,
        batchSize: metrics.batchSize,
        sent: metrics.sent,
        failed: metrics.failed,
        skipped: 0,
        budgetComputed: metrics.batchSize,
        budgetUsed: metrics.batchSize,
        errors: metrics.errors,
        createdAt: finishedAt,
      })),
    });
  }
  if (thrown !== undefined) throw thrown;
  if (result === undefined) throw new Error('Outbox dispatch did not produce a result');
  return result;
};
