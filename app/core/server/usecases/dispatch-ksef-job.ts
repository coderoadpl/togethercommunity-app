import { ok, type AppError, type Result } from '#core/domain/index.js';

import type { KsefSubmissionJobRepository } from '../ports.js';
import { runKsefSubmission, type KsefSubmissionDeps } from './ksef-submissions.js';

export interface DispatchKsefJobDeps extends KsefSubmissionDeps {
  jobs: KsefSubmissionJobRepository;
}

const maxJobsPerDispatch = 25;

export const dispatchKsefJob = async (
  deps: DispatchKsefJobDeps,
): Promise<Result<{
  processed: boolean;
  invoiceId: string | null;
  processedCount: number;
}, AppError>> => {
  let processedCount = 0;
  let invoiceId: string | null = null;
  while (processedCount < maxJobsPerDispatch) {
    const now = deps.clock.nowIso();
    const job = await deps.jobs.claimDue(now);
    if (job === null) break;
    const submitted = await runKsefSubmission(job.tenantId, job.invoiceId, deps);
    if (!submitted.ok) {
      await deps.jobs.reschedule(job.tenantId, job.id, {
        nextAttemptAt: new Date(Date.parse(now) + deps.retry.baseMs).toISOString(),
        error: submitted.error.message,
      });
      return submitted;
    }
    const state = submitted.value.ksef?.state;
    if (state === 'succeeded' || state === 'rejected' || state === 'numbering_conflict') {
      await deps.jobs.complete(job.tenantId, job.id);
    } else {
      await deps.jobs.reschedule(job.tenantId, job.id, {
        nextAttemptAt: submitted.value.ksef?.retryAt
          ?? new Date(Date.parse(now) + deps.retry.baseMs).toISOString(),
        error: submitted.value.ksef?.lastTransportError ?? null,
      });
    }
    processedCount += 1;
    invoiceId = job.invoiceId;
  }
  return ok({ processed: processedCount > 0, invoiceId, processedCount });
};
