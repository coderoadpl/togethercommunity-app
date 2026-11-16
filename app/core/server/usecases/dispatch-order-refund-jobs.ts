import {
  err,
  ok,
  orderRefundIdempotencyKey,
  orderRefundPermissionRetryAt,
  orderRefundRetryAt,
  orderRefundStatusCheckAt,
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
  refundJobs: Pick<OrderRefundJobRepository, 'claimDue' | 'release'>;
  orderDetails: OrderDetailRepository;
  payment: Pick<PaymentProvider, 'createRefund' | 'getRefund' | 'listRefunds'>;
  tenants: Pick<TenantRepository, 'findById' | 'findSettings'>;
  tenantAccess: Pick<TenantAccessReader, 'listStaffForTenant'>;
  tenantDomains: Pick<TenantDomainRepository, 'listByTenant'>;
  clock: Clock;
  logger: { warn(message: string): void; error(message: string): void };
  dispatchEmail(): void;
}

type DispatchOutcome = 'refunded' | 'submitted' | 'skipped_refunded' | 'retrying' | 'blocked_permission' | 'failed' | 'checked' | 'unconfirmed' | 'deferred' | 'lease_lost';

export interface DispatchOrderRefundJobsResult {
  processedCount: number;
  outcomes: Partial<Record<DispatchOutcome, number>>;
}

interface Settlement {
  update: OrderRefundJobUpdate;
  outcome: DispatchOutcome;
  alert: OrderRefundAlert | null;
}

const MAX_JOBS_PER_DISPATCH = 25;
export const ORDER_REFUND_DISPATCH_BUDGET_MS = 30_000;
const LEASE_MS = 10 * 60_000;
const STATUS_READ_RETRY_MS = 60 * 60_000;
const STATUS_READ_GIVE_UP_AFTER_MS = 8 * 24 * 60 * 60_000;
const SETTLEMENT_RETRY_MS = 60_000;

const providerUnavailable = refundFailure('credentials_unavailable', 'The payment provider cannot issue refunds');

const finalFailure = (lastError: string, alert: OrderRefundAlert = 'failed'): Settlement =>
  ({ update: { status: 'failed', nextAttemptAt: null, lastError }, outcome: 'failed', alert });

const unconfirmed = (update: OrderRefundJobUpdate & { lastError: string }): Settlement =>
  ({ update: { ...update, status: 'unconfirmed', nextAttemptAt: null }, outcome: 'unconfirmed', alert: 'unconfirmed' });

const settleSubmittedRefund = (refund: ProviderRefund, now: string): Settlement => {
  if (refund.status === 'failed' || refund.status === 'canceled') {
    return {
      update: { status: 'failed', nextAttemptAt: null, providerRefundId: refund.refundId, providerRefundStatus: refund.status, submittedAt: now, lastError: refund.failureReason ?? `Refund ${refund.status}` },
      outcome: 'failed',
      alert: 'failed_after_submission',
    };
  }
  const succeeded = refund.status === 'succeeded';
  return {
    update: {
      status: succeeded ? 'succeeded' : 'submitted', nextAttemptAt: orderRefundStatusCheckAt(now, 0), providerRefundId: refund.refundId,
      providerRefundStatus: refund.status, submittedAt: now, statusChecks: 0, lastError: null,
    },
    outcome: succeeded ? 'refunded' : 'submitted',
    alert: null,
  };
};

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

const skippedRefunded = (lastError: string | null = null): Settlement =>
  ({ update: { status: 'skipped_refunded', nextAttemptAt: null, lastError }, outcome: 'skipped_refunded', alert: null });

const settleRefundFailure = (job: OrderRefundJob, error: AppError, now: string): Settlement => {
  const kind = refundFailureOf(error)?.kind ?? 'transient';
  if (kind === 'already_refunded') return skippedRefunded(error.message);
  if (kind === 'permission_missing') return settlePermissionMissing(job, error.message, now);
  if (kind === 'not_found' || kind === 'refund_failed') return finalFailure(error.message);
  const retryAt = orderRefundRetryAt(job.attempts, now, job.createdAt);
  if (retryAt === null) return finalFailure(error.message);
  return { update: { status: 'pending', nextAttemptAt: retryAt, lastError: error.message }, outcome: 'retrying', alert: job.lastError === null ? 'retrying' : null };
};

const isCommitted = (refund: ProviderRefund): boolean => refund.status !== 'failed' && refund.status !== 'canceled';

const committedRefundCents = (refunds: readonly ProviderRefund[]): number =>
  refunds.filter(isCommitted).reduce((sum, refund) => sum + refund.amountCents, 0);

const issuedRefundOf = (job: OrderRefundJob, refunds: readonly ProviderRefund[]): ProviderRefund | undefined => {
  const issued = refunds.filter((refund) => refund.orderId === job.orderId && refund.reason === job.reason);
  return issued.find(isCommitted) ?? issued[0];
};

