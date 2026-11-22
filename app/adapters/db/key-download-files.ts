import { and, asc, count, desc, eq, inArray, isNull, lt, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';

import {
  KEY_DOWNLOAD_FILE_LIMITS,
  keyDownloadDestinationForFile,
  keyDownloadObjectOwner,
  keyDownloadPendingDeletionSchema,
  keyDownloadRecordEventSchema,
  keyDownloadStagedFileSchema,
  keyDownloadStagedKey,
  keyDownloadUploadRecordSchema,
  productDownloadAssetSchema,
  type KeyDownloadFileCap,
  type KeyDownloadPendingDeletion,
  type KeyDownloadRecordEvent,
  type KeyDownloadStagedFile,
  type KeyDownloadUploadRecord,
} from '#core/domain/index.js';
import type {
  KeyDownloadAttachment,
  KeyDownloadAttachRepository,
  KeyDownloadClaim,
  KeyDownloadCompletion,
  KeyDownloadFileRepository,
  KeyDownloadInterruption,
  KeyDownloadObjectRemoval,
  KeyDownloadReservation,
  KeyDownloadSweepCutoffs,
  KeyDownloadSweepRow,
} from '#core/server/index.js';

import { boundedAdvisoryLock, lockWaitMs } from './bounded-advisory-lock.js';
import { boundLockWait, busyAfterRollback, changeProposalBounds, type ChangeProposalBoundOptions } from './change-proposal-bounds.js';
import type { Db } from './client.js';
import {
  changeProposalDownloadDeletions as deletions,
  changeProposalDownloadFiles as stagedFiles,
  changeProposalDownloadUploadEvents as recordEvents,
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

const parseEvent = (row: typeof recordEvents.$inferSelect): KeyDownloadRecordEvent => keyDownloadRecordEventSchema.parse({
  tenantId: row.tenantId,
  recordId: row.recordId,
  apiKeyId: row.apiKeyId,
  kind: row.kind,
  attemptId: row.attemptId,
  reason: row.reason,
  at: row.at,
});

const parseDeletion = (row: typeof deletions.$inferSelect): KeyDownloadPendingDeletion => keyDownloadPendingDeletionSchema.parse({
  tenantId: row.tenantId,
  apiKeyId: row.apiKeyId,
  objectKey: row.objectKey,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
  notBefore: row.notBefore,
});

const workspaceLock = (tenantId: string): string => `key-download-files:${tenantId}`;

const keyLock = (tenantId: string, apiKeyId: string): string => `key-download-files:${tenantId}:${apiKeyId}`;

const before = (now: string, ms: number): string => new Date(Date.parse(now) - ms).toISOString();

interface Usage {
  keyFiles: number;
  keyBytes: number;
  workspaceBytes: number;
  keyStarts: number;
  keyDailyBytes: number;
}

const wholeNumberOf = (row: unknown, column: string): number => {
  const value = Number(typeof row === 'object' && row !== null ? Reflect.get(row, column) : undefined);
  if (!Number.isSafeInteger(value)) throw new Error(`Staging usage column ${column} is not a whole number`);
  return value;
};

const firstRowOf = (result: unknown): unknown =>
  typeof result === 'object' && result !== null && 'rows' in result && Array.isArray(result.rows) ? result.rows[0] : undefined;

/**
 * One statement, so every count reads one snapshot: an object whose ownership moves from an upload record to a staged
 * row while it runs is counted exactly once. A completed upload's file is counted through its staged row or its owed
 * deletion, never again through its record; a file attached to a product has left the staging budget.
 */
const usageOf = async (tx: Db, tenantId: string, apiKeyId: string, now: string): Promise<Usage> => {
  const result = await tx.execute(sql`
    with staged as (
      select ${stagedFiles.apiKeyId} as api_key_id, ${stagedFiles.sizeBytes}::bigint as bytes
      from ${stagedFiles} where ${stagedFiles.tenantId} = ${tenantId}
    ), owed as (
      select ${deletions.apiKeyId} as api_key_id, ${deletions.sizeBytes}::bigint as bytes
      from ${deletions} where ${deletions.tenantId} = ${tenantId}
    ), open as (
      select ${records.apiKeyId} as api_key_id, ${records.createdAt} as created_at, ${records.declaredBytes}::bigint as declared,
        ${records.declaredBytes}::bigint * ((${records.candidateKey} is not null)::int + (${records.stagedKey} is not null)::int) as bytes,
        ${records.state} in ('started', 'completing', 'interrupted', 'failed')
          and (${records.candidateKey} is not null or ${records.stagedKey} is not null) as holds_file
      from ${records} where ${records.tenantId} = ${tenantId} and ${records.state} <> 'settled'
    ), started as (
      select ${records.createdAt} as created_at, ${records.declaredBytes}::bigint as declared
      from ${records} where ${records.tenantId} = ${tenantId} and ${records.apiKeyId} = ${apiKeyId}
    )
    select
      (select count(*) from staged where api_key_id = ${apiKeyId})
        + (select count(*) from owed where api_key_id = ${apiKeyId})
        + (select count(*) from open where api_key_id = ${apiKeyId} and holds_file) as key_files,
      (select coalesce(sum(bytes), 0) from staged where api_key_id = ${apiKeyId})
        + (select coalesce(sum(bytes), 0) from owed where api_key_id = ${apiKeyId})
        + (select coalesce(sum(bytes), 0) from open where api_key_id = ${apiKeyId}) as key_bytes,
      (select coalesce(sum(bytes), 0) from staged) + (select coalesce(sum(bytes), 0) from owed)
        + (select coalesce(sum(bytes), 0) from open) as workspace_bytes,
      (select count(*) from started where created_at > ${before(now, KEY_DOWNLOAD_FILE_LIMITS.startsWindowMs)}) as key_starts,
      (select coalesce(sum(declared), 0) from started where created_at > ${before(now, KEY_DOWNLOAD_FILE_LIMITS.dailyWindowMs)}) as key_daily_bytes
  `);
  const row = firstRowOf(result);
  return {
    keyFiles: wholeNumberOf(row, 'key_files'),
    keyBytes: wholeNumberOf(row, 'key_bytes'),
    workspaceBytes: wholeNumberOf(row, 'workspace_bytes'),
    keyStarts: wholeNumberOf(row, 'key_starts'),
    keyDailyBytes: wholeNumberOf(row, 'key_daily_bytes'),
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
  or(notInArray(records.state, ['completing', 'interrupted']), lt(records.attemptAt, cutoffs.attemptsStartedBefore)),
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

const waitingSince = (table: typeof records | typeof stagedFiles | typeof deletions): SQL<string> =>
  sql<string>`coalesce(${table.sweepAttemptedAt}, ${table.createdAt})`;

const appendEvent = async (tx: Db, event: KeyDownloadRecordEvent): Promise<void> => {
  const parsed = keyDownloadRecordEventSchema.parse(event);
  await tx.insert(recordEvents).values(parsed);
};

const eventOf = (
  row: Pick<RecordRow, 'tenantId' | 'id' | 'apiKeyId'>,
  kind: KeyDownloadRecordEvent['kind'],
  attemptId: string | null,
  reason: string | null,
  at: string,
): KeyDownloadRecordEvent => ({ tenantId: row.tenantId, recordId: row.id, apiKeyId: row.apiKeyId, kind, attemptId, reason, at });

const after = (at: string, ms: number): string => new Date(Date.parse(at) + ms).toISOString();

const leaseEnd = (attemptAt: string): string => after(attemptAt, KEY_DOWNLOAD_FILE_LIMITS.completionDeadlineMs);

const deletionDue = (now: string): SQL | undefined => or(isNull(deletions.notBefore), lte(deletions.notBefore, now));

/** The debt is the key's whose key-files prefix holds the object, whoever removed the file, so that key's limits carry it. */
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
      tenantId, apiKeyId, objectKey: asset.storageKey, sizeBytes: asset.sizeBytes, createdAt: now, notBefore: null,
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
  const locked = <T>(work: (tx: Db) => Promise<T>, busy: T, wait?: number): Promise<T> => busyAfterRollback(() => db.transaction(async (tx) => {
    await boundLockWait(tx, { lockWaitMs: wait === undefined ? bounds.lockWaitMs : Math.min(bounds.lockWaitMs, lockWaitMs(wait)) });
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
        await appendEvent(tx, eventOf(parsed, 'started', parsed.attemptId, parsed.kind, now));
        return { kind: 'reserved', record: parsed };
      }), { kind: 'busy' } as const);
    },
    claimCompletion: (tenantId, apiKeyId, uploadId, attemptId, now, nextFileId) => locked(async (tx): Promise<KeyDownloadClaim> => {
      const [row] = await tx.select().from(records)
        .where(and(recordOf(tenantId, uploadId), eq(records.apiKeyId, apiKeyId), eq(records.kind, 'upload'))).for('update');
      if (row === undefined) return { kind: 'not_found' };
      const open = Date.parse(now) - Date.parse(row.createdAt) <= KEY_DOWNLOAD_FILE_LIMITS.uploadTtlSeconds * 1000;
      const claim = async (reason: string | null, destination: { fileId: string; stagedKey: string | null }): Promise<KeyDownloadClaim> => {
        const [claimed] = await tx.update(records).set({ state: 'completing', attemptId, attemptAt: now, ...destination })
          .where(recordOf(tenantId, uploadId)).returning();
        if (claimed === undefined) throw new Error('Upload record claim returned no row');
        await appendEvent(tx, eventOf(row, 'claimed', attemptId, reason, now));
        return { kind: 'claimed', record: parseRecord(claimed) };
      };
      const takeOver = async (superseded: { stagedKey: string; attemptAt: string }): Promise<KeyDownloadClaim> => {
        const fileId = nextFileId();
        const stagedKey = keyDownloadDestinationForFile(superseded.stagedKey, row.apiKeyId, fileId);
        if (stagedKey === null) return { kind: 'closed' };
        await tx.insert(deletions).values({
          tenantId,
          objectKey: superseded.stagedKey,
          apiKeyId: row.apiKeyId,
          sizeBytes: row.declaredBytes,
          createdAt: now,
          notBefore: after(superseded.attemptAt, KEY_DOWNLOAD_FILE_LIMITS.supersededDestinationDeleteAfterMs),
        }).onConflictDoNothing();
        return claim('reclaimed', { fileId, stagedKey });
      };
      switch (row.state) {
        case 'started':
          return open ? claim(null, { fileId: row.fileId, stagedKey: row.stagedKey }) : { kind: 'expired' };
        case 'completing':
        case 'interrupted': {
          if (row.attemptAt === null) throw new Error('A completing upload record has no attempt');
          const until = leaseEnd(row.attemptAt);
          if (now < until) {
            const reclaimable = row.candidateKey !== null && Date.parse(until) - Date.parse(row.createdAt) <= KEY_DOWNLOAD_FILE_LIMITS.uploadTtlSeconds * 1000;
            return { kind: row.state === 'completing' ? 'in_progress' : 'interrupted', until, reclaimable };
          }
          return open && row.candidateKey !== null && row.stagedKey !== null
            ? takeOver({ stagedKey: row.stagedKey, attemptAt: row.attemptAt })
            : { kind: 'closed' };
        }
        case 'completed': {
          const [file] = await tx.select().from(stagedFiles).where(and(stagedOf(tenantId, row.fileId), eq(stagedFiles.apiKeyId, apiKeyId)));
          return { kind: 'completed', record: parseRecord(row), file: file === undefined ? null : parseStaged(file) };
        }
        case 'failed':
        case 'settled':
          return { kind: 'closed' };
      }
    }, { kind: 'busy' }),
    finishCompletion: (tenantId, uploadId, attemptId, file, now) => {
      const parsed = keyDownloadStagedFileSchema.parse(file);
      if (parsed.tenantId !== tenantId) throw new Error('A staged file belongs to another tenant');
      return locked(async (tx): Promise<KeyDownloadCompletion> => {
        const [row] = await tx.select().from(records).where(recordOf(tenantId, uploadId)).for('update');
        if (row?.state !== 'completing' || row.attemptId !== attemptId || row.fileId !== parsed.id || row.stagedKey !== parsed.objectKey) {
          return { kind: 'lost' };
        }
        if (row.attemptAt === null || now >= leaseEnd(row.attemptAt)) {
          await tx.update(records).set({ state: 'interrupted' }).where(recordOf(tenantId, uploadId));
          await appendEvent(tx, eventOf(row, 'interrupted', attemptId, 'lease_expired', now));
          return { kind: 'lease_expired' };
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
        const state = row.kind === 'copy' ? 'settled' : 'completed';
        await tx.update(records).set({ state, completedAt: now, stagedKey: null }).where(recordOf(tenantId, uploadId));
        await appendEvent(tx, eventOf(row, 'completed', attemptId, null, now));
        if (state === 'settled') await appendEvent(tx, eventOf(row, 'settled', attemptId, 'copied', now));
        return { kind: 'stored', file: parsed };
      }, { kind: 'busy' });
    },
    interruptAttempt: (tenantId, uploadId, attemptId, reason, now) => locked(async (tx): Promise<KeyDownloadInterruption> => {
      const [row] = await tx.select().from(records).where(recordOf(tenantId, uploadId)).for('update');
      if (row?.state !== 'completing' || row.attemptId !== attemptId || row.attemptAt === null) return { kind: 'kept' };
      await tx.update(records).set({ state: 'interrupted' }).where(recordOf(tenantId, uploadId));
      await appendEvent(tx, eventOf(row, 'interrupted', attemptId, reason, now));
      return { kind: 'interrupted', until: leaseEnd(row.attemptAt) };
    }, { kind: 'busy' }),
    releaseRecord: (tenantId, uploadId, selection, remove, wait) => locked(async (tx): Promise<KeyDownloadObjectRemoval> => {
      const [row] = await tx.select().from(records).where(recordOf(tenantId, uploadId)).for('update');
      if (row === undefined) return 'gone';
      const attempt = selection.kind === 'attempt';
      if (attempt && row.attemptId !== selection.attemptId) return 'kept';
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
      const failing = attempt && row.state === 'completing';
      const now = attempt ? selection.now : selection.cutoffs.now;
      if (!removed) {
        if (failing) {
          await tx.update(records).set({ state: 'failed' }).where(recordOf(tenantId, uploadId));
          await appendEvent(tx, eventOf(row, 'failed', selection.attemptId, selection.reason, now));
        } else if (!attempt) {
          await tx.update(records).set({ sweepAttemptedAt: now }).where(recordOf(tenantId, uploadId));
        }
        return 'failed';
      }
      if (attempt) {
        await tx.update(records).set({ state: failing ? 'failed' : row.state, stagedKey: null }).where(recordOf(tenantId, uploadId));
        if (failing) await appendEvent(tx, eventOf(row, 'failed', selection.attemptId, selection.reason, now));
        return 'removed';
      }
      await tx.update(records).set({ state: 'settled', candidateKey: null, stagedKey: null }).where(recordOf(tenantId, uploadId));
      await appendEvent(tx, eventOf(row, 'settled', row.attemptId, 'swept', now));
      return 'removed';
    }, 'busy', wait),
    findStaged: async (tenantId, apiKeyId, id) => {
      const [row] = await db.select().from(stagedFiles).where(and(stagedOf(tenantId, id), eq(stagedFiles.apiKeyId, apiKeyId)));
      return row === undefined ? null : parseStaged(row);
    },
    listStaged: async (tenantId, apiKeyId) => (await db.select().from(stagedFiles)
      .where(and(eq(stagedFiles.tenantId, tenantId), eq(stagedFiles.apiKeyId, apiKeyId)))
      .orderBy(asc(stagedFiles.createdAt), asc(stagedFiles.id))).map(parseStaged),
    listRecordEvents: async (tenantId, recordId) => (await db.select().from(recordEvents)
      .where(and(eq(recordEvents.tenantId, tenantId), eq(recordEvents.recordId, recordId)))
      .orderBy(asc(recordEvents.sequence))).map(parseEvent),
    discard: (tenantId, apiKeyId, id, now) => db.transaction(async (tx) => {
      const [row] = await tx.select().from(stagedFiles).where(and(stagedOf(tenantId, id), eq(stagedFiles.apiKeyId, apiKeyId))).for('update');
      if (row === undefined) return null;
      const [owed] = await oweKeyFileDeletions(tx, tenantId, [{ storageKey: row.objectKey, sizeBytes: row.sizeBytes }], now);
      await tx.delete(stagedFiles).where(stagedOf(tenantId, id));
      return owed ?? null;
    }),
    finishDeletion: (tenantId, objectKey, now, remove, wait) => locked(async (tx): Promise<KeyDownloadObjectRemoval> => {
      const [row] = await tx.select().from(deletions).where(deletionOf(tenantId, objectKey)).for('update');
      if (row === undefined) return 'gone';
      if (row.notBefore !== null && now < row.notBefore) return 'kept';
      if (!await remove()) {
        await tx.update(deletions).set({ sweepAttemptedAt: now }).where(deletionOf(tenantId, objectKey));
        return 'failed';
      }
      await tx.delete(deletions).where(deletionOf(tenantId, objectKey));
      return 'removed';
    }, 'busy', wait),
    sweepStaged: (tenantId, id, cutoffs, remove, wait) => locked(async (tx): Promise<KeyDownloadObjectRemoval> => {
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
    }, 'busy', wait),
    listTenantIdsToSweep: async (cutoffs, limit) => {
      const waiting = new Map<string, string>();
      const collect = (rows: ReadonlyArray<{ tenantId: string; waiting: string | null }>) => {
        for (const row of rows) {
          const known = waiting.get(row.tenantId);
          if (row.waiting !== null && (known === undefined || row.waiting < known)) waiting.set(row.tenantId, row.waiting);
        }
      };
      collect(await db.select({ tenantId: records.tenantId, waiting: sql<string | null>`min(${waitingSince(records)})` }).from(records)
        .where(or(recordSweepable(cutoffs), recordPurgeable(cutoffs))).groupBy(records.tenantId));
      collect(await db.select({ tenantId: stagedFiles.tenantId, waiting: sql<string | null>`min(${waitingSince(stagedFiles)})` }).from(stagedFiles)
        .where(stagedSweepable(cutoffs)).groupBy(stagedFiles.tenantId));
      collect(await db.select({ tenantId: deletions.tenantId, waiting: sql<string | null>`min(${waitingSince(deletions)})` }).from(deletions)
        .where(deletionDue(cutoffs.now)).groupBy(deletions.tenantId));
      collect(await db.select({ tenantId: recordEvents.tenantId, waiting: sql<string | null>`min(${recordEvents.at})` }).from(recordEvents)
        .where(lt(recordEvents.at, cutoffs.eventsBefore)).groupBy(recordEvents.tenantId));
      return [...waiting.entries()]
        .sort(([leftId, left], [rightId, right]) => left < right ? -1 : left > right ? 1 : leftId < rightId ? -1 : leftId > rightId ? 1 : 0)
        .slice(0, limit)
        .map(([tenantId]) => tenantId);
    },
    listToSweep: async (tenantId, cutoffs, limit) => {
      const recordRows = await db.select({ row: records, waiting: waitingSince(records) }).from(records).where(and(eq(records.tenantId, tenantId), recordSweepable(cutoffs)))
        .orderBy(asc(waitingSince(records)), asc(records.id)).limit(limit);
      const stagedRows = await db.select({ row: stagedFiles, waiting: waitingSince(stagedFiles) }).from(stagedFiles)
        .where(and(eq(stagedFiles.tenantId, tenantId), stagedSweepable(cutoffs)))
        .orderBy(asc(waitingSince(stagedFiles)), asc(stagedFiles.id)).limit(limit);
      const deletionRows = await db.select({ row: deletions, waiting: waitingSince(deletions) }).from(deletions)
        .where(and(eq(deletions.tenantId, tenantId), deletionDue(cutoffs.now)))
        .orderBy(asc(waitingSince(deletions)), asc(deletions.objectKey)).limit(limit);
      const queue: Array<{ waiting: string; tie: string; row: KeyDownloadSweepRow }> = [
        ...recordRows.map(({ row, waiting }) => ({ waiting, tie: `record:${row.id}`, row: { kind: 'record' as const, record: parseRecord(row) } })),
        ...stagedRows.map(({ row, waiting }) => ({ waiting, tie: `staged:${row.id}`, row: { kind: 'staged' as const, file: parseStaged(row) } })),
        ...deletionRows.map(({ row, waiting }) => ({ waiting, tie: `deletion:${row.objectKey}`, row: { kind: 'deletion' as const, deletion: parseDeletion(row) } })),
      ];
      queue.sort((left, right) => left.waiting < right.waiting ? -1 : left.waiting > right.waiting ? 1 : left.tie < right.tie ? -1 : left.tie > right.tie ? 1 : 0);
      return { rows: queue.map(({ row }) => row) };
    },
    markAttempted: async (tenantId, batch, now) => {
      const ids = (kind: KeyDownloadSweepRow['kind']) => batch.rows.flatMap((row) => row.kind !== kind ? []
        : [row.kind === 'record' ? row.record.id : row.kind === 'staged' ? row.file.id : row.deletion.objectKey]);
      const recordIds = ids('record');
      const stagedIds = ids('staged');
      const objectKeys = ids('deletion');
      if (recordIds.length > 0) {
        await db.update(records).set({ sweepAttemptedAt: now }).where(and(eq(records.tenantId, tenantId), inArray(records.id, recordIds)));
      }
      if (stagedIds.length > 0) {
        await db.update(stagedFiles).set({ sweepAttemptedAt: now }).where(and(eq(stagedFiles.tenantId, tenantId), inArray(stagedFiles.id, stagedIds)));
      }
      if (objectKeys.length > 0) {
        await db.update(deletions).set({ sweepAttemptedAt: now }).where(and(eq(deletions.tenantId, tenantId), inArray(deletions.objectKey, objectKeys)));
      }
    },
    purgeSettled: (tenantId, cutoffs) => db.transaction(async (tx) => {
      const purged = await tx.delete(records).where(and(eq(records.tenantId, tenantId), recordPurgeable(cutoffs)))
        .returning({ tenantId: records.tenantId, id: records.id, apiKeyId: records.apiKeyId });
      for (const row of purged) await appendEvent(tx, eventOf(row, 'purged', null, 'retention', cutoffs.now));
      await tx.delete(recordEvents).where(and(eq(recordEvents.tenantId, tenantId), lt(recordEvents.at, cutoffs.eventsBefore)));
      return purged.length;
    }),
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
    if (staged === undefined) {
      const [applied] = await tx.select().from(productDownloadAssets)
        .where(and(assetsOfProduct(tenantId, input.productId), eq(productDownloadAssets.id, input.stagedFileId)));
      const ownPrefix = keyDownloadStagedKey(tenantId, input.apiKeyId, input.stagedFileId, '');
      if (applied?.storageKey.startsWith(ownPrefix) !== true) return { kind: 'staged_not_found' };
      const [replaced] = input.replacesAssetId === undefined ? [] : await tx.select().from(productDownloadAssets)
        .where(and(assetsOfProduct(tenantId, input.productId), eq(productDownloadAssets.id, input.replacesAssetId)));
      const sameLineage = input.replacesAssetId === undefined
        ? applied.lineageId === applied.id
        : replaced !== undefined && replaced.lineageId === applied.lineageId && replaced.versionNumber < applied.versionNumber;
      return sameLineage && applied.versionNote === input.versionNote ? { kind: 'attached', asset: parseAsset(applied) } : { kind: 'applied_otherwise' };
    }
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
