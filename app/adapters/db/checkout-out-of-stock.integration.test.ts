import { asc, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkoutSessionInputSchema, err, ok, refundFailure, type CheckoutSessionInput, type ProviderRefund } from '#core/domain/index.js';
import { dispatchOrderRefundJobs, fulfillStripeWebhook, releaseExpiredStockReservations, simulatePurchase, startCheckoutSession, validateCheckoutSelection, type PaymentProvider, type PaymentWebhookEvent } from '#core/server/index.js';
import { createLegacyCheckoutHarness, legacyBaseUrl, legacyProducts, legacyTenant } from '#core/server/testing/legacy-checkout-harness.js';

import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import { createOrderRefundJobRepository } from './order-refund-jobs.js';
import { createPaymentTransactionPort } from './payment-transaction.js';
import {
  createMemberRepository,
  createOrderRepository,
  createPaymentRefundRepository,
  createProcessedPaymentEventRepository,
  createProductGrantRepository,
} from './repositories.js';
import {
  autoInvoiceJobs, checkoutSnapshots, emailEvents, emailOutbox, members, metaCapiOutbox, orderRefundJobs, orders, processedPaymentEvents, productGrants,
  memberEvents, productPrices, products, productStock, stockEvents, stockReservations, consents, tenants,
} from './schema.js';
import { createStockRepository } from './stock.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

type Harness = ReturnType<typeof createLegacyCheckoutHarness>;

const harness = () => {
  const h = createLegacyCheckoutHarness({ stock: createStockRepository(database.db), checkoutSnapshots: createCheckoutSnapshotRepository(database.db) });
  h.captures.set('capture-1', {
    termsAccepted: true, termsUrl: 'https://acme.togethercommunity.app/terms', privacyUrl: 'https://acme.togethercommunity.app/privacy',
    selectedDefinitionIds: [], attachedDefinitionIds: [], collectedAt: '2026-11-15T10:00:00.000Z', confirmationBaseUrl: `${legacyBaseUrl}/marketing/confirm`,
  });
  Object.assign(h.webhookDeps, {
    paymentTransaction: createPaymentTransactionPort(database.db),
    processedPaymentEvents: createProcessedPaymentEventRepository(database.db),
    paymentRefunds: createPaymentRefundRepository(database.db),
    members: createMemberRepository(database.db),
    grants: createProductGrantRepository(database.db),
    orders: createOrderRepository(database.db),
    emailOutbox: createEmailOutboxRepository(database.db),
    tenantAccess: { listStaffForTenant: async () => [{ userId: 'owner', email: 'owner@example.com', staffRole: 'owner', language: 'en' }] },
  });
  return h;
};

const track = async (productId: string, onHand: number) => {
  const enabled = await createStockRepository(database.db).enableTracking(legacyTenant.id, { productId, onHand, lowStockThreshold: null, actorUserId: 'staff', now: '2026-11-15T09:00:00.000Z' });
  if (!enabled.ok) throw new Error(enabled.error.message);
};

const damage = async (productId: string, now: string) => {
  const adjusted = await createStockRepository(database.db).adjust(legacyTenant.id, { productId, delta: -1, reason: 'damaged', actorUserId: 'staff', now });
  if (!adjusted.ok) throw new Error(adjusted.error.message);
};

const publicCheckout = async (h: Harness, input: CheckoutSessionInput) => {
  const parsed = checkoutSessionInputSchema.parse(input);
  const selection = await validateCheckoutSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) throw new Error(selection.error.message);
  const started = await startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1');
  if (!started.ok) throw new Error(started.error.message);
  const snapshotId = h.paymentInputs.at(-1)?.checkoutSnapshotId;
  if (snapshotId == null) throw new Error('Checkout started without a snapshot');
  return snapshotId;
};

const sweep = (h: Harness, now: string) => {
  h.setNow(now);
  return releaseExpiredStockReservations({ stock: createStockRepository(database.db), clock: { nowIso: () => now }, logger: h.checkoutDeps.logger });
};

const sessionBase = {
  email: 'buyer@example.com', customerName: 'Buyer Example', customerCountry: null, billing: null, termsAccepted: false, paymentStatus: 'paid',
  subscriptionId: null, invoiceId: null, discountTotalCents: 0, shipping: null, shippingCostCents: null,
} as const;

