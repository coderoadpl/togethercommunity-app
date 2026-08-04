import { and, eq, lt, lte } from 'drizzle-orm';

import type { AutoInvoiceJobRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { autoInvoiceJobs } from './app-schema.js';

export const createAutoInvoiceJobRepository = (db: Db): AutoInvoiceJobRepository => ({
  enqueue: async (tenantId, job) => {
    const inserted = await db
      .insert(autoInvoiceJobs)
      .values({ ...job, tenantId })
      .onConflictDoNothing()
      .returning({ id: autoInvoiceJobs.id });
    return inserted.length > 0;
  },
  claimDue: async (now) =>
    db.transaction(async (tx) => {
      const staleBefore = new Date(Date.parse(now) - 15 * 60 * 1000).toISOString();
      await tx
        .update(autoInvoiceJobs)
        .set({ status: 'queued', lockedAt: null })
        .where(and(
          eq(autoInvoiceJobs.status, 'running'),
          lt(autoInvoiceJobs.lockedAt, staleBefore),
        ));
      const row = (
        await tx
          .select()
          .from(autoInvoiceJobs)
          .where(and(
            eq(autoInvoiceJobs.status, 'queued'),
            lte(autoInvoiceJobs.nextAttemptAt, now),
          ))
          .orderBy(autoInvoiceJobs.nextAttemptAt, autoInvoiceJobs.createdAt, autoInvoiceJobs.id)
          .limit(1)
          .for('update', { skipLocked: true })
      )[0];
      if (row === undefined) return null;
      const claimed = (
        await tx
          .update(autoInvoiceJobs)
          .set({ status: 'running', attempts: row.attempts + 1, lockedAt: now })
          .where(and(
            eq(autoInvoiceJobs.tenantId, row.tenantId),
            eq(autoInvoiceJobs.id, row.id),
            eq(autoInvoiceJobs.status, 'queued'),
          ))
          .returning()
      )[0];
      return claimed ?? null;
    }),
  reschedule: async (tenantId, jobId, input) => {
    await db
      .update(autoInvoiceJobs)
      .set({
        status: 'queued',
        nextAttemptAt: input.nextAttemptAt,
        lockedAt: null,
        lastError: input.error,
      })
      .where(and(
        eq(autoInvoiceJobs.tenantId, tenantId),
        eq(autoInvoiceJobs.id, jobId),
      ));
  },
  complete: async (tenantId, jobId) => {
    await db
      .update(autoInvoiceJobs)
      .set({ status: 'completed', lockedAt: null, lastError: null })
      .where(and(
        eq(autoInvoiceJobs.tenantId, tenantId),
        eq(autoInvoiceJobs.id, jobId),
      ));
  },
});
