import {
  emailBrandingFrom,
  err,
  ok,
  orderRefundIssuedEmail,
  prerenderedTransactionalPayload,
  orderRefundIdempotencyKey,
  orderRefundPermissionRetryAt,
  orderRefundRetryAt,
  orderRefundStatusCheckAt,
  REFUND_REQUEST_WORST_CASE_MS,
  refundFailure,
  refundFailureOf,
  refundJobOfClaim,
  resolveEmailLanguage,
  type AppError,
  type ClaimedRefundJob,
  type OrderListItem,
  type OrderRefundAlert,
  type ProviderRefund,
  type RefundJob,
  type Result,
} from '#core/domain/index.js';

import { safeErrorMessage, safeProviderLogMessage } from '../log-safety.js';
import type {
  Clock,
  EmailOutboxEnqueueInput,
  MemberRepository,
  OrderDetailRepository,
  PaymentProvider,
  RefundJobQueue,
  RefundJobUpdate,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '../ports.js';
import { resolveTenantOrigin, type TenantUrlDeps } from '../tenant-url.js';
import { tenantStaffRecipients } from './tenant-staff-recipients.js';

export interface DispatchOrderRefundJobsDeps extends TenantUrlDeps {
  refundJobs: Pick<RefundJobQueue, 'claimDue' | 'release' | 'countDue'> & Partial<Pick<RefundJobQueue, 'staffRefundWaiting' | 'markCreateAttempt'>>;
  orderDetails: OrderDetailRepository;
  members?: Pick<MemberRepository, 'findById'>;
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
  update: RefundJobUpdate;
  outcome: DispatchOutcome;
  alert: OrderRefundAlert | null;
  ownRefund?: ProviderRefund;
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

const unconfirmed = (update: RefundJobUpdate & { lastError: string }): Settlement =>
  ({ update: { ...update, status: 'unconfirmed', nextAttemptAt: null }, outcome: 'unconfirmed', alert: 'unconfirmed' });

// A staff refund whose create call may have reached the provider never ends as failed while its own refund was not
// seen: the money may have left, so staff must check the provider's dashboard.
const createMayHaveRefunded = (job: RefundJob): boolean => job.source === 'staff' && job.createOutcomeUnknown;

const unconfirmedCreate = (lastError: string): Settlement => unconfirmed({
  lastError: `A refund request may have reached the payment provider, but its refunds could not be read before the retries ended (${lastError}); check the payment in the provider's dashboard`,
});

const settlePermissionMissing = (job: RefundJob, lastError: string, now: string): Settlement => {
  const blockedAt = job.permissionBlockedAt ?? now;
  const retryAt = orderRefundPermissionRetryAt(blockedAt, now);
  if (retryAt === null) return createMayHaveRefunded(job) ? unconfirmedCreate(lastError) : finalFailure(lastError, 'blocked_permission_failed');
  return {
    update: { status: 'blocked_permission', nextAttemptAt: retryAt, lastError, permissionBlockedAt: blockedAt },
    outcome: 'blocked_permission',
    alert: job.permissionBlockedAt === null ? 'blocked_permission' : null,
  };
};

const handRefundUnconfirmed = (order: OrderListItem, settlement: Settlement): Settlement =>
  order.status === 'refunded' && settlement.alert === 'blocked_permission_failed'
    ? unconfirmed({
      lastError: `The payment shows a full refund made outside the platform that the refund key cannot confirm (${settlement.update.lastError ?? 'permission missing'}); check it in the payment provider's dashboard`,
    })
    : settlement;

const skippedRefunded = (): Settlement =>
  ({ update: { status: 'skipped_refunded', nextAttemptAt: null, lastError: null }, outcome: 'skipped_refunded', alert: null });

const watchRefunds = (lastError: string, now: string): Settlement => ({
  update: { status: 'submitted', nextAttemptAt: orderRefundStatusCheckAt(now, 0), submittedAt: now, statusChecks: 0, lastError },
  outcome: 'watching',
  alert: null,
});

const settleRefundFailure = (job: RefundJob, error: AppError, now: string): Settlement => {
  const kind = refundFailureOf(error)?.kind ?? 'transient';
  if (kind === 'already_refunded') return watchRefunds(error.message, now);
  if (kind === 'permission_missing') return settlePermissionMissing(job, error.message, now);
  if (kind === 'idempotency_mismatch') return { update: { status: 'pending', nextAttemptAt: now, lastError: error.message }, outcome: 'retrying', alert: null };
  if (kind === 'not_found' || kind === 'refund_failed') return finalFailure(job.source === 'staff' ? `The payment provider refused the refund, so nothing was refunded: ${error.message}` : error.message);
  const transientFailureStreak = job.transientFailureStreak + 1;
  const retryAt = orderRefundRetryAt(transientFailureStreak, now, job.createdAt);
  if (retryAt === null) return createMayHaveRefunded(job) ? unconfirmedCreate(error.message) : finalFailure(error.message);
  return {
    update: { status: 'pending', nextAttemptAt: retryAt, lastError: error.message, transientFailureStreak },
    outcome: 'retrying',
    alert: job.lastError === null ? 'retrying' : null,
  };
};

const isCommitted = (refund: ProviderRefund): boolean => refund.status !== 'failed' && refund.status !== 'canceled';

const sumCents = (refunds: readonly ProviderRefund[]): number => refunds.reduce((sum, refund) => sum + refund.amountCents, 0);

const isOwnRefund = (job: RefundJob, refund: ProviderRefund): boolean =>
  job.source === 'staff' ? refund.refundJobId === job.id : refund.orderId === job.orderId && refund.reason === job.reason;

const ownRefundsOf = (job: RefundJob, refunds: readonly ProviderRefund[]): ProviderRefund[] =>
  refunds.filter((refund) => refund.refundId === job.providerRefundId || isOwnRefund(job, refund));

type Coverage =
  | { kind: 'own_failed'; refund: ProviderRefund }
  | { kind: 'short'; remainingCents: number }
  | { kind: 'covered'; awaiting: ProviderRefund | undefined };

const committedCoverage = (refunds: readonly ProviderRefund[], targetCents: number): Coverage => {
  const committed = refunds.filter(isCommitted);
  const remainingCents = targetCents - sumCents(committed);
  if (remainingCents > 0) return { kind: 'short', remainingCents };
  const settled = sumCents(committed.filter((refund) => refund.status === 'succeeded')) >= targetCents;
  return { kind: 'covered', awaiting: settled ? undefined : committed.find((refund) => refund.status !== 'succeeded') };
};

const ownCoverage = (job: RefundJob, refunds: readonly ProviderRefund[]): Coverage => {
  const own = ownRefundsOf(job, refunds).filter(isCommitted);
  if (own.length === 0) return { kind: 'short', remainingCents: job.amountCents };
  return { kind: 'covered', awaiting: own.find((refund) => refund.status !== 'succeeded') };
};

const coverageOf = (job: RefundJob, refunds: readonly ProviderRefund[]): Coverage => {
  const ownFailed = ownRefundsOf(job, refunds).find((refund) => !isCommitted(refund));
  if (ownFailed !== undefined) return { kind: 'own_failed', refund: ownFailed };
  return job.source === 'staff' ? ownCoverage(job, refunds) : committedCoverage(refunds, job.amountCents);
};

// A staff refund the provider refused as already refunded has no refund of its own; it ends only once refunds made
// outside the platform cover the whole charge, and is issued after all when one of them fails.
const coverageAtCheck = (job: RefundJob, refunds: readonly ProviderRefund[], order: OrderListItem | null): Coverage => {
  const coverage = coverageOf(job, refunds);
  if (coverage.kind !== 'short' || job.source !== 'staff' || order === null) return coverage;
  const chargeCoverage = committedCoverage(refunds, order.amountCents);
  return chargeCoverage.kind === 'covered' ? chargeCoverage : coverage;
};

const ownRefundFailed = (refund: ProviderRefund, update: RefundJobUpdate = {}): Settlement => ({
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
  const observed: RefundJobUpdate = {
    nextAttemptAt: orderRefundStatusCheckAt(now, 0), providerRefundId: own?.refundId ?? null, providerRefundStatus: own?.status ?? null,
    submittedAt: now, statusChecks: 0, lastError: null,
  };
  const ownRefund = own === undefined ? {} : { ownRefund: own };
  if (awaiting === undefined) return { update: { ...observed, status: 'succeeded' }, outcome: 'refunded', alert: null, ...ownRefund };
  return { update: { ...observed, status: 'submitted' }, outcome: own === undefined ? 'watching' : 'submitted', alert: null, ...ownRefund };
};

const settleCoverageAtCheck = (job: RefundJob, submittedAt: string, refunds: readonly ProviderRefund[], order: OrderListItem | null, now: string): Settlement => {
  const coverage = coverageAtCheck(job, refunds, order);
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
  const ownRefund = own === undefined ? {} : { ownRefund: own };
  if (coverage.awaiting === undefined) {
    return { update: { status: 'succeeded', providerRefundStatus, statusChecks, nextAttemptAt, lastError: null }, outcome: 'checked', alert: null, ...ownRefund };
  }
  if (nextAttemptAt === null) return { ...unconfirmed({ providerRefundStatus, statusChecks, lastError: awaitingError(coverage.awaiting) }), ...ownRefund };
  return { update: { status: 'submitted', providerRefundStatus, statusChecks, nextAttemptAt, lastError: null }, outcome: 'checked', alert: null, ...ownRefund };
};

const ownRefundNotListed = (refundId: string): AppError =>
  refundFailure('transient', `The refund list does not show refund ${refundId} yet`);

const ownRefundSeen = (job: RefundJob): RefundJobUpdate => (job.source === 'staff' ? { createOutcomeUnknown: false } : {});

const withUpdate = (settlement: Settlement, update: RefundJobUpdate): Settlement => ({ ...settlement, update: { ...settlement.update, ...update } });

const leaseLost: Settlement = { update: {}, outcome: 'lease_lost', alert: null };

// Reading the refunds is not a refund request: while an earlier request may have reached the provider, no list
// answer can prove that nothing was refunded, so it is retried until it can be read or the retries end.
const settleListFailure = (job: RefundJob, order: OrderListItem, error: AppError, now: string): Settlement =>
  createMayHaveRefunded(job)
    ? settleRefundFailure(job, refundFailure('transient', error.message), now)
    : handRefundUnconfirmed(order, settleRefundFailure(job, error, now));

// A worker can be lost after the provider accepted a staff refund but before its result is saved, so the attempt
// and the key it uses are saved first; a later run then never takes the refund for failed.
const markCreateAttempt = async (claim: ClaimedRefundJob, keyGeneration: number, deps: DispatchOrderRefundJobsDeps): Promise<boolean> => {
  if (deps.refundJobs.markCreateAttempt === undefined) throw new Error(`Staff refund ${claim.job.id} cannot record its create attempt`);
  return deps.refundJobs.markCreateAttempt(claim.job.tenantId, claim.job.id, claim.lease, { keyGeneration, now: deps.clock.nowIso() });
};

const attemptRefund = async (claim: ClaimedRefundJob, job: RefundJob, order: OrderListItem, paymentIntentId: string, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
  const { createRefund, listRefunds } = deps.payment;
  if (createRefund === undefined || listRefunds === undefined) return settleRefundFailure(job, providerUnavailable, now);
  const listed = await listRefunds({ mode: order.mode, tenantId: job.tenantId, paymentIntentId });
  if (!listed.ok) return settleListFailure(job, order, listed.error, now);
  const refunds = listed.value;
  if (job.providerRefundId !== null && !refunds.some((refund) => refund.refundId === job.providerRefundId)) {
    return settleRefundFailure(job, ownRefundNotListed(job.providerRefundId), now);
  }
  const coverage = coverageOf(job, refunds);
  if (coverage.kind === 'own_failed') return ownRefundFailed(coverage.refund, { submittedAt: now, ...ownRefundSeen(job) });
  if (coverage.kind === 'covered') return withUpdate(settleCoverageAfterRefund(ownRefundsOf(job, refunds)[0], coverage.awaiting, now), ownRefundSeen(job));
  // An own refund the job never recorded came from a call whose result was not saved, so it spent the
  // current key; a recorded one moved the generation on when the job reopened.
  const keySpent = ownRefundsOf(job, refunds).some((refund) => refund.refundId !== job.providerRefundId);
  const keyGeneration = keySpent ? job.keyGeneration + 1 : job.keyGeneration;
  if (job.source === 'staff' && !await markCreateAttempt(claim, keyGeneration, deps)) return leaseLost;
  const created = await createRefund({
    mode: order.mode,
    tenantId: job.tenantId,
    paymentIntentId,
    amountCents: coverage.remainingCents,
    idempotencyKey: orderRefundIdempotencyKey({ ...job, keyGeneration }),
    metadata: job.source === 'staff' ? { orderId: job.orderId, reason: 'staff', refundJobId: job.id } : { orderId: job.orderId, reason: job.reason },
  });
  if (created.ok) {
    const withCreated = [created.value, ...refunds.filter((refund) => refund.refundId !== created.value.refundId)];
    // The created refund is this staff refund's own even when the provider echoes no metadata.
    const owner: RefundJob = job.source === 'staff' ? { ...job, providerRefundId: created.value.refundId } : job;
    const after = coverageOf(owner, withCreated);
    if (after.kind === 'own_failed') return ownRefundFailed(after.refund, { submittedAt: now, keyGeneration, ...ownRefundSeen(job) });
    if (after.kind === 'short') {
      const settlement = settleRefundFailure(job, refundFailure('transient', `Refund ${created.value.refundId} does not cover the rest of the payment`), now);
      return withUpdate(settlement, { keyGeneration: keyGeneration + 1, ...ownRefundSeen(job) });
    }
    return withUpdate(settleCoverageAfterRefund(created.value, after.awaiting, now), { keyGeneration, ...ownRefundSeen(job) });
  }
  const failureDetails = refundFailureOf(created.error);
  // A staff refund is created with the key it is retried with, so after a provider server error the same key
  // either replays the refund the provider made or makes it once; a new key could make a second one.
  const outcomeUnknown = failureDetails?.outcomeUnknown === true || (job.source === 'staff' && failureDetails?.providerServerError === true);
  const attempted: RefundJob = job.source === 'staff' ? { ...job, createOutcomeUnknown: outcomeUnknown } : job;
  const failure = settleRefundFailure(attempted, created.error, now);
  const settlement = refunds.some((refund) => !isCommitted(refund)) ? failure : handRefundUnconfirmed(order, failure);
  return withUpdate(settlement, {
    keyGeneration: outcomeUnknown ? keyGeneration : keyGeneration + 1,
    ...(attempted.source === 'staff' ? { createOutcomeUnknown: attempted.createOutcomeUnknown } : {}),
  });
};

const settleAttempt = (settlement: Settlement): Settlement => {
  const refundCovered = settlement.outcome === 'refunded' || settlement.outcome === 'submitted' || settlement.outcome === 'watching';
  return { ...settlement, update: { transientFailureStreak: 0, ...(refundCovered ? { permissionBlockedAt: null } : {}), ...settlement.update } };
};

const refundJob = async (claim: ClaimedRefundJob, job: RefundJob, order: OrderListItem | null, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
  if (job.source === 'staff') {
    if (order === null) return finalFailure('The order was not found');
    return settleAttempt(await attemptRefund(claim, job, order, job.paymentIntentId, now, deps));
  }
  if (order === null) return finalFailure('The cancelled order was not found');
  const refundable = order.cancelReason === job.reason && job.paymentIntentId !== null;
  if (!refundable && order.status === 'refunded') return skippedRefunded();
  if (order.cancelReason !== job.reason) return finalFailure('The order is not cancelled for this refund reason');
  if (job.paymentIntentId === null) return finalFailure('The order has no payment intent to refund');
  return settleAttempt(await attemptRefund(claim, job, order, job.paymentIntentId, now, deps));
};

const settleReadFailure = (submittedAt: string, lastError: string, now: string): Settlement => {
  if (Date.parse(now) - Date.parse(submittedAt) > STATUS_READ_GIVE_UP_AFTER_MS) return unconfirmed({ lastError });
  return {
    update: { nextAttemptAt: new Date(Date.parse(now) + STATUS_READ_RETRY_MS).toISOString(), lastError },
    outcome: 'checked',
    alert: null,
  };
};

// Only one staff refund of an order may wait to reach the provider, so the reopen waits for the other one.
const waitForOtherStaffRefund = (reopen: Settlement, now: string): Settlement => ({
  update: {
    nextAttemptAt: new Date(Date.parse(now) + STATUS_READ_RETRY_MS).toISOString(),
    lastError: `${reopen.update.lastError ?? 'Part of the payment is left to refund'}; another refund of this order is still waiting to reach the payment provider`,
  },
  outcome: 'checked',
  alert: null,
});

const checkRefundStatus = async (job: RefundJob, order: OrderListItem | null, now: string, deps: DispatchOrderRefundJobsDeps): Promise<Settlement> => {
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
  const settlement = settleCoverageAtCheck(job, job.submittedAt, listed.value, order, now);
  if (settlement.outcome !== 'reopened' || job.source !== 'staff') return settlement;
  const anotherWaiting = await deps.refundJobs.staffRefundWaiting?.(job.tenantId, job.orderId, { except: job.id }) ?? false;
  return anotherWaiting ? waitForOtherStaffRefund(settlement, now) : settlement;
};

const STAFF_REFUND_EMAIL_SOURCE = 'staff-refunds';

// A refund still awaited at the last check ends unconfirmed for staff, yet the buyer is told once the provider holds it.
const BUYER_NOTICE_STATUSES: ReadonlySet<string> = new Set(['submitted', 'succeeded', 'unconfirmed']);

const STOCK_KEPT_ALERTS: ReadonlySet<OrderRefundAlert> = new Set(['failed', 'failed_after_submission', 'blocked_permission_failed', 'unconfirmed']);

const staffRefundAlertError = (job: Extract<RefundJob, { source: 'staff' }>, alert: OrderRefundAlert): string => {
  const kept = [
    ...(job.restocked ? ['the goods returned to stock'] : []),
    ...(job.removedFromPackingList ? ['the order taken off the packing list'] : []),
  ];
  const keptNote = kept.length > 0 && STOCK_KEPT_ALERTS.has(alert) ? ` This refund was requested by staff; ${kept.join(' and ')} stay as chosen.` : ' This refund was requested by staff.';
  const accessNote = alert === 'failed_after_submission'
    ? ' If the payment provider had already reported the refund, the order shows as refunded and the access it gave was ended; that access is not given back automatically, so grant it again on the member page, and refund the order again from its page if needed.'
    : '';
  return `${job.lastError ?? ''}${keptNote}${accessNote}`.trim();
};

const buyerNotice = async (
  job: RefundJob,
  order: OrderListItem | null,
  settlement: Settlement,
  deps: DispatchOrderRefundJobsDeps,
): Promise<EmailOutboxEnqueueInput | undefined> => {
  const status = settlement.update.status;
  const ownRefund = settlement.ownRefund;
  if (job.source !== 'staff' || job.buyerNotifiedAt !== null || order === null || order.mode === 'test' || ownRefund === undefined) return undefined;
  if (status === undefined || !BUYER_NOTICE_STATUSES.has(status)) return undefined;
  if (ownRefund.status !== 'pending' && ownRefund.status !== 'succeeded') return undefined;
  const tenant = await deps.tenants.findById(job.tenantId);
  if (tenant === null) return undefined;
  const [settings, member] = await Promise.all([
    deps.tenants.findSettings(job.tenantId),
    deps.members?.findById(job.tenantId, order.memberId) ?? null,
  ]);
  const shopUrl = `${await resolveTenantOrigin(tenant, deps)}/`;
  const message = orderRefundIssuedEmail(resolveEmailLanguage(member?.language, settings?.defaultLanguage), {
    tenantName: tenant.name,
    orderId: job.orderId,
    amountCents: ownRefund.amountCents,
    currency: job.currency,
    shopUrl,
    ...(settings === null ? {} : { branding: emailBrandingFrom(settings, shopUrl) }),
  });
  return {
    id: `order-refund-issued:${job.id}`,
    tenantId: job.tenantId,
    to: member?.email ?? order.memberEmail,
    payload: prerenderedTransactionalPayload(message),
    sourceApp: STAFF_REFUND_EMAIL_SOURCE,
    tenantTransportRequired: false,
    now: deps.clock.nowIso(),
    onConflict: 'keep-existing',
  };
};

const staffAlertEmails = async (job: RefundJob, alert: OrderRefundAlert, deps: DispatchOrderRefundJobsDeps): Promise<EmailOutboxEnqueueInput[]> => {
  const tenant = await deps.tenants.findById(job.tenantId);
  if (tenant === null) return [];
  const recipients = await tenantStaffRecipients(job.tenantId, deps);
  const orderUrl = `${await resolveTenantOrigin(tenant, deps)}/panel/sales/${encodeURIComponent(job.orderId)}`;
  const now = deps.clock.nowIso();
  const error = job.source === 'staff' ? staffRefundAlertError(job, alert) : job.lastError ?? '';
  return recipients.map((recipient, index) => ({
    id: `order-refund-alert:${job.id}:${alert}:${String(job.attempts)}:${String(index)}`,
    tenantId: job.tenantId,
    to: recipient.email,
    payload: {
      kind: 'order-refund-alert', language: recipient.language, tenantName: tenant.name, alert, orderId: job.orderId,
      amountCents: job.amountCents, currency: job.currency, error, orderUrl,
    },
    now,
  }));
};

const deferSettlement = async (claim: ClaimedRefundJob, cause: unknown, deps: DispatchOrderRefundJobsDeps): Promise<DispatchOutcome> => {
  const { job } = claim;
  const now = deps.clock.nowIso();
  deps.logger.error(safeProviderLogMessage(`[order-refund] settlement not saved, retrying tenant=${job.tenantId} order=${job.orderId} job=${job.id} phase=${claim.phase}: ${safeErrorMessage(cause)}`));
  try {
    await deps.refundJobs.release(job.tenantId, job.id, claim.lease, {
      ...(claim.phase === 'refund' ? { status: 'pending' } : {}),
      nextAttemptAt: new Date(Date.parse(now) + SETTLEMENT_RETRY_MS).toISOString(),
      now,
    });
  } catch (releaseCause) {
    deps.logger.error(safeProviderLogMessage(`[order-refund] job left to its lease tenant=${job.tenantId} order=${job.orderId} job=${job.id}: ${safeErrorMessage(releaseCause)}`));
  }
  return 'deferred';
};

const processClaim = async (claim: ClaimedRefundJob, deps: DispatchOrderRefundJobsDeps): Promise<DispatchOutcome> => {
  const job = refundJobOfClaim(claim);
  const now = deps.clock.nowIso();
  const order = await deps.orderDetails.findById(job.tenantId, job.orderId);
  const settlement = claim.phase === 'refund'
    ? await refundJob(claim, job, order, now, deps)
    : await checkRefundStatus(job, order, now, deps);
  if (settlement.outcome === 'lease_lost') {
    deps.logger.error(`[order-refund] lease lost before the refund request tenant=${job.tenantId} order=${job.orderId} job=${job.id}`);
    return 'lease_lost';
  }
  let staffAlerts: EmailOutboxEnqueueInput[] = [];
  let notice: EmailOutboxEnqueueInput | undefined;
  let released: Awaited<ReturnType<DispatchOrderRefundJobsDeps['refundJobs']['release']>>;
  try {
    if (settlement.alert !== null) staffAlerts = await staffAlertEmails({ ...job, ...settlement.update }, settlement.alert, deps);
    notice = await buyerNotice(job, order, settlement, deps);
    released = notice === undefined
      ? await deps.refundJobs.release(job.tenantId, job.id, claim.lease, { ...settlement.update, now: deps.clock.nowIso() }, staffAlerts)
      : await deps.refundJobs.release(job.tenantId, job.id, claim.lease, { ...settlement.update, now: deps.clock.nowIso() }, staffAlerts, notice);
  } catch (cause) {
    return deferSettlement(claim, cause, deps);
  }
  if (released === null) {
    deps.logger.error(`[order-refund] lease lost tenant=${job.tenantId} order=${job.orderId} job=${job.id} phase=${claim.phase}`);
    return 'lease_lost';
  }
  if (settlement.outcome !== 'refunded' && settlement.outcome !== 'checked') {
    deps.logger.warn(safeProviderLogMessage(`[order-refund] tenant=${job.tenantId} order=${job.orderId} job=${job.id} attempt=${String(job.attempts)} status=${released.status} next=${released.nextAttemptAt ?? 'none'} error=${released.lastError ?? 'none'}`));
  }
  if (staffAlerts.length > 0 || notice !== undefined) deps.dispatchEmail();
  return settlement.outcome;
};

const warnDueJobsLeft = async (stoppedBy: 'cap' | 'deadline', deps: DispatchOrderRefundJobsDeps): Promise<void> => {
  try {
    const due = await deps.refundJobs.countDue({ now: deps.clock.nowIso() });
    if (due > 0) deps.logger.warn(`[order-refund] run stopped by ${stoppedBy}, ${String(due)} due refund jobs left for the next run`);
  } catch (cause) {
    deps.logger.error(safeProviderLogMessage(`[order-refund] due refund jobs not counted after the run stopped by ${stoppedBy}: ${safeErrorMessage(cause)}`));
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
