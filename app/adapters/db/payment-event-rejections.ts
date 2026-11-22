import { and, desc, eq, isNull, notExists, sql } from 'drizzle-orm';

import { paymentEventRejectionSchema, type PaymentEventRejection } from '#core/domain/index.js';
import type { PaymentEventRejectionRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { orders } from './app-schema.js';
import { paymentEventRejections } from './payment-event-rejection-schema.js';

const toRejection = (row: typeof paymentEventRejections.$inferSelect): PaymentEventRejection => paymentEventRejectionSchema.parse({
  ...row,
  firstSeenAt: new Date(row.firstSeenAt).toISOString(),
  lastSeenAt: new Date(row.lastSeenAt).toISOString(),
  resolvedAt: row.resolvedAt === null ? null : new Date(row.resolvedAt).toISOString(),
});

const liveOrderOfSession = (db: Db) => db.select({ id: orders.id }).from(orders).where(and(
  eq(orders.tenantId, paymentEventRejections.tenantId),
  eq(orders.mode, 'live'),
  sql`${orders.providerObjectIds} ->> 'checkoutSession' = ${paymentEventRejections.checkoutSessionId}`,
));

export const createPaymentEventRejectionRepository = (db: Db): PaymentEventRejectionRepository => ({
  record: async (tenantId, { seenAt, ...rejection }) => {
    const [row] = await db.insert(paymentEventRejections)
      .values({ tenantId, ...rejection, firstSeenAt: seenAt, lastSeenAt: seenAt, attempts: 1, resolvedAt: null })
      .onConflictDoUpdate({
        target: [paymentEventRejections.tenantId, paymentEventRejections.eventId],
        set: {
          eventType: rejection.eventType,
          checkoutSessionId: rejection.checkoutSessionId,
          reasonCode: rejection.reasonCode,
          reasonMessage: rejection.reasonMessage,
          lastSeenAt: seenAt,
          attempts: sql`${paymentEventRejections.attempts} + 1`,
          resolvedAt: null,
        },
      })
      .returning();
    if (row === undefined) throw new Error('Payment event rejection upsert returned no row');
    return toRejection(row);
  },
  resolve: async (tenantId, eventId, resolvedAt) => {
    await db.update(paymentEventRejections)
      .set({ resolvedAt })
      .where(and(
        eq(paymentEventRejections.tenantId, tenantId),
        eq(paymentEventRejections.eventId, eventId),
        isNull(paymentEventRejections.resolvedAt),
      ));
  },
  listUnresolved: async (tenantId, limit) => {
    const rows = await db.select().from(paymentEventRejections)
      .where(and(
        eq(paymentEventRejections.tenantId, tenantId),
        isNull(paymentEventRejections.resolvedAt),
        notExists(liveOrderOfSession(db)),
      ))
      .orderBy(desc(paymentEventRejections.lastSeenAt), desc(paymentEventRejections.eventId))
      .limit(limit);
    return rows.map(toRejection);
  },
});
