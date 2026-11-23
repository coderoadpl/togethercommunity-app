import { and, asc, eq, like, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ok, orderRefundIssuedEmail, outOfStockRefundJob, refundFailure, staffRefundAlertEmail, type Identity, type OrderShipping, type ProviderRefund } from '#core/domain/index.js';
import {
  createStaffRefund,
  dispatchOrderRefundJobs,
  exportOrders,
  getOrder,
  listOrders,
  previewStaffRefund,
  shipRefundedOrderAnyway,
  type Ctx,
} from '#core/server/index.js';
import { createRefundProviderFake, type RefundProviderStep } from '#core/server/testing/refund-provider-fake.js';
import { createInMemoryTenantDomainRepository } from '#core/server/testing/tenant-domain-fakes.js';

import { createOrderStaffRefundRepository } from './order-staff-refunds.js';
import { deadlockDetected, uniqueViolation } from './pg-errors.js';
import { createRefundJobQueue } from './refund-job-queue.js';
import { createMemberRepository, createOrderRepository } from './repositories.js';
import {
  emailEvents,
  emailOutbox,
  members,
  orderChanges,
  orderRefundJobs,
  orders,
  orderShipments,
  orderStaffRefunds,
  products,
  productStock,
  stockEvents,
  tenants,
  user,
} from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const start = '2026-11-22T10:00:00.000Z';
const minutes = (count: number) => new Date(Date.parse(start) + count * 60_000).toISOString();
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const shipping: OrderShipping = {
  rateId: 'courier', label: 'Courier', amountCents: 1999, vatRatePercent: 8, carrier: 'other', pickupPoint: null,
  address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' }, phone: null,
};

const staff = (tenantId: string, overrides: Partial<Identity> = {}): Ctx => ({
  identity: {
    userId: `staff-${tenantId}`, email: `owner@${tenantId}.example.com`, name: 'Owner', emailVerified: true, tenantAccess: 'staff',
    tenantId, tenantSlug: tenantId, tenantName: tenantId, staffRole: 'owner', memberId: null, image: null, memberDisplayName: null,
    memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false, ...overrides,
  },
});

const insertOrder = (id: string, over: Partial<typeof orders.$inferInsert> = {}) => database.db.insert(orders).values({
  id, tenantId: 'tenant-a', memberId: 'member-a', productId: 'book', kind: 'one_time', status: 'paid', amountCents: 4099,
  currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: `cs_${id}`, paymentIntent: `pi_${id}` }, createdAt: start, ...over,
});

const handRefund = (amountCents: number): ProviderRefund => ({
  refundId: 're_hand', paymentIntentId: 'pi_order-1', amountCents, status: 'succeeded', failureReason: null, orderId: null, reason: null,
});

const harness = (input: { steps?: RefundProviderStep[] } = {}) => {
  let now = start;
  let sequence = 0;
  const logs: string[] = [];
  const provider = createRefundProviderFake({ chargeAmountCents: 4099, ...(input.steps === undefined ? {} : { steps: input.steps }) });
  let listsHidden = false;
  let crashAfterCreate = false;
  const payment = {
    ...provider.payment,
    createRefund: async (call: Parameters<NonNullable<typeof provider.payment.createRefund>>[0]) => {
      const created = await provider.payment.createRefund?.(call);
      if (created === undefined || crashAfterCreate) throw new Error('Worker lost after the provider answered');
      return created;
    },
    listRefunds: async (call: Parameters<NonNullable<typeof provider.payment.listRefunds>>[0]) =>
      (listsHidden ? ok([]) : provider.payment.listRefunds?.(call) ?? ok([])),
  };
  const staffRefunds = createOrderStaffRefundRepository(database.db);
  const orderDetails = createOrderRepository(database.db);
  const logger = { warn: (message: string) => { logs.push(message); }, error: (message: string) => { logs.push(message); } };
  const deps = {
    orderDetails,
    staffRefunds,
    payment,
    ids: { nextId: () => { sequence += 1; return `refund-${String(sequence)}`; } },
    clock: { nowIso: () => now },
    logger,
  };
  const dispatchDeps = {
    refundJobs: createRefundJobQueue(database.db),
    orderDetails,
    members: createMemberRepository(database.db),
    payment,
    tenants: {
      findById: async (tenantId: string) => ({ id: tenantId, slug: 'acme', name: 'Acme', status: 'active' as const, plan: 'hosted' as const, contentVersion: 1 }),
      findSettings: async () => null,
    },
    tenantAccess: { listStaffForTenant: async () => [{ userId: 'owner', email: 'owner@acme.example.com', staffRole: 'owner' as const, language: 'en' as const }] },
    tenantDomains: createInMemoryTenantDomainRepository(),
    clock: { nowIso: () => now },
    logger,
    dispatchEmail: () => undefined,
    appBaseUrl: 'https://togethercommunity.app',
    baseDomain: 'togethercommunity.app',
    singleTenantMode: false,
  };
  const refund = (orderId: string, body: Record<string, unknown>, ctx: Ctx = staff('tenant-a')) => createStaffRefund(ctx, orderId, body, deps);
  const dispatch = async (at: string, overrides: Partial<Parameters<typeof dispatchOrderRefundJobs>[0]> = {}) => {
    now = at;
    const result = await dispatchOrderRefundJobs({ ...dispatchDeps, ...overrides });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const providerTotal = () => provider.created
    .filter((created) => created.status !== 'failed' && created.status !== 'canceled')
    .reduce((sum, created) => sum + created.amountCents, 0);
  const hideLists = (hidden: boolean) => { listsHidden = hidden; };
  const crashAfterEachCreate = (crash: boolean) => { crashAfterCreate = crash; };
  return { deps, dispatchDeps, provider, refund, dispatch, providerTotal, logs, hideLists, crashAfterEachCreate };
};

const refundRows = async (orderId: string) => (await createOrderStaffRefundRepository(database.db).listByOrder('tenant-a', orderId)).toReversed();

const buyerEmails = () => database.db.select({ id: emailOutbox.id, to: emailOutbox.to, payload: emailOutbox.payload }).from(emailOutbox)
  .where(like(emailOutbox.id, 'order-refund-issued:%')).orderBy(asc(emailOutbox.id));

const noticeMessage = (amountCents: number) => orderRefundIssuedEmail('pl', {
  tenantName: 'Acme', orderId: 'order-1', amountCents, currency: 'PLN', shopUrl: 'https://acme.togethercommunity.app/',
});

const noticeSubject = (amountCents: number): string => noticeMessage(amountCents).subject;

const textOf = (payload: unknown): string =>
  (typeof payload === 'object' && payload !== null && 'text' in payload && typeof payload.text === 'string' ? payload.text : '');

const alertPayloads = async () => (await database.db.select({ id: emailOutbox.id, kind: emailOutbox.kind, sourceApp: emailOutbox.sourceApp, payload: emailOutbox.payload })
  .from(emailOutbox).where(like(emailOutbox.id, 'order-refund-alert:%')).orderBy(asc(emailOutbox.id)))
  .map((row) => ({ alert: row.id.split(':')[2], kind: row.kind, sourceApp: row.sourceApp, text: textOf(row.payload) }));

const fulfilmentOf = async (orderId: string) =>
  (await database.db.select({ fulfilmentStatus: orders.fulfilmentStatus }).from(orders).where(eq(orders.id, orderId)))[0]?.fulfilmentStatus;

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

beforeAll(async () => {
  database = await createTestDatabase('together_staff_refunds_it', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: 'tenant-a', slug: 'tenant-a', name: 'Workspace A', createdAt: start },
    { id: 'tenant-b', slug: 'tenant-b', name: 'Workspace B', createdAt: start },
  ]);
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values([
    { id: 'member-a', tenantId: 'tenant-a', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', language: 'pl', createdAt: start },
    { id: 'member-b', tenantId: 'tenant-b', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: start },
  ]);
  await database.db.insert(products).values(['tenant-a', 'tenant-b'].map((tenantId) => ({
    id: 'book', tenantId, type: 'physical' as const, description: '', slug: 'book', title: 'Book', priceCents: 4099, currency: 'PLN', published: true, createdAt: start,
  })));
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
  await database.db.delete(emailEvents);
  await database.db.delete(emailOutbox);
  await database.db.delete(orderStaffRefunds);
  await database.db.delete(orderRefundJobs);
  await database.db.delete(stockEvents);
  await database.db.delete(productStock);
  await database.db.delete(orderChanges);
  await database.db.delete(orderShipments);
  await database.db.delete(orders);
  await insertOrder('order-1', { shipping, fulfilmentStatus: 'to_pack' });
});

