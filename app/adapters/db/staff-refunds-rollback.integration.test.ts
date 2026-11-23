import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refundFailure, type Identity, type OrderShipping, type ProviderRefund } from '#core/domain/index.js';
import { createStaffRefund, dispatchOrderRefundJobs, shipRefundedOrderAnyway, type Ctx } from '#core/server/index.js';
import { createRefundProviderFake } from '#core/server/testing/refund-provider-fake.js';
import { createInMemoryTenantDomainRepository } from '#core/server/testing/tenant-domain-fakes.js';

import { createOrderStaffRefundRepository } from './order-staff-refunds.js';
import { createRefundJobQueue } from './refund-job-queue.js';
import { createMemberRepository, createOrderRepository } from './repositories.js';
import {
  emailOutbox, members, notifications, orderChanges, orderRefundJobs, orders, orderStaffRefunds, products, productStock, stockEvents, tenantAuditEvents, tenants, user,
} from './schema.js';
import { createTestDatabase } from './test-database-name.js';

// Literal copies of what the release on production (8141fd15) parses; they must not follow this release's schemas.
const previousOrderRefundJobReasons = ['out_of_stock'] as const;
const previousOrderRefundJobStatuses = ['pending', 'running', 'submitted', 'succeeded', 'failed', 'blocked_permission', 'skipped_refunded', 'resolved_externally', 'unconfirmed'] as const;
const previousOrderStatuses = ['paid', 'pending', 'failed', 'refunded', 'partially_refunded'] as const;
const previousOrderCancelReasons = ['out_of_stock'] as const;
const previousFulfilmentStatuses = ['to_pack', 'shipped'] as const;
const previousStockEventTypes = ['tracking_enabled', 'adjusted', 'reserved', 'released', 'committed', 'committed_late', 'oversold', 'returned'] as const;
const previousEmailPayloadKinds = [
  'auth-email-verification', 'auth-magic-link', 'auth-password-reset', 'direct-message', 'lesson-question', 'm2m-transactional', 'magic-link',
  'marketing-consent-confirmation', 'member-erasure-request', 'order-out-of-stock', 'order-refund-alert', 'order-shipped', 'order-sold-out-refund',
  'reputation-alert', 'reset-password', 'space-event', 'space-post', 'stock-low', 'subscription-ended', 'subscription-payment-failed',
  'support-message', 'thread-reply', 'verify-email', 'welcome-sign-in',
] as const;
const previousRefundAlerts = ['retrying', 'blocked_permission', 'blocked_permission_failed', 'failed', 'failed_after_submission', 'unconfirmed'] as const;
// adapters/db may not import zod, so the previous release's schemas are spelled out check by check; their literal zod
// copies run against the same builders in core/domain/staff-refund-rollback.test.ts.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isUrl = (value: unknown): boolean => typeof value === 'string' && URL.canParse(value);
const stringOfLength = (value: unknown, min: number, max: number): boolean => typeof value === 'string' && value.length >= min && value.length <= max;

// z.object({ kind: z.literal('order-refund-alert'), language: z.string(), tenantName: z.string(), alert: z.enum(ORDER_REFUND_ALERTS),
//   orderId: z.string().min(1), amountCents: z.number().int().nonnegative(), currency: currencySchema, error: z.string(), orderUrl: z.string().url() })
const previousRefundAlertParses = (payload: unknown): boolean => isRecord(payload)
  && payload['kind'] === 'order-refund-alert'
  && typeof payload['language'] === 'string'
  && typeof payload['tenantName'] === 'string'
  && listed(previousRefundAlerts, payload['alert'])
  && typeof payload['orderId'] === 'string' && payload['orderId'].length >= 1
  && typeof payload['amountCents'] === 'number' && Number.isInteger(payload['amountCents']) && payload['amountCents'] >= 0
  && typeof payload['currency'] === 'string' && /^[A-Z]{3}$/.test(payload['currency'])
  && typeof payload['error'] === 'string'
  && isUrl(payload['orderUrl']);