const printedPaid = (input: { eventId: string; session: string; snapshotId: string; paymentIntentId: string }): PaymentWebhookEvent => ({
  id: input.eventId, type: 'checkout.session.completed', objectId: input.session, tenantIds: ['tenant-a'], livemode: true,
  checkoutSession: {
    ...sessionBase, paymentIntentId: input.paymentIntentId, customerName: 'Jane Buyer', amountTotalCents: 4099, shippingCostCents: 1999,
    shipping: { name: 'Jane Buyer', phone: '+48600100200', address: { line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL', state: null } },
    metadata: { attribution: null, tenantId: 'tenant-a', productId: 'printed-1', priceId: 'price-printed-1', memberEmail: 'buyer@example.com', language: 'en', checkoutConsentCaptureId: 'capture-1', couponCheckoutSessionId: null, checkoutSnapshotId: input.snapshotId },
  },
});

const bundlePaid = (snapshotId: string): PaymentWebhookEvent => ({
  id: 'evt_oos_bundle', type: 'checkout.session.completed', objectId: 'cs_live_golden1', tenantIds: ['tenant-a'], livemode: true,
  checkoutSession: {
    ...sessionBase, paymentIntentId: 'pi_oos_bundle', amountTotalCents: 8400,
    metadata: { attribution: null, tenantId: 'tenant-a', productId: 'course-1', priceId: null, memberEmail: 'buyer@example.com', language: null, checkoutConsentCaptureId: 'capture-1', couponCheckoutSessionId: null, checkoutSnapshotId: snapshotId, salesLinkId: 'link-1', productIds: '["course-1","poster-1"]' },
  },
});

const printedRequest: CheckoutSessionInput = { productId: 'printed-1', priceId: 'price-printed-1', email: 'buyer@example.com', language: 'en', termsAccepted: true, shipping: { rateId: 'courier' } };

const tenantRows = async () => ({
  orders: await database.db.select({
    id: orders.id, status: orders.status, cancelReason: orders.cancelReason, fulfilmentStatus: orders.fulfilmentStatus, amountCents: orders.amountCents,
    providerObjectIds: orders.providerObjectIds,
  }).from(orders).where(eq(orders.tenantId, legacyTenant.id)).orderBy(asc(orders.createdAt), asc(orders.id)),
  refundJobs: await database.db.select({
    orderId: orderRefundJobs.orderId, paymentIntentId: orderRefundJobs.paymentIntentId, amountCents: orderRefundJobs.amountCents, currency: orderRefundJobs.currency,
    reason: orderRefundJobs.reason, idempotencyKey: orderRefundJobs.idempotencyKey, status: orderRefundJobs.status, attempts: orderRefundJobs.attempts,
  }).from(orderRefundJobs).where(eq(orderRefundJobs.tenantId, legacyTenant.id)).orderBy(asc(orderRefundJobs.orderId)),
  levels: await database.db.select({ productId: productStock.productId, onHand: productStock.onHand, reserved: productStock.reserved })
    .from(productStock).where(eq(productStock.tenantId, legacyTenant.id)).orderBy(asc(productStock.productId)),
  stockEventTypes: (await database.db.select({ type: stockEvents.type }).from(stockEvents)
    .where(eq(stockEvents.tenantId, legacyTenant.id)).orderBy(asc(stockEvents.occurredAt), asc(stockEvents.type))).map((row) => row.type),
  grants: await database.db.select({ productId: productGrants.productId }).from(productGrants).where(eq(productGrants.tenantId, legacyTenant.id)),
  invoiceJobs: await database.db.select({ orderId: autoInvoiceJobs.orderId }).from(autoInvoiceJobs).where(eq(autoInvoiceJobs.tenantId, legacyTenant.id)),
  capiOutbox: await database.db.select({ orderId: metaCapiOutbox.orderId }).from(metaCapiOutbox).where(eq(metaCapiOutbox.tenantId, legacyTenant.id)),
  emails: await database.db.select({ kind: emailOutbox.kind, to: emailOutbox.to }).from(emailOutbox)
    .where(eq(emailOutbox.tenantId, legacyTenant.id)).orderBy(asc(emailOutbox.kind), asc(emailOutbox.to)),
});

const cancelledJob = (orderId: string, paymentIntentId: string, amountCents: number) => ({
  orderId, paymentIntentId, amountCents, currency: 'PLN', reason: 'out_of_stock', idempotencyKey: `oos-refund-${orderId}`, status: 'pending', attempts: 0,
});

const waitForLockWaiters = async (observer: pg.Client, count: number) => {
  for (;;) {
    const waiting = await observer.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if ((waiting.rows[0]?.count ?? 0) >= count) return;
  }
};

beforeAll(async () => {
  database = await createTestDatabase('together_checkout_out_of_stock', baseDatabaseUrl);
  await database.db.insert(tenants).values({ id: legacyTenant.id, slug: legacyTenant.slug, name: legacyTenant.name, createdAt: '2026-11-01T09:00:00.000Z' });
  await database.db.insert(products).values(legacyProducts.map((product) => ({
    id: product.id, tenantId: product.tenantId, type: product.type, slug: product.slug, title: product.title, description: product.description,
    priceCents: product.priceCents, currency: product.currency, published: product.published, deliveryMethod: product.deliveryMethod ?? 'pickup',
    vatRate: typeof product.vatRate === 'number' ? product.vatRate : null, createdAt: product.createdAt,
  })));
  await database.db.insert(productPrices).values([
    { id: 'price-printed-1', tenantId: legacyTenant.id, productId: 'printed-1', kind: 'one_time', interval: null, amountCents: 2100, currency: 'PLN', active: true, createdAt: '2026-11-01T09:00:00.000Z' },
  ]);
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
  for (const table of [orderRefundJobs, autoInvoiceJobs, metaCapiOutbox, emailEvents, emailOutbox, consents, productGrants, processedPaymentEvents, orders, memberEvents, members, stockReservations, stockEvents, productStock, checkoutSnapshots]) {
    await database.db.delete(table);
  }
});

describe('payment for goods that sold out after the hold ended', () => {
  it('records the order as paid and cancelled, decrements nothing and queues exactly one refund job', async () => {
    const h = harness();
    await track('printed-1', 1);
    const snapshotId = await publicCheckout(h, printedRequest);
    expect(await sweep(h, '2026-11-15T10:40:00.000Z')).toStrictEqual(ok({ released: 1 }));
    await damage('printed-1', '2026-11-15T10:41:00.000Z');
    h.setNow('2026-11-15T10:42:00.000Z');

    expect(await fulfillStripeWebhook(legacyTenant, printedPaid({ eventId: 'evt_oos_1', session: 'cs_live_golden1', snapshotId, paymentIntentId: 'pi_oos_1' }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));

    const rows = await tenantRows();
    const orderId = rows.orders[0]?.id ?? '';
    expect(rows).toStrictEqual({
      orders: [{ id: orderId, status: 'paid', cancelReason: 'out_of_stock', fulfilmentStatus: null, amountCents: 4099, providerObjectIds: { checkoutSession: 'cs_live_golden1', paymentIntent: 'pi_oos_1' } }],
      refundJobs: [cancelledJob(orderId, 'pi_oos_1', 4099)],
      levels: [{ productId: 'printed-1', onHand: 0, reserved: 0 }],
      stockEventTypes: ['tracking_enabled', 'reserved', 'released', 'adjusted'],
      grants: [],
      invoiceJobs: [],
      capiOutbox: [],
      emails: [{ kind: 'order-out-of-stock', to: 'owner@example.com' }, { kind: 'order-sold-out-refund', to: 'buyer@example.com' }],
    });
    const buyerEmail = await database.db.select({ id: emailOutbox.id, payload: emailOutbox.payload }).from(emailOutbox).where(eq(emailOutbox.kind, 'order-sold-out-refund'));
    expect(buyerEmail).toStrictEqual([{ id: `order-sold-out-refund:${legacyTenant.id}:${orderId}`, payload: expect.objectContaining({ language: 'en', orderId, amountCents: 4099, currency: 'PLN', productTitles: ['Printed book'] }) }]);
    expect((await createOrderRepository(database.db).list(legacyTenant.id, { page: 1, pageSize: 20 })).orders)
      .toStrictEqual([expect.objectContaining({ id: orderId, cancelReason: 'out_of_stock', refundJobStatus: 'pending' })]);
    expect(await createOrderRefundJobRepository(database.db).findByOrderId(legacyTenant.id, orderId)).toMatchObject({
      idempotencyKey: `oos-refund-${orderId}`, status: 'pending', nextAttemptAt: '2026-11-15T10:42:00.000Z', providerRefundId: null,
    });
    expect(await createOrderRefundJobRepository(database.db).findByOrderId('other-tenant', orderId)).toBeNull();
    expect(h.warnings).toContain(`[stock] out of stock tenant=tenant-a order=${orderId} products=printed-1 refund=oos-refund-${orderId}`);
    expect(h.warnings.some((line) => line.includes('oversold'))).toBe(false);
  });

  it('cancels a two-line order when one line is short and decrements neither line nor grants the other one', async () => {
    const h = harness();
    await track('course-1', 5);
    await track('poster-1', 1);
    const snapshotId = await publicCheckout(h, { productId: 'course-1', salesLinkId: 'link-1', email: 'buyer@example.com', termsAccepted: true });
    await sweep(h, '2026-11-15T10:40:00.000Z');
    await damage('poster-1', '2026-11-15T10:41:00.000Z');
    h.setNow('2026-11-15T10:42:00.000Z');

    expect(await fulfillStripeWebhook(legacyTenant, bundlePaid(snapshotId), h.webhookDeps)).toStrictEqual(ok({ processed: true }));

    const rows = await tenantRows();
    const orderId = rows.orders[0]?.id ?? '';
    expect(rows.orders).toStrictEqual([{ id: orderId, status: 'paid', cancelReason: 'out_of_stock', fulfilmentStatus: null, amountCents: 8400, providerObjectIds: { checkoutSession: 'cs_live_golden1', paymentIntent: 'pi_oos_bundle' } }]);
    expect(rows.refundJobs).toStrictEqual([cancelledJob(orderId, 'pi_oos_bundle', 8400)]);
    expect(rows.levels).toStrictEqual([{ productId: 'course-1', onHand: 5, reserved: 0 }, { productId: 'poster-1', onHand: 0, reserved: 0 }]);
    expect(rows.stockEventTypes.filter((type) => type.startsWith('committed') || type === 'oversold')).toStrictEqual([]);
    expect(rows.grants).toStrictEqual([]);
    expect(rows.emails).toStrictEqual([{ kind: 'order-out-of-stock', to: 'owner@example.com' }, { kind: 'order-sold-out-refund', to: 'buyer@example.com' }]);
  });

  it('keeps one order and one refund job when the same webhook is delivered again or the session is reported twice', async () => {
    const h = harness();
    await track('printed-1', 1);
    const snapshotId = await publicCheckout(h, printedRequest);
    await sweep(h, '2026-11-15T10:40:00.000Z');
    await damage('printed-1', '2026-11-15T10:41:00.000Z');
    h.setNow('2026-11-15T10:42:00.000Z');
    const event = printedPaid({ eventId: 'evt_oos_dup', session: 'cs_live_golden1', snapshotId, paymentIntentId: 'pi_oos_dup' });

    expect(await fulfillStripeWebhook(legacyTenant, event, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    const first = await tenantRows();
    expect(await fulfillStripeWebhook(legacyTenant, event, h.webhookDeps)).toStrictEqual(ok({ processed: false }));
    expect((await createStockRepository(database.db).adjust(legacyTenant.id, { productId: 'printed-1', delta: 3, reason: 'restock', actorUserId: 'staff', now: '2026-11-15T10:43:00.000Z' })).ok).toBe(true);
    expect(await fulfillStripeWebhook(legacyTenant, { ...event, id: 'evt_oos_dup_other' }, h.webhookDeps)).toStrictEqual(ok({ processed: false }));

    const rows = await tenantRows();
    expect(rows.orders).toStrictEqual(first.orders);
    expect(rows.refundJobs).toStrictEqual(first.refundJobs);
    expect(rows.refundJobs).toHaveLength(1);
    expect(rows.levels).toStrictEqual([{ productId: 'printed-1', onHand: 3, reserved: 0 }]);
    expect(rows.emails).toStrictEqual(first.emails);
    expect(rows.stockEventTypes.filter((type) => type.startsWith('committed') || type === 'oversold')).toStrictEqual([]);
  });

  it('fulfils exactly one of two payments racing for the last piece and cancels the other with a refund job', async () => {
    const h = harness();
    await track('printed-1', 1);
    const firstSnapshot = await publicCheckout(h, printedRequest);
    await sweep(h, '2026-11-15T10:40:00.000Z');
    h.setNow('2026-11-15T10:41:00.000Z');
    const secondSnapshot = await publicCheckout(h, printedRequest);
    await sweep(h, '2026-11-15T11:20:00.000Z');
    expect(await tenantRows().then((rows) => rows.levels)).toStrictEqual([{ productId: 'printed-1', onHand: 1, reserved: 0 }]);

    const blocker = new pg.Client({ connectionString: database.url });
    const observer = new pg.Client({ connectionString: database.url });
    await blocker.connect();
    await observer.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM product_stock WHERE tenant_id = $1 AND product_id = $2 FOR UPDATE', [legacyTenant.id, 'printed-1']);
      const racing = Promise.all([
        fulfillStripeWebhook(legacyTenant, printedPaid({ eventId: 'evt_race_1', session: 'cs_live_golden1', snapshotId: firstSnapshot, paymentIntentId: 'pi_race_1' }), h.webhookDeps),
        fulfillStripeWebhook(legacyTenant, printedPaid({ eventId: 'evt_race_2', session: 'cs_live_golden2', snapshotId: secondSnapshot, paymentIntentId: 'pi_race_2' }), h.webhookDeps),
      ]);
      await waitForLockWaiters(observer, 2);
      await blocker.query('COMMIT');
      expect(await racing).toStrictEqual([ok({ processed: true }), ok({ processed: true })]);
    } finally {
      await blocker.end();
      await observer.end();
    }

    const rows = await tenantRows();
    const fulfilled = rows.orders.filter((order) => order.cancelReason === null);
    const cancelled = rows.orders.filter((order) => order.cancelReason === 'out_of_stock');
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ status: 'paid', fulfilmentStatus: 'to_pack' });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ status: 'paid', fulfilmentStatus: null });
    const cancelledOrder = cancelled[0];
    if (cancelledOrder === undefined) throw new Error('Expected a cancelled order');
    expect(rows.refundJobs).toStrictEqual([cancelledJob(cancelledOrder.id, cancelledOrder.providerObjectIds['paymentIntent'] ?? '', 4099)]);
    expect(rows.levels).toStrictEqual([{ productId: 'printed-1', onHand: 0, reserved: 0 }]);
    expect(rows.stockEventTypes.filter((type) => type.startsWith('committed') || type === 'oversold')).toStrictEqual(['committed_late']);
    expect(rows.invoiceJobs.map((job) => job.orderId)).toStrictEqual(fulfilled.map((order) => order.id));
  });
});