const attemptRefund = async (job: OrderRefundJob, order: OrderListItem, paymentIntentId: string, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
  const { createRefund, listRefunds } = deps.payment;
  const orderRefunded = order.status === 'refunded';
  if (createRefund === undefined || listRefunds === undefined) return orderRefunded ? skippedRefunded() : settleRefundFailure(job, providerUnavailable, now);
  const listed = await listRefunds({ mode: order.mode, tenantId: job.tenantId, paymentIntentId });
  if (!listed.ok) {
    const transient = (refundFailureOf(listed.error)?.kind ?? 'transient') === 'transient';
    return orderRefunded && !transient ? skippedRefunded() : settleRefundFailure(job, listed.error, now);
  }
  const issued = issuedRefundOf(job, listed.value);
  if (issued !== undefined) return settleSubmittedRefund(issued, now);
  const remainingCents = job.amountCents - committedRefundCents(listed.value);
  if (orderRefunded || remainingCents <= 0) return skippedRefunded();
  const created = await createRefund({
    mode: order.mode,
    tenantId: job.tenantId,
    paymentIntentId,
    amountCents: remainingCents,
    idempotencyKey: orderRefundIdempotencyKey(job),
    metadata: { orderId: job.orderId, reason: job.reason },
  });
  if (created.ok) return settleSubmittedRefund(created.value, now);
  const settlement = settleRefundFailure(job, created.error, now);
  return refundFailureOf(created.error)?.outcomeUnknown === true
    ? settlement
    : { ...settlement, update: { ...settlement.update, keyGeneration: job.keyGeneration + 1 } };
};

const refundJob = async (job: OrderRefundJob, order: OrderListItem | null, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
  if (order === null) return finalFailure('The cancelled order was not found');
  const refundable = order.cancelReason === job.reason && job.paymentIntentId !== null;
  if (!refundable && order.status === 'refunded') return skippedRefunded();
  if (order.cancelReason !== job.reason) return finalFailure('The order is not cancelled for this refund reason');
  if (job.paymentIntentId === null) return finalFailure('The order has no payment intent to refund');
  const settlement = await attemptRefund(job, order, job.paymentIntentId, now, deps);
  return settlement.outcome === 'blocked_permission' ? settlement : { ...settlement, update: { permissionBlockedAt: null, ...settlement.update } };
};

const checkRefundStatus = async (job: OrderRefundJob, order: OrderListItem | null, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
  if (job.providerRefundId === null || job.submittedAt === null) {
    return { update: { nextAttemptAt: null }, outcome: 'checked', alert: null };
  }
  const read = deps.payment.getRefund === undefined
    ? err(providerUnavailable)
    : await deps.payment.getRefund({ mode: order?.mode ?? 'live', tenantId: job.tenantId, refundId: job.providerRefundId });
  if (!read.ok) {
    if (Date.parse(now) - Date.parse(job.submittedAt) > STATUS_READ_GIVE_UP_AFTER_MS) return unconfirmed({ lastError: read.error.message });
    return {
      update: { nextAttemptAt: new Date(Date.parse(now) + STATUS_READ_RETRY_MS).toISOString(), lastError: read.error.message },
      outcome: 'checked',
      alert: null,
    };
  }
  const refund = read.value;
  if (refund.status === 'failed' || refund.status === 'canceled') {
    return {
      update: { status: 'failed', nextAttemptAt: null, providerRefundStatus: refund.status, statusChecks: job.statusChecks + 1, lastError: refund.failureReason ?? `Refund ${refund.status}` },
      outcome: 'failed',
      alert: 'failed_after_submission',
    };
  }
  const statusChecks = job.statusChecks + 1;
  const nextAttemptAt = orderRefundStatusCheckAt(job.submittedAt, statusChecks);
  if (refund.status !== 'succeeded' && nextAttemptAt === null) {
    return unconfirmed({ providerRefundStatus: refund.status, statusChecks, lastError: `Refund still ${refund.status} at the last scheduled status check` });
  }
  return {
    update: {
      status: refund.status === 'succeeded' ? 'succeeded' : 'submitted', providerRefundStatus: refund.status, statusChecks, nextAttemptAt, lastError: null,
    },
    outcome: 'checked',
    alert: null,
  };
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

export const dispatchOrderRefundJobs = async (
  deps: DispatchOrderRefundJobsDeps,
): Promise<Result<DispatchOrderRefundJobsResult, AppError>> => {
  const outcomes: Partial<Record<DispatchOutcome, number>> = {};
  let processedCount = 0;
  const stopClaimingAt = Date.parse(deps.clock.nowIso()) + ORDER_REFUND_DISPATCH_BUDGET_MS;
  while (processedCount < MAX_JOBS_PER_DISPATCH && Date.parse(deps.clock.nowIso()) < stopClaimingAt) {
    const claim = await deps.refundJobs.claimDue({ now: deps.clock.nowIso(), leaseMs: LEASE_MS });
    if (claim === null) break;
    const outcome = await processClaim(claim, deps);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    processedCount += 1;
  }
  return ok({ processedCount, outcomes });
};
