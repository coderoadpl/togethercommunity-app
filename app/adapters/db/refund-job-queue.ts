import { and, asc, count, eq, inArray, isNull, lt, lte, ne } from 'drizzle-orm';

import { STAFF_REFUND_WAITING_STATUSES, type ClaimedRefundJob } from '#core/domain/index.js';
import type { RefundJobQueue } from '#core/server/index.js';

import { orders } from './app-schema.js';
import type { Db } from './client.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import { orderRefundJobs } from './order-refund-job-schema.js';
import { createOrderRefundJobRepository, DUE_STATUSES, toJob } from './order-refund-jobs.js';
import { orderStaffRefunds } from './order-staff-refund-schema.js';
import { toStaffRefund } from './order-staff-refunds.js';

const soldOutDue = (now: string) => and(inArray(orderRefundJobs.status, [...DUE_STATUSES]), lte(orderRefundJobs.nextAttemptAt, now));
const staffDue = (now: string) => and(inArray(orderStaffRefunds.status, [...DUE_STATUSES]), lte(orderStaffRefunds.nextAttemptAt, now));

const refunding = (status: string): boolean => status === 'pending' || status === 'blocked_permission';

const dueTime = (value: string | null): number => (value === null ? Number.POSITIVE_INFINITY : Date.parse(value));

