import { and, eq, getTableColumns, inArray, isNull, lt, lte, sql } from 'drizzle-orm';

import { marketingContactImportSchema, marketingImportRowReceiptSchema } from '#core/domain/index.js';
import type { MarketingContactImportRepository, MarketingDirectoryJobs } from '#core/server/index.js';

import type { Db } from './client.js';
import { createMarketingDirectoryEventRepository } from './marketing-contact-repositories.js';
import { marketingContactImports as batches, marketingContactImportRows as rows, marketingMemberSyncJobs as jobs } from './schema.js';

const { rawCsv, ...batchColumns } = getTableColumns(batches);

export const createMarketingContactImportRepository = (db: Db): MarketingContactImportRepository => ({
  findById: async (tenantId, importId) => {
    const [row] = await db.select(batchColumns).from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.id, importId)));
    return row === undefined ? null : marketingContactImportSchema.parse(row);
  },
  findByKey: async (tenantId, key) => {
    const [row] = await db.select(batchColumns).from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.idempotencyKey, key)));
    return row === undefined ? null : marketingContactImportSchema.parse(row);
  },
  save: async (tenantId, input) => {
    const batch = marketingContactImportSchema.parse({ ...input, tenantId });
    await db.insert(batches).values(batch).onConflictDoUpdate({ target: [batches.tenantId, batches.id], set: batch });
  },
  runnable: async (tenantId, now) => (await db.select({ id: batches.id }).from(batches).where(and(eq(batches.tenantId, tenantId), inArray(batches.status, ['queued', 'processing', 'failed']), lte(batches.nextAttemptAt, now))).orderBy(batches.createdAt)).map((row) => row.id),
  rows: async (tenantId, importId) => (await db.select().from(rows).where(and(eq(rows.tenantId, tenantId), eq(rows.importId, importId))).orderBy(rows.rowNumber)).map((row) => marketingImportRowReceiptSchema.parse(row)),
  nextRow: async (tenantId, importId) => {
    const [row] = await db.select().from(rows).where(and(eq(rows.tenantId, tenantId), eq(rows.importId, importId), isNull(rows.processedAt))).orderBy(rows.rowNumber).limit(1);
    return row === undefined ? null : marketingImportRowReceiptSchema.parse(row);
  },
  rowsPage: async (tenantId, importId, offset, limit) => (await db.select().from(rows).where(and(eq(rows.tenantId, tenantId), eq(rows.importId, importId))).orderBy(rows.rowNumber).offset(offset).limit(limit)).map((row) => marketingImportRowReceiptSchema.parse(row)),
  hasLists: async (tenantId, importId) => (await db.select({ rowNumber: rows.rowNumber }).from(rows).where(and(eq(rows.tenantId, tenantId), eq(rows.importId, importId), sql`jsonb_array_length(${rows.normalizedPayload}->'lists') > 0`)).limit(1)).length > 0,
  saveRow: async (tenantId, input) => {
    const row = marketingImportRowReceiptSchema.parse({ ...input, tenantId });
    await db.insert(rows).values(row).onConflictDoUpdate({ target: [rows.tenantId, rows.importId, rows.rowNumber], set: row });
  },
  lock: async (tenantId, key) => { await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + key}, 3))`); },
  saveCsv: async (tenantId, importId, csv) => { await db.update(batches).set({ rawCsv: csv }).where(and(eq(batches.tenantId, tenantId), eq(batches.id, importId))); },
  readCsv: async (tenantId, importId) => (await db.select({ csv: rawCsv }).from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.id, importId))))[0]?.csv ?? null,
  clearStagedRows: async (tenantId, importId) => { await db.delete(rows).where(and(eq(rows.tenantId, tenantId), eq(rows.importId, importId))); },
  purgeStaging: async (tenantId, now) => {
    const expired = new Date(Date.parse(now) - 86_400_000).toISOString();
    const retained = new Date(Date.parse(now) - 30 * 86_400_000).toISOString();
    return db.transaction(async (tx) => {
      const stale = await tx.update(batches).set({ status: 'cancelled', finishedAt: now }).where(and(eq(batches.tenantId, tenantId), inArray(batches.status, ['draft', 'ready']), lt(batches.createdAt, expired))).returning(batchColumns);
      for (const batch of stale) await createMarketingDirectoryEventRepository(tx).append(tenantId, { id: crypto.randomUUID(), tenantId, subjectKind: 'import', subjectId: batch.id, type: 'import_cancelled', actor: 'staging_retention', importId: batch.id, payload: {}, occurredAt: now, createdAt: now });
      const completed = await tx.select(batchColumns).from(batches).where(and(eq(batches.tenantId, tenantId), inArray(batches.status, ['completed', 'completed_with_errors', 'cancelled']), lt(batches.finishedAt, retained), isNull(batches.stagedDataPurgedAt)));
      for (const batch of [...stale, ...completed]) {
        await tx.update(rows).set({ stagedPayload: null, normalizedPayload: null }).where(and(eq(rows.tenantId, tenantId), eq(rows.importId, batch.id)));
        await tx.update(batches).set({ stagedDataPurgedAt: now, rawCsv: null }).where(and(eq(batches.tenantId, tenantId), eq(batches.id, batch.id)));
      }
      return stale.length + completed.length;
    });
  },
});
export const createMarketingDirectoryJobs = (db: Db): MarketingDirectoryJobs => ({
  tenantIds: async () => [...new Set([
    ...(await db.selectDistinct({ tenantId: batches.tenantId }).from(batches)).map((row) => row.tenantId),
    ...(await db.selectDistinct({ tenantId: jobs.tenantId }).from(jobs).where(eq(jobs.status, 'pending'))).map((row) => row.tenantId),
  ])].sort(),
});
