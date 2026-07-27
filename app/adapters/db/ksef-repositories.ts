import { and, eq, lt, lte, sql } from 'drizzle-orm';

import type {
  FiscalArtifactRepository,
  KsefNumberRepository,
  KsefSubmissionJobRepository,
} from '@core/server/index.js';

import type { Db } from './client.js';
import {
  fiscalArtifacts,
  ksefNumberAllocations,
  ksefNumberSequences,
  ksefSubmissionJobs,
  tenants,
} from './app-schema.js';

export const createKsefNumberRepository = (db: Db): KsefNumberRepository => ({
  allocate: async (tenantId, input) =>
    db.transaction(async (tx) => {
      const existing = (
        await tx
          .select({ p2: ksefNumberAllocations.p2, sequence: ksefNumberAllocations.sequence })
          .from(ksefNumberAllocations)
          .where(and(
            eq(ksefNumberAllocations.tenantId, tenantId),
            eq(ksefNumberAllocations.orderId, input.orderId),
          ))
          .limit(1)
      )[0];
      if (existing !== undefined) return existing;
      const sequenceId = `${tenantId}:${input.invoiceType}:${String(input.year)}`;
      const row = (
        await tx
          .insert(ksefNumberSequences)
          .values({
            id: sequenceId,
            tenantId,
            invoiceType: input.invoiceType,
            year: input.year,
            nextValue: 2,
            updatedAt: input.allocatedAt,
          })
          .onConflictDoUpdate({
            target: [
              ksefNumberSequences.tenantId,
              ksefNumberSequences.invoiceType,
              ksefNumberSequences.year,
            ],
            set: {
              nextValue: sql`${ksefNumberSequences.nextValue} + 1`,
              updatedAt: input.allocatedAt,
            },
          })
          .returning({ allocated: sql<number>`${ksefNumberSequences.nextValue} - 1` })
      )[0];
      if (row === undefined) throw new Error('KSeF number sequence allocation failed');
      const p2 = `FV/${String(input.year)}/${String(row.allocated).padStart(6, '0')}`;
      await tx.insert(ksefNumberAllocations).values({
        id: `${sequenceId}:${String(row.allocated)}`,
        tenantId,
        invoiceType: input.invoiceType,
        year: input.year,
        sequence: row.allocated,
        p2,
        orderId: input.orderId,
        allocatedAt: input.allocatedAt,
      });
      return { p2, sequence: row.allocated };
    }),
});

export const createFiscalArtifactRepository = (db: Db): FiscalArtifactRepository => ({
  findByKey: async (tenantId, key) => {
    const row = (
      await db
        .select()
        .from(fiscalArtifacts)
        .where(and(eq(fiscalArtifacts.tenantId, tenantId), eq(fiscalArtifacts.key, key)))
        .limit(1)
    )[0];
    return row ?? null;
  },
  store: async (tenantId, artifact) => {
    const rows = await db
      .insert(fiscalArtifacts)
      .values({ ...artifact, tenantId })
      .onConflictDoNothing()
      .returning({ key: fiscalArtifacts.key });
    return rows.length > 0;
  },
});

export const createKsefSubmissionJobRepository = (
  db: Db,
): KsefSubmissionJobRepository => ({
  claimDue: async (now) =>
    db.transaction(async (tx) => {
      const staleBefore = new Date(Date.parse(now) - 15 * 60 * 1000).toISOString();
      await tx
        .update(ksefSubmissionJobs)
        .set({ status: 'queued', lockedAt: null })
        .where(and(
          eq(ksefSubmissionJobs.status, 'running'),
          lt(ksefSubmissionJobs.lockedAt, staleBefore),
        ));
      const row = (
        await tx
          .select({
            id: ksefSubmissionJobs.id,
            tenantId: ksefSubmissionJobs.tenantId,
            invoiceId: ksefSubmissionJobs.invoiceId,
            status: ksefSubmissionJobs.status,
            attempts: ksefSubmissionJobs.attempts,
            nextAttemptAt: ksefSubmissionJobs.nextAttemptAt,
            lockedAt: ksefSubmissionJobs.lockedAt,
            lastError: ksefSubmissionJobs.lastError,
            createdAt: ksefSubmissionJobs.createdAt,
          })
          .from(ksefSubmissionJobs)
          .innerJoin(tenants, eq(tenants.id, ksefSubmissionJobs.tenantId))
          .where(and(
            eq(ksefSubmissionJobs.status, 'queued'),
            lte(ksefSubmissionJobs.nextAttemptAt, now),
            sql`not exists (
              select 1 from ksef_submission_jobs running
              where running.tenant_id = ${ksefSubmissionJobs.tenantId}
                and running.status = 'running'
            )`,
          ))
          .orderBy(ksefSubmissionJobs.nextAttemptAt, ksefSubmissionJobs.createdAt)
          .limit(1)
          .for('update', { of: [ksefSubmissionJobs, tenants], skipLocked: true })
      )[0];
      if (row === undefined) return null;
      const claimed = (
        await tx
          .update(ksefSubmissionJobs)
          .set({
            status: 'running',
            attempts: row.attempts + 1,
            lockedAt: now,
          })
          .where(and(
            eq(ksefSubmissionJobs.tenantId, row.tenantId),
            eq(ksefSubmissionJobs.id, row.id),
            eq(ksefSubmissionJobs.status, 'queued'),
          ))
          .returning()
      )[0];
      return claimed ?? null;
    }),
  reschedule: async (tenantId, jobId, input) => {
    await db
      .update(ksefSubmissionJobs)
      .set({
        status: 'queued',
        nextAttemptAt: input.nextAttemptAt,
        lockedAt: null,
        lastError: input.error,
      })
      .where(and(
        eq(ksefSubmissionJobs.tenantId, tenantId),
        eq(ksefSubmissionJobs.id, jobId),
      ));
  },
  complete: async (tenantId, jobId) => {
    await db
      .update(ksefSubmissionJobs)
      .set({ status: 'completed', lockedAt: null, lastError: null })
      .where(and(
        eq(ksefSubmissionJobs.tenantId, tenantId),
        eq(ksefSubmissionJobs.id, jobId),
      ));
  },
});
