import { and, asc, count, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';

import { orderRefundJobSchema, type OrderRefundJob } from '#core/domain/index.js';
import type { OrderRefundJobRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import { orderRefundJobs } from './order-refund-job-schema.js';

const isoOrNull = (value: string | null): string | null => value === null ? null : new Date(value).toISOString();

const DUE_STATUSES = ['pending', 'blocked_permission', 'submitted', 'succeeded'] as const;

const isDue = (now: string) => and(inArray(orderRefundJobs.status, [...DUE_STATUSES]), lte(orderRefundJobs.nextAttemptAt, now));

const toJob = (row: typeof orderRefundJobs.$inferSelect): OrderRefundJob => orderRefundJobSchema.parse({
  ...row,
  nextAttemptAt: isoOrNull(row.nextAttemptAt),
  lockedAt: isoOrNull(row.lockedAt),
  submittedAt: isoOrNull(row.submittedAt),
  permissionBlockedAt: isoOrNull(row.permissionBlockedAt),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString(),
});

export const createOrderRefundJobRepository = (db: Db): OrderRefundJobRepository => ({
  enqueue: async (tenantId, job) => {
    const inserted = await db.insert(orderRefundJobs)
      .values({ ...orderRefundJobSchema.parse(job), tenantId })
      .onConflictDoNothing()
      .returning({ id: orderRefundJobs.id });
    return inserted.length > 0;
  },
  findByOrderId: async (tenantId, orderId) => {
    const [row] = await db.select().from(orderRefundJobs)
      .where(and(eq(orderRefundJobs.tenantId, tenantId), eq(orderRefundJobs.orderId, orderId)));
    return row === undefined ? null : toJob(row);
  },
  claimDue: async ({ now, leaseMs }) => db.transaction(async (tx) => {
    const staleBefore = new Date(Date.parse(now) - leaseMs).toISOString();
    await tx.update(orderRefundJobs)
      .set({ status: 'pending', lockedAt: null, updatedAt: now })
      .where(and(eq(orderRefundJobs.status, 'running'), lt(orderRefundJobs.lockedAt, staleBefore)));
    const [due] = await tx.select().from(orderRefundJobs)
      .where(isDue(now))
      .orderBy(asc(orderRefundJobs.nextAttemptAt), asc(orderRefundJobs.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (due === undefined) return null;
    const refunding = due.status === 'pending' || due.status === 'blocked_permission';
    const [claimed] = await tx.update(orderRefundJobs)
      .set(refunding
        ? { status: 'running', attempts: due.attempts + 1, lockedAt: now, updatedAt: now }
        : { lockedAt: now, nextAttemptAt: new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now })
      .where(and(
        eq(orderRefundJobs.tenantId, due.tenantId),
        eq(orderRefundJobs.id, due.id),
        eq(orderRefundJobs.status, due.status),
      ))
      .returning();
    if (claimed === undefined) return null;
    const job = toJob(claimed);
    return { job, phase: refunding ? 'refund' : 'status_check', lease: { status: job.status, lockedAt: now } };
  }),
  countDue: async ({ now }) => {
    const [row] = await db.select({ due: count() }).from(orderRefundJobs).where(isDue(now));
    return row?.due ?? 0;
  },
  release: async (tenantId, jobId, lease, { now, ...update }, staffAlerts = []) => db.transaction(async (tx) => {
    const [row] = await tx.update(orderRefundJobs)
      .set({ ...update, lockedAt: null, updatedAt: now })
      .where(and(
        eq(orderRefundJobs.tenantId, tenantId),
        eq(orderRefundJobs.id, jobId),
        eq(orderRefundJobs.status, lease.status),
        eq(orderRefundJobs.lockedAt, lease.lockedAt),
      ))
      .returning();
    if (row === undefined) return null;
    const outbox = createEmailOutboxRepository(tx);
    for (const alert of staffAlerts) {
      if (alert.tenantId !== tenantId) throw new Error(`Refund alert ${alert.id} belongs to another workspace`);
      const queued = await outbox.enqueue(alert);
      if (!queued.ok) throw new Error(`Refund alert ${alert.id} not queued: ${queued.error.message}`);
    }
    return toJob(row);
  }),
  resolveExternally: async (tenantId, orderId, now) => {
    const [row] = await db.update(orderRefundJobs)
      .set({ status: 'resolved_externally', nextAttemptAt: null, lockedAt: null, updatedAt: now })
      .where(and(
        eq(orderRefundJobs.tenantId, tenantId),
        eq(orderRefundJobs.orderId, orderId),
        or(
          and(eq(orderRefundJobs.status, 'pending'), eq(orderRefundJobs.attempts, 0), isNull(orderRefundJobs.providerRefundId)),
          eq(orderRefundJobs.status, 'failed'),
        ),
      ))
      .returning();
    return row === undefined ? null : toJob(row);
  },
});
