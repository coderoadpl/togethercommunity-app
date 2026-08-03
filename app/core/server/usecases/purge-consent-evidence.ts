import { err, internal, ok, type AppError, type Result } from '#core/domain/index.js';

import type {
  Clock,
  ConsentEvidenceRetentionRepository,
  IdGenerator,
  SchedulerRunRepository,
} from '../ports.js';

export const CONSENT_EVIDENCE_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const WARSAW_JANUARY_OFFSET_MS = 60 * 60 * 1000;

// Art. 118 of the Polish Civil Code uses the Warsaw calendar year, whose January boundary is UTC+1.
export const consentEvidenceRetentionCutoff = (now: string): string => {
  const year = new Date(now).getUTCFullYear();
  return new Date(Date.UTC(year - 6, 0, 1) - WARSAW_JANUARY_OFFSET_MS).toISOString();
};

export const purgeExpiredConsentEvidence = async (
  input: { trigger: 'cron' | 'dev' | 'manual'; minIntervalMs: number },
  deps: {
    retention: ConsentEvidenceRetentionRepository;
    runs: SchedulerRunRepository;
    ids: IdGenerator;
    clock: Clock;
  },
): Promise<Result<{ purged: number; tenantsProcessed: number }, AppError>> => {
  const startedAt = deps.clock.nowIso();
  if (input.trigger === 'cron') {
    const [previous] = (await deps.runs.listPage({ kind: 'consent_evidence_purge', limit: 1 })).runs;
    if (previous !== undefined && Date.parse(startedAt) - Date.parse(previous.startedAt) < input.minIntervalMs) {
      return ok({ purged: 0, tenantsProcessed: 0 });
    }
  }
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
  const tenantMetrics: Array<{ tenantId: string; purged: number; errors: string[] }> = [];
  let result: Result<{ purged: number; tenantsProcessed: number }, AppError> | undefined;
  let thrown: unknown;
  try {
    const retentionStartedBefore = consentEvidenceRetentionCutoff(startedAt);
    const tenantIds = await deps.retention.listExpiredTenantIds(retentionStartedBefore);
    let purged = 0;
    let firstError: string | null = null;
    for (const tenantId of tenantIds) {
      try {
        const tenantPurged = await deps.retention.purgeExpired(tenantId, retentionStartedBefore);
        purged += tenantPurged;
        tenantMetrics.push({ tenantId, purged: tenantPurged, errors: [] });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        firstError ??= message;
        tenantMetrics.push({ tenantId, purged: 0, errors: [message] });
      }
    }
    result = firstError === null
      ? ok({ purged, tenantsProcessed: tenantIds.length })
      : err(internal(firstError));
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
      totals: emptyTotals,
      tenants: tenantMetrics.map((metrics) => ({
        id: deps.ids.nextId(),
        runId,
        tenantId: metrics.tenantId,
        campaignsTouched: 0,
        batchSize: metrics.purged,
        sent: 0,
        failed: 0,
        skipped: 0,
        budgetComputed: 0,
        budgetUsed: 0,
        errors: metrics.errors,
        createdAt: finishedAt,
      })),
    });
  }
  if (thrown !== undefined) throw thrown;
  if (result === undefined) throw new Error('Consent evidence purge did not produce a result');
  return result;
};
