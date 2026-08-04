import { err, internal, ok, type AppError, type Result } from '#core/domain/index.js';

import type { AutoInvoiceJobRepository } from '../ports.js';
import { issueAutoInvoiceOnPayment, type InvoiceDeps } from './invoices.js';

export interface DispatchAutoInvoiceJobsDeps extends InvoiceDeps {
  jobs: AutoInvoiceJobRepository;
}

export interface DispatchAutoInvoiceJobsResult {
  processed: boolean;
  processedCount: number;
  orderId: string | null;
}

const maxJobsPerDispatch = 25;
const retryBaseMs = 60_000;
const retryCapMs = 15 * 60_000;

const retryAt = (now: string, attempts: number): string =>
  new Date(
    Date.parse(now) + Math.min(retryBaseMs * 2 ** Math.max(0, attempts - 1), retryCapMs),
  ).toISOString();

export const dispatchAutoInvoiceJobs = async (
  deps: DispatchAutoInvoiceJobsDeps,
): Promise<Result<DispatchAutoInvoiceJobsResult, AppError>> => {
  let processedCount = 0;
  let orderId: string | null = null;
  while (processedCount < maxJobsPerDispatch) {
    const now = deps.clock.nowIso();
    const job = await deps.jobs.claimDue(now);
    if (job === null) break;
    try {
      const order = await deps.orderDetails.findById(job.tenantId, job.orderId);
      if (order === null) throw new Error(`Automatic invoice order ${job.orderId} was not found`);
      await issueAutoInvoiceOnPayment(job.tenantId, order, deps);
      await deps.jobs.complete(job.tenantId, job.id);
    } catch (cause) {
      const message = String(cause);
      await deps.jobs.reschedule(job.tenantId, job.id, {
        nextAttemptAt: retryAt(now, job.attempts),
        error: message,
      });
      return err(internal(`Automatic invoice job failed: ${message}`));
    }
    processedCount += 1;
    orderId = job.orderId;
  }
  return ok({ processed: processedCount > 0, processedCount, orderId });
};
