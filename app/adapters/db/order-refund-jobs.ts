import { and, eq } from 'drizzle-orm';

import { orderRefundJobSchema, type OrderRefundJob } from '#core/domain/index.js';
import type { OrderRefundJobRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { orderRefundJobs } from './order-refund-job-schema.js';

const isoOrNull = (value: string | null): string | null => value === null ? null : new Date(value).toISOString();

const toJob = (row: typeof orderRefundJobs.$inferSelect): OrderRefundJob => orderRefundJobSchema.parse({
  ...row,
  nextAttemptAt: isoOrNull(row.nextAttemptAt),
  lockedAt: isoOrNull(row.lockedAt),
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
});
