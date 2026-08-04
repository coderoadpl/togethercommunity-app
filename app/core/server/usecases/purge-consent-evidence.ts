import { err, internal, ok, type AppError, type Result } from '#core/domain/index.js';

import type {
  Clock,
  ConsentEvidenceRetentionRepository,
  IdGenerator,
  SchedulerRunRepository,
} from '../ports.js';

export const CONSENT_EVIDENCE_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CONSENT_EVIDENCE_PURGE_BATCH_SIZE = 500;
export const CONSENT_EVIDENCE_PURGE_TIME_BUDGET_MS = 5_000;

const WARSAW_JANUARY_OFFSET_MS = 60 * 60 * 1000;

export const consentEvidenceRetentionCutoff = (now: string): string => {
  const year = new Date(Date.parse(now) + WARSAW_JANUARY_OFFSET_MS).getUTCFullYear();
  return new Date(Date.UTC(year - 6, 0, 1) - WARSAW_JANUARY_OFFSET_MS).toISOString();
};

const errorMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

export const purgeExpiredConsentEvidence = async (
  input: {
    trigger: 'cron' | 'dev' | 'manual';
    minIntervalMs: number;
    batchSize: number;
    timeBudgetMs: number;
  },
  deps: {
    retention: ConsentEvidenceRetentionRepository;
    runs: SchedulerRunRepository;
    ids: IdGenerator;
    clock: Clock;
  },
): Promise<Result<{ purged: number; tenantsProcessed: number }, AppError>> => {
  let startedAt: string;
  let runId: string;
  try {
    startedAt = deps.clock.nowIso();
    if (input.trigger === 'cron') {
      const [previous] = (await deps.runs.listPage({ kind: 'consent_evidence_purge', limit: 1 })).runs;
      if (previous !== undefined && Date.parse(startedAt) - Date.parse(previous.startedAt) < input.minIntervalMs) {
        return ok({ purged: 0, tenantsProcessed: 0 });
      }
    }
    runId = deps.ids.nextId();
  } catch (cause) {
    return err(internal(errorMessage(cause)));
  }
  const emptyTotals = {
    campaignsTouched: 0,
    sendsAttempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    reEnqueued: false,
  };
  try {
    await deps.runs.start({
      id: runId,
      kind: 'consent_evidence_purge',
      trigger: input.trigger,
      startedAt,
      finishedAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      totals: emptyTotals,
      createdAt: startedAt,
    });
  } catch (cause) {
    return err(internal(errorMessage(cause)));
  }
  const tenantMetrics: Array<{ tenantId: string; purged: number; errors: string[] }> = [];
  let result: Result<{ purged: number; tenantsProcessed: number }, AppError>;
  try {
    const deadlineMs = Date.now() + input.timeBudgetMs;
    const retentionStartedBefore = consentEvidenceRetentionCutoff(startedAt);
    const tenantIds = await deps.retention.listExpiredTenantIds(retentionStartedBefore);
    let purged = 0;
    let firstError: string | null = null;
    for (const tenantId of tenantIds) {
      if (Date.now() >= deadlineMs) break;
      try {
        const tenantPurged = await deps.retention.purgeExpired(tenantId, retentionStartedBefore, {
          batchSize: input.batchSize,
          deadlineMs,
        });
        purged += tenantPurged;
        tenantMetrics.push({ tenantId, purged: tenantPurged, errors: [] });
      } catch (cause) {
        const message = errorMessage(cause);
        firstError ??= message;
        tenantMetrics.push({ tenantId, purged: 0, errors: [message] });
      }
    }
    result = firstError === null
      ? ok({ purged, tenantsProcessed: tenantMetrics.length })
      : err(internal(firstError));
  } catch (cause) {
    result = err(internal(errorMessage(cause)));
  }
  try {
    const finishedAt = deps.clock.nowIso();
    const error = result.ok ? null : result.error.message;
    await deps.runs.finalize(runId, {
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      status: error === null ? 'completed' : 'failed',
      error,
      totals: emptyTotals,
      tenants: tenantMetrics.map((metrics) => ({
        id: deps.ids.nextId(),
        runId,
        tenantId: metrics.tenantId,
        campaignsTouched: 0,
        batchSize: metrics.purged,
        purged: metrics.purged,
        sent: 0,
        failed: 0,
        skipped: 0,
        budgetComputed: 0,
        budgetUsed: 0,
        errors: metrics.errors,
        createdAt: finishedAt,
      })),
    });
  } catch (cause) {
    return err(internal(errorMessage(cause)));
  }
  return result;
};