describe('lock order of the payment webhook and a simulated sales-link purchase', () => {
  it('finishes both without a deadlock when they wait on the same stock row', async () => {
    const h = harness();
    await track('course-1', 5);
    await track('poster-1', 2);
    const snapshotId = await publicCheckout(h, { productId: 'course-1', salesLinkId: 'link-1', email: 'buyer@example.com', termsAccepted: true });
    h.setNow('2026-11-15T10:20:00.000Z');
    const simulatedDeps = {
      ...h.checkoutDeps,
      ...h.webhookDeps,
      purchases: { createMemberGrant: async () => { throw new Error('A sales-link purchase never takes the single-grant path'); } },
    };

    const blocker = new pg.Client({ connectionString: database.url });
    const observer = new pg.Client({ connectionString: database.url });
    await blocker.connect();
    await observer.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM product_stock WHERE tenant_id = $1 AND product_id = $2 FOR UPDATE', [legacyTenant.id, 'course-1']);
      const paid = fulfillStripeWebhook(legacyTenant, bundlePaid(snapshotId), h.webhookDeps);
      await waitForLockWaiters(observer, 1);
      const simulated = simulatePurchase(legacyTenant.id, { email: 'walk-in@example.com', productId: 'course-1', salesLinkId: 'link-1' }, simulatedDeps);
      await waitForLockWaiters(observer, 2);
      await blocker.query('COMMIT');
      expect(await paid).toStrictEqual(ok({ processed: true }));
      expect(await simulated).toMatchObject({ ok: true, value: { productId: 'course-1', alreadyOwned: false } });
    } finally {
      await blocker.end();
      await observer.end();
    }

    const rows = await tenantRows();
    expect(rows.orders.map((order) => [order.status, order.cancelReason])).toStrictEqual([['paid', null], ['paid', null]]);
    expect(rows.refundJobs).toStrictEqual([]);
    expect(rows.levels).toStrictEqual([{ productId: 'course-1', onHand: 3, reserved: 0 }, { productId: 'poster-1', onHand: 0, reserved: 0 }]);
    expect(h.errors).toStrictEqual([]);
  });
});

