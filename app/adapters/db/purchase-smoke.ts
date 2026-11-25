import { and, count, eq, gte, notExists, sql } from 'drizzle-orm';

import { purchaseSmokeCheckoutSchema, purchaseSmokeReceiptSchema, purchaseSmokeResultSchema } from '#core/domain/index.js';
import type { PurchaseSmokeRepository } from '#core/server/purchase-smoke-ports.js';

import type { Db } from './client.js';
import { orders } from './schema.js';
import { purchaseSmokeCheckouts, purchaseSmokeReceipts } from './purchase-smoke-schema.js';

export const createPurchaseSmokeRepository = (db: Db): PurchaseSmokeRepository => ({
  hasCheckout: async (tenantId, sessionId) => {
    const [row] = await db.select({ reference: purchaseSmokeCheckouts.reference }).from(purchaseSmokeCheckouts)
      .where(and(eq(purchaseSmokeCheckouts.tenantId, tenantId), eq(purchaseSmokeCheckouts.sessionId, sessionId))).limit(1);
    return row !== undefined;
  },
  findRun: async (tenantId, apiKeyId, input) => {
    const [row] = await db.select().from(purchaseSmokeCheckouts).where(and(
      eq(purchaseSmokeCheckouts.tenantId, tenantId), eq(purchaseSmokeCheckouts.apiKeyId, apiKeyId),
      eq(purchaseSmokeCheckouts.runId, input.runId), eq(purchaseSmokeCheckouts.scenario, input.scenario),
    )).limit(1);
    return row === undefined ? null : purchaseSmokeCheckoutSchema.parse(row);
  },
  countSince: async (tenantId, since) => {
    const [row] = await db.select({ count: count() }).from(purchaseSmokeCheckouts)
      .where(and(eq(purchaseSmokeCheckouts.tenantId, tenantId), gte(purchaseSmokeCheckouts.createdAt, since)));
    return row?.count ?? 0;
  },
  create: async (tenantId, apiKeyId, checkout, createdAt) => {
    await db.insert(purchaseSmokeCheckouts).values({ ...purchaseSmokeCheckoutSchema.parse(checkout), tenantId, apiKeyId, createdAt });
  },
  result: async (tenantId, apiKeyId, reference) => {
    const [checkout] = await db.select().from(purchaseSmokeCheckouts).where(and(
      eq(purchaseSmokeCheckouts.tenantId, tenantId), eq(purchaseSmokeCheckouts.apiKeyId, apiKeyId),
      eq(purchaseSmokeCheckouts.reference, reference),
    )).limit(1);
    if (checkout === undefined) return null;
    const [order] = await db.select({ status: orders.status }).from(orders).where(and(
      eq(orders.tenantId, tenantId), eq(orders.mode, 'test'),
      sql`${orders.providerObjectIds}->>'checkoutSession' = ${checkout.sessionId}`,
    )).limit(1);
    if (order === undefined) return null;
    const receipts = (await db.select().from(purchaseSmokeReceipts).where(and(
      eq(purchaseSmokeReceipts.tenantId, tenantId), eq(purchaseSmokeReceipts.reference, reference),
    ))).map(({ receipt }) => purchaseSmokeReceiptSchema.parse(receipt))
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.eventId.localeCompare(b.eventId));
    return purchaseSmokeResultSchema.parse({
      ...checkout,
      paid: ['paid', 'partially_refunded', 'refunded'].includes(order.status),
      refundState: order.status === 'refunded' ? 'full' : order.status === 'partially_refunded' ? 'partial' : 'none',
      refundedAmountCents: Math.max(0, ...receipts.map((receipt) => receipt.refundedAmountCents ?? 0)),
      receipts,
    });
  },
  recordAppliedEvent: async (tenantId, sessionId, receipt, refundAdvance) => {
    const findCheckout = db.select({ reference: purchaseSmokeCheckouts.reference }).from(purchaseSmokeCheckouts)
      .where(and(eq(purchaseSmokeCheckouts.tenantId, tenantId), eq(purchaseSmokeCheckouts.sessionId, sessionId))).limit(1);
    const [checkout] = await (receipt.type === 'charge.refunded' ? findCheckout.for('no key update') : findCheckout);
    if (checkout === undefined) return;
    const parsed = purchaseSmokeReceiptSchema.parse(receipt);
    if (refundAdvance !== undefined) {
      const amount = parsed.refundedAmountCents;
      if (amount === null || amount === 0) return;
      const [advanced] = await db.select({ id: orders.id }).from(orders).where(and(
        eq(orders.tenantId, tenantId), eq(orders.id, refundAdvance.orderId), eq(orders.mode, 'test'),
        eq(orders.status, refundAdvance.status), sql`${orders.providerObjectIds}->>'checkoutSession' = ${sessionId}`,
        notExists(db.select({ eventId: purchaseSmokeReceipts.eventId }).from(purchaseSmokeReceipts).where(and(
          eq(purchaseSmokeReceipts.tenantId, tenantId), eq(purchaseSmokeReceipts.reference, checkout.reference),
          sql`(${purchaseSmokeReceipts.receipt}->>'refundedAmountCents')::numeric >= ${amount}`,
        ))),
      ));
      if (advanced === undefined) return;
    }
    await db.insert(purchaseSmokeReceipts).values({ tenantId, reference: checkout.reference, eventId: parsed.eventId, receipt: parsed })
      .onConflictDoNothing();
  },
});