// z.object({ kind: z.literal('m2m-transactional'), subject: z.string().trim().min(1).max(200), html: z.string().min(1).max(1_000_000).optional(),
//   text: z.string().min(1).max(500_000).optional(), replyTo: z.string().email().optional() }).strict(), then the render branch that needs html or text.
const previousM2mKeys = ['kind', 'subject', 'html', 'text', 'replyTo'] as const;
const previousRenderM2m = (payload: unknown): { subject: string; html: unknown; text: unknown } | null => {
  if (!isRecord(payload) || payload['kind'] !== 'm2m-transactional' || !Object.keys(payload).every((key) => listed(previousM2mKeys, key))) return null;
  const { subject, html, text, replyTo } = payload;
  if (typeof subject !== 'string' || !stringOfLength(subject.trim(), 1, 200)) return null;
  if ((html !== undefined && !stringOfLength(html, 1, 1_000_000)) || (text !== undefined && !stringOfLength(text, 1, 500_000))) return null;
  if (replyTo !== undefined && !(typeof replyTo === 'string' && replyTo.includes('@'))) return null;
  if (html === undefined && text === undefined) return null;
  return { subject: subject.trim(), html, text };
};
// The tables holding this test's rows, in the order the previous release's demo and smoke reseed wipes them; its list has no order_staff_refunds.
const previousReseedWipeOrder = ['order_refund_jobs', 'stock_events', 'product_stock', 'order_changes', 'email_outbox', 'orders'] as const;

const listed = (values: readonly string[], value: unknown): boolean => values.some((candidate) => candidate === value);

// What the previous Sent e-mails reader keeps of a row: kinds outside its union are dropped after the page is fetched.
const previousRenders = (row: { kind: string; payload: unknown }): boolean =>
  row.kind === 'm2m-transactional' ? previousRenderM2m(row.payload) !== null : listed(previousEmailPayloadKinds, row.kind);

// The previous transactional Sent page: limit + 1 rows newest first, unrenderable rows dropped, the cursor taken from what is left.
const previousSentPage = async (tenantId: string, limit: number, cursor: { createdAt: string; key: string } | undefined) => {
  const filters = [eq(emailOutbox.tenantId, tenantId)];
  if (cursor !== undefined) {
    filters.push(or(
      lt(emailOutbox.createdAt, cursor.createdAt),
      and(eq(emailOutbox.createdAt, cursor.createdAt), sql`(${'transactional:'} || ${emailOutbox.id}) < ${cursor.key}`),
    ) ?? sql`false`);
  }
  const rows = await database.db.select().from(emailOutbox)
    .where(and(...filters))
    .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
    .limit(limit + 1);
  const kept = rows.filter(previousRenders);
  const sends = kept.slice(0, limit);
  const lastSend = sends.at(-1);
  return {
    ids: sends.map((send) => send.id),
    nextCursor: kept.length > limit && lastSend !== undefined
      ? { createdAt: new Date(lastSend.createdAt).toISOString(), key: `transactional:${lastSend.id}` }
      : undefined,
  };
};

const previousSoldOutOwnRefund = (job: { orderId: string; reason: 'out_of_stock'; providerRefundId: string | null }, refund: ProviderRefund): boolean =>
  refund.refundId === job.providerRefundId || (refund.orderId === job.orderId && refund.reason === job.reason);

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const start = '2026-11-22T10:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const shipping: OrderShipping = {
  rateId: 'courier', label: 'Courier', amountCents: 1999, vatRatePercent: 8, carrier: 'other', pickupPoint: null,
  address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' }, phone: null,
};

const owner: Ctx = {
  identity: {
    userId: 'staff-a', email: 'owner@tenant-a.example.com', name: 'Owner', emailVerified: true, tenantAccess: 'staff', tenantId: 'tenant-a',
    tenantSlug: 'tenant-a', tenantName: 'tenant-a', staffRole: 'owner', memberId: null, image: null, memberDisplayName: null, memberBannedAt: null,
    memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  } satisfies Identity,
};

