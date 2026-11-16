import { describe, expect, it } from 'vitest';

import {
  err,
  ok,
  orderListItemSchema,
  outOfStockRefundJob,
  refundFailure,
  type AppError,
  type OrderListItem,
  type ProviderRefund,
  type Result,
} from '#core/domain/index.js';

import { createOrderRefundJobFake } from '../testing/order-refund-job-fake.js';
import { createRefundProviderFake, type RefundProviderStep } from '../testing/refund-provider-fake.js';
import { createInMemoryTenantDomainRepository } from '../testing/tenant-domain-fakes.js';
import {
  dispatchOrderRefundJobs, ORDER_REFUND_CRON_TICK_MAX_JOBS, ORDER_REFUND_DISPATCH_BUDGET_MS, ORDER_REFUND_JOB_WORST_CASE_MS, type DispatchOrderRefundJobsOptions,
} from './dispatch-order-refund-jobs.js';

const createdAt = '2026-11-15T10:42:00.000Z';
const minutes = (count: number) => count * 60_000;
const hours = (count: number) => count * minutes(60);
const at = (offsetMs: number) => new Date(Date.parse(createdAt) + offsetMs).toISOString();

const cancelledOrder = (overrides: Partial<OrderListItem> = {}): OrderListItem => orderListItemSchema.parse({
  id: 'order-1', tenantId: 'tenant-a', memberId: 'member-1', productId: 'printed-1', priceId: null, kind: 'one_time', status: 'paid',
  amountCents: 4099, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: 'cs_1', paymentIntent: 'pi_1' }, couponId: null,
  discountCents: 0, cancelReason: 'out_of_stock', createdAt, memberEmail: 'buyer@example.com', memberName: null, productTitle: 'Printed book',
  couponCode: null, mode: 'live', ...overrides,
});

const providerRefund = (status: ProviderRefund['status'] = 'succeeded'): ProviderRefund =>
  ({ refundId: 're_1', paymentIntentId: 'pi_1', amountCents: 4099, status, failureReason: status === 'failed' ? 'expired_or_canceled_card' : null, orderId: 'order-1', reason: 'out_of_stock' });

const permissionMissing = () => refundFailure('permission_missing', 'The provided key does not have the required permissions', 'permission_denied');

