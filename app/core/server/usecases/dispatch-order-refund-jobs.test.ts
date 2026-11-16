import { describe, expect, it } from 'vitest';

import {
  err,
  ok,
  orderListItemSchema,
  outOfStockRefundJob,
  refundFailure,
  type AppError,
  type EmailOutboxPayload,
  type OrderListItem,
  type ProviderRefund,
  type Result,
} from '#core/domain/index.js';

import type { PaymentProvider } from '../ports.js';
import { createOrderRefundJobFake } from '../testing/order-refund-job-fake.js';
import { createInMemoryTenantDomainRepository } from '../testing/tenant-domain-fakes.js';
import { dispatchOrderRefundJobs } from './dispatch-order-refund-jobs.js';

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

type CreateRefund = NonNullable<PaymentProvider['createRefund']>;
type CreateRefundInput = Parameters<CreateRefund>[0];

const providerRefund = (status: ProviderRefund['status'] = 'succeeded'): ProviderRefund =>
  ({ refundId: 're_1', paymentIntentId: 'pi_1', amountCents: 4099, status, failureReason: status === 'failed' ? 'expired_or_canceled_card' : null });

const harness = (input: {
  order?: OrderListItem;
  refunds?: Array<Result<ProviderRefund, AppError>>;
  reads?: Array<Result<ProviderRefund, AppError>>;
} = {}) => {
  let now = createdAt;
  let nextId = 0;
  const order = input.order ?? cancelledOrder();
  const fake = createOrderRefundJobFake();
  const refundCalls: CreateRefundInput[] = [];
  const readCalls: string[] = [];
  const alerts: Array<{ to: string; payload: EmailOutboxPayload }> = [];
  const refunds = [...(input.refunds ?? [ok(providerRefund())])];
  const reads = [...(input.reads ?? [])];
  const deps = {
    refundJobs: fake.repository,
    orderDetails: { findById: async (tenantId: string, orderId: string) => (tenantId === order.tenantId && orderId === order.id ? order : null) },
    payment: {
      createRefund: async (call: CreateRefundInput) => {
        refundCalls.push(call);
        return refunds.shift() ?? ok(providerRefund());
      },
      getRefund: async (call: { refundId: string }) => {
        readCalls.push(call.refundId);
        return reads.shift() ?? ok(providerRefund());
      },
    },
    tenants: {
      findById: async () => ({ id: 'tenant-a', slug: 'acme', name: 'Acme', status: 'active' as const, plan: 'hosted' as const, contentVersion: 1 }),
      findSettings: async () => null,
    },
    tenantAccess: { listStaffForTenant: async () => [{ userId: 'owner', email: 'owner@example.com', staffRole: 'owner' as const, language: 'en' as const }] },
    tenantDomains: createInMemoryTenantDomainRepository(),
    emailOutbox: {
      enqueue: async (email: { to: string; payload: EmailOutboxPayload }) => {
        alerts.push({ to: email.to, payload: email.payload });
        return ok({ id: `email-${String(alerts.length)}` });
      },
    },
    ids: { nextId: () => `id-${String(++nextId)}` },
    clock: { nowIso: () => now },
    logger: { warn: () => undefined, error: () => undefined },
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
  return { deps, queue, tick, job, refundCalls, readCalls, alerts, alertKinds };
};

describe('order refund dispatcher', () => {
  it('retries a failing refund on the schedule with one idempotency key and makes exactly one successful call', async () => {
    const h = harness({ refunds: [err(refundFailure('transient', 'Stripe is unavailable')), err(refundFailure('insufficient_balance', 'Insufficient balance', 'balance_insufficient')), ok(providerRefund())] });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { retrying: 1 } });
    expect(h.job()).toMatchObject({ status: 'pending', attempts: 1, nextAttemptAt: at(minutes(1)), lastError: 'Stripe is unavailable', lockedAt: null });
    expect(await h.tick(at(minutes(1) - 1))).toStrictEqual({ processedCount: 0, outcomes: {} });

    await h.tick(at(minutes(1)));
    expect(h.job()).toMatchObject({ status: 'pending', attempts: 2, nextAttemptAt: at(minutes(6)), lastError: 'Insufficient balance' });

    await h.tick(at(minutes(6)));
    expect(h.job()).toMatchObject({
      status: 'succeeded', attempts: 3, providerRefundId: 're_1', providerRefundStatus: 'succeeded', submittedAt: at(minutes(6)),
      nextAttemptAt: at(minutes(6) + hours(24)), lastError: null, lockedAt: null,
    });
    expect(await h.tick(at(minutes(7)))).toStrictEqual({ processedCount: 0, outcomes: {} });

    expect(h.refundCalls).toHaveLength(3);
    expect(new Set(h.refundCalls.map((call) => call.idempotencyKey))).toStrictEqual(new Set(['oos-refund-order-1']));
    expect(h.refundCalls[0]).toStrictEqual({
      mode: 'live', tenantId: 'tenant-a', paymentIntentId: 'pi_1', amountCents: 4099, idempotencyKey: 'oos-refund-order-1',
      metadata: { orderId: 'order-1', reason: 'out_of_stock' },
    });
    expect(h.alertKinds()).toStrictEqual(['retrying']);
    expect(h.alerts[0]).toMatchObject({ to: 'owner@example.com', payload: { orderId: 'order-1', orderUrl: 'https://acme.togethercommunity.app/panel/sales/order-1', error: 'Stripe is unavailable' } });
  });

  it('skips an order that staff already refunded by hand without calling the provider', async () => {
    const h = harness({ order: cancelledOrder({ status: 'refunded' }) });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { skipped_refunded: 1 } });
    expect(h.job()).toMatchObject({ status: 'skipped_refunded', nextAttemptAt: null, providerRefundId: null });
    expect(await h.tick(at(hours(48)))).toStrictEqual({ processedCount: 0, outcomes: {} });
    expect(h.refundCalls).toStrictEqual([]);
    expect(h.alerts).toStrictEqual([]);
  });

  it('marks a charge Stripe reports as already refunded as skipped', async () => {
    const h = harness({ refunds: [err(refundFailure('already_refunded', 'Charge has already been refunded', 'charge_already_refunded'))] });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'skipped_refunded', nextAttemptAt: null });
    expect(h.alerts).toStrictEqual([]);
  });

  it('blocks a refund the restricted key may not create, alerts staff once and stops calling', async () => {
    const h = harness({ refunds: [err(refundFailure('permission_missing', 'The provided key does not have the required permissions', 'permission_denied'))] });
    await h.queue();

    expect(await h.tick(createdAt)).toStrictEqual({ processedCount: 1, outcomes: { blocked_permission: 1 } });
    expect(h.job()).toMatchObject({ status: 'blocked_permission', attempts: 1, nextAttemptAt: null, lastError: 'The provided key does not have the required permissions' });
    for (const offset of [minutes(1), hours(1), hours(24), hours(24 * 8)]) await h.tick(at(offset));

    expect(h.refundCalls).toHaveLength(1);
    expect(h.alertKinds()).toStrictEqual(['blocked_permission']);
  });

  it('fails after seven days of retries and tells staff to refund by hand', async () => {
    const h = harness({ refunds: Array.from({ length: 40 }, () => err(refundFailure('transient', 'Stripe is unavailable'))) });
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
    expect(h.alertKinds()).toStrictEqual(['retrying', 'failed']);
  });

  it('fails at once on a refund Stripe rejects for good', async () => {
    const h = harness({ refunds: [err(refundFailure('refund_failed', 'Refund amount is greater than the unrefunded amount'))] });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'failed', nextAttemptAt: null });
    expect(h.alertKinds()).toStrictEqual(['failed']);
  });

  it('re-reads a refund at 24 hours and 7 days and stops checking once both confirm it', async () => {
    const h = harness({ refunds: [ok(providerRefund('pending'))], reads: [ok(providerRefund('succeeded')), ok(providerRefund('succeeded'))] });
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

  it('refunds nothing for an order that is not cancelled', async () => {
    const h = harness({ order: cancelledOrder({ cancelReason: null }) });
    await h.queue();

    await h.tick(createdAt);
    expect(h.job()).toMatchObject({ status: 'failed' });
    expect(h.refundCalls).toStrictEqual([]);
  });
});
