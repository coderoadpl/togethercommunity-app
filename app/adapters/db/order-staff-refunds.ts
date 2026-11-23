import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import {
  appError,
  err,
  isActiveStaffRefundStatus,
  notFound,
  ok,
  orderSchema,
  orderStaffRefundSchema,
  PLATFORM_COMMITTED_REFUND_STATUSES,
  shipAnywayBlocker,
  STAFF_REFUND_WAITING_STATUSES,
  staffRefundWaitingConflict,
  type Order,
  type OrderStaffRefund,
} from '#core/domain/index.js';
import type { OrderStaffRefundRepository } from '#core/server/index.js';

import { orders } from './app-schema.js';
import type { Db } from './client.js';
import { normalizeOrderDates } from './order-dates.js';
import { orderRefundJobs } from './order-refund-job-schema.js';
import { isoOrNull } from './order-refund-jobs.js';
import { orderStaffRefunds } from './order-staff-refund-schema.js';
import { orderShipments } from './shipx-schema.js';
import { returnableOrderStock, returnCommittedOrderStock, takeBackReturnedOrderStock } from './stock.js';

type Executor = Parameters<Parameters<Db['transaction']>[0]>[0];

const STAFF_REFUND_STOCK_REASON = 'staff_refund';

// One bind parameter per id; Postgres refuses a statement with more than 65,535.
const ORDER_ID_CHUNK_SIZE = 1000;

export const toStaffRefund = (row: typeof orderStaffRefunds.$inferSelect): OrderStaffRefund => orderStaffRefundSchema.parse({
  ...row,
  nextAttemptAt: isoOrNull(row.nextAttemptAt),
  lockedAt: isoOrNull(row.lockedAt),
  submittedAt: isoOrNull(row.submittedAt),
  permissionBlockedAt: isoOrNull(row.permissionBlockedAt),
  buyerNotifiedAt: isoOrNull(row.buyerNotifiedAt),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString(),
});

const parseOrder = (row: Order): Order => orderSchema.parse(normalizeOrderDates(row));

const ofOrder = (tenantId: string, orderId: string) =>
  and(eq(orderStaffRefunds.tenantId, tenantId), eq(orderStaffRefunds.orderId, orderId));

const committedCents = async (executor: Pick<Executor, 'select'>, tenantId: string, orderId: string): Promise<number> => {
  const [staff] = await executor.select({ cents: sql<string>`coalesce(sum(${orderStaffRefunds.amountCents}), 0)` })
    .from(orderStaffRefunds)
    .where(and(ofOrder(tenantId, orderId), inArray(orderStaffRefunds.status, [...PLATFORM_COMMITTED_REFUND_STATUSES])));
  const [soldOut] = await executor.select({ cents: sql<string>`coalesce(sum(${orderRefundJobs.amountCents}), 0)` })
    .from(orderRefundJobs)
    .where(and(
      eq(orderRefundJobs.tenantId, tenantId),
      eq(orderRefundJobs.orderId, orderId),
      inArray(orderRefundJobs.status, [...PLATFORM_COMMITTED_REFUND_STATUSES]),
    ));
  return Number(staff?.cents ?? 0) + Number(soldOut?.cents ?? 0);
};

const labelBought = async (executor: Pick<Executor, 'select'>, tenantId: string, orderId: string): Promise<boolean> => {
  const [row] = await executor.select({ id: orderShipments.id }).from(orderShipments)
    .where(and(
      eq(orderShipments.tenantId, tenantId),
      eq(orderShipments.orderId, orderId),
      or(isNotNull(orderShipments.providerShipmentId), isNotNull(orderShipments.boughtAt), isNotNull(orderShipments.createAttemptedAt)),
    ))
    .limit(1);
  return row !== undefined;
};

const insertConflict = async (executor: Pick<Executor, 'select'>, tenantId: string, requestKey: string) => {
  const [sameKey] = await executor.select({ id: orderStaffRefunds.id }).from(orderStaffRefunds)
    .where(and(eq(orderStaffRefunds.tenantId, tenantId), eq(orderStaffRefunds.requestKey, requestKey)));
  return sameKey === undefined ? staffRefundWaitingConflict() : appError('conflict', 'This refund request key was already used');
};