export const createRefundJobQueue = (db: Db): RefundJobQueue => ({
  claimDue: async ({ now, leaseMs }) => db.transaction(async (tx): Promise<ClaimedRefundJob | null> => {
    const staleBefore = new Date(Date.parse(now) - leaseMs).toISOString();
    await tx.update(orderRefundJobs)
      .set({ status: 'pending', lockedAt: null, updatedAt: now })
      .where(and(eq(orderRefundJobs.status, 'running'), lt(orderRefundJobs.lockedAt, staleBefore)));
    await tx.update(orderStaffRefunds)
      .set({ status: 'pending', lockedAt: null, updatedAt: now })
      .where(and(eq(orderStaffRefunds.status, 'running'), lt(orderStaffRefunds.lockedAt, staleBefore)));
    const [soldOut] = await tx.select().from(orderRefundJobs)
      .where(soldOutDue(now))
      .orderBy(asc(orderRefundJobs.nextAttemptAt), asc(orderRefundJobs.id))
      .limit(1)
      .for('update', { skipLocked: true });
    const [staff] = await tx.select().from(orderStaffRefunds)
      .where(staffDue(now))
      .orderBy(asc(orderStaffRefunds.nextAttemptAt), asc(orderStaffRefunds.id))
      .limit(1)
      .for('update', { skipLocked: true });
    const lease = (due: { nextAttemptAt: string | null; attempts: number; status: string }) => refunding(due.status)
      ? { status: 'running' as const, attempts: due.attempts + 1, lockedAt: now, updatedAt: now }
      : { lockedAt: now, nextAttemptAt: new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now };
    if (soldOut !== undefined && (staff === undefined || dueTime(soldOut.nextAttemptAt) <= dueTime(staff.nextAttemptAt))) {
      const [claimed] = await tx.update(orderRefundJobs)
        .set(lease(soldOut))
        .where(and(eq(orderRefundJobs.tenantId, soldOut.tenantId), eq(orderRefundJobs.id, soldOut.id), eq(orderRefundJobs.status, soldOut.status)))
        .returning();
      if (claimed === undefined) return null;
      const job = toJob(claimed);
      return { job, phase: refunding(soldOut.status) ? 'refund' : 'status_check', lease: { status: job.status, lockedAt: now } };
    }
    if (staff === undefined) return null;
    const [claimed] = await tx.update(orderStaffRefunds)
      .set(lease(staff))
      .where(and(eq(orderStaffRefunds.tenantId, staff.tenantId), eq(orderStaffRefunds.id, staff.id), eq(orderStaffRefunds.status, staff.status)))
      .returning();
    if (claimed === undefined) return null;
    const job = toStaffRefund(claimed);
    return { job, phase: refunding(staff.status) ? 'refund' : 'status_check', lease: { status: job.status, lockedAt: now, source: 'staff' } };
  }),
  countDue: async ({ now }) => {
    const [soldOut] = await db.select({ due: count() }).from(orderRefundJobs).where(soldOutDue(now));
    const [staff] = await db.select({ due: count() }).from(orderStaffRefunds).where(staffDue(now));
    return (soldOut?.due ?? 0) + (staff?.due ?? 0);
  },
  staffRefundWaiting: async (tenantId, orderId, { except }) => {
    const [row] = await db.select({ id: orderStaffRefunds.id }).from(orderStaffRefunds)
      .where(and(
        eq(orderStaffRefunds.tenantId, tenantId),
        eq(orderStaffRefunds.orderId, orderId),
        ne(orderStaffRefunds.id, except),
        inArray(orderStaffRefunds.status, [...STAFF_REFUND_WAITING_STATUSES]),
      ))
      .limit(1);
    return row !== undefined;
  },
  markCreateAttempt: async (tenantId, jobId, lease, { keyGeneration, now }) => {
    if (!('source' in lease)) throw new Error(`Sold-out refund job ${jobId} does not record a create attempt`);
    const marked = await db.update(orderStaffRefunds)
      .set({ createOutcomeUnknown: true, keyGeneration, updatedAt: now })
      .where(and(
        eq(orderStaffRefunds.tenantId, tenantId),
        eq(orderStaffRefunds.id, jobId),
        eq(orderStaffRefunds.status, lease.status),
        eq(orderStaffRefunds.lockedAt, lease.lockedAt),
      ))
      .returning({ id: orderStaffRefunds.id });
    return marked.length > 0;
  },
  release: async (tenantId, jobId, lease, update, staffAlerts = [], buyerNotice) => {
    if (!('source' in lease)) {
      if (buyerNotice !== undefined) throw new Error(`Sold-out refund job ${jobId} cannot carry a buyer notice`);
      if (update.createOutcomeUnknown !== undefined) throw new Error(`Sold-out refund job ${jobId} does not record a create outcome`);
      return createOrderRefundJobRepository(db).release(tenantId, jobId, lease, update, staffAlerts);
    }
    const { now, ...fields } = update;
    return db.transaction(async (tx) => {
      const [owner] = await tx.select({ orderId: orderStaffRefunds.orderId }).from(orderStaffRefunds)
        .where(and(eq(orderStaffRefunds.tenantId, tenantId), eq(orderStaffRefunds.id, jobId)));
      if (owner === undefined) return null;
      // A refund request locks the order before it saves its refund; the status trigger then locks the same order, so take it first.
      await tx.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, owner.orderId)))
        .for('update');
      const [row] = await tx.update(orderStaffRefunds)
        .set({ ...fields, lockedAt: null, updatedAt: now })
        .where(and(
          eq(orderStaffRefunds.tenantId, tenantId),
          eq(orderStaffRefunds.id, jobId),
          eq(orderStaffRefunds.status, lease.status),
          eq(orderStaffRefunds.lockedAt, lease.lockedAt),
        ))
        .returning();
      if (row === undefined) return null;
      const outbox = createEmailOutboxRepository(tx);
      for (const alert of staffAlerts) {
        if (alert.tenantId !== tenantId) throw new Error(`Refund alert ${alert.id} belongs to another workspace`);
        const queued = await outbox.enqueue(alert);
        if (!queued.ok) throw new Error(`Refund alert ${alert.id} not queued: ${queued.error.message}`);
      }
      if (buyerNotice === undefined || (row.status !== 'submitted' && row.status !== 'succeeded')) return toStaffRefund(row);
      if (buyerNotice.tenantId !== tenantId) throw new Error(`Refund notice ${buyerNotice.id} belongs to another workspace`);
      const [notified] = await tx.update(orderStaffRefunds)
        .set({ buyerNotifiedAt: now })
        .where(and(eq(orderStaffRefunds.tenantId, tenantId), eq(orderStaffRefunds.id, jobId), isNull(orderStaffRefunds.buyerNotifiedAt)))
        .returning();
      if (notified === undefined) return toStaffRefund(row);
      const queued = await outbox.enqueue({ ...buyerNotice, onConflict: 'keep-existing' });
      if (!queued.ok) throw new Error(`Refund notice ${buyerNotice.id} not queued: ${queued.error.message}`);
      return toStaffRefund(notified);
    });
  },
});
