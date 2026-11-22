import { and, asc, count, desc, eq, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';

import {
  KEY_DOWNLOAD_FILE_LIMITS,
  keyDownloadObjectOwner,
  keyDownloadPendingDeletionSchema,
  keyDownloadStagedFileSchema,
  keyDownloadUploadRecordSchema,
  productDownloadAssetSchema,
  type KeyDownloadFileCap,
  type KeyDownloadPendingDeletion,
  type KeyDownloadStagedFile,
  type KeyDownloadUploadRecord,
} from '#core/domain/index.js';
import type {
  KeyDownloadAttachment,
  KeyDownloadAttachRepository,
  KeyDownloadClaim,
  KeyDownloadCompletion,
  KeyDownloadFileRepository,
  KeyDownloadObjectRemoval,
  KeyDownloadReservation,
  KeyDownloadSweepCutoffs,
} from '#core/server/index.js';

import { boundedAdvisoryLock } from './bounded-advisory-lock.js';
import { boundLockWait, busyAfterRollback, changeProposalBounds, type ChangeProposalBoundOptions } from './change-proposal-bounds.js';
import type { Db } from './client.js';
import {
  changeProposalDownloadDeletions as deletions,
  changeProposalDownloadFiles as stagedFiles,
  changeProposalDownloadUploads as records,
  changeProposals,
  productDownloadAssets,
  products,
  productStock,
  shopManagementKeys,
} from './schema.js';

type StagedRow = typeof stagedFiles.$inferSelect;
type RecordRow = typeof records.$inferSelect;

const copiedFromOf = (row: { copiedFromProductId: string | null; copiedFromAssetId: string | null; copiedFromVersion: number | null }) =>
  row.copiedFromProductId === null || row.copiedFromAssetId === null || row.copiedFromVersion === null
    ? null
    : { productId: row.copiedFromProductId, assetId: row.copiedFromAssetId, versionNumber: row.copiedFromVersion };

const copiedFromColumns = (source: KeyDownloadStagedFile['copiedFrom']) => ({
  copiedFromProductId: source?.productId ?? null,
  copiedFromAssetId: source?.assetId ?? null,
  copiedFromVersion: source?.versionNumber ?? null,
});

const parseStaged = (row: StagedRow): KeyDownloadStagedFile => keyDownloadStagedFileSchema.parse({
  tenantId: row.tenantId,
  id: row.id,
  apiKeyId: row.apiKeyId,
  fileName: row.fileName,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  sha256: row.sha256,
  objectKey: row.objectKey,
  copiedFrom: copiedFromOf(row),
  proposalId: row.proposalId,
  createdAt: row.createdAt,
});

const parseRecord = (row: RecordRow): KeyDownloadUploadRecord => keyDownloadUploadRecordSchema.parse({
  tenantId: row.tenantId,
  id: row.id,
  apiKeyId: row.apiKeyId,
  kind: row.kind,
  state: row.state,
  fileId: row.fileId,
  fileName: row.fileName,
  contentType: row.contentType,
  declaredBytes: row.declaredBytes,
  candidateKey: row.candidateKey,
  stagedKey: row.stagedKey,
  copiedFrom: copiedFromOf(row),
  attemptId: row.attemptId,
  attemptAt: row.attemptAt,
  createdAt: row.createdAt,
  completedAt: row.completedAt,
});

const parseDeletion = (row: typeof deletions.$inferSelect): KeyDownloadPendingDeletion => keyDownloadPendingDeletionSchema.parse({
  tenantId: row.tenantId,
  apiKeyId: row.apiKeyId,
  objectKey: row.objectKey,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
});

const workspaceLock = (tenantId: string): string => `key-download-files:${tenantId}`;

const keyLock = (tenantId: string, apiKeyId: string): string => `key-download-files:${tenantId}:${apiKeyId}`;

const before = (now: string, ms: number): string => new Date(Date.parse(now) - ms).toISOString();

const bytesOf = (value: unknown): number => Number(value ?? 0);

const recordObjectBytes = sql<string>`${records.declaredBytes}::bigint * ((${records.candidateKey} is not null)::int + (${records.stagedKey} is not null)::int)`;

interface Usage {
  keyFiles: number;
  keyBytes: number;
  workspaceBytes: number;
  keyStarts: number;
  keyDailyBytes: number;
}

const usageOf = async (tx: Db, tenantId: string, apiKeyId: string, now: string): Promise<Usage> => {
  const ofKey = (column: SQL | typeof stagedFiles.apiKeyId) => sql`${column} = ${apiKeyId}`;
  const [staged] = await tx.select({
    keyFiles: sql<string>`count(*) filter (where ${ofKey(stagedFiles.apiKeyId)})`,
    keyBytes: sql<string>`coalesce(sum(${stagedFiles.sizeBytes}::bigint) filter (where ${ofKey(stagedFiles.apiKeyId)}), 0)`,
    workspaceBytes: sql<string>`coalesce(sum(${stagedFiles.sizeBytes}::bigint), 0)`,
  }).from(stagedFiles).where(eq(stagedFiles.tenantId, tenantId));
  const [owed] = await tx.select({
    keyBytes: sql<string>`coalesce(sum(${deletions.sizeBytes}::bigint) filter (where ${deletions.apiKeyId} = ${apiKeyId}), 0)`,
    workspaceBytes: sql<string>`coalesce(sum(${deletions.sizeBytes}::bigint), 0)`,
  }).from(deletions).where(eq(deletions.tenantId, tenantId));
  const [open] = await tx.select({
    keyFiles: sql<string>`count(*) filter (where ${records.apiKeyId} = ${apiKeyId} and ${records.state} in ('started', 'completing'))`,
    keyBytes: sql<string>`coalesce(sum(${recordObjectBytes}) filter (where ${records.apiKeyId} = ${apiKeyId}), 0)`,
    workspaceBytes: sql<string>`coalesce(sum(${recordObjectBytes}), 0)`,
    keyStarts: sql<string>`count(*) filter (where ${records.apiKeyId} = ${apiKeyId} and ${records.createdAt} > ${before(now, KEY_DOWNLOAD_FILE_LIMITS.startsWindowMs)})`,
    keyDailyBytes: sql<string>`coalesce(sum(${records.declaredBytes}::bigint) filter (where ${records.apiKeyId} = ${apiKeyId} and ${records.createdAt} > ${before(now, KEY_DOWNLOAD_FILE_LIMITS.dailyWindowMs)}), 0)`,
  }).from(records).where(eq(records.tenantId, tenantId));
  return {
    keyFiles: bytesOf(staged?.keyFiles) + bytesOf(open?.keyFiles),
    keyBytes: bytesOf(staged?.keyBytes) + bytesOf(owed?.keyBytes) + bytesOf(open?.keyBytes),
    workspaceBytes: bytesOf(staged?.workspaceBytes) + bytesOf(owed?.workspaceBytes) + bytesOf(open?.workspaceBytes),
    keyStarts: bytesOf(open?.keyStarts),
    keyDailyBytes: bytesOf(open?.keyDailyBytes),
  };
};

const capReached = (usage: Usage, record: KeyDownloadUploadRecord): KeyDownloadFileCap | null => {
  const limits = KEY_DOWNLOAD_FILE_LIMITS;
  const objectBytes = record.declaredBytes * ((record.candidateKey === null ? 0 : 1) + (record.stagedKey === null ? 0 : 1));
  if (usage.keyStarts >= limits.startsPerKey) return 'key_file_uploads';
  if (usage.keyDailyBytes + record.declaredBytes > limits.declaredBytesPerKeyDaily) return 'key_file_bytes_daily';
  if (usage.keyFiles >= limits.stagedFilesPerKey) return 'key_staged_files';
  if (usage.keyBytes + objectBytes > limits.stagedBytesPerKey) return 'key_staged_bytes';
  if (usage.workspaceBytes + objectBytes > limits.stagedBytesPerWorkspace) return 'workspace_staged_bytes';
  return null;
};

const recordValues = (record: KeyDownloadUploadRecord) => ({
  tenantId: record.tenantId,
  id: record.id,
  apiKeyId: record.apiKeyId,
  kind: record.kind,
  state: record.state,
  fileId: record.fileId,
  fileName: record.fileName,
  contentType: record.contentType,
  declaredBytes: record.declaredBytes,
  candidateKey: record.candidateKey,
  stagedKey: record.stagedKey,
  ...copiedFromColumns(record.copiedFrom),
  attemptId: record.attemptId,
  attemptAt: record.attemptAt,
  createdAt: record.createdAt,
  completedAt: record.completedAt,
});

const recordOf = (tenantId: string, id: string): SQL | undefined => and(eq(records.tenantId, tenantId), eq(records.id, id));

const stagedOf = (tenantId: string, id: string): SQL | undefined => and(eq(stagedFiles.tenantId, tenantId), eq(stagedFiles.id, id));

const deletionOf = (tenantId: string, objectKey: string): SQL | undefined =>
  and(eq(deletions.tenantId, tenantId), eq(deletions.objectKey, objectKey));

/** Whether a staged row or a product file row owns the object, so no removal step may delete it. */
const objectOwned = async (tx: Db, tenantId: string, objectKey: string): Promise<boolean> => {
  const [staged] = await tx.select({ id: stagedFiles.id }).from(stagedFiles)
    .where(and(eq(stagedFiles.tenantId, tenantId), eq(stagedFiles.objectKey, objectKey))).limit(1);
  if (staged !== undefined) return true;
  const [asset] = await tx.select({ id: productDownloadAssets.id }).from(productDownloadAssets)
    .where(and(eq(productDownloadAssets.tenantId, tenantId), eq(productDownloadAssets.storageKey, objectKey))).limit(1);
  return asset !== undefined;
};

const recordSweepable = (cutoffs: KeyDownloadSweepCutoffs): SQL | undefined => and(
  ne(records.state, 'settled'),
  lt(records.createdAt, cutoffs.recordsStartedBefore),
  or(ne(records.state, 'completing'), lt(records.attemptAt, cutoffs.attemptsStartedBefore)),
);

const recordPurgeable = (cutoffs: KeyDownloadSweepCutoffs): SQL | undefined =>
  and(eq(records.state, 'settled'), lt(records.createdAt, cutoffs.settledStartedBefore));

const keyActive = (now: string): SQL => sql`exists (select 1 from ${shopManagementKeys} where ${shopManagementKeys.tenantId} = ${stagedFiles.tenantId}
  and ${shopManagementKeys.id} = ${stagedFiles.apiKeyId} and ${shopManagementKeys.revokedAt} is null and ${shopManagementKeys.expiresAt} > ${now})`;

const attachedToPendingProposal = (now: string): SQL => sql`exists (select 1 from ${changeProposals} where ${changeProposals.tenantId} = ${stagedFiles.tenantId}
  and ${changeProposals.id} = ${stagedFiles.proposalId} and ${changeProposals.status} = 'pending' and ${changeProposals.expiresAt} > ${now})`;

const stagedSweepable = (cutoffs: KeyDownloadSweepCutoffs): SQL | undefined => and(
  or(lt(stagedFiles.createdAt, cutoffs.stagedCreatedBefore), sql`not ${keyActive(cutoffs.now)}`),
  sql`not ${attachedToPendingProposal(cutoffs.now)}`,
);

const waitingSince = (attempted: SQL | typeof records.sweepAttemptedAt, created: typeof records.createdAt) =>
  sql<string>`coalesce(${attempted}, ${created})`;

/** Records an object deletion owed for each staged object among `assets`, in the caller's transaction. */
export const oweKeyFileDeletions = async (
  tx: Db,
  tenantId: string,
  assets: ReadonlyArray<{ storageKey: string; sizeBytes: number }>,
  now: string,
): Promise<KeyDownloadPendingDeletion[]> => {
  const owed: KeyDownloadPendingDeletion[] = [];
  for (const asset of assets) {
    const apiKeyId = keyDownloadObjectOwner(tenantId, asset.storageKey);
    if (apiKeyId === null) continue;
    const deletion = keyDownloadPendingDeletionSchema.parse({
      tenantId, apiKeyId, objectKey: asset.storageKey, sizeBytes: asset.sizeBytes, createdAt: now,
    });
    await tx.insert(deletions).values({
      tenantId, objectKey: deletion.objectKey, apiKeyId, sizeBytes: deletion.sizeBytes, createdAt: deletion.createdAt,
    }).onConflictDoNothing();
    owed.push(deletion);
  }
  return owed;
};

export const createKeyDownloadFileRepository = (db: Db, options: ChangeProposalBoundOptions = {}): KeyDownloadFileRepository => {
  const bounds = changeProposalBounds(options);
  const waits = { lockWaitMs: bounds.lockWaitMs, lockWaitAfterMs: bounds.lockWaitMs };
  const locked = <T>(work: (tx: Db) => Promise<T>, busy: T): Promise<T> => busyAfterRollback(() => db.transaction(async (tx) => {
    await boundLockWait(tx, bounds);
    return work(tx);
  }), busy);
  return {
    reserve: (tenantId, record, now) => {
      const parsed = keyDownloadUploadRecordSchema.parse(record);
      if (parsed.tenantId !== tenantId) throw new Error('An upload record belongs to another tenant');
      return busyAfterRollback(() => db.transaction(async (tx): Promise<KeyDownloadReservation> => {
        if (!await boundedAdvisoryLock(tx, workspaceLock(tenantId), waits)) return { kind: 'busy' };
        if (!await boundedAdvisoryLock(tx, keyLock(tenantId, parsed.apiKeyId), waits)) return { kind: 'busy' };
        const cap = capReached(await usageOf(tx, tenantId, parsed.apiKeyId, now), parsed);
        if (cap !== null) return { kind: 'cap_exceeded', cap };
        await tx.insert(records).values(recordValues(parsed));
        return { kind: 'reserved', record: parsed };
      }), { kind: 'busy' } as const);
    },
    claimCompletion: (tenantId, apiKeyId, uploadId, attemptId, now) => locked(async (tx): Promise<KeyDownloadClaim> => {
      const [row] = await tx.select().from(records)
        .where(and(recordOf(tenantId, uploadId), eq(records.apiKeyId, apiKeyId), eq(records.kind, 'upload'))).for('update');
      if (row === undefined) return { kind: 'not_found' };
      switch (row.state) {
        case 'started': {
          if (Date.parse(now) - Date.parse(row.createdAt) > KEY_DOWNLOAD_FILE_LIMITS.uploadTtlSeconds * 1000) return { kind: 'expired' };
          const [claimed] = await tx.update(records).set({ state: 'completing', attemptId, attemptAt: now })
            .where(recordOf(tenantId, uploadId)).returning();
          if (claimed === undefined) throw new Error('Upload record claim returned no row');
          return { kind: 'claimed', record: parseRecord(claimed) };
        }
        case 'completing':
          return { kind: 'in_progress' };
        case 'completed': {
          const [file] = await tx.select().from(stagedFiles).where(and(stagedOf(tenantId, row.fileId), eq(stagedFiles.apiKeyId, apiKeyId)));
          return { kind: 'completed', record: parseRecord(row), file: file === undefined ? null : parseStaged(file) };
        }
        case 'failed':
        case 'settled':
          return { kind: 'closed' };
      }
    }, { kind: 'in_progress' }),
    finishCompletion: (tenantId, uploadId, attemptId, file, now) => {
      const parsed = keyDownloadStagedFileSchema.parse(file);
      if (parsed.tenantId !== tenantId) throw new Error('A staged file belongs to another tenant');
      return locked(async (tx): Promise<KeyDownloadCompletion> => {
        const [row] = await tx.select().from(records).where(recordOf(tenantId, uploadId)).for('update');
        if (row?.state !== 'completing' || row.attemptId !== attemptId || row.fileId !== parsed.id || row.stagedKey !== parsed.objectKey) {
          return { kind: 'lost' };
        }
        await tx.insert(stagedFiles).values({
          tenantId,
          id: parsed.id,
          apiKeyId: parsed.apiKeyId,
          fileName: parsed.fileName,
          contentType: parsed.contentType,
          sizeBytes: parsed.sizeBytes,
          sha256: parsed.sha256,
          objectKey: parsed.objectKey,
          ...copiedFromColumns(parsed.copiedFrom),
          proposalId: null,
          createdAt: parsed.createdAt,
        });
        await tx.update(records).set({ state: row.kind === 'copy' ? 'settled' : 'completed', completedAt: now, stagedKey: null })
          .where(recordOf(tenantId, uploadId));
        return { kind: 'stored', file: parsed };
      }, { kind: 'lost' });
    },
    releaseRecord: (tenantId, uploadId, selection, remove) => locked(async (tx): Promise<KeyDownloadObjectRemoval> => {
      const [row] = await tx.select().from(records).where(recordOf(tenantId, uploadId)).for('update');
      if (row === undefined) return 'gone';
      const attempt = selection.kind === 'attempt';
      if (attempt && (row.attemptId !== selection.attemptId || row.state === 'completed')) return 'kept';
      if (!attempt) {
        const [selected] = await tx.select({ id: records.id }).from(records).where(and(recordOf(tenantId, uploadId), recordSweepable(selection.cutoffs)));
        if (selected === undefined) return 'kept';
      }
      const destination = attempt ? selection.destination : row.stagedKey;
      const objects = [
        row.candidateKey,
        destination !== null && !await objectOwned(tx, tenantId, destination) ? destination : null,
      ].filter((key): key is string => key !== null);
      const removed = objects.length === 0 || await remove(objects);
      const state = attempt && row.state === 'completing' ? 'failed' : row.state;
      if (!removed) {
        await tx.update(records).set(attempt ? { state } : { sweepAttemptedAt: selection.cutoffs.now }).where(recordOf(tenantId, uploadId));
        return 'failed';
      }
      await tx.update(records).set(attempt ? { state, stagedKey: null } : { state: 'settled', candidateKey: null, stagedKey: null })
        .where(recordOf(tenantId, uploadId));
      return 'removed';
    }, 'busy'),
    findStaged: async (tenantId, apiKeyId, id) => {
      const [row] = await db.select().from(stagedFiles).where(and(stagedOf(tenantId, id), eq(stagedFiles.apiKeyId, apiKeyId)));
      return row === undefined ? null : parseStaged(row);
    },
    listStaged: async (tenantId, apiKeyId) => (await db.select().from(stagedFiles)
      .where(and(eq(stagedFiles.tenantId, tenantId), eq(stagedFiles.apiKeyId, apiKeyId)))
      .orderBy(asc(stagedFiles.createdAt), asc(stagedFiles.id))).map(parseStaged),
    discard: (tenantId, apiKeyId, id, now) => db.transaction(async (tx) => {
      const [row] = await tx.select().from(stagedFiles).where(and(stagedOf(tenantId, id), eq(stagedFiles.apiKeyId, apiKeyId))).for('update');
      if (row === undefined) return null;
      const [owed] = await oweKeyFileDeletions(tx, tenantId, [{ storageKey: row.objectKey, sizeBytes: row.sizeBytes }], now);
      await tx.delete(stagedFiles).where(stagedOf(tenantId, id));
      return owed ?? null;
    }),
    finishDeletion: (tenantId, objectKey, now, remove) => locked(async (tx): Promise<KeyDownloadObjectRemoval> => {
      const [row] = await tx.select().from(deletions).where(deletionOf(tenantId, objectKey)).for('update');
      if (row === undefined) return 'gone';
      if (!await remove()) {
        await tx.update(deletions).set({ sweepAttemptedAt: now }).where(deletionOf(tenantId, objectKey));
        return 'failed';
      }
      await tx.delete(deletions).where(deletionOf(tenantId, objectKey));
      return 'removed';
    }, 'busy'),
    sweepStaged: (tenantId, id, cutoffs, remove) => locked(async (tx): Promise<KeyDownloadObjectRemoval> => {
      const [row] = await tx.select().from(stagedFiles).where(stagedOf(tenantId, id)).for('update');
      if (row === undefined) return 'gone';
      const [selected] = await tx.select({ id: stagedFiles.id }).from(stagedFiles).where(and(stagedOf(tenantId, id), stagedSweepable(cutoffs)));
      if (selected === undefined) return 'kept';
      if (!await remove()) {
        await tx.update(stagedFiles).set({ sweepAttemptedAt: cutoffs.now }).where(stagedOf(tenantId, id));
        return 'failed';
      }
      await tx.delete(stagedFiles).where(stagedOf(tenantId, id));
      return 'removed';
    }, 'busy'),
    listTenantIdsToSweep: async (cutoffs, limit) => {
      const rows = await db.execute<{ tenant_id: string }>(sql`select tenant_id from (
        select ${records.tenantId} as tenant_id, ${waitingSince(records.sweepAttemptedAt, records.createdAt)} as waiting
          from ${records} where ${or(recordSweepable(cutoffs), recordPurgeable(cutoffs))}
        union all
        select ${stagedFiles.tenantId}, ${waitingSince(stagedFiles.sweepAttemptedAt, stagedFiles.createdAt)}
          from ${stagedFiles} where ${stagedSweepable(cutoffs)}
        union all
        select ${deletions.tenantId}, ${waitingSince(deletions.sweepAttemptedAt, deletions.createdAt)} from ${deletions}
      ) as waiting_rows group by tenant_id order by min(waiting), tenant_id limit ${limit}`);
      return rows.rows.map((row) => row.tenant_id);
    },
    listToSweep: async (tenantId, cutoffs, limit) => ({
      records: (await db.select().from(records).where(and(eq(records.tenantId, tenantId), recordSweepable(cutoffs)))
        .orderBy(asc(waitingSince(records.sweepAttemptedAt, records.createdAt)), asc(records.id)).limit(limit)).map(parseRecord),
      stagedFiles: (await db.select().from(stagedFiles).where(and(eq(stagedFiles.tenantId, tenantId), stagedSweepable(cutoffs)))
        .orderBy(asc(waitingSince(stagedFiles.sweepAttemptedAt, stagedFiles.createdAt)), asc(stagedFiles.id)).limit(limit)).map(parseStaged),
      deletions: (await db.select().from(deletions).where(eq(deletions.tenantId, tenantId))
        .orderBy(asc(waitingSince(deletions.sweepAttemptedAt, deletions.createdAt)), asc(deletions.objectKey)).limit(limit)).map(parseDeletion),
    }),
    purgeSettled: async (tenantId, cutoffs) =>
      (await db.delete(records).where(and(eq(records.tenantId, tenantId), recordPurgeable(cutoffs))).returning({ id: records.id })).length,
  };
};

const parseAsset = (row: typeof productDownloadAssets.$inferSelect) => productDownloadAssetSchema.parse(row);

/** The order a product deletion takes, so a live stock writer holding the stock row and about to key-share the product never deadlocks with it. */
const lockProductFiles = async (tx: Db, tenantId: string, productId: string): Promise<{ type: string } | null> => {
  const product = and(eq(products.tenantId, tenantId), eq(products.id, productId));
  const [found] = await tx.select({ type: products.type }).from(products).where(product).for('no key update');
  if (found === undefined) return null;
  await tx.select({ productId: productStock.productId }).from(productStock)
    .where(and(eq(productStock.tenantId, tenantId), eq(productStock.productId, productId))).for('update');
  await tx.select({ id: products.id }).from(products).where(product).for('update');
  return found;
};

const assetsOfProduct = (tenantId: string, productId: string): SQL | undefined =>
  and(eq(productDownloadAssets.tenantId, tenantId), eq(productDownloadAssets.productId, productId));

export const createKeyDownloadAttachRepository = (executor: Db): KeyDownloadAttachRepository => ({
  attach: (tenantId, input) => executor.transaction(async (tx): Promise<KeyDownloadAttachment> => {
    const product = await lockProductFiles(tx, tenantId, input.productId);
    if (product === null) return { kind: 'product_not_found' };
    if (product.type !== 'digital_download') return { kind: 'not_digital' };
    const [staged] = await tx.select().from(stagedFiles)
      .where(and(stagedOf(tenantId, input.stagedFileId), eq(stagedFiles.apiKeyId, input.apiKeyId))).for('update');
    if (staged === undefined) return { kind: 'staged_not_found' };
    const [files] = await tx.select({ files: count() }).from(productDownloadAssets).where(assetsOfProduct(tenantId, input.productId));
    if ((files?.files ?? 0) >= KEY_DOWNLOAD_FILE_LIMITS.filesPerProduct) return { kind: 'cap_exceeded', cap: 'product_files' };
    let lineageId = staged.id;
    let versionNumber = 1;
    if (input.replacesAssetId !== undefined) {
      const [replacement] = await tx.select().from(productDownloadAssets)
        .where(and(assetsOfProduct(tenantId, input.productId), eq(productDownloadAssets.id, input.replacesAssetId)));
      if (replacement === undefined) return { kind: 'replacement_not_found' };
      if (replacement.status !== 'ready') return { kind: 'replacement_not_ready' };
      lineageId = replacement.lineageId;
      const [latest] = await tx.select({ versionNumber: productDownloadAssets.versionNumber }).from(productDownloadAssets)
        .where(and(assetsOfProduct(tenantId, input.productId), eq(productDownloadAssets.lineageId, lineageId)))
        .orderBy(desc(productDownloadAssets.versionNumber)).limit(1);
      versionNumber = (latest?.versionNumber ?? 0) + 1;
      await tx.update(productDownloadAssets).set({ supersededAt: input.now }).where(and(
        assetsOfProduct(tenantId, input.productId),
        eq(productDownloadAssets.lineageId, lineageId),
        eq(productDownloadAssets.status, 'ready'),
        isNull(productDownloadAssets.supersededAt),
      ));
    }
    const [asset] = await tx.insert(productDownloadAssets).values({
      id: staged.id,
      tenantId,
      productId: input.productId,
      lineageId,
      versionNumber,
      versionNote: input.versionNote,
      supersededAt: null,
      replacesAssetId: null,
      fileName: staged.fileName,
      contentType: staged.contentType,
      sizeBytes: staged.sizeBytes,
      storageKey: staged.objectKey,
      status: 'ready',
      createdAt: input.now,
      sha256: staged.sha256,
    }).returning();
    if (asset === undefined) throw new Error('Product file insert returned no row');
    await tx.delete(stagedFiles).where(stagedOf(tenantId, staged.id));
    return { kind: 'attached', asset: parseAsset(asset) };
  }),
  remove: (tenantId, input) => executor.transaction(async (tx) => {
    if (await lockProductFiles(tx, tenantId, input.productId) === null) return { kind: 'not_found' };
    const [deleted] = await tx.delete(productDownloadAssets)
      .where(and(assetsOfProduct(tenantId, input.productId), eq(productDownloadAssets.id, input.assetId))).returning();
    if (deleted === undefined) return { kind: 'not_found' };
    if (deleted.status === 'ready' && deleted.supersededAt === null) {
      const [latest] = await tx.select({ id: productDownloadAssets.id }).from(productDownloadAssets).where(and(
        assetsOfProduct(tenantId, input.productId),
        eq(productDownloadAssets.lineageId, deleted.lineageId),
        eq(productDownloadAssets.status, 'ready'),
      )).orderBy(desc(productDownloadAssets.versionNumber)).limit(1);
      if (latest !== undefined) {
        await tx.update(productDownloadAssets).set({ supersededAt: null })
          .where(and(eq(productDownloadAssets.tenantId, tenantId), eq(productDownloadAssets.id, latest.id)));
      }
    }
    const [owedDeletion] = await oweKeyFileDeletions(tx, tenantId, [deleted], input.now);
    return { kind: 'removed', asset: parseAsset(deleted), owedDeletion: owedDeletion ?? null };
  }),
});