const harness = (input: {
  order?: OrderListItem;
  steps?: RefundProviderStep[];
  reads?: Array<Result<ProviderRefund, AppError>>;
  refundedByHand?: ProviderRefund[];
  staleRefundList?: boolean;
} = {}) => {
  let now = createdAt;
  let failingRecipientLookups = 0;
  let order = input.order ?? cancelledOrder();
  const fake = createOrderRefundJobFake();
  const provider = createRefundProviderFake({
    chargeAmountCents: order.amountCents,
    ...(input.steps === undefined ? {} : { steps: input.steps }),
    ...(input.reads === undefined ? {} : { reads: input.reads }),
    ...(input.refundedByHand === undefined ? {} : { refundedByHand: input.refundedByHand }),
  });
  const alerts = fake.alerts;
  const errors: string[] = [];
  const deps = {
    refundJobs: fake.repository,
    orderDetails: { findById: async (tenantId: string, orderId: string) => (tenantId === order.tenantId && orderId === order.id ? order : null) },
    payment: input.staleRefundList === true ? { ...provider.payment, listRefunds: async () => ok([]) } : provider.payment,
    tenants: {
      findById: async () => ({ id: 'tenant-a', slug: 'acme', name: 'Acme', status: 'active' as const, plan: 'hosted' as const, contentVersion: 1 }),
      findSettings: async () => null,
    },
    tenantAccess: {
      listStaffForTenant: async () => {
        if (failingRecipientLookups > 0) {
          failingRecipientLookups -= 1;
          throw new Error('Connection pool timeout');
        }
        return [{ userId: 'owner', email: 'owner@example.com', staffRole: 'owner' as const, language: 'en' as const }];
      },
    },
    tenantDomains: createInMemoryTenantDomainRepository(),
    clock: { nowIso: () => now },
    logger: { warn: () => undefined, error: (message: string) => { errors.push(message); } },
    dispatchEmail: () => undefined,
    appBaseUrl: 'https://togethercommunity.app',
    baseDomain: 'togethercommunity.app',
    singleTenantMode: false,
  };
  const queue = async () => {
    await fake.repository.enqueue('tenant-a', outOfStockRefundJob(order, { id: 'job-1', now: createdAt }));
  };
  const tick = async (time: string) => {
    now = time;
    const result = await dispatchOrderRefundJobs(deps);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const job = () => {
    const stored = fake.jobs[0];
    if (stored === undefined) throw new Error('No refund job');
    return stored;
  };
  const alertKinds = () => alerts.map(({ payload }) => (payload.kind === 'order-refund-alert' ? payload.alert : payload.kind));
  const keys = () => provider.calls.map((call) => call.idempotencyKey);
  const failRecipientLookups = (count: number) => { failingRecipientLookups = count; };
  const chargeRefunded = async () => {
    order = { ...order, status: 'refunded' };
    return fake.repository.resolveExternally(order.tenantId, order.id, now);
  };
  return {
    deps, queue, tick, job, refundCalls: provider.calls, readCalls: provider.readCalls, created: provider.created, alerts, alertKinds, keys, errors,
    failAlertWrites: fake.failAlertWrites, failRecipientLookups, chargeRefunded, refundByHand: provider.refundByHand, failRefund: provider.failRefund,
  };
};

describe('order refund dispatcher', () => {
  it('retries a failing refund on the schedule with a new key generation after each error response and makes exactly one refund', async () => {
    const h = harness({ steps: [
      { outcome: 'error', error: refundFailure('transient', 'Stripe is unavailable') },
      { outcome: 'error', error: refundFailure('insufficient_balance', 'Insufficient balance', 'balance_insufficient') },
    ] });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { retrying: 1 } });
    expect(h.job()).toMatchObject({ status: 'pending', attempts: 1, keyGeneration: 1, nextAttemptAt: at(minutes(1)), lastError: 'Stripe is unavailable', lockedAt: null });
    expect(await h.tick(at(minutes(1) - 1))).toStrictEqual({ processedCount: 0, outcomes: {} });

    await h.tick(at(minutes(1)));
    expect(h.job()).toMatchObject({ status: 'pending', attempts: 2, keyGeneration: 2, nextAttemptAt: at(minutes(6)), lastError: 'Insufficient balance' });

    await h.tick(at(minutes(6)));
    expect(h.job()).toMatchObject({
      status: 'succeeded', attempts: 3, keyGeneration: 2, providerRefundId: 're_1', providerRefundStatus: 'succeeded', submittedAt: at(minutes(6)),
      nextAttemptAt: at(minutes(6) + hours(24)), lastError: null, lockedAt: null,
    });
    expect(await h.tick(at(minutes(7)))).toStrictEqual({ processedCount: 0, outcomes: {} });

    expect(h.keys()).toStrictEqual(['oos-refund-order-1', 'oos-refund-order-1-1', 'oos-refund-order-1-2']);
    expect(h.refundCalls[0]).toStrictEqual({
      mode: 'live', tenantId: 'tenant-a', paymentIntentId: 'pi_1', amountCents: 4099, idempotencyKey: 'oos-refund-order-1',
      metadata: { orderId: 'order-1', reason: 'out_of_stock' },
    });
    expect(h.created).toHaveLength(1);
    expect(h.alertKinds()).toStrictEqual(['retrying']);
    expect(h.alerts[0]).toMatchObject({ to: 'owner@example.com', payload: { orderId: 'order-1', orderUrl: 'https://acme.togethercommunity.app/panel/sales/order-1', error: 'Stripe is unavailable' } });
  });

  it('pays on the next attempt with a new key once the balance is restored, although Stripe saved the first error under the old key', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('insufficient_balance', 'Insufficient available balance', 'balance_insufficient') }] });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'pending', keyGeneration: 1, nextAttemptAt: at(minutes(1)) });
    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { refunded: 1 } });

    expect(h.job()).toMatchObject({ status: 'succeeded', attempts: 2, keyGeneration: 1, providerRefundId: 're_1' });
    expect(h.keys()).toStrictEqual(['oos-refund-order-1', 'oos-refund-order-1-1']);
    expect(h.created).toStrictEqual([expect.objectContaining({ amountCents: 4099, status: 'succeeded' })]);
  });

  it('reuses the same key after a request whose answer never arrived', async () => {
    const h = harness({ steps: [{ outcome: 'no_response', createsRefund: false }] });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { retrying: 1 } });
    expect(h.job()).toMatchObject({ status: 'pending', keyGeneration: 0, nextAttemptAt: at(minutes(1)) });
    await h.tick(at(minutes(1)));

    expect(h.job()).toMatchObject({ status: 'succeeded', keyGeneration: 0 });
    expect(h.keys()).toStrictEqual(['oos-refund-order-1', 'oos-refund-order-1']);
    expect(h.created).toHaveLength(1);
  });

  it('gets the same refund back with the same key when a request without an answer did create it', async () => {
    const h = harness({ steps: [{ outcome: 'no_response', createsRefund: true }], staleRefundList: true });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'pending', keyGeneration: 0 });
    await h.tick(at(minutes(1)));

    expect(h.job()).toMatchObject({ status: 'submitted', providerRefundId: 're_1', providerRefundStatus: 'pending' });
    expect(h.keys()).toStrictEqual(['oos-refund-order-1', 'oos-refund-order-1']);
    expect(h.created).toHaveLength(1);
  });

  it('takes over the refund a 500 did create instead of refunding again with the next key', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('transient', 'Stripe API error', null), createsRefund: true }] });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'pending', keyGeneration: 1 });
    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { submitted: 1 } });

    expect(h.job()).toMatchObject({ status: 'submitted', providerRefundId: 're_1', providerRefundStatus: 'pending', nextAttemptAt: at(minutes(1) + hours(24)) });
    expect(h.refundCalls).toHaveLength(1);
    expect(h.created).toHaveLength(1);
    expect(h.alertKinds()).toStrictEqual(['retrying']);
  });

  it("ends as skipped_refunded with exactly one refund when a stale refund list hides the refund a 500 did create (Stripe's refundable cap)", async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('transient', 'Stripe API error', null), createsRefund: true }], staleRefundList: true });
    await h.queue();

    await h.tick(createdAt);
    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { skipped_refunded: 1 } });

    expect(h.job()).toMatchObject({ status: 'skipped_refunded', nextAttemptAt: null });
    expect(h.keys()).toStrictEqual(['oos-refund-order-1', 'oos-refund-order-1-1']);
    expect(h.created).toHaveLength(1);
  });

  it('takes over a refund Stripe made although the create call timed out, re-reads it and alerts staff when it fails later', async () => {
    const h = harness({ steps: [{ outcome: 'no_response', createsRefund: true }], reads: [ok(providerRefund('failed'))] });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { retrying: 1 } });
    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { submitted: 1 } });
    expect(h.job()).toMatchObject({
      status: 'submitted', providerRefundId: 're_1', providerRefundStatus: 'pending', submittedAt: at(minutes(1)), statusChecks: 0,
      nextAttemptAt: at(minutes(1) + hours(24)), lastError: null,
    });
    expect(h.refundCalls).toHaveLength(1);

    expect(await h.tick(at(minutes(1) + hours(24)))).toStrictEqual({ processedCount: 1, outcomes: { failed: 1 } });
    expect(h.job()).toMatchObject({ status: 'failed', providerRefundStatus: 'failed', lastError: 'expired_or_canceled_card', nextAttemptAt: null });
    expect(h.alertKinds()).toStrictEqual(['retrying', 'failed_after_submission']);
    expect(h.created).toHaveLength(1);
  });

  it('keeps tracking its own refund when charge.refunded for it arrives before the next attempt', async () => {
    const h = harness({ steps: [{ outcome: 'no_response', createsRefund: true }] });
    await h.queue();

    await h.tick(createdAt);
    expect(await h.chargeRefunded()).toBeNull();
    expect(h.job()).toMatchObject({ status: 'pending', attempts: 1 });

    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { submitted: 1 } });
    expect(h.job()).toMatchObject({ status: 'submitted', providerRefundId: 're_1', nextAttemptAt: at(minutes(1) + hours(24)) });
    await h.tick(at(minutes(1) + hours(24)));
    expect(h.job()).toMatchObject({ status: 'submitted', statusChecks: 1, nextAttemptAt: at(minutes(1) + hours(24 * 7)) });
    expect(h.readCalls).toStrictEqual(['re_1']);
    expect(h.refundCalls).toHaveLength(1);
  });

  it('ends as skipped_refunded without a refund call when staff refund by hand after an attempt failed', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('transient', 'Stripe is unavailable') }] });
    await h.queue();

    await h.tick(createdAt);
    h.refundByHand({ refundId: 're_hand', paymentIntentId: 'pi_1', amountCents: 4099, status: 'pending', failureReason: null, orderId: null, reason: null });
    expect(await h.chargeRefunded()).toBeNull();

    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { skipped_refunded: 1 } });
    expect(h.job()).toMatchObject({ status: 'skipped_refunded', providerRefundId: null, nextAttemptAt: null });
    expect(h.refundCalls).toHaveLength(1);
  });

  it('resolves a job that never called Stripe when the charge is refunded by hand', async () => {
    const h = harness();
    await h.queue();

    expect(await h.chargeRefunded()).toMatchObject({ status: 'resolved_externally', nextAttemptAt: null });
    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 0, outcomes: {} });
    expect(h.refundCalls).toStrictEqual([]);
  });

  it('refunds only what is left after staff refunded part of the payment by hand', async () => {
    const h = harness({
      order: cancelledOrder({ status: 'partially_refunded' }),
      refundedByHand: [{ refundId: 're_hand', paymentIntentId: 'pi_1', amountCents: 2000, status: 'succeeded', failureReason: null, orderId: null, reason: null }],
    });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { refunded: 1 } });
    expect(h.refundCalls).toStrictEqual([expect.objectContaining({ amountCents: 2099, idempotencyKey: 'oos-refund-order-1' })]);
    expect(h.job()).toMatchObject({ status: 'succeeded', providerRefundId: 're_1' });
    expect(h.alerts).toStrictEqual([]);
  });

  it('skips without a refund call when staff already refunded the whole payment by hand in parts', async () => {
    const h = harness({
      order: cancelledOrder({ status: 'partially_refunded' }),
      refundedByHand: [
        { refundId: 're_hand_1', paymentIntentId: 'pi_1', amountCents: 2000, status: 'succeeded', failureReason: null, orderId: null, reason: null },
        { refundId: 're_hand_2', paymentIntentId: 'pi_1', amountCents: 2099, status: 'pending', failureReason: null, orderId: null, reason: null },
        { refundId: 're_hand_failed', paymentIntentId: 'pi_1', amountCents: 4099, status: 'failed', failureReason: 'declined', orderId: null, reason: null },
      ],
    });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { skipped_refunded: 1 } });
    expect(h.refundCalls).toStrictEqual([]);
  });

  it('skips an order that staff already refunded by hand without a refund call', async () => {
    const h = harness({
      order: cancelledOrder({ status: 'refunded' }),
      refundedByHand: [{ refundId: 're_hand', paymentIntentId: 'pi_1', amountCents: 4099, status: 'succeeded', failureReason: null, orderId: null, reason: null }],
    });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { skipped_refunded: 1 } });
    expect(h.job()).toMatchObject({ status: 'skipped_refunded', nextAttemptAt: null, providerRefundId: null });
    expect(await h.tick(at(hours(48)))).toStrictEqual({ processedCount: 0, outcomes: {} });
    expect(h.refundCalls).toStrictEqual([]);
    expect(h.alerts).toStrictEqual([]);
  });

  it('refunds a blocked job exactly once when the hand refund that marked the order refunded fails later', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: permissionMissing() }] });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { blocked_permission: 1 } });
    h.refundByHand({ refundId: 're_hand', paymentIntentId: 'pi_1', amountCents: 4099, status: 'pending', failureReason: null, orderId: null, reason: null });
    expect(await h.chargeRefunded()).toBeNull();
    h.failRefund('re_hand', 'expired_or_canceled_card');

    expect(await h.tick(at(hours(1)))).toStrictEqual({ processedCount: 1, outcomes: { refunded: 1 } });
    expect(h.job()).toMatchObject({ status: 'succeeded', keyGeneration: 1, providerRefundId: 're_1', permissionBlockedAt: null });
    expect(h.refundCalls).toStrictEqual([
      expect.objectContaining({ amountCents: 4099, idempotencyKey: 'oos-refund-order-1' }),
      expect.objectContaining({ amountCents: 4099, idempotencyKey: 'oos-refund-order-1-1' }),
    ]);
    expect(await h.tick(at(hours(2)))).toStrictEqual({ processedCount: 0, outcomes: {} });
    expect(await h.tick(at(hours(25)))).toStrictEqual({ processedCount: 1, outcomes: { checked: 1 } });
    expect(h.refundCalls).toHaveLength(2);
    expect(h.created).toStrictEqual([expect.objectContaining({ refundId: 're_1', amountCents: 4099, orderId: 'order-1' })]);
  });

  it('fails with a staff alert instead of skipping an order marked refunded when its refunds cannot be listed for good', async () => {
    const h = harness({ order: cancelledOrder({ status: 'refunded' }) });
    h.deps.payment = { ...h.deps.payment, listRefunds: async () => err(refundFailure('not_found', "No such payment_intent: 'pi_1'", 'resource_missing')) };
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { failed: 1 } });
    expect(h.job()).toMatchObject({ status: 'failed', nextAttemptAt: null, lastError: "No such payment_intent: 'pi_1'" });
    expect(h.alertKinds()).toStrictEqual(['failed']);
    expect(h.refundCalls).toStrictEqual([]);
  });

  it('marks a charge Stripe reports as already refunded as skipped', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('already_refunded', 'Charge has already been refunded', 'charge_already_refunded') }] });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'skipped_refunded', nextAttemptAt: null });
    expect(h.alerts).toStrictEqual([]);
  });

  it('retries a refund the restricted key may not create every hour with a new key and pays it once the permission is added', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: permissionMissing() }, { outcome: 'error', error: permissionMissing() }] });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { blocked_permission: 1 } });
    expect(h.job()).toMatchObject({
      status: 'blocked_permission', attempts: 1, keyGeneration: 1, nextAttemptAt: at(hours(1)), permissionBlockedAt: createdAt,
      lastError: 'The provided key does not have the required permissions',
    });
    expect(await h.tick(at(minutes(59)))).toStrictEqual({ processedCount: 0, outcomes: {} });
    expect(await h.tick(at(hours(1)))).toStrictEqual({ processedCount: 1, outcomes: { blocked_permission: 1 } });
    expect(h.job()).toMatchObject({ status: 'blocked_permission', attempts: 2, keyGeneration: 2, nextAttemptAt: at(hours(2)), permissionBlockedAt: createdAt });
    expect(await h.tick(at(hours(2)))).toStrictEqual({ processedCount: 1, outcomes: { refunded: 1 } });

    expect(h.job()).toMatchObject({ status: 'succeeded', attempts: 3, keyGeneration: 2, permissionBlockedAt: null, providerRefundId: 're_1' });
    expect(h.keys()).toStrictEqual(['oos-refund-order-1', 'oos-refund-order-1-1', 'oos-refund-order-1-2']);
    expect(h.created).toHaveLength(1);
    expect(h.alertKinds()).toStrictEqual(['blocked_permission']);
  });

  it('retries a temporary error met after hourly permission refusals a minute later, because the retry delay follows consecutive temporary errors', async () => {
    const h = harness({ steps: [
      ...Array.from({ length: 6 }, () => ({ outcome: 'error' as const, error: permissionMissing() })),
      { outcome: 'error', error: refundFailure('transient', 'Stripe is unavailable') },
    ] });
    await h.queue();

    for (let hour = 0; hour < 6; hour += 1) await h.tick(at(hours(hour)));
    expect(h.job()).toMatchObject({ status: 'blocked_permission', attempts: 6, nextAttemptAt: at(hours(6)), transientFailureStreak: 0 });

    expect(await h.tick(at(hours(6)))).toStrictEqual({ processedCount: 1, outcomes: { retrying: 1 } });
    expect(h.job()).toMatchObject({ status: 'pending', attempts: 7, transientFailureStreak: 1, nextAttemptAt: at(hours(6) + minutes(1)), lastError: 'Stripe is unavailable' });

    expect(await h.tick(at(hours(6) + minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { refunded: 1 } });
    expect(h.job()).toMatchObject({ status: 'succeeded', transientFailureStreak: 0, permissionBlockedAt: null });
    expect(h.created).toHaveLength(1);
  });

  it('keeps the 72-hour window and sends no second blocked alert for a permission refusal after a temporary error', async () => {
    const h = harness({ steps: [
      { outcome: 'error', error: permissionMissing() },
      { outcome: 'error', error: refundFailure('transient', 'Stripe is unavailable') },
      ...Array.from({ length: 100 }, () => ({ outcome: 'error' as const, error: permissionMissing() })),
    ] });
    await h.queue();

    await h.tick(createdAt);
    await h.tick(at(hours(1)));
    expect(h.job()).toMatchObject({ status: 'pending', permissionBlockedAt: createdAt, nextAttemptAt: at(hours(1) + minutes(1)) });

    expect(await h.tick(at(hours(1) + minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { blocked_permission: 1 } });
    expect(h.job()).toMatchObject({ status: 'blocked_permission', permissionBlockedAt: createdAt, nextAttemptAt: at(hours(2) + minutes(1)) });
    expect(h.alertKinds()).toStrictEqual(['blocked_permission']);

    const attemptTimes: string[] = [];
    for (let tick = 0; tick < 100 && ['pending', 'blocked_permission'].includes(h.job().status); tick += 1) {
      const due = h.job().nextAttemptAt ?? createdAt;
      attemptTimes.push(due);
      await h.tick(due);
    }
    expect(attemptTimes.at(-1)).toBe(at(hours(72) + minutes(1)));
    expect(h.job()).toMatchObject({ status: 'failed', nextAttemptAt: null });
    expect(h.alertKinds()).toStrictEqual(['blocked_permission', 'blocked_permission_failed']);
  });

  it('gives up a refund still blocked by the missing permission after 72 hours and alerts staff a second time', async () => {
    const h = harness({ steps: Array.from({ length: 100 }, () => ({ outcome: 'error' as const, error: permissionMissing() })) });
    await h.queue();

    const attemptTimes: string[] = [];
    for (let tick = 0; tick < 100 && ['pending', 'blocked_permission'].includes(h.job().status); tick += 1) {
      const due = h.job().nextAttemptAt ?? createdAt;
      attemptTimes.push(due);
      await h.tick(due);
    }

    expect(h.job()).toMatchObject({ status: 'failed', attempts: 73, nextAttemptAt: null });
    expect(attemptTimes.slice(0, 3)).toStrictEqual([createdAt, at(hours(1)), at(hours(2))]);
    expect(attemptTimes.at(-1)).toBe(at(hours(72)));
    expect(new Set(h.keys()).size).toBe(73);
    expect(h.created).toStrictEqual([]);
    expect(h.alertKinds()).toStrictEqual(['blocked_permission', 'blocked_permission_failed']);
    expect(await h.tick(at(hours(96)))).toStrictEqual({ processedCount: 0, outcomes: {} });
  });

  it('fails after seven days of retries and tells staff to refund by hand', async () => {
    const h = harness({ steps: Array.from({ length: 40 }, () => ({ outcome: 'error' as const, error: refundFailure('transient', 'Stripe is unavailable') })) });
    await h.queue();

    const attemptTimes: string[] = [];
    for (let tick = 0; tick < 40 && h.job().status === 'pending'; tick += 1) {
      const due = h.job().nextAttemptAt ?? createdAt;
      attemptTimes.push(due);
      await h.tick(due);
    }

    expect(h.job()).toMatchObject({ status: 'failed', attempts: 19, nextAttemptAt: null });
    expect(attemptTimes.slice(0, 7)).toStrictEqual([
      createdAt, at(minutes(1)), at(minutes(6)), at(minutes(36)), at(minutes(156)), at(minutes(516)), at(minutes(516) + hours(12)),
    ]);
    expect(Date.parse(attemptTimes.at(-1) ?? createdAt) - Date.parse(createdAt)).toBeLessThanOrEqual(hours(24 * 7));
    expect(h.refundCalls).toHaveLength(19);
    expect(new Set(h.keys()).size).toBe(19);
    expect(h.alertKinds()).toStrictEqual(['retrying', 'failed']);
  });

  it('fails at once on a refund Stripe rejects for good', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('refund_failed', 'Refund amount is greater than the unrefunded amount') }] });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'failed', nextAttemptAt: null });
    expect(h.alertKinds()).toStrictEqual(['failed']);
  });

  it('re-reads a refund at 24 hours and 7 days and stops checking once both confirm it', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'pending' }], reads: [ok(providerRefund('succeeded')), ok(providerRefund('succeeded'))] });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'submitted', providerRefundStatus: 'pending', nextAttemptAt: at(hours(24)) });
    expect(await h.tick(at(hours(23)))).toStrictEqual({ processedCount: 0, outcomes: {} });
    await h.tick(at(hours(24)));
    expect(h.job()).toMatchObject({ status: 'succeeded', statusChecks: 1, nextAttemptAt: at(hours(24 * 7)) });
    await h.tick(at(hours(24 * 7)));
    expect(h.job()).toMatchObject({ status: 'succeeded', statusChecks: 2, nextAttemptAt: null });

    expect(h.readCalls).toStrictEqual(['re_1', 're_1']);
    expect(h.refundCalls).toHaveLength(1);
    expect(h.alerts).toStrictEqual([]);
  });

  it('marks a refund that failed after it was issued as failed at the 24-hour re-read and alerts staff', async () => {
    const h = harness({ reads: [ok(providerRefund('failed'))] });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job().status).toBe('succeeded');
    await h.tick(at(hours(24)));

    expect(h.job()).toMatchObject({ status: 'failed', providerRefundStatus: 'failed', lastError: 'expired_or_canceled_card', nextAttemptAt: null });
    expect(h.alertKinds()).toStrictEqual(['failed_after_submission']);
    await h.tick(at(hours(24 * 7)));
    expect(h.readCalls).toHaveLength(1);
    expect(h.refundCalls).toHaveLength(1);
  });

  it.each(['pending', 'requires_action'] as const)('marks a refund still %s at the 7-day re-read as unconfirmed and alerts staff once', async (status) => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'pending' }], reads: [ok(providerRefund(status)), ok(providerRefund(status))] });
    await h.queue();

    await h.tick(createdAt);
    await h.tick(at(hours(24)));
    expect(h.job()).toMatchObject({ status: 'submitted', statusChecks: 1, nextAttemptAt: at(hours(24 * 7)) });
    expect(h.alerts).toStrictEqual([]);

    expect(await h.tick(at(hours(24 * 7)))).toStrictEqual({ processedCount: 1, outcomes: { unconfirmed: 1 } });
    expect(h.job()).toMatchObject({
      status: 'unconfirmed', providerRefundStatus: status, statusChecks: 2, nextAttemptAt: null, lockedAt: null,
      lastError: `Refund still ${status} at the last scheduled status check`,
    });
    expect(h.alertKinds()).toStrictEqual(['unconfirmed']);
    expect(h.alerts[0]).toMatchObject({ to: 'owner@example.com', payload: { error: `Refund still ${status} at the last scheduled status check` } });
    expect(await h.tick(at(hours(24 * 30)))).toStrictEqual({ processedCount: 0, outcomes: {} });
    expect(h.readCalls).toHaveLength(2);
    expect(h.refundCalls).toHaveLength(1);
  });

  it('marks a refund whose status reads fail until 8 days after it was issued as unconfirmed and alerts staff once', async () => {
    const readFailure = refundFailure('permission_missing', 'The provided key does not have the required permissions', 'permission_denied');
    const h = harness({ steps: [{ outcome: 'refund', status: 'pending' }], reads: Array.from({ length: 300 }, () => err(readFailure)) });
    await h.queue();

    await h.tick(createdAt);
    const readTimes: string[] = [];
    for (let tick = 0; tick < 300 && h.job().status === 'submitted'; tick += 1) {
      const due = h.job().nextAttemptAt ?? createdAt;
      readTimes.push(due);
      await h.tick(due);
    }

    expect(h.job()).toMatchObject({ status: 'unconfirmed', providerRefundStatus: 'pending', nextAttemptAt: null, lastError: readFailure.message });
    expect(readTimes.slice(0, 2)).toStrictEqual([at(hours(24)), at(hours(25))]);
    expect(readTimes.at(-2)).toBe(at(hours(24 * 8)));
    expect(readTimes.at(-1)).toBe(at(hours(24 * 8 + 1)));
    expect(h.alertKinds()).toStrictEqual(['unconfirmed']);
    expect(await h.tick(at(hours(24 * 30)))).toStrictEqual({ processedCount: 0, outcomes: {} });
  });

  it('keeps a refund Stripe rejected for good out of its failed state until its staff alert is queued, and queues the alert exactly once', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('refund_failed', 'Refund amount is greater than the unrefunded amount') }] });
    await h.queue();
    h.failAlertWrites(1);

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { deferred: 1 } });
    expect(h.job()).toMatchObject({ status: 'pending', attempts: 1, keyGeneration: 0, nextAttemptAt: at(minutes(1)), lastError: null, lockedAt: null });
    expect(h.alerts).toStrictEqual([]);
    expect(h.errors).toStrictEqual([expect.stringContaining('[order-refund] settlement not saved, retrying tenant=tenant-a order=order-1 job=job-1 phase=refund')]);

    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { failed: 1 } });
    expect(h.job()).toMatchObject({ status: 'failed', attempts: 2, nextAttemptAt: null, lastError: 'Refund amount is greater than the unrefunded amount' });
    expect(h.alerts).toStrictEqual([expect.objectContaining({ id: 'order-refund-alert:job-1:failed:2:0', to: 'owner@example.com' })]);
    expect(await h.tick(at(hours(24 * 30)))).toStrictEqual({ processedCount: 0, outcomes: {} });
    expect(h.keys()).toStrictEqual(['oos-refund-order-1', 'oos-refund-order-1']);
    expect(h.created).toStrictEqual([]);
  });

  it('retries a missing permission whose staff recipients could not be read and alerts staff about it exactly once', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: permissionMissing() }] });
    await h.queue();
    h.failRecipientLookups(1);

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { deferred: 1 } });
    expect(h.job()).toMatchObject({ status: 'pending', permissionBlockedAt: null, nextAttemptAt: at(minutes(1)) });

    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { blocked_permission: 1 } });
    expect(h.job()).toMatchObject({ status: 'blocked_permission', permissionBlockedAt: at(minutes(1)), nextAttemptAt: at(minutes(61)) });
    expect(h.alertKinds()).toStrictEqual(['blocked_permission']);
  });

  it('sends the first retry alert after a failed alert write although the attempt counter moved on', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('transient', 'Stripe is unavailable') }] });
    await h.queue();
    h.failAlertWrites(1);

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { deferred: 1 } });
    expect(await h.tick(at(minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { retrying: 1 } });
    expect(h.job()).toMatchObject({ status: 'pending', attempts: 2, lastError: 'Stripe is unavailable' });
    expect(h.alertKinds()).toStrictEqual(['retrying']);
  });

  it('reads a refund that failed after it was issued again a minute later when its staff alert could not be queued', async () => {
    const h = harness({ reads: [ok(providerRefund('failed')), ok(providerRefund('failed'))] });
    await h.queue();

    await h.tick(createdAt);
    h.failAlertWrites(1);
    expect(await h.tick(at(hours(24)))).toStrictEqual({ processedCount: 1, outcomes: { deferred: 1 } });
    expect(h.job()).toMatchObject({ status: 'succeeded', statusChecks: 0, nextAttemptAt: at(hours(24) + minutes(1)), lockedAt: null });

    expect(await h.tick(at(hours(24) + minutes(1)))).toStrictEqual({ processedCount: 1, outcomes: { failed: 1 } });
    expect(h.job()).toMatchObject({ status: 'failed', providerRefundStatus: 'failed', nextAttemptAt: null });
    expect(h.alertKinds()).toStrictEqual(['failed_after_submission']);
    expect(h.readCalls).toHaveLength(2);
  });

  const slowDispatch = async (options: DispatchOrderRefundJobsOptions) => {
    const h = harness();
    const orders = Array.from({ length: 6 }, (_, index) => cancelledOrder({
      id: `order-${String(index + 1)}`, providerObjectIds: { checkoutSession: `cs_${String(index + 1)}`, paymentIntent: `pi_${String(index + 1)}` },
    }));
    const jobs = createOrderRefundJobFake();
    for (const [index, order] of orders.entries()) {
      await jobs.repository.enqueue('tenant-a', outOfStockRefundJob(order, { id: `job-${String(index + 1)}`, now: createdAt }));
    }
    let now = createdAt;
    const warnings: string[] = [];
    const provider = createRefundProviderFake({ chargeAmountCents: 4099 });
    const slowCreateRefund = provider.payment.createRefund;
    if (slowCreateRefund === undefined) throw new Error('Fake refund method missing');
    const result = await dispatchOrderRefundJobs({
      ...h.deps,
      refundJobs: jobs.repository,
      orderDetails: { findById: async (tenantId: string, orderId: string) => orders.find((order) => order.tenantId === tenantId && order.id === orderId) ?? null },
      payment: {
        ...provider.payment,
        createRefund: async (call) => {
          now = new Date(Date.parse(now) + 12_000).toISOString();
          return slowCreateRefund(call);
        },
      },
      clock: { nowIso: () => now },
      logger: { ...h.deps.logger, warn: (message: string) => { warnings.push(message); } },
    }, options);
    return { result, warnings, claimed: jobs.jobs.filter((job) => job.attempts > 0).map((job) => job.id), untouched: jobs.jobs.filter((job) => job.status === 'pending' && job.attempts === 0).length };
  };

  it('claims a job only while a list and a create call that both run into their worst case still end before the tick deadline', async () => {
    expect(ORDER_REFUND_JOB_WORST_CASE_MS).toBe(21_000);
    const { result, claimed, untouched, warnings } = await slowDispatch({ deadlineAt: Date.parse(createdAt) + 45_000 });

    expect(result).toStrictEqual(ok({ processedCount: 3, outcomes: { refunded: 3 } }));
    expect(claimed).toStrictEqual(['job-1', 'job-2', 'job-3']);
    expect(untouched).toBe(3);
    expect(warnings).toStrictEqual(['[order-refund] run deadline reached, 3 due refund jobs left for the next run']);
  });

  it('claims one job on the cron tick although the deadline leaves time for more, and logs no deadline warning', async () => {
    expect(ORDER_REFUND_CRON_TICK_MAX_JOBS).toBe(1);
    const { result, claimed, untouched, warnings } = await slowDispatch({ deadlineAt: Date.parse(createdAt) + 45_000, maxJobs: ORDER_REFUND_CRON_TICK_MAX_JOBS });

    expect(result).toStrictEqual(ok({ processedCount: 1, outcomes: { refunded: 1 } }));
    expect(claimed).toStrictEqual(['job-1']);
    expect(untouched).toBe(5);
    expect(warnings).toStrictEqual([]);
  });

  it('logs no deadline warning when the deadline stops a run that has no due job left', async () => {
    const h = harness();
    const warnings: string[] = [];
    const result = await dispatchOrderRefundJobs({ ...h.deps, logger: { ...h.deps.logger, warn: (message: string) => { warnings.push(message); } } }, { deadlineAt: Date.parse(createdAt) });

    expect(result).toStrictEqual(ok({ processedCount: 0, outcomes: {} }));
    expect(warnings).toStrictEqual([]);
  });

  it('claims nothing when the tick has less time left than the worst case of one job', async () => {
    const { result, claimed, untouched, warnings } = await slowDispatch({ deadlineAt: Date.parse(createdAt) + ORDER_REFUND_JOB_WORST_CASE_MS - 1 });

    expect(result).toStrictEqual(ok({ processedCount: 0, outcomes: {} }));
    expect(claimed).toStrictEqual([]);
    expect(untouched).toBe(6);
    expect(warnings).toStrictEqual(['[order-refund] run deadline reached, 6 due refund jobs left for the next run']);
  });

  it('gives a run without a tick deadline, such as the kick after a webhook, 30 seconds', async () => {
    const { result, claimed } = await slowDispatch({});

    expect(ORDER_REFUND_DISPATCH_BUDGET_MS).toBe(30_000);
    expect(result).toStrictEqual(ok({ processedCount: 1, outcomes: { refunded: 1 } }));
    expect(claimed).toStrictEqual(['job-1']);
  });

  it('refunds nothing for an order that is not cancelled', async () => {
    const h = harness({ order: cancelledOrder({ cancelReason: null }) });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'failed' });
    expect(h.refundCalls).toStrictEqual([]);
  });
});