export const createOrderStaffRefundRepository = (db: Db): OrderStaffRefundRepository => ({
  create: async (tenantId, input) => db.transaction(async (tx) => {
    const [orderRow] = await tx.select().from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId)))
      .for('update');
    if (orderRow === undefined) return err(notFound('Order not found'));
    const order = parseOrder(orderRow);
    const [sameRequest] = await tx.select().from(orderStaffRefunds)
      .where(and(eq(orderStaffRefunds.tenantId, tenantId), eq(orderStaffRefunds.requestKey, input.requestKey)));
    const [waiting] = await tx.select().from(orderStaffRefunds)
      .where(and(ofOrder(tenantId, input.orderId), inArray(orderStaffRefunds.status, [...STAFF_REFUND_WAITING_STATUSES])))
      .limit(1);
    const decision = input.decide({
      order,
      platformCommittedCents: await committedCents(tx, tenantId, input.orderId),
      sameRequest: sameRequest === undefined ? null : toStaffRefund(sameRequest),
      waiting: waiting === undefined ? null : toStaffRefund(waiting),
      hasLabel: await labelBought(tx, tenantId, input.orderId),
    });
    if (!decision.ok) return decision;
    if (decision.value.kind === 'existing') return ok({ refund: decision.value.refund, created: false, returnedToStock: [] });
    const refund = orderStaffRefundSchema.parse(decision.value.refund);
    if (refund.tenantId !== tenantId || refund.orderId !== input.orderId || refund.requestKey !== input.requestKey) {
      throw new Error(`Staff refund ${refund.id} does not belong to the locked order`);
    }
    const [inserted] = await tx.insert(orderStaffRefunds).values(refund).onConflictDoNothing().returning();
    if (inserted === undefined) return err(await insertConflict(tx, tenantId, input.requestKey));
    const returnedToStock = refund.restocked
      ? await returnCommittedOrderStock(tx, tenantId, { orderId: input.orderId, reason: STAFF_REFUND_STOCK_REASON, actorUserId: input.actorUserId, now: input.now })
      : [];
    if (refund.removedFromPackingList) {
      await tx.update(orders)
        .set({ fulfilmentStatus: null })
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId), eq(orders.fulfilmentStatus, 'to_pack')));
    }
    return ok({ refund: toStaffRefund(inserted), created: true, returnedToStock });
  }),
  listByOrder: async (tenantId, orderId) =>
    (await db.select().from(orderStaffRefunds)
      .where(ofOrder(tenantId, orderId))
      .orderBy(desc(orderStaffRefunds.createdAt), desc(orderStaffRefunds.id)))
      .map(toStaffRefund),
  platformCommittedCents: async (tenantId, orderId) => committedCents(db, tenantId, orderId),
  hasLabel: async (tenantId, orderId) => labelBought(db, tenantId, orderId),
  committedCentsByOrder: async (tenantId, orderIds) => {
    const committed = new Map<string, number>();
    for (let start = 0; start < orderIds.length; start += ORDER_ID_CHUNK_SIZE) {
      const chunk = orderIds.slice(start, start + ORDER_ID_CHUNK_SIZE);
      const staff = await db.select({ orderId: orderStaffRefunds.orderId, cents: sql<string>`sum(${orderStaffRefunds.amountCents})` })
        .from(orderStaffRefunds)
        .where(and(
          eq(orderStaffRefunds.tenantId, tenantId),
          inArray(orderStaffRefunds.orderId, chunk),
          inArray(orderStaffRefunds.status, [...PLATFORM_COMMITTED_REFUND_STATUSES]),
        ))
        .groupBy(orderStaffRefunds.orderId);
      const soldOut = await db.select({ orderId: orderRefundJobs.orderId, cents: sql<string>`sum(${orderRefundJobs.amountCents})` })
        .from(orderRefundJobs)
        .where(and(
          eq(orderRefundJobs.tenantId, tenantId),
          inArray(orderRefundJobs.orderId, chunk),
          inArray(orderRefundJobs.status, [...PLATFORM_COMMITTED_REFUND_STATUSES]),
        ))
        .groupBy(orderRefundJobs.orderId);
      for (const row of [...staff, ...soldOut]) committed.set(row.orderId, (committed.get(row.orderId) ?? 0) + Number(row.cents));
    }
    return committed;
  },
  activeRefundByOrder: async (tenantId, orderIds) => {
    if (orderIds.length === 0) return new Map();
    const latest = await db.selectDistinctOn([orderStaffRefunds.orderId], { orderId: orderStaffRefunds.orderId, status: orderStaffRefunds.status, amountCents: orderStaffRefunds.amountCents })
      .from(orderStaffRefunds)
      .where(and(eq(orderStaffRefunds.tenantId, tenantId), inArray(orderStaffRefunds.orderId, [...orderIds])))
      .orderBy(orderStaffRefunds.orderId, desc(orderStaffRefunds.createdAt), desc(orderStaffRefunds.id));
    return new Map(latest.flatMap((row) => isActiveStaffRefundStatus(row.status) ? [[row.orderId, { status: row.status, amountCents: row.amountCents }]] : []));
  },
  returnableStock: async (tenantId, orderId) => returnableOrderStock(db, tenantId, orderId, STAFF_REFUND_STOCK_REASON),
  noteChargeRefunded: async (tenantId, orderId, now) =>
    (await db.update(orderStaffRefunds)
      .set({ nextAttemptAt: now, updatedAt: now })
      .where(and(ofOrder(tenantId, orderId), or(
        eq(orderStaffRefunds.status, 'pending'),
        and(eq(orderStaffRefunds.status, 'blocked_permission'), isNull(orderStaffRefunds.providerRefundId)),
      )))
      .returning())
      .map(toStaffRefund),
  shipAnyway: async (tenantId, orderId, input) => db.transaction(async (tx) => {
    const [row] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).for('update');
    if (row === undefined) return err(notFound('Order not found'));
    const blocker = shipAnywayBlocker(parseOrder(row));
    if (blocker !== null) return err(blocker);
    const takenBack = await takeBackReturnedOrderStock(tx, tenantId, { orderId, reason: STAFF_REFUND_STOCK_REASON, ...input });
    if (!takenBack.ok) return takenBack;
    const [updated] = await tx.update(orders)
      .set({ fulfilmentStatus: 'to_pack' })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId), isNull(orders.fulfilmentStatus)))
      .returning();
    if (updated === undefined) return err(appError('conflict', 'The order is already on the packing list or shipped'));
    return ok(parseOrder(updated));
  }),
});