describe('staff refunds against a real database', () => {
  it('answers a double submit with the same request key with one refund', async () => {
    const h = harness();
    const [first, second] = await Promise.all([h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }), h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 })]);

    expect([unwrap(first).created, unwrap(second).created].toSorted()).toStrictEqual([false, true]);
    expect(unwrap(first).refund.id).toBe(unwrap(second).refund.id);
    expect(await refundRows('order-1')).toHaveLength(1);
    expect(h.logs.filter((line) => line.startsWith('[order-refund] staff refund requested'))).toStrictEqual([
      `[order-refund] staff refund requested tenant=tenant-a order=order-1 refund=${unwrap(first).refund.id} actor=staff-tenant-a amount=4099 currency=PLN kind=remainder`,
    ]);
  });

  it('replays a stored full refund by its request key without the remainder it was confirmed for', async () => {
    const h = harness();
    const first = unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    await h.dispatch(minutes(1));

    expect(unwrap(await h.refund('order-1', { requestKey: 'req-1' }))).toMatchObject({ created: false, refund: { id: first.refund.id } });
    expect(await h.refund('order-1', { requestKey: 'req-2' })).toMatchObject({ ok: false });
    expect(h.provider.calls).toHaveLength(1);
  });

  it('lets one of two refunds requested at once with different keys win and refuses the other', async () => {
    const h = harness();
    const results = await Promise.all([h.refund('order-1', { requestKey: 'req-a', expectedAmountCents: 4099 }), h.refund('order-1', { requestKey: 'req-b', amountCents: 1000 })]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.flatMap((result) => (result.ok ? [] : [result.error.code]))).toStrictEqual(['conflict']);
    expect(await refundRows('order-1')).toHaveLength(1);
  });

  it('names the waiting refund, not the request key, when another refund reopens while the request is being saved', async () => {
    const h = harness();
    const holder = new pg.Client({ connectionString: database.url });
    const observer = new pg.Client({ connectionString: database.url });
    await holder.connect();
    await observer.connect();
    try {
      await holder.query(
        `INSERT INTO order_staff_refunds (id, tenant_id, order_id, payment_intent_id, amount_cents, currency, kind, request_key, idempotency_key, status,
          requested_by_user_id, requested_by_email, created_at, updated_at)
         VALUES ('reopened', 'tenant-a', 'order-1', 'pi_order-1', 1000, 'PLN', 'remainder', 'req-reopened', 'staff-refund-reopened', 'submitted', 'staff', 'staff@example.com', $1, $1)`,
        [start],
      );
      // The order feed trigger locks the order row, which would make the request wait for the reopen before it reads the waiting refunds.
      await holder.query('ALTER TABLE order_staff_refunds DISABLE TRIGGER order_staff_refunds_record_status');
      await holder.query('BEGIN');
      await holder.query("UPDATE order_staff_refunds SET status = 'pending' WHERE id = 'reopened'");
      const requested = h.refund('order-1', { requestKey: 'req-1', amountCents: 500 });
      for (;;) {
        const waiting = await observer.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
        if ((waiting.rows[0]?.count ?? 0) >= 1) break;
      }
      await holder.query('COMMIT');

      expect(await requested).toMatchObject({ ok: false, error: { code: 'conflict', message: expect.stringContaining('Another refund of this order is still waiting') } });
    } finally {
      await holder.query('ALTER TABLE order_staff_refunds ENABLE TRIGGER order_staff_refunds_record_status');
      await holder.end();
      await observer.end();
    }
  });

  it('lets a status check reopen a staff refund while a refund request of the same order is being saved without a deadlock', async () => {
    const h = harness();
    await insertOrder('order-2');
    await database.db.insert(orderStaffRefunds).values({
      id: 'reopened', tenantId: 'tenant-a', orderId: 'order-1', paymentIntentId: 'pi_order-1', amountCents: 1000, currency: 'PLN', kind: 'remainder',
      requestKey: 'req-reopened', idempotencyKey: 'staff-refund-reopened', status: 'submitted', requestedByUserId: 'staff', requestedByEmail: 'staff@example.com',
      submittedAt: start, lockedAt: minutes(1), createdAt: start, updatedAt: start,
    });
    const holder = new pg.Client({ connectionString: database.url });
    const observer = new pg.Client({ connectionString: database.url });
    await holder.connect();
    await observer.connect();
    const lockWaiters = async (count: number) => {
      for (;;) {
        const waiting = await observer.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
        if ((waiting.rows[0]?.count ?? 0) >= count) return;
      }
    };
    try {
      await holder.query('BEGIN');
      await holder.query(
        `INSERT INTO order_staff_refunds (id, tenant_id, order_id, payment_intent_id, amount_cents, currency, kind, request_key, idempotency_key, status,
          requested_by_user_id, requested_by_email, created_at, updated_at)
         VALUES ('held', 'tenant-a', 'order-2', 'pi_order-2', 1000, 'PLN', 'remainder', 'req-1', 'staff-refund-held', 'failed', 'staff', 'staff@example.com', $1, $1)`,
        [start],
      );
      const requested = h.refund('order-1', { requestKey: 'req-1', amountCents: 500 });
      await lockWaiters(1);
      const reopened = createRefundJobQueue(database.db)
        .release('tenant-a', 'reopened', { status: 'submitted', lockedAt: minutes(1), source: 'staff' }, { status: 'pending', nextAttemptAt: minutes(2), now: minutes(2) })
        .then((row) => ({ row }), (error: unknown) => ({ error }));
      await lockWaiters(2);
      await holder.query('ROLLBACK');

      const [request, reopen] = await Promise.all([requested, reopened]);
      expect(request).toMatchObject({ ok: true, value: { created: true, refund: { status: 'pending', amountCents: 500 } } });
      expect('error' in reopen && deadlockDetected(reopen.error)).toBe(false);
      expect('error' in reopen && uniqueViolation(reopen.error, 'order_staff_refunds_tenant_order_waiting_uidx')).toBe(true);
      expect(Object.fromEntries((await refundRows('order-1')).map((row) => [row.id, row.status]))).toStrictEqual({ reopened: 'submitted', [unwrap(request).refund.id]: 'pending' });
    } finally {
      await holder.end();
      await observer.end();
    }
  });

  it('returns the committed refund for a retried request after it settled and refuses the key for another amount', async () => {
    const h = harness();
    const first = unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    await database.db.update(orders).set({ status: 'partially_refunded' }).where(eq(orders.id, 'order-1'));

    expect(unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }))).toMatchObject({
      created: false, refund: { id: first.refund.id, status: 'succeeded', amountCents: 1000 },
    });
    expect(await h.refund('order-1', { requestKey: 'req-1', amountCents: 999 })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.provider.calls).toHaveLength(1);
  });

  it('never refunds twice when the provider response was lost, and tells the buyer once', async () => {
    const h = harness({ steps: [{ outcome: 'no_response', createsRefund: true }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));

    expect(await h.dispatch(minutes(0))).toMatchObject({ outcomes: { retrying: 1 } });
    expect(await refundRows('order-1')).toMatchObject([{ status: 'pending', keyGeneration: 0, providerRefundId: null }]);
    expect(await buyerEmails()).toStrictEqual([]);

    expect(await h.dispatch(minutes(1))).toMatchObject({ outcomes: { submitted: 1 } });
    expect(h.provider.calls.map((call) => call.idempotencyKey)).toStrictEqual(['staff-refund-refund-1']);
    expect(h.provider.calls[0]?.metadata).toStrictEqual({ orderId: 'order-1', reason: 'staff', refundJobId: 'refund-1' });
    expect(h.providerTotal()).toBe(4099);

    h.provider.setRefundStatus('re_1', 'succeeded');
    await h.dispatch(minutes(60 * 24 + 1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'succeeded', providerRefundId: 're_1' }]);
    expect(await buyerEmails()).toStrictEqual([{
      id: 'order-refund-issued:refund-1', to: 'buyer@example.org', payload: { kind: 'm2m-transactional', ...noticeMessage(4099) },
    }]);
    expect(await database.db.select({ kind: emailOutbox.kind, sourceApp: emailOutbox.sourceApp, tenantTransportRequired: emailOutbox.tenantTransportRequired })
      .from(emailOutbox).where(eq(emailOutbox.id, 'order-refund-issued:refund-1')))
      .toStrictEqual([{ kind: 'm2m-transactional', sourceApp: 'staff-refunds', tenantTransportRequired: false }]);
  });

  it('keeps the request key after a provider server error, so the refund the error hid is taken over and never made twice', async () => {
    const serverError = refundFailure('transient', 'Stripe rejected the refund: Something went wrong', null, false, true);
    const h = harness({ steps: [{ outcome: 'error', error: serverError, createsRefund: true }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    h.hideLists(true);

    await h.dispatch(minutes(1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'pending', keyGeneration: 0, createOutcomeUnknown: true }]);
    await h.dispatch(minutes(2));
    h.hideLists(false);
    await h.dispatch(minutes(30));

    expect(h.provider.calls.map((call) => call.idempotencyKey)).toStrictEqual(['staff-refund-refund-1', 'staff-refund-refund-1']);
    expect(h.providerTotal()).toBe(1000);
    expect(await refundRows('order-1')).toMatchObject([{ status: 'submitted', providerRefundId: 're_1', keyGeneration: 0, createOutcomeUnknown: false }]);
  });

  it('ends a staff refund whose create outcome was unknown as unconfirmed, still counted, when its refunds cannot be read until the retries end', async () => {
    const h = harness({ steps: [{ outcome: 'no_response', createsRefund: true }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    h.provider.failLists(...Array.from({ length: 60 }, () => refundFailure('transient', 'Stripe could not list the refunds: Request aborted due to timeout')));

    for (let at = 2; at <= 60 * 24 * 8; at += 6 * 60) await h.dispatch(minutes(at));

    expect(await refundRows('order-1')).toMatchObject([{ status: 'unconfirmed', createOutcomeUnknown: true, nextAttemptAt: null }]);
    expect((await alertPayloads()).map((alert) => alert.alert)).toStrictEqual(['retrying', 'unconfirmed']);
    expect(await h.deps.staffRefunds.platformCommittedCents('tenant-a', 'order-1')).toBe(1000);
    expect(h.provider.created).toHaveLength(1);
  });

  it('ends a staff refund the provider accepted before its worker was lost as unconfirmed, still counted, when its refunds cannot be read until the retries end', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    h.crashAfterEachCreate(true);
    await expect(h.dispatch(minutes(1))).rejects.toThrow('Worker lost after the provider answered');
    h.crashAfterEachCreate(false);
    expect(await refundRows('order-1')).toMatchObject([{ status: 'running', createOutcomeUnknown: true, keyGeneration: 0 }]);
    h.provider.failLists(...Array.from({ length: 60 }, () => refundFailure('transient', 'Stripe could not list the refunds: Request aborted due to timeout')));

    for (let at = 12; at <= 60 * 24 * 8; at += 6 * 60) await h.dispatch(minutes(at));

    expect(await refundRows('order-1')).toMatchObject([{ status: 'unconfirmed', createOutcomeUnknown: true, nextAttemptAt: null }]);
    expect(await h.deps.staffRefunds.platformCommittedCents('tenant-a', 'order-1')).toBe(1000);
    expect(h.provider.created).toHaveLength(1);
    expect(h.provider.calls).toHaveLength(1);
  });

  it('sends no refund request when another worker took the staff refund over before its attempt was recorded', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));

    expect(await h.dispatch(minutes(1), { refundJobs: { ...h.dispatchDeps.refundJobs, markCreateAttempt: async () => false } })).toMatchObject({ outcomes: { lease_lost: 1 } });
    expect(h.provider.calls).toStrictEqual([]);
    expect(h.logs).toContain('[order-refund] lease lost before the refund request tenant=tenant-a order=order-1 job=refund-1');
  });

  it('takes the refund a lost worker made over with the key it recorded once the refunds can be read again', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    h.crashAfterEachCreate(true);
    await expect(h.dispatch(minutes(1))).rejects.toThrow('Worker lost after the provider answered');
    h.crashAfterEachCreate(false);
    h.hideLists(true);

    await h.dispatch(minutes(12));
    h.hideLists(false);

    expect(h.provider.calls.map((call) => call.idempotencyKey)).toStrictEqual(['staff-refund-refund-1', 'staff-refund-refund-1']);
    expect(h.provider.created).toHaveLength(1);
    expect(await refundRows('order-1')).toMatchObject([{ status: 'succeeded', providerRefundId: 're_1', createOutcomeUnknown: false }]);
  });

  it.each([
    ['not_found', refundFailure('not_found', "Stripe could not list the refunds: No such payment_intent: 'pi_order-1'", 'resource_missing')],
    ['refund_failed', refundFailure('refund_failed', 'Stripe could not list the refunds: Invalid request')],
    ['permission_missing', refundFailure('permission_missing', 'Stripe could not list the refunds: The provided key does not have the required permissions', 'permission_denied')],
  ] as const)('never reads a %s refund list answer after an unknown create outcome as a refusal, and takes the refund over once the list is readable', async (_kind, listFailure) => {
    const h = harness({ steps: [{ outcome: 'no_response', createsRefund: true }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    h.provider.failLists(listFailure);

    await h.dispatch(minutes(2));
    const [afterRead] = await refundRows('order-1');
    expect(afterRead).toMatchObject({ status: 'pending', createOutcomeUnknown: true, keyGeneration: 0 });
    expect(afterRead?.lastError).not.toContain('refused');
    await h.dispatch(minutes(30));

    expect(await refundRows('order-1')).toMatchObject([{ status: 'submitted', providerRefundId: 're_1', createOutcomeUnknown: false }]);
    expect(h.provider.created).toHaveLength(1);
    expect(h.providerTotal()).toBe(1000);
  });

  it('tells the buyer only once the provider holds the refund as pending or succeeded, not while it requires action', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'requires_action' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));

    await h.dispatch(minutes(1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'submitted', providerRefundStatus: 'requires_action', buyerNotifiedAt: null }]);
    expect(await buyerEmails()).toStrictEqual([]);

    h.provider.setRefundStatus('re_1', 'pending');
    await h.dispatch(minutes(60 * 24 + 1));
    expect(await buyerEmails()).toMatchObject([{ id: 'order-refund-issued:refund-1', payload: { subject: noticeSubject(1000) } }]);
  });

  it('tells the buyer once when the last scheduled check first sees the refund pending, and still ends it unconfirmed for staff', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'requires_action' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    await h.dispatch(minutes(60 * 24 + 1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'submitted', providerRefundStatus: 'requires_action', buyerNotifiedAt: null }]);

    h.provider.setRefundStatus('re_1', 'pending');
    await h.dispatch(minutes(60 * 24 * 7 + 1));

    expect(await refundRows('order-1')).toMatchObject([{ status: 'unconfirmed', providerRefundStatus: 'pending', buyerNotifiedAt: minutes(60 * 24 * 7 + 1) }]);
    expect(await buyerEmails()).toMatchObject([{ id: 'order-refund-issued:refund-1', payload: { subject: noticeSubject(1000) } }]);
    expect(await alertPayloads()).toHaveLength(1);
  });

  it('lets staff refund an order marked refunded again once the provider shows its full refund failed, and tells them access stays ended', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'pending' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    await h.dispatch(minutes(1));
    await database.db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, 'order-1'));
    h.provider.failRefund('re_1', 'expired_or_canceled_card');
    await h.dispatch(minutes(60 * 24 + 1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'failed' }]);
    expect(await alertPayloads()).toStrictEqual([expect.objectContaining({
      alert: 'failed_after_submission', text: expect.stringContaining('that access is not given back automatically: grant it again on the member page'),
    })]);

    h.provider.failLists(refundFailure('transient', 'Stripe could not list the refunds: Request aborted due to timeout'));
    expect(unwrap(await previewStaffRefund(staff('tenant-a'), 'order-1', h.deps))).toMatchObject({ refundable: false, remainderCents: 0, remainderSource: 'platform' });
    expect(unwrap(await previewStaffRefund(staff('tenant-a'), 'order-1', h.deps))).toMatchObject({ refundable: true, remainderCents: 4099, remainderSource: 'provider' });
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-2', expectedAmountCents: 4099 })).refund).toMatchObject({ kind: 'remainder', amountCents: 4099 });
    await h.dispatch(minutes(60 * 24 + 2));
    expect(h.provider.created.map((created) => [created.amountCents, created.status])).toStrictEqual([[4099, 'failed'], [4099, 'succeeded']]);
  });

  it('keeps an order marked refunded without any failed provider refund, such as one a dispute marked, unrefundable', async () => {
    await database.db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, 'order-1'));
    const h = harness();

    expect(unwrap(await previewStaffRefund(staff('tenant-a'), 'order-1', h.deps))).toMatchObject({ refundable: false, remainderCents: 0, remainderSource: 'provider' });
    expect(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await refundRows('order-1')).toStrictEqual([]);
  });

  it('refunds a test-mode order in test mode without a buyer e-mail', async () => {
    await database.db.update(orders).set({ mode: 'test' }).where(eq(orders.id, 'order-1'));
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));

    expect(await h.dispatch(minutes(1))).toMatchObject({ outcomes: { refunded: 1 } });
    expect(h.provider.calls).toHaveLength(1);
    expect(await refundRows('order-1')).toMatchObject([{ status: 'succeeded', buyerNotifiedAt: null }]);
    expect(await buyerEmails()).toStrictEqual([]);
  });

  it('issues partial, partial and then the full remainder, and refuses anything above what is left', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    unwrap(await h.refund('order-1', { requestKey: 'req-2', amountCents: 500 }));
    await h.dispatch(minutes(2));
    expect(await h.refund('order-1', { requestKey: 'req-3', amountCents: 2600 })).toMatchObject({
      ok: false, error: { code: 'validation', message: 'Refund amount is above the refundable remainder of 25.99 PLN' },
    });
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-4', expectedAmountCents: 2599 })).refund).toMatchObject({ kind: 'remainder', amountCents: 2599 });
    await h.dispatch(minutes(3));

    expect(h.provider.calls.map((call) => call.amountCents)).toStrictEqual([1000, 500, 2599]);
    expect(h.providerTotal()).toBe(4099);
    expect(await h.refund('order-1', { requestKey: 'req-5', amountCents: 1 })).toMatchObject({ ok: false, error: { code: 'conflict', message: 'Nothing is left to refund on this order' } });
    expect((await buyerEmails()).map((email) => email.id)).toStrictEqual(['order-refund-issued:refund-1', 'order-refund-issued:refund-2', 'order-refund-issued:refund-4']);
    const detail = unwrap(await getOrder(staff('tenant-a'), 'order-1', { orders: createOrderRepository(database.db), staffRefunds: h.deps.staffRefunds }));
    expect(detail.refundTotals).toStrictEqual({ paidCents: 4099, refundedCents: 4099, remainingCents: 0, currency: 'PLN' });
    expect(detail.staffRefunds?.map((refund) => [refund.amountCents, refund.status])).toStrictEqual([[2599, 'succeeded'], [500, 'succeeded'], [1000, 'succeeded']]);
  });

  it('refuses a full refund once a dashboard refund left less on the charge than its amount, with a staff alert naming its amount and no buyer e-mail', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    h.provider.refundByHand(handRefund(1000));
    await h.dispatch(minutes(1));

    expect(h.provider.calls.map((call) => call.amountCents)).toStrictEqual([4099]);
    expect(h.provider.created).toStrictEqual([]);
    expect(await refundRows('order-1')).toMatchObject([{
      status: 'failed', amountCents: 4099, lastError: 'The payment provider refused the refund, so nothing was refunded: Refund amount is greater than the unrefunded amount on the charge',
    }]);
    expect(await buyerEmails()).toStrictEqual([]);
    const [refusedFull] = await alertPayloads();
    expect(refusedFull).toMatchObject({ alert: 'failed', kind: 'm2m-transactional', sourceApp: 'staff-refunds' });
    expect(refusedFull?.text).toContain('A staff member asked to refund PLN\u00a040.99 of order order-1.\nThe refund failed and is no longer retried. Nothing was refunded by this request.');
    expect(refusedFull?.text).toContain('The goods returned to stock and the order taken off the packing list with this refund stay that way.');
    expect(refusedFull?.text).toContain('Last error: The payment provider refused the refund, so nothing was refunded: Refund amount is greater than the unrefunded amount on the charge');
    const detail = unwrap(await getOrder(staff('tenant-a'), 'order-1', { orders: createOrderRepository(database.db), staffRefunds: h.deps.staffRefunds }));
    expect(detail.staffRefunds?.map((refund) => [refund.kind, refund.amountCents, refund.status])).toStrictEqual([['remainder', 4099, 'failed']]);
    expect(detail.refundTotals).toMatchObject({ refundedCents: 0, remainingCents: 4099 });
  });

  it('lets the provider refuse a partial refund above what a dashboard refund left on the charge, with a staff alert and no buyer e-mail', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 3000 }));
    h.provider.refundByHand(handRefund(2000));
    await h.dispatch(minutes(1));

    expect(await refundRows('order-1')).toMatchObject([{ status: 'failed', lastError: 'The payment provider refused the refund, so nothing was refunded: Refund amount is greater than the unrefunded amount on the charge' }]);
    expect(h.provider.created).toStrictEqual([]);
    expect(await buyerEmails()).toStrictEqual([]);
    const [refusedPartial] = await alertPayloads();
    expect(refusedPartial).toMatchObject({ alert: 'failed', text: expect.stringContaining('A staff member asked to refund PLN\u00a030.00 of order order-1.') });
    expect(refusedPartial?.text).not.toContain('stock');
  });

  it('skips a partial refund of a charge the dashboard already refunded in full, without telling the buyer', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    h.provider.refundByHand(handRefund(4099));
    await h.dispatch(minutes(1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'submitted', providerRefundId: null }]);

    await h.dispatch(minutes(60 * 24 + 1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'skipped_refunded', nextAttemptAt: null }]);
    expect(h.provider.created).toStrictEqual([]);
    expect(await buyerEmails()).toStrictEqual([]);
  });

  it('keeps watching a partial refund while a pending dashboard refund covers the charge and issues it once that refund fails', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    h.provider.refundByHand({ ...handRefund(4099), status: 'pending' });
    await h.dispatch(minutes(1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'submitted', providerRefundId: null }]);

    await h.dispatch(minutes(60 * 24 + 1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'submitted', nextAttemptAt: minutes(60 * 24 * 7 + 1) }]);

    h.provider.failRefund('re_hand', 'expired_or_canceled_card');
    await h.dispatch(minutes(60 * 24 * 7 + 1));
    await h.dispatch(minutes(60 * 24 * 7 + 2));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([1000]);
    expect(await refundRows('order-1')).toMatchObject([{ status: 'succeeded', amountCents: 1000 }]);
  });

  it('leaves the shortfall of a failed partial staff refund to that refund instead of paying it again with the full refund', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'pending' }, { outcome: 'refund' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    unwrap(await h.refund('order-1', { requestKey: 'req-2', expectedAmountCents: 3099 }));
    await h.dispatch(minutes(2));
    h.provider.failRefund('re_1', 'expired_or_canceled_card');

    await h.dispatch(minutes(60 * 24 + 3));
    await h.dispatch(minutes(60 * 24 + 4));
    await h.dispatch(minutes(60 * 24 * 7 + 3));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([1000, 3099]);
    expect(await refundRows('order-1')).toMatchObject([{ kind: 'amount', status: 'failed' }, { kind: 'remainder', status: 'succeeded' }]);
    expect(await alertPayloads()).toStrictEqual([expect.objectContaining({ alert: 'failed_after_submission', text: expect.stringContaining('refund PLN\u00a010.00 of order') })]);
  });

  it('leaves the shortfall of a partial staff refund requested after the full refund and failing later to that refund', async () => {
    const h = harness({ steps: [{ outcome: 'refund' }, { outcome: 'refund', status: 'pending' }] });
    h.provider.refundByHand(handRefund(1000));
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 3099 })).refund).toMatchObject({ kind: 'remainder', amountCents: 3099 });
    await h.dispatch(minutes(1));
    h.provider.failRefund('re_hand', 'expired_or_canceled_card');
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-2', amountCents: 1000 })).refund).toMatchObject({ kind: 'amount', amountCents: 1000 });
    await h.dispatch(minutes(2));

    await h.dispatch(minutes(60 * 24 + 1));
    await h.dispatch(minutes(60 * 24 + 2));
    h.provider.failRefund('re_2', 'expired_or_canceled_card');
    await h.dispatch(minutes(60 * 24 * 7 + 2));
    await h.dispatch(minutes(60 * 24 * 7 + 3));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([3099, 1000]);
    expect(await refundRows('order-1')).toMatchObject([{ kind: 'remainder', status: 'succeeded' }, { kind: 'amount', status: 'failed' }]);
    expect(await alertPayloads()).toStrictEqual([expect.objectContaining({ alert: 'failed_after_submission', text: expect.stringContaining('refund PLN\u00a010.00 of order') })]);
  });

  it('pays the whole remainder of a full refund requested again after a full staff refund failed', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'failed' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    await h.dispatch(minutes(1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'failed' }]);

    expect(unwrap(await h.refund('order-1', { requestKey: 'req-2', expectedAmountCents: 4099 })).refund).toMatchObject({ kind: 'remainder', amountCents: 4099 });
    await h.dispatch(minutes(2));
    expect(h.provider.created.map((created) => [created.amountCents, created.status])).toStrictEqual([[4099, 'failed'], [4099, 'succeeded']]);
    expect(await refundRows('order-1')).toMatchObject([{ status: 'failed' }, { status: 'succeeded', amountCents: 4099 }]);
    expect((await buyerEmails()).map((email) => email.payload)).toMatchObject([{ subject: noticeSubject(4099) }]);
  });

  it('pays the whole remainder of a full refund requested after a partial staff refund failed', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'failed' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));

    expect(unwrap(await h.refund('order-1', { requestKey: 'req-2', expectedAmountCents: 4099 })).refund).toMatchObject({ kind: 'remainder', amountCents: 4099 });
    await h.dispatch(minutes(2));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([1000, 4099]);
    expect(h.providerTotal()).toBe(4099);
    expect(await refundRows('order-1')).toMatchObject([{ status: 'failed' }, { status: 'succeeded' }]);
    const detail = unwrap(await getOrder(staff('tenant-a'), 'order-1', { orders: createOrderRepository(database.db), staffRefunds: h.deps.staffRefunds }));
    expect(detail.refundTotals).toStrictEqual({ paidCents: 4099, refundedCents: 4099, remainingCents: 0, currency: 'PLN' });
  });

  it('pays the rest of a full refund requested after a failed partial staff refund was refunded again by hand', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'failed' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    h.provider.refundByHand(handRefund(1000));

    expect(unwrap(await h.refund('order-1', { requestKey: 'req-2', expectedAmountCents: 3099 })).refund).toMatchObject({ kind: 'remainder', amountCents: 3099 });
    await h.dispatch(minutes(2));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([1000, 3099]);
    expect(h.providerTotal()).toBe(3099);
  });

  it('issues exactly the typed amount after a partial staff refund failed', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'failed' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));

    expect(unwrap(await h.refund('order-1', { requestKey: 'req-2', amountCents: 2500 })).refund).toMatchObject({ kind: 'amount', amountCents: 2500 });
    await h.dispatch(minutes(2));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([1000, 2500]);
  });

  it('never pays again for a dashboard refund that fails after a full refund paid its own amount', async () => {
    const h = harness();
    h.provider.refundByHand(handRefund(1000));
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 3099 }));
    await h.dispatch(minutes(1));
    h.provider.failRefund('re_hand', 'expired_or_canceled_card');

    await h.dispatch(minutes(60 * 24 + 1));
    await h.dispatch(minutes(60 * 24 + 2));
    await h.dispatch(minutes(60 * 24 * 7 + 1));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([3099]);
    expect(await refundRows('order-1')).toMatchObject([{ status: 'succeeded', amountCents: 3099, nextAttemptAt: null }]);
    expect(await alertPayloads()).toStrictEqual([]);
  });

  it('pays each staff refund exactly its own amount when a failed sibling was refunded again and a dashboard refund fails later', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'pending' }] });
    h.provider.refundByHand(handRefund(1000));
    unwrap(await h.refund('order-1', { requestKey: 'req-s', amountCents: 500 }));
    await h.dispatch(minutes(1));
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-r', expectedAmountCents: 2599 })).refund).toMatchObject({ kind: 'remainder', amountCents: 2599 });
    h.provider.failRefund('re_1', 'expired_or_canceled_card');
    await h.dispatch(minutes(2));
    await h.dispatch(minutes(60 * 24 + 1));
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-t', expectedAmountCents: 500 })).refund).toMatchObject({ kind: 'remainder', amountCents: 500 });
    h.provider.failRefund('re_hand', 'expired_or_canceled_card');

    for (const at of [60 * 24 + 2, 60 * 24 * 2 + 3, 60 * 24 * 7 + 2, 60 * 24 * 8 + 3]) await h.dispatch(minutes(at));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([500, 2599, 500]);
    expect(h.providerTotal()).toBe(3099);
    expect((await refundRows('order-1')).map((row) => [row.amountCents, row.status])).toStrictEqual([[500, 'failed'], [2599, 'succeeded'], [500, 'succeeded']]);
    expect(await buyerEmails()).toMatchObject([
      { id: 'order-refund-issued:refund-1', payload: { subject: noticeSubject(500) } },
      { id: 'order-refund-issued:refund-2', payload: { subject: noticeSubject(2599) } },
      { id: 'order-refund-issued:refund-3', payload: { subject: noticeSubject(500) } },
    ]);
    expect(await buyerEmails()).toHaveLength(3);
    expect(await alertPayloads()).toStrictEqual([expect.objectContaining({ alert: 'failed_after_submission', text: expect.stringContaining('refund PLN\u00a05.00 of order') })]);
  });

  it('pays a full refund exactly its amount when a dashboard refund and a sibling that failed at the provider before its status check shaped the remainder', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'pending' }] });
    h.provider.refundByHand(handRefund(2000));
    unwrap(await h.refund('order-1', { requestKey: 'req-s', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    h.provider.failRefund('re_1', 'expired_or_canceled_card');
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-r', expectedAmountCents: 2099 })).refund).toMatchObject({ kind: 'remainder', amountCents: 2099 });

    for (const at of [2, 60 * 24 + 1, 60 * 24 + 2, 60 * 24 * 7 + 2]) await h.dispatch(minutes(at));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([1000, 2099]);
    expect(h.providerTotal()).toBe(2099);
    expect((await refundRows('order-1')).map((row) => [row.amountCents, row.status])).toStrictEqual([[1000, 'failed'], [2099, 'succeeded']]);
    expect(await buyerEmails()).toMatchObject([{ id: 'order-refund-issued:refund-1', payload: { subject: noticeSubject(1000) } }, { id: 'order-refund-issued:refund-2', payload: { subject: noticeSubject(2099) } }]);
    expect(await buyerEmails()).toHaveLength(2);
  });

  it('refuses a full refund confirmed for a remainder that grew because a sibling failed meanwhile, and pays the new remainder once confirmed', async () => {
    const h = harness({ steps: [{ outcome: 'refund', status: 'pending' }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-s', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    expect(unwrap(await previewStaffRefund(staff('tenant-a'), 'order-1', h.deps)).remainderCents).toBe(3099);
    h.provider.failRefund('re_1', 'expired_or_canceled_card');
    await h.dispatch(minutes(60 * 24 + 1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'failed' }]);

    expect(await h.refund('order-1', { requestKey: 'req-r', expectedAmountCents: 3099 })).toMatchObject({
      ok: false, error: { code: 'conflict', message: 'The refundable remainder is now 40.99 PLN; check the refund again before confirming it', details: { remainderCents: 4099 } },
    });
    expect(await refundRows('order-1')).toHaveLength(1);
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-r', expectedAmountCents: 4099 })).refund).toMatchObject({ kind: 'remainder', amountCents: 4099 });
    await h.dispatch(minutes(60 * 24 + 2));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([1000, 4099]);
    expect(h.providerTotal()).toBe(4099);
  });

  it('never pays the refund of a sibling that was marked failed while its lost provider refund was still pending', async () => {
    const h = harness();
    await database.db.insert(orderStaffRefunds).values({
      id: 'lost', tenantId: 'tenant-a', orderId: 'order-1', paymentIntentId: 'pi_order-1', amountCents: 1000, currency: 'PLN', kind: 'amount',
      requestKey: 'req-lost', idempotencyKey: 'staff-refund-lost', status: 'failed', requestedByUserId: 'staff', requestedByEmail: 'staff@example.com',
      createdAt: start, updatedAt: start,
    });
    h.provider.refundByHand({ ...handRefund(1000), refundId: 're_lost', status: 'pending', orderId: 'order-1', reason: 'staff', refundJobId: 'lost' });
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-r', expectedAmountCents: 3099 })).refund).toMatchObject({ kind: 'remainder', amountCents: 3099 });
    await h.dispatch(minutes(1));
    h.provider.failRefund('re_lost', 'expired_or_canceled_card');

    await h.dispatch(minutes(60 * 24 + 1));
    await h.dispatch(minutes(60 * 24 + 2));
    await h.dispatch(minutes(60 * 24 * 7 + 1));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([3099]);
    expect((await refundRows('order-1')).map((row) => [row.id, row.status])).toStrictEqual([['lost', 'failed'], ['refund-1', 'succeeded']]);
  });

  it('keeps a watched partial refund that must be issued after all as it is while another refund of the order waits, and checks again an hour later', async () => {
    const permissionMissing = refundFailure('permission_missing', 'The provided key does not have the required permissions', 'permission_denied');
    const h = harness({ steps: [{ outcome: 'refund' }, ...Array.from({ length: 30 }, () => ({ outcome: 'error' as const, error: permissionMissing }))] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    h.provider.refundByHand({ ...handRefund(4099), status: 'pending' });
    await h.dispatch(minutes(1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'submitted', providerRefundId: null }]);
    h.provider.failRefund('re_hand', 'expired_or_canceled_card');
    unwrap(await h.refund('order-1', { requestKey: 'req-2', amountCents: 500 }));
    await h.dispatch(minutes(2));

    await h.dispatch(minutes(60 * 24 + 1));
    const [watched, waiting] = await refundRows('order-1');
    expect(waiting).toMatchObject({ status: 'blocked_permission' });
    expect(watched).toMatchObject({ status: 'submitted', nextAttemptAt: minutes(60 * 25 + 1) });
    expect(watched?.lastError).toContain('another refund of this order is still waiting');
    expect(h.provider.created).toStrictEqual([]);
    expect(h.logs.filter((line) => line.includes('settlement not saved'))).toStrictEqual([]);
  });

  it('renders the staff alert of a staff refund in each recipient\'s language and stores it in the shape every release renders', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('refund_failed', 'Refund declined') }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1), {
      tenantAccess: { listStaffForTenant: async () => [
        { userId: 'owner', email: 'owner@acme.example.com', staffRole: 'owner' as const, language: 'en' as const },
        { userId: 'admin', email: 'admin@acme.example.com', staffRole: 'admin' as const, language: 'pl' as const },
      ] },
    });

    const rows = await database.db.select({ id: emailOutbox.id, to: emailOutbox.to, kind: emailOutbox.kind, sourceApp: emailOutbox.sourceApp, payload: emailOutbox.payload })
      .from(emailOutbox).orderBy(asc(emailOutbox.id));
    expect(rows.map((row) => [row.id, row.to, row.kind, row.sourceApp])).toStrictEqual([
      ['order-refund-alert:refund-1:failed:1:0', 'owner@acme.example.com', 'm2m-transactional', 'staff-refunds'],
      ['order-refund-alert:refund-1:failed:1:1', 'admin@acme.example.com', 'm2m-transactional', 'staff-refunds'],
    ]);
    const rendered = (language: string) => staffRefundAlertEmail(language, {
      tenantName: 'Acme', alert: 'failed', orderId: 'order-1', amountCents: 1000, currency: 'PLN', mayHaveRefunded: false, restocked: false, removedFromPackingList: false,
      diagnostic: 'The payment provider refused the refund, so nothing was refunded: Refund declined', orderUrl: 'https://acme.togethercommunity.app/panel/sales/order-1',
    });
    expect(rows.map((row) => row.payload)).toStrictEqual([{ kind: 'm2m-transactional', ...rendered('en') }, { kind: 'm2m-transactional', ...rendered('pl') }]);
    expect(rendered('pl').text).not.toBe(rendered('en').text);
    expect(textOf(rows[0]?.payload)).toBe('A staff member asked to refund PLN\u00a010.00 of order order-1.\nThe refund failed and is no longer retried. Nothing was refunded by this request. Refund the order again from its page, or by hand in the Stripe Dashboard.\nLast error: The payment provider refused the refund, so nothing was refunded: Refund declined\nhttps://acme.togethercommunity.app/panel/sales/order-1');
  });

  it('names in the staff alert the amount of a full refund the provider refused and says nothing was refunded', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('refund_failed', 'Refund declined') }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    await h.dispatch(minutes(1));

    expect(await refundRows('order-1')).toMatchObject([{ status: 'failed', amountCents: 4099 }]);
    const [declined] = await alertPayloads();
    expect(declined).toMatchObject({ alert: 'failed', text: expect.stringContaining('A staff member asked to refund PLN\u00a040.99 of order order-1.') });
    expect(declined?.text).toContain('Nothing was refunded by this request.');
    expect(declined?.text).toContain('The goods returned to stock and the order taken off the packing list with this refund stay that way.');
    expect(declined?.text).toContain('Last error: The payment provider refused the refund, so nothing was refunded: Refund declined');
  });

  it('keeps an API key from a provider error out of the stored refund, the Studio view and the staff alert', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('refund_failed', 'Invalid API Key provided: rk_live_51SYNTHETICmarker99 for charge ch_3Visible01') }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));

    const [stored] = await database.db.select({ lastError: orderStaffRefunds.lastError }).from(orderStaffRefunds);
    const detail = unwrap(await getOrder(staff('tenant-a'), 'order-1', { orders: createOrderRepository(database.db), staffRefunds: h.deps.staffRefunds }));
    const outbox = await database.db.select({ payload: emailOutbox.payload }).from(emailOutbox);
    expect(stored?.lastError).toContain('ch_3Visible01');
    expect(outbox).toHaveLength(1);
    for (const sink of [stored?.lastError, JSON.stringify(detail), JSON.stringify(outbox)]) expect(sink).not.toMatch(/rk_live_|SYNTHETICmarker/);
  });

  it('waits on a missing refund permission, refuses a second refund meanwhile and succeeds once the permission is granted', async () => {
    const permissionMissing = refundFailure('permission_missing', 'The provided key does not have the required permissions', 'permission_denied');
    const h = harness({ steps: [{ outcome: 'error', error: permissionMissing }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));

    expect(await refundRows('order-1')).toMatchObject([{ status: 'blocked_permission', nextAttemptAt: minutes(61) }]);
    expect(await alertPayloads()).toMatchObject([{ alert: 'blocked_permission', text: expect.stringContaining('A staff member asked to refund PLN\u00a010.00 of order order-1.') }]);
    const blockedDetail = unwrap(await getOrder(staff('tenant-a'), 'order-1', { orders: createOrderRepository(database.db), staffRefunds: h.deps.staffRefunds }));
    expect(blockedDetail.staffRefunds).toMatchObject([{ status: 'blocked_permission', permissionBlockedAt: minutes(1) }]);
    expect(await h.refund('order-1', { requestKey: 'req-2', amountCents: 500 })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await buyerEmails()).toStrictEqual([]);

    await h.dispatch(minutes(61));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'succeeded', permissionBlockedAt: null, keyGeneration: 1 }]);
    expect(h.providerTotal()).toBe(1000);
    expect(await buyerEmails()).toHaveLength(1);
  });

  it('returns tracked goods to stock, takes the order off the packing list and puts it back with ship anyway', async () => {
    const h = harness();
    await database.db.insert(productStock).values({ tenantId: 'tenant-a', productId: 'book', onHand: 3, reserved: 0, updatedAt: start });
    await database.db.insert(stockEvents).values({ tenantId: 'tenant-a', productId: 'book', type: 'committed', quantity: -2, reference: { orderId: 'order-1', checkoutSnapshotId: 'snap-1' }, occurredAt: start });
    expect(unwrap(await previewStaffRefund(staff('tenant-a'), 'order-1', h.deps))).toMatchObject({
      refundable: true, paidCents: 4099, remainderCents: 4099, remainderSource: 'provider', returnableStock: [{ productId: 'book', quantity: 2 }],
      onPackingList: true, hasShipment: false, fullRefundOptions: { restockDefault: true, removeFromPackingListDefault: true },
    });

    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    expect((await database.db.select().from(productStock).where(eq(productStock.productId, 'book')))[0]?.onHand).toBe(5);
    expect(await database.db.select({ quantity: stockEvents.quantity, reference: stockEvents.reference, actorUserId: stockEvents.actorUserId }).from(stockEvents).where(eq(stockEvents.type, 'returned')))
      .toStrictEqual([{ quantity: 2, reference: { orderId: 'order-1', reason: 'staff_refund' }, actorUserId: 'staff-tenant-a' }]);
    expect(await fulfilmentOf('order-1')).toBeNull();
    expect(unwrap(await previewStaffRefund(staff('tenant-a'), 'order-1', h.deps)).returnableStock).toStrictEqual([]);

    await h.dispatch(minutes(1));
    await database.db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, 'order-1'));
    expect(await shipRefundedOrderAnyway(staff('tenant-b'), 'order-1', h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await shipRefundedOrderAnyway(staff('tenant-a'), 'order-1', h.deps)).toMatchObject({ ok: true, value: { fulfilmentStatus: 'to_pack', status: 'refunded' } });
    expect((await database.db.select().from(productStock).where(eq(productStock.productId, 'book')))[0]?.onHand).toBe(3);
    expect(await database.db.select({ quantity: stockEvents.quantity, reference: stockEvents.reference, actorUserId: stockEvents.actorUserId }).from(stockEvents).where(eq(stockEvents.type, 'adjusted')))
      .toStrictEqual([{ quantity: -2, reference: { orderId: 'order-1', reason: 'staff_refund_ship_anyway' }, actorUserId: 'staff-tenant-a' }]);
    expect(await shipRefundedOrderAnyway(staff('tenant-a'), 'order-1', h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect((await database.db.select().from(productStock).where(eq(productStock.productId, 'book')))[0]?.onHand).toBe(3);
  });

  it('refuses ship anyway while fewer units are on hand than the refund returned to stock and keeps the order off the packing list', async () => {
    const h = harness();
    await database.db.insert(productStock).values({ tenantId: 'tenant-a', productId: 'book', onHand: 0, reserved: 0, updatedAt: start });
    await database.db.insert(stockEvents).values({ tenantId: 'tenant-a', productId: 'book', type: 'committed', quantity: -2, reference: { orderId: 'order-1', checkoutSnapshotId: 'snap-1' }, occurredAt: start });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    await database.db.update(productStock).set({ onHand: 1 }).where(eq(productStock.productId, 'book'));

    expect(await shipRefundedOrderAnyway(staff('tenant-a'), 'order-1', h.deps)).toMatchObject({
      ok: false, error: { code: 'conflict', message: 'The refund returned units of Book to stock and fewer are on hand and not reserved by other checkouts now; adjust the stock before shipping the order' },
    });
    expect(await fulfilmentOf('order-1')).toBeNull();
    expect((await database.db.select().from(productStock).where(eq(productStock.productId, 'book')))[0]?.onHand).toBe(1);
  });

  it('refuses ship anyway when another checkout reserved the units the refund returned to stock and leaves the stock alone', async () => {
    const h = harness();
    await database.db.insert(productStock).values({ tenantId: 'tenant-a', productId: 'book', onHand: 0, reserved: 0, updatedAt: start });
    await database.db.insert(stockEvents).values({ tenantId: 'tenant-a', productId: 'book', type: 'committed', quantity: -1, reference: { orderId: 'order-1', checkoutSnapshotId: 'snap-1' }, occurredAt: start });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    await database.db.update(productStock).set({ reserved: 1 }).where(eq(productStock.productId, 'book'));

    expect(await shipRefundedOrderAnyway(staff('tenant-a'), 'order-1', h.deps)).toMatchObject({ ok: false, error: { code: 'conflict', message: expect.stringContaining('units of Book') } });
    expect(await fulfilmentOf('order-1')).toBeNull();
    expect(await database.db.select({ onHand: productStock.onHand, reserved: productStock.reserved }).from(productStock)).toStrictEqual([{ onHand: 1, reserved: 1 }]);
  });

  it('refunds no more than a typed amount equal to the remainder when a dashboard refund fails before it is issued, and offers the full refund choices with it', async () => {
    const h = harness();
    h.provider.refundByHand({ ...handRefund(1000), status: 'pending' });
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 3099 })).refund)
      .toMatchObject({ kind: 'amount', amountCents: 3099, restocked: true, removedFromPackingList: true });
    expect(await fulfilmentOf('order-1')).toBeNull();
    h.provider.failRefund('re_hand', 'expired_or_canceled_card');

    await h.dispatch(minutes(1));
    expect(h.provider.created.map((created) => created.amountCents)).toStrictEqual([3099]);
  });

  it('refuses a note holding a NUL as a validation error and saves nothing', async () => {
    const h = harness();
    expect(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000, reason: 'damaged\u0000cover' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await refundRows('order-1')).toStrictEqual([]);
  });

  it('treats a carrier shipment whose create call started without a provider id yet as a possibly bought label', async () => {
    const h = harness();
    await database.db.insert(orderShipments).values({
      id: 'shipment-1', tenantId: 'tenant-a', orderId: 'order-1', provider: 'inpost_shipx', environment: 'sandbox', organizationId: 'org-1',
      providerShipmentId: null, status: 'unknown', createAttemptedAt: start, createdAt: start, updatedAt: start,
    });

    expect(unwrap(await previewStaffRefund(staff('tenant-a'), 'order-1', h.deps))).toMatchObject({
      hasShipment: true, fullRefundOptions: { restockDefault: false, removeFromPackingListDefault: false },
    });
    expect(unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 })).refund).toMatchObject({ restocked: false, removedFromPackingList: false });
    expect(await fulfilmentOf('order-1')).toBe('to_pack');
  });

  it('keeps stock and the packing list for a partial refund and refuses to restock with one', async () => {
    const h = harness();
    expect(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000, restock: true })).toMatchObject({ ok: false, error: { code: 'validation' } });
    unwrap(await h.refund('order-1', { requestKey: 'req-2', amountCents: 1000 }));
    expect(await fulfilmentOf('order-1')).toBe('to_pack');
  });

  it('claims a sold-out refund job before a staff refund due at the same instant', async () => {
    const h = harness();
    await insertOrder('order-sold-out', { cancelReason: 'out_of_stock' });
    await database.db.insert(orderRefundJobs).values(outOfStockRefundJob(
      { id: 'order-sold-out', tenantId: 'tenant-a', amountCents: 4099, currency: 'PLN', providerObjectIds: { paymentIntent: 'pi_order-sold-out' } },
      { id: 'zz-job', now: start },
    ));
    unwrap(await h.refund('order-1', { requestKey: 'req-1', expectedAmountCents: 4099 }));
    const queue = createRefundJobQueue(database.db);

    expect(await queue.countDue({ now: start })).toBe(2);
    const first = await queue.claimDue({ now: start, leaseMs: 600_000 });
    const second = await queue.claimDue({ now: start, leaseMs: 600_000 });
    expect([first?.job.id, second?.job.id]).toStrictEqual(['zz-job', 'refund-1']);
    expect(second?.lease).toStrictEqual({ status: 'running', lockedAt: start, source: 'staff' });
    expect(await queue.claimDue({ now: start, leaseMs: 600_000 })).toBeNull();
  });

  it('refuses another workspace, an admin without a verified e-mail, a member and a machine key', async () => {
    const h = harness();
    expect(await h.refund('order-1', { requestKey: 'req-1' }, staff('tenant-b'))).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.refund('order-1', { requestKey: 'req-1' }, staff('tenant-a', { staffRole: 'admin', emailVerified: false }))).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await h.refund('order-1', { requestKey: 'req-1' }, staff('tenant-a', { staffRole: null, memberId: 'member-a' }))).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await h.refund('order-1', { requestKey: 'req-1' }, { ...staff('tenant-a'), machineActor: { kind: 'shop_management_key', apiKeyId: 'key-1', mode: 'direct' } }))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await refundRows('order-1')).toStrictEqual([]);
  });

  it('makes a waiting staff refund due at once when the charge is refunded and logs its changes on the order feed', async () => {
    const h = harness({ steps: [{ outcome: 'error', error: refundFailure('transient', 'Stripe is unavailable') }] });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    await h.dispatch(minutes(1));
    expect(await refundRows('order-1')).toMatchObject([{ status: 'pending', nextAttemptAt: minutes(2) }]);

    expect(await h.deps.staffRefunds.noteChargeRefunded('tenant-b', 'order-1', minutes(1))).toStrictEqual([]);
    expect(await h.deps.staffRefunds.noteChargeRefunded('tenant-a', 'order-1', minutes(1))).toMatchObject([{ status: 'pending', nextAttemptAt: minutes(1) }]);
    const [changes] = await database.db.select({ count: sql<number>`count(*)::int` }).from(orderChanges)
      .where(and(eq(orderChanges.tenantId, 'tenant-a'), eq(orderChanges.orderId, 'order-1')));
    expect(changes?.count).toBeGreaterThanOrEqual(3);
  });

  it('shows the most recent unsettled staff refund on the Studio orders list in its own field and leaves the sold-out refund field and machine keys alone', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    const listDeps = { orders: createOrderRepository(database.db), staffRefunds: h.deps.staffRefunds };
    const listed = unwrap(await listOrders(staff('tenant-a'), {}, listDeps));
    expect(listed.orders.map((order) => [order.id, order.staffRefundStatus, order.staffRefundAmountCents, order.refundJobStatus])).toStrictEqual([['order-1', 'pending', 1000, undefined]]);
    const machineKey: Ctx = { ...staff('tenant-a'), machineActor: { kind: 'shop_management_key', apiKeyId: 'key-1', mode: 'direct' } };
    const machineListed = unwrap(await listOrders(machineKey, {}, listDeps));
    expect(machineListed.orders.map((order) => [order.id, order.staffRefundStatus, order.staffRefundAmountCents, order.refundJobStatus])).toStrictEqual([['order-1', undefined, undefined, undefined]]);
    expect((await createOrderRepository(database.db).list('tenant-a', { page: 1, pageSize: 10 })).orders[0]?.refundJobStatus).toBeUndefined();
    await h.dispatch(minutes(1));
    const settled = unwrap(await listOrders(staff('tenant-a'), {}, listDeps));
    expect(settled.orders.map((order) => [order.id, order.staffRefundStatus])).toStrictEqual([['order-1', undefined]]);
  });

  it('adds the refunded amount to the CSV and JSON export', async () => {
    const h = harness();
    await insertOrder('order-2', { status: 'refunded', createdAt: minutes(-1) });
    await insertOrder('order-3', { createdAt: minutes(-2) });
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    const exportDeps = { orders: createOrderRepository(database.db), staffRefunds: h.deps.staffRefunds };

    const [header = '', ...lines] = unwrap(await exportOrders(staff('tenant-a'), { format: 'csv' }, exportDeps)).content.split('\n');
    expect(header.split(',').at(-1)).toBe('refunded_amount');
    expect(lines.map((line) => line.split(',').at(-1))).toStrictEqual(['"1000"', '"4099"', '"0"']);
    const json: unknown = JSON.parse(unwrap(await exportOrders(staff('tenant-a'), { format: 'json' }, exportDeps)).content);
    expect(json).toMatchObject([{ id: 'order-1', refundedCents: 1000 }, { id: 'order-2', refundedCents: 4099 }, { id: 'order-3', refundedCents: 0 }]);
  });

  it('adds the amount of a sold-out refund the provider accepted to the export before charge.refunded marks the order refunded', async () => {
    const h = harness();
    await insertOrder('order-sold-out', { cancelReason: 'out_of_stock', createdAt: minutes(-1) });
    await database.db.insert(orderRefundJobs).values({
      ...outOfStockRefundJob(
        { id: 'order-sold-out', tenantId: 'tenant-a', amountCents: 4099, currency: 'PLN', providerObjectIds: { paymentIntent: 'pi_order-sold-out' } },
        { id: 'sold-out-job', now: start },
      ),
      status: 'succeeded',
    });
    const exportDeps = { orders: createOrderRepository(database.db), staffRefunds: h.deps.staffRefunds };

    expect(await h.deps.staffRefunds.committedCentsByOrder('tenant-a', ['order-1', 'order-sold-out'])).toStrictEqual(new Map([['order-sold-out', 4099]]));
    const json: unknown = JSON.parse(unwrap(await exportOrders(staff('tenant-a'), { format: 'json' }, exportDeps)).content);
    expect(json).toMatchObject([{ id: 'order-1', refundedCents: 0 }, { id: 'order-sold-out', status: 'paid', refundedCents: 4099 }]);
  });

  it('sums committed staff refunds for more order ids than one statement can bind', async () => {
    const h = harness();
    unwrap(await h.refund('order-1', { requestKey: 'req-1', amountCents: 1000 }));
    const orderIds = [...Array.from({ length: 66_000 }, (_value, index) => `order-x-${String(index)}`), 'order-1'];

    expect(await h.deps.staffRefunds.committedCentsByOrder('tenant-a', orderIds)).toStrictEqual(new Map([['order-1', 1000]]));
  });
});
