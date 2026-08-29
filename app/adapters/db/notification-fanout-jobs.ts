import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import {
  notificationFanoutJobSchema,
  type NotificationFanoutJob,
} from '#core/domain/index.js';
import type { NotificationFanoutJobRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { notificationFanoutJobs } from './schema.js';

const parseJob = (row: typeof notificationFanoutJobs.$inferSelect): NotificationFanoutJob =>
  notificationFanoutJobSchema.parse(row);

export const insertFanoutJob = async (
  db: Db,
  tenantId: string,
  job: NotificationFanoutJob,
): Promise<void> => {
  await db
    .insert(notificationFanoutJobs)
    .values({ ...job, tenantId })
    .onConflictDoNothing({
      target: [notificationFanoutJobs.tenantId, notificationFanoutJobs.sourceKey],
    });
};

export const createNotificationFanoutJobRepository = (
  db: Db,
): NotificationFanoutJobRepository => ({
  claimDue: async (input) =>
    db.transaction(async (tx) => {
      const due = await tx
        .select({ id: notificationFanoutJobs.id })
        .from(notificationFanoutJobs)
        .where(
          and(
            eq(notificationFanoutJobs.status, 'pending'),
            lte(notificationFanoutJobs.nextAttemptAt, input.now),
          ),
        )
        .orderBy(asc(notificationFanoutJobs.nextAttemptAt))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (due.length === 0) return [];
      const rows = await tx
        .update(notificationFanoutJobs)
        .set({
          attempts: sql`${notificationFanoutJobs.attempts} + 1`,
          nextAttemptAt: input.leaseUntil,
          updatedAt: input.now,
        })
        .where(inArray(notificationFanoutJobs.id, due.map((row) => row.id)))
        .returning();
      return rows.map(parseJob);
    }),
  save: async (tenantId, input) => {
    await db
      .update(notificationFanoutJobs)
      .set({
        status: input.status,
        attempts: input.attempts,
        cursorUserId: input.cursorUserId,
        nextAttemptAt: input.nextAttemptAt,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(notificationFanoutJobs.tenantId, tenantId),
          eq(notificationFanoutJobs.id, input.id),
        ),
      );
  },
});