beforeAll(async () => {
  database = await createTestDatabase('together_staff_refunds_rollback', baseDatabaseUrl);
  await database.db.insert(tenants).values({ id: 'tenant-a', slug: 'tenant-a', name: 'Workspace A', createdAt: start });
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'member-a', tenantId: 'tenant-a', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: start });
  await database.db.insert(products).values({ id: 'book', tenantId: 'tenant-a', type: 'physical', description: '', slug: 'book', title: 'Book', priceCents: 4099, currency: 'PLN', published: true, createdAt: start });
  for (const id of ['order-full', 'order-partial', 'order-failing']) {
    await database.db.insert(orders).values({
      id, tenantId: 'tenant-a', memberId: 'member-a', productId: 'book', kind: 'one_time', status: 'paid', amountCents: 4099, currency: 'PLN',
      provider: 'stripe', providerObjectIds: { paymentIntent: `pi_${id}` }, shipping, fulfilmentStatus: 'to_pack', createdAt: start,
    });
  }
  await database.db.insert(productStock).values({ tenantId: 'tenant-a', productId: 'book', onHand: 3, reserved: 0, updatedAt: start });
  await database.db.insert(stockEvents).values({ tenantId: 'tenant-a', productId: 'book', type: 'committed', quantity: -1, reference: { orderId: 'order-full' }, occurredAt: start });

  let now = start;
  let sequence = 0;
  const steps = [{ outcome: 'refund' as const }, { outcome: 'refund' as const }, { outcome: 'error' as const, error: refundFailure('refund_failed', 'Refund declined') }];
  const provider = createRefundProviderFake({ chargeAmountCents: 4099, steps });
  const logger = { warn: () => undefined, error: () => undefined };
  const orderDetails = createOrderRepository(database.db);
  const staffRefunds = createOrderStaffRefundRepository(database.db);
  const deps = { orderDetails, staffRefunds, payment: provider.payment, ids: { nextId: () => { sequence += 1; return `refund-${String(sequence)}`; } }, clock: { nowIso: () => now }, logger };
  for (const [orderId, body] of [['order-full', { requestKey: 'req-full', expectedAmountCents: 4099 }], ['order-partial', { requestKey: 'req-partial', amountCents: 1000 }], ['order-failing', { requestKey: 'req-failing', expectedAmountCents: 4099 }]] as const) {
    const created = await createStaffRefund(owner, orderId, body, deps);
    if (!created.ok) throw new Error(created.error.message);
  }
  now = '2026-11-22T10:01:00.000Z';
  const dispatched = await dispatchOrderRefundJobs({
    refundJobs: createRefundJobQueue(database.db), orderDetails, members: createMemberRepository(database.db), payment: provider.payment,
    tenants: { findById: async () => ({ id: 'tenant-a', slug: 'acme', name: 'Acme', status: 'active' as const, plan: 'hosted' as const, contentVersion: 1 }), findSettings: async () => null },
    tenantAccess: { listStaffForTenant: async () => [{ userId: 'staff-a', email: 'owner@tenant-a.example.com', staffRole: 'owner' as const, language: 'en' as const }] },
    tenantDomains: createInMemoryTenantDomainRepository(), clock: { nowIso: () => now }, logger, dispatchEmail: () => undefined,
    appBaseUrl: 'https://togethercommunity.app', baseDomain: 'togethercommunity.app', singleTenantMode: false,
  });
  if (!dispatched.ok || dispatched.value.processedCount !== 3) throw new Error('Expected three staff refunds to be dispatched');
  await database.db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, 'order-full'));
  await database.db.update(orders).set({ status: 'partially_refunded' }).where(eq(orders.id, 'order-partial'));
  const shipped = await shipRefundedOrderAnyway(owner, 'order-full', deps);
  if (!shipped.ok) throw new Error(shipped.error.message);
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('rows written by staff refunds, read by the previous release', () => {
  it('leaves order_refund_jobs, the only refund table the previous release reads, without a row', async () => {
    const rows = await database.db.select({ reason: orderRefundJobs.reason, status: orderRefundJobs.status }).from(orderRefundJobs);
    expect(rows).toStrictEqual([]);
    expect(rows.every((row) => listed(previousOrderRefundJobReasons, row.reason) && listed(previousOrderRefundJobStatuses, row.status))).toBe(true);
  });

  it('writes only order status, cancel reason and fulfilment values the previous release parses', async () => {
    const rows = await database.db.select({ id: orders.id, status: orders.status, cancelReason: orders.cancelReason, fulfilmentStatus: orders.fulfilmentStatus }).from(orders);
    expect(rows.toSorted((left, right) => left.id.localeCompare(right.id))).toStrictEqual([
      { id: 'order-failing', status: 'paid', cancelReason: null, fulfilmentStatus: null },
      { id: 'order-full', status: 'refunded', cancelReason: null, fulfilmentStatus: 'to_pack' },
      { id: 'order-partial', status: 'partially_refunded', cancelReason: null, fulfilmentStatus: 'to_pack' },
    ]);
    for (const row of rows) {
      expect(listed(previousOrderStatuses, row.status)).toBe(true);
      expect(row.cancelReason === null || listed(previousOrderCancelReasons, row.cancelReason)).toBe(true);
      expect(row.fulfilmentStatus === null || listed(previousFulfilmentStatuses, row.fulfilmentStatus)).toBe(true);
    }
  });

  it('writes only stock event types the previous release knows', async () => {
    const rows = await database.db.select({ type: stockEvents.type, reference: stockEvents.reference }).from(stockEvents);
    expect(rows.every((row) => listed(previousStockEventTypes, row.type))).toBe(true);
    expect(rows).toContainEqual({ type: 'returned', reference: { orderId: 'order-full', reason: 'staff_refund' } });
  });

  it('queues staff alerts and buyer notices the previous release parses and renders', async () => {
    const rows = await database.db.select({ id: emailOutbox.id, kind: emailOutbox.kind, payload: emailOutbox.payload }).from(emailOutbox);
    expect(rows.filter((row) => !listed(previousEmailPayloadKinds, row.kind))).toStrictEqual([]);
    const alerts = rows.filter((row) => row.kind === 'order-refund-alert');
    expect(alerts).toHaveLength(1);
    for (const alert of alerts) expect(previousRefundAlertParses(alert.payload)).toBe(true);
    const notices = rows.filter((row) => row.id.startsWith('order-refund-issued:'));
    expect(notices.map((row) => row.kind)).toStrictEqual(['m2m-transactional', 'm2m-transactional']);
    for (const notice of notices) {
      expect(previousRenderM2m(notice.payload)).toStrictEqual({ subject: expect.stringContaining('Acme'), html: expect.any(String), text: expect.any(String) });
    }
  });

  it('lets the previous Sent e-mails list page past the buyer notices to every older e-mail', async () => {
    const all = await database.db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.tenantId, 'tenant-a'));
    expect(all.length).toBeGreaterThan(2);
    const seen: string[] = [];
    let cursor: { createdAt: string; key: string } | undefined;
    for (let page = 0; page < all.length + 1; page += 1) {
      const result = await previousSentPage('tenant-a', 1, cursor);
      seen.push(...result.ids);
      cursor = result.nextCursor;
      if (cursor === undefined) break;
    }
    expect(seen.toSorted()).toStrictEqual(all.map((row) => row.id).toSorted());
  });

  it('writes no audit event and no notification', async () => {
    expect(await database.db.select().from(tenantAuditEvents)).toStrictEqual([]);
    expect(await database.db.select().from(notifications)).toStrictEqual([]);
  });

  it('logs each staff refund change on the order feed with the columns the previous release reads', async () => {
    const rows = await database.db.select().from(orderChanges);
    expect(new Set(rows.map((row) => row.orderId))).toStrictEqual(new Set(['order-full', 'order-partial', 'order-failing']));
    expect(Object.keys(rows[0] ?? {}).toSorted()).toStrictEqual(['changedAt', 'id', 'orderId', 'tenantId', 'xactId']);
  });

  it('tags provider refunds so a previous-release sold-out job counts them as money but never takes them as its own', () => {
    const staffRefund: ProviderRefund = { refundId: 're_staff', paymentIntentId: 'pi_1', amountCents: 1000, status: 'succeeded', failureReason: null, orderId: 'order-1', reason: 'staff', refundJobId: 'refund-1' };
    expect(previousSoldOutOwnRefund({ orderId: 'order-1', reason: 'out_of_stock', providerRefundId: null }, staffRefund)).toBe(false);
  });

  it("lets the previous release's reseed delete orders that hold staff refunds, which go with them", async () => {
    class RolledBack extends Error {
      constructor(readonly remaining: unknown[]) { super('Rolled back'); }
    }
    const left = await database.db.transaction(async (tx) => {
      expect((await tx.select().from(orderStaffRefunds)).length).toBeGreaterThan(0);
      for (const table of previousReseedWipeOrder) await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = 'tenant-a'`);
      throw new RolledBack(await tx.select({ id: orderStaffRefunds.id }).from(orderStaffRefunds));
    }).catch((error: unknown) => {
      if (error instanceof RolledBack) return error.remaining;
      throw error;
    });
    expect(left).toStrictEqual([]);
    expect((await database.db.select().from(orders)).length).toBe(3);
  });
});
