import {
  err,
  ok,
  orderRefundIdempotencyKey,
  orderRefundPermissionRetryAt,
  orderRefundRetryAt,
  orderRefundStatusCheckAt,
  REFUND_REQUEST_WORST_CASE_MS,
  refundFailure,
  refundFailureOf,
  type AppError,
  type ClaimedOrderRefundJob,
  type OrderListItem,
  type OrderRefundAlert,
  type OrderRefundJob,
  type ProviderRefund,
  type Result,
} from '#core/domain/index.js';

import { safeErrorMessage, safeLogMessage } from '../log-safety.js';
import type {
  Clock,
  EmailOutboxEnqueueInput,
  OrderDetailRepository,
  OrderRefundJobRepository,
  OrderRefundJobUpdate,
  PaymentProvider,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '../ports.js';
import { resolveTenantOrigin, type TenantUrlDeps } from '../tenant-url.js';
import { tenantStaffRecipients } from './tenant-staff-recipients.js';

export interface DispatchOrderRefundJobsDeps extends TenantUrlDeps {
  refundJobs: Pick<OrderRefundJobRepository, 'claimDue' | 'release' | 'countDue'>;
  orderDetails: OrderDetailRepository;
  payment: Pick<PaymentProvider, 'createRefund' | 'listRefunds'>;
  tenants: Pick<TenantRepository, 'findById' | 'findSettings'>;
  tenantAccess: Pick<TenantAccessReader, 'listStaffForTenant'>;
  tenantDomains: Pick<TenantDomainRepository, 'listByTenant'>;
  clock: Clock;
  logger: { warn(message: string): void; error(message: string): void };
  dispatchEmail(): void;
}

type DispatchOutcome = 'refunded' | 'submitted' | 'watching' | 'reopened' | 'skipped_refunded' | 'retrying' | 'blocked_permission' | 'failed' | 'checked' | 'unconfirmed' | 'deferred' | 'lease_lost';

export interface DispatchOrderRefundJobsResult {
  processedCount: number;
  outcomes: Partial<Record<DispatchOutcome, number>>;
}

interface Settlement {
  update: OrderRefundJobUpdate;
  outcome: DispatchOutcome;
  alert: OrderRefundAlert | null;
}

export interface DispatchOrderRefundJobsOptions {
  deadlineAt?: number;
  maxJobs?: number;
}

const MAX_JOBS_PER_DISPATCH = 25;
export const ORDER_REFUND_CRON_TICK_MAX_JOBS = 1;
export const ORDER_REFUND_DISPATCH_BUDGET_MS = 30_000;
export const ORDER_REFUND_TICK_BUDGET_MS = 45_000;
export const ORDER_REFUND_JOB_WORST_CASE_MS = 2 * REFUND_REQUEST_WORST_CASE_MS;
const LEASE_MS = 10 * 60_000;
const STATUS_READ_RETRY_MS = 60 * 60_000;
const STATUS_READ_GIVE_UP_AFTER_MS = 8 * 24 * 60 * 60_000;
const SETTLEMENT_RETRY_MS = 60_000;

const providerUnavailable = refundFailure('credentials_unavailable', 'The payment provider cannot issue refunds');

const finalFailure = (lastError: string, alert: OrderRefundAlert = 'failed'): Settlement =>
  ({ update: { status: 'failed', nextAttemptAt: null, lastError }, outcome: 'failed', alert });

const unconfirmed = (update: OrderRefundJobUpdate & { lastError: string }): Settlement =>
  ({ update: { ...update, status: 'unconfirmed', nextAttemptAt: null }, outcome: 'unconfirmed', alert: 'unconfirmed' });

const settlePermissionMissing = (job: OrderRefundJob, lastError: string, now: string): Settlement => {
  const blockedAt = job.permissionBlockedAt ?? now;
  const retryAt = orderRefundPermissionRetryAt(blockedAt, now);
  if (retryAt === null) return finalFailure(lastError, 'blocked_permission_failed');
  return {
    update: { status: 'blocked_permission', nextAttemptAt: retryAt, lastError, permissionBlockedAt: blockedAt },
    outcome: 'blocked_permission',
    alert: job.permissionBlockedAt === null ? 'blocked_permission' : null,
  };
};

const skippedRefunded = (): Settlement =>
  ({ update: { status: 'skipped_refunded', nextAttemptAt: null, lastError: null }, outcome: 'skipped_refunded', alert: null });

const watchRefunds = (lastError: string, now: string): Settlement => ({
  update: { status: 'submitted', nextAttemptAt: orderRefundStatusCheckAt(now, 0), submittedAt: now, statusChecks: 0, lastError },
  outcome: 'watching',
  alert: null,
});

const settleRefundFailure = (job: OrderRefundJob, error: AppError, now: string): Settlement => {
  const kind = refundFailureOf(error)?.kind ?? 'transient';
  if (kind === 'already_refunded') return watchRefunds(error.message, now);
  if (kind === 'permission_missing') return settlePermissionMissing(job, error.message, now);
  if (kind === 'idempotency_mismatch') return { update: { status: 'pending', nextAttemptAt: now, lastError: error.message }, outcome: 'retrying', alert: null };
  if (kind === 'not_found' || kind === 'refund_failed') return finalFailure(error.message);
  const transientFailureStreak = job.transientFailureStreak + 1;
  const retryAt = orderRefundRetryAt(transientFailureStreak, now, job.createdAt);
  if (retryAt === null) return finalFailure(error.message);
  return {
    update: { status: 'pending', nextAttemptAt: retryAt, lastError: error.message, transientFailureStreak },
    outcome: 'retrying',
    alert: job.lastError === null ? 'retrying' : null,
  };
};

const isCommitted = (refund: ProviderRefund): boolean => refund.status !== 'failed' && refund.status !== 'canceled';

const sumCents = (refunds: readonly ProviderRefund[]): number => refunds.reduce((sum, refund) => sum + refund.amountCents, 0);

const ownRefundsOf = (job: OrderRefundJob, refunds: readonly ProviderRefund[]): ProviderRefund[] =>
  refunds.filter((refund) => refund.refundId === job.providerRefundId || (refund.orderId === job.orderId && refund.reason === job.reason));

type Coverage =
  | { kind: 'own_failed'; refund: ProviderRefund }
  | { kind: 'short'; remainingCents: number }
  | { kind: 'covered'; awaiting: ProviderRefund | undefined };

const coverageOf = (job: OrderRefundJob, refunds: readonly ProviderRefund[]): Coverage => {
  const ownFailed = ownRefundsOf(job, refunds).find((refund) => !isCommitted(refund));
  if (ownFailed !== undefined) return { kind: 'own_failed', refund: ownFailed };
  const committed = refunds.filter(isCommitted);
  const remainingCents = job.amountCents - sumCents(committed);
  if (remainingCents > 0) return { kind: 'short', remainingCents };
  const settled = sumCents(committed.filter((refund) => refund.status === 'succeeded')) >= job.amountCents;
  return { kind: 'covered', awaiting: settled ? undefined : committed.find((refund) => refund.status !== 'succeeded') };
};

const ownRefundFailed = (refund: ProviderRefund, update: OrderRefundJobUpdate = {}): Settlement => ({
  update: {
    ...update, status: 'failed', nextAttemptAt: null, providerRefundId: refund.refundId, providerRefundStatus: refund.status,
    lastError: refund.failureReason ?? `Refund ${refund.status ?? 'failed'}`,
  },
  outcome: 'failed',
  alert: 'failed_after_submission',
});

const awaitingError = (refund: ProviderRefund): string => `Refund still ${refund.status ?? 'pending'} at the last scheduled status check`;

const settleCoverageAfterRefund = (own: ProviderRefund | undefined, awaiting: ProviderRefund | undefined, now: string): Settlement => {
  if (own === undefined && awaiting === undefined) return skippedRefunded();
  const observed: OrderRefundJobUpdate = {
    nextAttemptAt: orderRefundStatusCheckAt(now, 0), providerRefundId: own?.refundId ?? null, providerRefundStatus: own?.status ?? null,
    submittedAt: now, statusChecks: 0, lastError: null,
  };
  if (awaiting === undefined) return { update: { ...observed, status: 'succeeded' }, outcome: 'refunded', alert: null };
  return { update: { ...observed, status: 'submitted' }, outcome: own === undefined ? 'watching' : 'submitted', alert: null };
};

const settleCoverageAtCheck = (job: OrderRefundJob, submittedAt: string, refunds: readonly ProviderRefund[], now: string): Settlement => {
  const coverage = coverageOf(job, refunds);
  const statusChecks = job.statusChecks + 1;
  if (coverage.kind === 'own_failed') return ownRefundFailed(coverage.refund, { statusChecks });
  if (coverage.kind === 'short') {
    return {
      update: {
        status: 'pending', nextAttemptAt: now, keyGeneration: job.keyGeneration + 1, transientFailureStreak: 0,
        lastError: `A refund made outside the platform failed or was canceled; ${String(coverage.remainingCents)} minor units are left to refund`,
      },
      outcome: 'reopened',
      alert: null,
    };
  }
  const own = refunds.find((refund) => refund.refundId === job.providerRefundId) ?? ownRefundsOf(job, refunds)[0];
  const providerRefundStatus = own?.status ?? null;
  if (coverage.awaiting === undefined && own === undefined) return skippedRefunded();
  const nextAttemptAt = orderRefundStatusCheckAt(submittedAt, statusChecks);
  if (coverage.awaiting === undefined) {
    return { update: { status: 'succeeded', providerRefundStatus, statusChecks, nextAttemptAt, lastError: null }, outcome: 'checked', alert: null };
  }
  if (nextAttemptAt === null) return unconfirmed({ providerRefundStatus, statusChecks, lastError: awaitingError(coverage.awaiting) });
  return { update: { status: 'submitted', providerRefundStatus, statusChecks, nextAttemptAt, lastError: null }, outcome: 'checked', alert: null };
};

const ownRefundNotListed = (refundId: string): AppError =>
  refundFailure('transient', `The refund list does not show refund ${refundId} yet`);

const attemptRefund = async (job: OrderRefundJob, order: OrderListItem, paymentIntentId: string, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
  const { createRefund, listRefunds } = deps.payment;
  if (createRefund === undefined || listRefunds === undefined) return settleRefundFailure(job, providerUnavailable, now);
  const listed = await listRefunds({ mode: order.mode, tenantId: job.tenantId, paymentIntentId });
  if (!listed.ok) return settleRefundFailure(job, listed.error, now);
  const refunds = listed.value;
  if (job.providerRefundId !== null && !refunds.some((refund) => refund.refundId === job.providerRefundId)) {
    return settleRefundFailure(job, ownRefundNotListed(job.providerRefundId), now);
  }
  const coverage = coverageOf(job, refunds);
  if (coverage.kind === 'own_failed') return ownRefundFailed(coverage.refund, { submittedAt: now });
  if (coverage.kind === 'covered') return settleCoverageAfterRefund(ownRefundsOf(job, refunds)[0], coverage.awaiting, now);
  // An own refund the job never recorded came from a call whose result was not saved, so it spent the
  // current key; a recorded one moved the generation on when the job reopened.
  const keySpent = ownRefundsOf(job, refunds).some((refund) => refund.refundId !== job.providerRefundId);
  const keyGeneration = keySpent ? job.keyGeneration + 1 : job.keyGeneration;
  const created = await createRefund({
    mode: order.mode,
    tenantId: job.tenantId,
    paymentIntentId,
    amountCents: coverage.remainingCents,
    idempotencyKey: orderRefundIdempotencyKey({ ...job, keyGeneration }),
    metadata: { orderId: job.orderId, reason: job.reason },
  });
  if (created.ok) {
    const withCreated = [created.value, ...refunds.filter((refund) => refund.refundId !== created.value.refundId)];
    const after = coverageOf(job, withCreated);
    if (after.kind === 'own_failed') return ownRefundFailed(after.refund, { submittedAt: now, keyGeneration });
    if (after.kind === 'short') {
      const settlement = settleRefundFailure(job, refundFailure('transient', `Refund ${created.value.refundId} does not cover the rest of the payment`), now);
      return { ...settlement, update: { ...settlement.update, keyGeneration: keyGeneration + 1 } };
    }
    const settlement = settleCoverageAfterRefund(created.value, after.awaiting, now);
    return { ...settlement, update: { ...settlement.update, keyGeneration } };
  }
  const settlement = settleRefundFailure(job, created.error, now);
  return refundFailureOf(created.error)?.outcomeUnknown === true
    ? { ...settlement, update: { ...settlement.update, keyGeneration } }
    : { ...settlement, update: { ...settlement.update, keyGeneration: keyGeneration + 1 } };
};

const refundJob = async (job: OrderRefundJob, order: OrderListItem | null, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
  if (order === null) return finalFailure('The cancelled order was not found');
  const refundable = order.cancelReason === job.reason && job.paymentIntentId !== null;
  if (!refundable && order.status === 'refunded') return skippedRefunded();
  if (order.cancelReason !== job.reason) return finalFailure('The order is not cancelled for this refund reason');
  if (job.paymentIntentId === null) return finalFailure('The order has no payment intent to refund');
  const settlement = await attemptRefund(job, order, job.paymentIntentId, now, deps);
  const refundCovered = settlement.outcome === 'refunded' || settlement.outcome === 'submitted' || settlement.outcome === 'watching';
  return { ...settlement, update: { transientFailureStreak: 0, ...(refundCovered ? { permissionBlockedAt: null } : {}), ...settlement.update } };
};

const settleReadFailure = (submittedAt: string, lastError: string, now: string): Settlement => {
  if (Date.parse(now) - Date.parse(submittedAt) > STATUS_READ_GIVE_UP_AFTER_MS) return unconfirmed({ lastError });
  return {
    update: { nextAttemptAt: new Date(Date.parse(now) + STATUS_READ_RETRY_MS).toISOString(), lastError },
    outcome: 'checked',
    alert: null,
  };
};

const checkRefundStatus = async (job: OrderRefundJob, order: OrderListItem | null, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
  if (job.submittedAt === null || job.paymentIntentId === null) {
    return { update: { nextAttemptAt: null }, outcome: 'checked', alert: null };
  }
  const listed = deps.payment.listRefunds === undefined
    ? err(providerUnavailable)
    : await deps.payment.listRefunds({ mode: order?.mode ?? 'live', tenantId: job.tenantId, paymentIntentId: job.paymentIntentId });
  if (!listed.ok) return settleReadFailure(job.submittedAt, listed.error.message, now);
  if (job.providerRefundId !== null && !listed.value.some((refund) => refund.refundId === job.providerRefundId)) {
    return settleReadFailure(job.submittedAt, ownRefundNotListed(job.providerRefundId).message, now);
  }
  return settleCoverageAtCheck(job, job.submittedAt, listed.value, now);
};

const staffAlertEmails = async (job: OrderRefundJob, alert: OrderRefundAlert, deps: DispatchOrderRefundJobsDeps): Promise<EmailOutboxEnqueueInput[]> => {
  const tenant = await deps.tenants.findById(job.tenantId);
  if (tenant === null) return [];
  const recipients = await tenantStaffRecipients(job.tenantId, deps);
  const orderUrl = `${await resolveTenantOrigin(tenant, deps)}/panel/sales/${encodeURIComponent(job.orderId)}`;
  const now = deps.clock.nowIso();
  return recipients.map((recipient, index) => ({
    id: `order-refund-alert:${job.id}:${alert}:${String(job.attempts)}:${String(index)}`,
    tenantId: job.tenantId,
    to: recipient.email,
    payload: {
      kind: 'order-refund-alert', language: recipient.language, tenantName: tenant.name, alert, orderId: job.orderId,
      amountCents: job.amountCents, currency: job.currency, error: job.lastError ?? '', orderUrl,
    },
    now,
  }));
};

const deferSettlement = async (claim: ClaimedOrderRefundJob, cause: unknown, deps: DispatchOrderRefundJobsDeps): Promise<DispatchOutcome> => {
  const { job } = claim;
  const now = deps.clock.nowIso();
  deps.logger.error(safeLogMessage(`[order-refund] settlement not saved, retrying tenant=${job.tenantId} order=${job.orderId} job=${job.id} phase=${claim.phase}: ${safeErrorMessage(cause)}`));
  try {
    await deps.refundJobs.release(job.tenantId, job.id, claim.lease, {
      ...(claim.phase === 'refund' ? { status: 'pending' } : {}),
      nextAttemptAt: new Date(Date.parse(now) + SETTLEMENT_RETRY_MS).toISOString(),
      now,
    });
  } catch (releaseCause) {
    deps.logger.error(safeLogMessage(`[order-refund] job left to its lease tenant=${job.tenantId} order=${job.orderId} job=${job.id}: ${safeErrorMessage(releaseCause)}`));
  }
  return 'deferred';
};

const processClaim = async (claim: ClaimedOrderRefundJob, deps: DispatchOrderRefundJobsDeps): Promise<DispatchOutcome> => {
  const { job } = claim;
  const now = deps.clock.nowIso();
  const order = await deps.orderDetails.findById(job.tenantId, job.orderId);
  const settlement = claim.phase === 'refund'
    ? await refundJob(job, order, now, deps)
    : await checkRefundStatus(job, order, now, deps);
  let staffAlerts: EmailOutboxEnqueueInput[] = [];
  let released: OrderRefundJob | null;
  try {
    if (settlement.alert !== null) staffAlerts = await staffAlertEmails({ ...job, ...settlement.update }, settlement.alert, deps);
    released = await deps.refundJobs.release(job.tenantId, job.id, claim.lease, { ...settlement.update, now: deps.clock.nowIso() }, staffAlerts);
  } catch (cause) {
    return deferSettlement(claim, cause, deps);
  }
  if (released === null) {
    deps.logger.error(`[order-refund] lease lost tenant=${job.tenantId} order=${job.orderId} job=${job.id} phase=${claim.phase}`);
    return 'lease_lost';
  }
  if (settlement.outcome !== 'refunded' && settlement.outcome !== 'checked') {
    deps.logger.warn(safeLogMessage(`[order-refund] tenant=${job.tenantId} order=${job.orderId} job=${job.id} attempt=${String(job.attempts)} status=${released.status} next=${released.nextAttemptAt ?? 'none'} error=${released.lastError ?? 'none'}`));
  }
  if (staffAlerts.length > 0) deps.dispatchEmail();
  return settlement.outcome;
};

const warnDueJobsLeft = async (stoppedBy: 'cap' | 'deadline', deps: DispatchOrderRefundJobsDeps): Promise<void> => {
  try {
    const due = await deps.refundJobs.countDue({ now: deps.clock.nowIso() });
    if (due > 0) deps.logger.warn(`[order-refund] run stopped by ${stoppedBy}, ${String(due)} due refund jobs left for the next run`);
  } catch (cause) {
    deps.logger.error(safeLogMessage(`[order-refund] due refund jobs not counted after the run stopped by ${stoppedBy}: ${safeErrorMessage(cause)}`));
  }
};

export const dispatchOrderRefundJobs = async (
  deps: DispatchOrderRefundJobsDeps,
  options: DispatchOrderRefundJobsOptions = {},
): Promise<Result<DispatchOrderRefundJobsResult, AppError>> => {
  const outcomes: Partial<Record<DispatchOutcome, number>> = {};
  let processedCount = 0;
  const deadlineAt = options.deadlineAt ?? Date.parse(deps.clock.nowIso()) + ORDER_REFUND_DISPATCH_BUDGET_MS;
  const maxJobs = Math.min(options.maxJobs ?? MAX_JOBS_PER_DISPATCH, MAX_JOBS_PER_DISPATCH);
  for (;;) {
    if (processedCount >= maxJobs) {
      await warnDueJobsLeft('cap', deps);
      break;
    }
    if (Date.parse(deps.clock.nowIso()) + ORDER_REFUND_JOB_WORST_CASE_MS > deadlineAt) {
      await warnDueJobsLeft('deadline', deps);
      break;
    }
    const claim = await deps.refundJobs.claimDue({ now: deps.clock.nowIso(), leaseMs: LEASE_MS });
    if (claim === null) break;
    const outcome = await processClaim(claim, deps);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    processedCount += 1;
  }
  return ok({ processedCount, outcomes });
};