type RefundInput = Parameters<NonNullable<PaymentProvider['createRefund']>>[0];

const refundDispatcher = (h: Harness, release: Promise<void> = Promise.resolve()) => {
  const calls: RefundInput[] = [];
  const deps = {
    ...h.webhookDeps,
    refundJobs: createOrderRefundJobRepository(database.db),
    orderDetails: createOrderRepository(database.db),
    tenantAccess: { listStaffForTenant: async () => [] },
    payment: {
      createRefund: async (input: RefundInput) => {
        calls.push(input);
        await release;
        const refund: ProviderRefund = { refundId: `re_${input.idempotencyKey}`, paymentIntentId: input.paymentIntentId, amountCents: input.amountCents, status: 'succeeded', failureReason: null, orderId: null, reason: null };
        return ok(refund);
      },
      getRefund: async () => ok<ProviderRefund>({ refundId: 're_unused', paymentIntentId: null, amountCents: 0, status: 'succeeded', failureReason: null, orderId: null, reason: null }),
      listRefunds: async () => ok<ProviderRefund[]>([]),
    },
  };
  return { calls, run: () => dispatchOrderRefundJobs(deps) };
};

describe('refund dispatcher for orders cancelled out of stock', () => {
  it('refunds a cancelled order delivered twice exactly once and kicks the dispatcher only for the first delivery', async () => {
    const h = harness();
    const kicks: string[] = [];
    Object.assign(h.webhookDeps, { dispatchOrderRefunds: () => { kicks.push('kick'); } });
    await track('printed-1', 1);
    const snapshotId = await publicCheckout(h, printedRequest);
    await sweep(h, '2026-11-15T10:40:00.000Z');
    await damage('printed-1', '2026-11-15T10:41:00.000Z');
    h.setNow('2026-11-15T10:42:00.000Z');
    const event = printedPaid({ eventId: 'evt_oos_refund', session: 'cs_live_golden1', snapshotId, paymentIntentId: 'pi_oos_refund' });

    expect(await fulfillStripeWebhook(legacyTenant, event, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(await fulfillStripeWebhook(legacyTenant, { ...event, id: 'evt_oos_refund_again' }, h.webhookDeps)).toStrictEqual(ok({ processed: false }));
    expect(kicks).toStrictEqual(['kick']);

    const dispatcher = refundDispatcher(h);
    expect(await dispatcher.run()).toStrictEqual(ok({ processedCount: 1, outcomes: { refunded: 1 } }));
    expect(await dispatcher.run()).toStrictEqual(ok({ processedCount: 0, outcomes: {} }));

    const rows = await tenantRows();
    const orderId = rows.orders[0]?.id ?? '';
    expect(rows.refundJobs).toStrictEqual([{ ...cancelledJob(orderId, 'pi_oos_refund', 4099), status: 'succeeded', attempts: 1 }]);
    expect(dispatcher.calls).toStrictEqual([{
      mode: 'live', tenantId: 'tenant-a', paymentIntentId: 'pi_oos_refund', amountCents: 4099, idempotencyKey: `oos-refund-${orderId}`,
      metadata: { orderId, reason: 'out_of_stock' },
    }]);
    expect(await createOrderRefundJobRepository(database.db).findByOrderId(legacyTenant.id, orderId)).toMatchObject({
      providerRefundId: `re_oos-refund-${orderId}`, providerRefundStatus: 'succeeded', submittedAt: '2026-11-15T10:42:00.000Z',
      nextAttemptAt: '2026-11-16T10:42:00.000Z', lockedAt: null,
    });
  });

  it('gives each due job to exactly one of two concurrent dispatcher runs', async () => {
    const h = harness();
    await track('printed-1', 2);
    const firstSnapshot = await publicCheckout(h, printedRequest);
    const secondSnapshot = await publicCheckout(h, printedRequest);
    await sweep(h, '2026-11-15T10:40:00.000Z');
    await damage('printed-1', '2026-11-15T10:41:00.000Z');
    await damage('printed-1', '2026-11-15T10:41:30.000Z');
    h.setNow('2026-11-15T10:42:00.000Z');
    expect(await fulfillStripeWebhook(legacyTenant, printedPaid({ eventId: 'evt_oos_c1', session: 'cs_live_golden1', snapshotId: firstSnapshot, paymentIntentId: 'pi_oos_c1' }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));
    expect(await fulfillStripeWebhook(legacyTenant, printedPaid({ eventId: 'evt_oos_c2', session: 'cs_live_golden2', snapshotId: secondSnapshot, paymentIntentId: 'pi_oos_c2' }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));
    expect((await tenantRows()).refundJobs.map((job) => job.status)).toStrictEqual(['pending', 'pending']);

    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const first = refundDispatcher(h, gate);
    const second = refundDispatcher(h, gate);
    const running = Promise.all([first.run(), second.run()]);
    for (let wait = 0; wait < 200 && first.calls.length + second.calls.length < 2; wait += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    open();
    const results = await running;

    const calls = [...first.calls, ...second.calls];
    expect(calls.map((call) => call.paymentIntentId).toSorted()).toStrictEqual(['pi_oos_c1', 'pi_oos_c2']);
    expect(results.map((result) => (result.ok ? result.value.processedCount : -1)).reduce((sum, count) => sum + count, 0)).toBe(2);
    expect((await tenantRows()).refundJobs.map((job) => [job.status, job.attempts])).toStrictEqual([['succeeded', 1], ['succeeded', 1]]);
    expect(await refundDispatcher(h).run()).toStrictEqual(ok({ processedCount: 0, outcomes: {} }));
  });
});

const chargeAdjustment = (input: { eventId: string; paymentIntentId: string; amountCents: number; type?: 'charge.refunded' | 'charge.dispute.created' }): PaymentWebhookEvent => ({
  id: input.eventId, type: input.type ?? 'charge.refunded', objectId: `ch_${input.paymentIntentId}`, tenantIds: ['tenant-a'], livemode: true, checkoutSession: null,
  adjustment: {
    chargeId: `ch_${input.paymentIntentId}`, paymentIntentId: input.paymentIntentId, invoiceId: null,
    ...(input.type === 'charge.dispute.created' ? {} : { refund: { full: true, amountRefundedCents: input.amountCents, amountCents: input.amountCents } }),
  },
});

const owner = { userId: 'owner', email: 'owner@example.com', staffRole: 'owner' as const, language: 'en' as const };

const providerCalls = (h: Harness, created: ProviderRefund | 'permission_missing', staff: Array<typeof owner> = [], listed: ProviderRefund[] = []) => {
  const calls: string[] = [];
  const deps = {
    ...h.webhookDeps,
    refundJobs: createOrderRefundJobRepository(database.db),
    orderDetails: createOrderRepository(database.db),
    tenantAccess: { listStaffForTenant: async () => staff },
    payment: {
      createRefund: async (input: RefundInput) => {
        calls.push(`create:${input.idempotencyKey}`);
        return created === 'permission_missing' ? err(refundFailure('permission_missing', 'The key lacks the refund permission')) : ok(created);
      },
      getRefund: async (input: { refundId: string }) => {
        calls.push(`get:${input.refundId}`);
        return ok<ProviderRefund>({ refundId: input.refundId, paymentIntentId: null, amountCents: 0, status: 'pending', failureReason: null, orderId: null, reason: null });
      },
      listRefunds: async () => ok(listed),
    },
  };
  return { calls, run: () => dispatchOrderRefundJobs(deps) };
};

const cancelBundle = async (h: Harness) => {
  await track('course-1', 5);
  await track('poster-1', 1);
  const snapshotId = await publicCheckout(h, { productId: 'course-1', salesLinkId: 'link-1', email: 'buyer@example.com', termsAccepted: true });
  await sweep(h, '2026-11-15T10:40:00.000Z');
  await damage('poster-1', '2026-11-15T10:41:00.000Z');
  h.setNow('2026-11-15T10:42:00.000Z');
  expect(await fulfillStripeWebhook(legacyTenant, bundlePaid(snapshotId), h.webhookDeps)).toStrictEqual(ok({ processed: true }));
  const [cancelled] = await database.db.select({ id: orders.id, memberId: orders.memberId }).from(orders).where(eq(orders.tenantId, legacyTenant.id));
  if (cancelled === undefined) throw new Error('Expected the cancelled order');
  return cancelled;
};

const grantCourse = (memberId: string, source: 'manual' | 'stripe') => database.db.insert(productGrants).values({
  id: `grant-${source}`, tenantId: legacyTenant.id, memberId, productId: 'course-1', source, mode: 'live', createdAt: '2026-11-01T09:00:00.000Z',
});

const recordCoursePurchase = (memberId: string, id: string) => createOrderRepository(database.db).create(legacyTenant.id, {
  id, tenantId: legacyTenant.id, memberId, productId: 'course-1', priceId: null, mode: 'live', kind: 'one_time', status: 'paid', amountCents: 4900, currency: 'PLN',
  provider: 'stripe', providerObjectIds: { paymentIntent: `pi_${id}` }, couponId: null, discountCents: 0, createdAt: '2026-11-01T09:00:00.000Z',
});

const courseGrant = async () => (await database.db.select({ source: productGrants.source, expiresAt: productGrants.expiresAt }).from(productGrants)
  .where(eq(productGrants.tenantId, legacyTenant.id)));

const refundJobOf = (orderId: string) => createOrderRefundJobRepository(database.db).findByOrderId(legacyTenant.id, orderId);

describe('a refund or dispute of an order cancelled out of stock', () => {
  it.each(['manual', 'stripe'] as const)('keeps a course the member holds through a %s grant when the cancelled order is refunded', async (source) => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    if (source === 'stripe') await recordCoursePurchase(cancelled.memberId, 'course-purchase');
    await grantCourse(cancelled.memberId, source);
    h.setNow('2026-11-15T11:00:00.000Z');

    expect(await fulfillStripeWebhook(legacyTenant, chargeAdjustment({ eventId: 'evt_refund_cancelled', paymentIntentId: 'pi_oos_bundle', amountCents: 8400 }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));

    expect(await courseGrant()).toStrictEqual([{ source, expiresAt: null }]);
    expect((await tenantRows()).orders.find((order) => order.id === cancelled.id)).toMatchObject({ status: 'refunded', cancelReason: 'out_of_stock' });
  });

  it('keeps a course held through a manual grant when the cancelled order is disputed', async () => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    await grantCourse(cancelled.memberId, 'manual');

    expect(await fulfillStripeWebhook(legacyTenant, chargeAdjustment({ eventId: 'evt_dispute_cancelled', paymentIntentId: 'pi_oos_bundle', amountCents: 8400, type: 'charge.dispute.created' }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));

    expect(await courseGrant()).toStrictEqual([{ source: 'manual', expiresAt: null }]);
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'pending' });
  });

  it('revokes a course when its only real purchase is refunded while a cancelled order for it waits on a blocked refund', async () => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    expect(await providerCalls(h, 'permission_missing').run()).toStrictEqual(ok({ processedCount: 1, outcomes: { blocked_permission: 1 } }));
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'blocked_permission' });
    await recordCoursePurchase(cancelled.memberId, 'course-purchase');
    await grantCourse(cancelled.memberId, 'stripe');
    h.setNow('2026-11-15T11:00:00.000Z');

    expect(await fulfillStripeWebhook(legacyTenant, chargeAdjustment({ eventId: 'evt_refund_real', paymentIntentId: 'pi_course-purchase', amountCents: 4900 }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));

    expect(await courseGrant()).toStrictEqual([{ source: 'stripe', expiresAt: '2026-11-15T11:00:00.000Z' }]);
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'blocked_permission' });
  });

  it('resolves a refund job that never called Stripe when the cancelled order is refunded by hand and never calls Stripe for it again', async () => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'pending', attempts: 0 });
    h.setNow('2026-11-15T11:00:00.000Z');

    expect(await fulfillStripeWebhook(legacyTenant, chargeAdjustment({ eventId: 'evt_refund_by_hand', paymentIntentId: 'pi_oos_bundle', amountCents: 8400 }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));

    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'resolved_externally', nextAttemptAt: null, lockedAt: null, updatedAt: '2026-11-15T11:00:00.000Z' });
    expect((await createOrderRepository(database.db).list(legacyTenant.id, { page: 1, pageSize: 20 })).orders)
      .toStrictEqual([expect.objectContaining({ id: cancelled.id, status: 'refunded', refundJobStatus: 'resolved_externally' })]);
    expect(h.warnings).toContain(`[order-refund] resolved externally tenant=tenant-a order=${cancelled.id} job=${(await refundJobOf(cancelled.id))?.id ?? ''} event=evt_refund_by_hand`);
    const dispatcher = providerCalls(h, { refundId: 're_never', paymentIntentId: 'pi_oos_bundle', amountCents: 8400, status: 'succeeded', failureReason: null, orderId: null, reason: null });
    for (const now of ['2026-11-15T11:01:00.000Z', '2026-11-16T12:00:00.000Z', '2026-11-25T12:00:00.000Z']) {
      h.setNow(now);
      expect(await dispatcher.run()).toStrictEqual(ok({ processedCount: 0, outcomes: {} }));
    }
    expect(dispatcher.calls).toStrictEqual([]);
  });

  it('leaves a blocked refund job to its next hourly attempt when the order is refunded by hand, which ends it as skipped_refunded without a refund call', async () => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    const blocked = providerCalls(h, 'permission_missing');
    await blocked.run();
    h.setNow('2026-11-15T11:00:00.000Z');

    expect(await fulfillStripeWebhook(legacyTenant, chargeAdjustment({ eventId: 'evt_refund_by_hand', paymentIntentId: 'pi_oos_bundle', amountCents: 8400 }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'blocked_permission', nextAttemptAt: '2026-11-15T11:42:00.000Z' });

    h.setNow('2026-11-15T11:42:00.000Z');
    const byHand: ProviderRefund = { refundId: 're_by_hand', paymentIntentId: 'pi_oos_bundle', amountCents: 8400, status: 'succeeded', failureReason: null, orderId: null, reason: null };
    const listing = providerCalls(h, 'permission_missing', [], [byHand]);
    expect(await listing.run()).toStrictEqual(ok({ processedCount: 1, outcomes: { skipped_refunded: 1 } }));
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'skipped_refunded', nextAttemptAt: null, providerRefundId: null });
    expect([...blocked.calls, ...listing.calls]).toStrictEqual([`create:oos-refund-${cancelled.id}`]);
  });

  it('claims a blocked refund again an hour later and sends the next key generation', async () => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    const blocked = providerCalls(h, 'permission_missing');
    expect(await blocked.run()).toStrictEqual(ok({ processedCount: 1, outcomes: { blocked_permission: 1 } }));
    expect(await refundJobOf(cancelled.id)).toMatchObject({
      status: 'blocked_permission', keyGeneration: 1, permissionBlockedAt: '2026-11-15T10:42:00.000Z', nextAttemptAt: '2026-11-15T11:42:00.000Z',
    });
    h.setNow('2026-11-15T11:41:59.000Z');
    expect(await blocked.run()).toStrictEqual(ok({ processedCount: 0, outcomes: {} }));

    h.setNow('2026-11-15T11:42:00.000Z');
    const paying = providerCalls(h, { refundId: 're_after_permission', paymentIntentId: 'pi_oos_bundle', amountCents: 8400, status: 'succeeded', failureReason: null, orderId: null, reason: null });
    expect(await paying.run()).toStrictEqual(ok({ processedCount: 1, outcomes: { refunded: 1 } }));

    expect([...blocked.calls, ...paying.calls]).toStrictEqual([`create:oos-refund-${cancelled.id}`, `create:oos-refund-${cancelled.id}-1`]);
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'succeeded', attempts: 2, keyGeneration: 1, permissionBlockedAt: null, providerRefundId: 're_after_permission' });
  });

  it('commits a blocked refund only together with its staff alert and queues that alert exactly once', async () => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    const jobId = (await refundJobOf(cancelled.id))?.id ?? '';
    const refundAlerts = async () => (await database.db.select({ id: emailOutbox.id, to: emailOutbox.to }).from(emailOutbox)
      .where(eq(emailOutbox.tenantId, legacyTenant.id)).orderBy(asc(emailOutbox.id))).filter((row) => row.id.startsWith('order-refund-alert:'));
    const takenId = `order-refund-alert:${jobId}:blocked_permission:1:0`;
    await database.db.insert(emailOutbox).values({
      id: takenId, tenantId: legacyTenant.id, kind: 'order-refund-alert', to: 'someone-else@example.com', payload: {},
      nextAttemptAt: '2026-11-15T10:00:00.000Z', createdAt: '2026-11-15T10:00:00.000Z',
    });
    const blocked = providerCalls(h, 'permission_missing', [owner]);

    expect(await blocked.run()).toStrictEqual(ok({ processedCount: 1, outcomes: { deferred: 1 } }));
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'pending', attempts: 1, permissionBlockedAt: null, keyGeneration: 0, nextAttemptAt: '2026-11-15T10:43:00.000Z', lockedAt: null });
    expect(await refundAlerts()).toStrictEqual([{ id: takenId, to: 'someone-else@example.com' }]);

    await database.db.delete(emailOutbox).where(eq(emailOutbox.id, takenId));
    h.setNow('2026-11-15T10:43:00.000Z');
    expect(await blocked.run()).toStrictEqual(ok({ processedCount: 1, outcomes: { blocked_permission: 1 } }));
    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'blocked_permission', attempts: 2, permissionBlockedAt: '2026-11-15T10:43:00.000Z' });
    expect(await refundAlerts()).toStrictEqual([{ id: `order-refund-alert:${jobId}:blocked_permission:2:0`, to: 'owner@example.com' }]);
  });

  it('leaves a running refund attempt its lease when the charge is reported refunded, so the attempt saves the refund it made', async () => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    const repository = createOrderRefundJobRepository(database.db);
    const claim = await repository.claimDue({ now: '2026-11-15T10:42:00.000Z', leaseMs: 600_000 });
    expect(claim).toMatchObject({ phase: 'refund', job: { status: 'running', providerRefundId: null } });
    h.setNow('2026-11-15T10:43:00.000Z');

    expect(await fulfillStripeWebhook(legacyTenant, chargeAdjustment({ eventId: 'evt_refund_while_running', paymentIntentId: 'pi_oos_bundle', amountCents: 8400 }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));

    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'running', lockedAt: '2026-11-15T10:42:00.000Z' });
    if (claim === null) throw new Error('Expected a claimed job');
    expect(await repository.release(legacyTenant.id, claim.job.id, claim.lease, { status: 'succeeded', providerRefundId: 're_ours', now: '2026-11-15T10:44:00.000Z' }))
      .toMatchObject({ status: 'succeeded', providerRefundId: 're_ours' });
  });

  it('leaves a submitted refund with its scheduled status reads when the charge is reported refunded', async () => {
    const h = harness();
    const cancelled = await cancelBundle(h);
    const submitting = providerCalls(h, { refundId: 're_pending', paymentIntentId: 'pi_oos_bundle', amountCents: 8400, status: 'pending', failureReason: null, orderId: null, reason: null });
    expect(await submitting.run()).toStrictEqual(ok({ processedCount: 1, outcomes: { submitted: 1 } }));
    h.setNow('2026-11-15T10:43:00.000Z');

    expect(await fulfillStripeWebhook(legacyTenant, chargeAdjustment({ eventId: 'evt_refund_submitted', paymentIntentId: 'pi_oos_bundle', amountCents: 8400 }), h.webhookDeps))
      .toStrictEqual(ok({ processed: true }));

    expect(await refundJobOf(cancelled.id)).toMatchObject({ status: 'submitted', providerRefundId: 're_pending', nextAttemptAt: '2026-11-16T10:42:00.000Z' });
  });
});
