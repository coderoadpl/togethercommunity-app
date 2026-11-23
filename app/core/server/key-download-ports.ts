import type {
  KeyDownloadFileCap,
  KeyDownloadPendingDeletion,
  KeyDownloadRecordEvent,
  KeyDownloadStagedFile,
  KeyDownloadUploadRecord,
  ProductDownloadAsset,
} from '#core/domain/index.js';

export type KeyDownloadReservation =
  | { kind: 'reserved'; record: KeyDownloadUploadRecord }
  | { kind: 'cap_exceeded'; cap: KeyDownloadFileCap }
  | { kind: 'busy' };

/**
 * `until` is when the attempt holding the record loses its lease, so that a new claim may take the record over;
 * `reclaimable` says whether the upload is still open then.
 */
export type KeyDownloadClaim =
  | { kind: 'claimed'; record: KeyDownloadUploadRecord }
  | { kind: 'completed'; record: KeyDownloadUploadRecord; file: KeyDownloadStagedFile | null }
  | { kind: 'in_progress'; until: string; reclaimable: boolean }
  | { kind: 'interrupted'; until: string; reclaimable: boolean }
  | { kind: 'expired' }
  | { kind: 'closed' }
  | { kind: 'cap_exceeded'; cap: KeyDownloadFileCap }
  | { kind: 'not_found' }
  | { kind: 'busy' };

export type KeyDownloadCompletion =
  | { kind: 'stored'; file: KeyDownloadStagedFile }
  | { kind: 'lost' }
  | { kind: 'lease_expired' }
  | { kind: 'busy' };

export type KeyDownloadInterruption = { kind: 'interrupted'; until: string } | { kind: 'kept' } | { kind: 'busy' };

/** What a locked removal step found: the objects it may delete, or why it deletes nothing. */
export type KeyDownloadObjectRemoval = 'removed' | 'failed' | 'gone' | 'kept' | 'busy';

export type KeyDownloadStagedSweep = { kind: 'owed'; deletion: KeyDownloadPendingDeletion } | { kind: 'gone' | 'kept' | 'busy' };

export type KeyDownloadSweepRow =
  | { kind: 'record'; record: KeyDownloadUploadRecord }
  | { kind: 'staged'; file: KeyDownloadStagedFile }
  | { kind: 'deletion'; deletion: KeyDownloadPendingDeletion };

interface KeyDownloadSweepBatch {
  rows: KeyDownloadSweepRow[];
}

export interface KeyDownloadSweepCutoffs {
  now: string;
  recordsStartedBefore: string;
  attemptsStartedBefore: string;
  stagedCreatedBefore: string;
  settledStartedBefore: string;
  eventsBefore: string;
}

/**
 * The staging area of shop management keys: upload and copy records (also the accounting rows of the limits, kept for
 * a day), staged files, and the object deletions still owed. Rows, never a storage listing, are what is counted and swept.
 */
export interface KeyDownloadFileRepository {
  /**
   * Under the workspace's staging lock and then the key's, counts in one statement everything the limits count (records
   * that still own an object, staged files, owed deletions, and the records started inside each window) and inserts the
   * record only when it fits.
   */
  reserve(tenantId: string, record: KeyDownloadUploadRecord, now: string): Promise<KeyDownloadReservation>;
  /**
   * In a short transaction of its own, holding the record row: moves a started upload of the key to completing under
   * `attemptId`, so exactly one request performs its storage requests. A completing or interrupted upload is taken over
   * once its attempt's lease ended, while the upload is open and still owns its upload object: the new attempt gets a
   * fresh file id from `nextFileId` and its own destination, and the superseded destination becomes an owed deletion
   * due 30 minutes after the superseded attempt started, so a copy of that attempt that lands late is never staged and
   * is still counted and deleted. A takeover holds the workspace's staging lock and then the key's, as a reservation
   * does, and answers `cap_exceeded` without changing anything when that extra file or its bytes would pass a limit.
   */
  claimCompletion(
    tenantId: string,
    apiKeyId: string,
    uploadId: string,
    attemptId: string,
    now: string,
    nextFileId: () => string,
  ): Promise<KeyDownloadClaim>;
  /**
   * Holding the record row: when the record is still completing under `attemptId` within its lease, inserts the staged
   * row, which takes ownership of the staged object, and closes the record in the same transaction. Past the lease it
   * marks the record interrupted and keeps every object with it; for another attempt it changes nothing.
   */
  finishCompletion(tenantId: string, uploadId: string, attemptId: string, file: KeyDownloadStagedFile, now: string): Promise<KeyDownloadCompletion>;
  /**
   * Holding the record row until `remove` answered, deletes what the record still owns: its candidate, and its staged
   * destination only while no staged row and no product file row points at it. An `attempt` acts only for the attempt
   * that claimed the record and marks a completing record failed with `reason`; a `sweep` acts only on a record it
   * still selects and settles it. A failed `remove` keeps the keys for the sweep. `lockWaitMs` shortens the row lock wait
   * below the repository's own bound.
   */
  releaseRecord(
    tenantId: string,
    uploadId: string,
    selection: { kind: 'attempt'; attemptId: string; destination: string; reason: string; now: string } | { kind: 'sweep'; cutoffs: KeyDownloadSweepCutoffs },
    remove: (objectKeys: readonly string[]) => Promise<boolean>,
    lockWaitMs?: number,
  ): Promise<KeyDownloadObjectRemoval>;
  /**
   * Holding the record row: an attempt whose storage outcome is unknown leaves the record interrupted, still owning its
   * upload object and its destination at their declared size, so neither is deleted while a storage write may land.
   */
  interruptAttempt(tenantId: string, uploadId: string, attemptId: string, reason: string, now: string): Promise<KeyDownloadInterruption>;
  /** The state changes of one record, oldest first, kept 30 days after each. */
  listRecordEvents(tenantId: string, recordId: string): Promise<KeyDownloadRecordEvent[]>;
  findStaged(tenantId: string, apiKeyId: string, id: string): Promise<KeyDownloadStagedFile | null>;
  listStaged(tenantId: string, apiKeyId: string): Promise<KeyDownloadStagedFile[]>;
  /** Moves the key's staged file to the owed deletions in one transaction; null when the key has no such file. */
  discard(tenantId: string, apiKeyId: string, id: string, now: string): Promise<KeyDownloadPendingDeletion | null>;
  /**
   * Holding the owed deletion's row until `remove` answered: deletes the row once `remove` answers true. A deletion whose
   * not-before time is later than `now` is kept without a storage request.
   */
  finishDeletion(tenantId: string, objectKey: string, now: string, remove: () => Promise<boolean>, lockWaitMs?: number): Promise<KeyDownloadObjectRemoval>;
  /**
   * Holding the staged row: when the file is still past its age, of a revoked or deleted key, or held by an ended
   * proposal, and no pending, unexpired proposal attaches it, moves it to the owed deletions in one transaction, as a
   * discard does, so the storage delete that follows starts only once no attach or proposal can take the file.
   */
  sweepStaged(tenantId: string, id: string, cutoffs: KeyDownloadSweepCutoffs, lockWaitMs?: number): Promise<KeyDownloadStagedSweep>;
  /**
   * Workspaces with rows the sweep selects, the one waiting longest first, by the attempt time or else the creation time.
   * Given `boundMs`, its statements and lock waits end by then, and one that runs out answers none.
   */
  listTenantIdsToSweep(cutoffs: KeyDownloadSweepCutoffs, limit: number, boundMs?: number): Promise<string[]>;
  /**
   * The rows of one workspace the sweep selects (an owed deletion only once its not-before time passed), up to `limit`
   * of each kind, in one queue ordered by the attempt time or else the creation time, longest waiting first. Given
   * `boundMs`, its statements and lock waits end by then, and one that runs out answers an empty batch.
   */
  listToSweep(tenantId: string, cutoffs: KeyDownloadSweepCutoffs, limit: number, boundMs?: number): Promise<KeyDownloadSweepBatch>;
  /**
   * Writes the attempt time on every row of the batch, so a workspace the sweep cannot serve moves behind the others;
   * given `boundMs`, its statements end by then, and one that runs out writes nothing.
   */
  markAttempted(tenantId: string, batch: KeyDownloadSweepBatch, now: string, boundMs?: number): Promise<void>;
  /**
   * Deletes up to `limit` settled records started before `settledStartedBefore`, which own no object, oldest first, and
   * up to `limit` events older than `eventsBefore`; `lockWaitMs` bounds its statements as well as its lock waits, and
   * 0 means it ran out and deleted nothing.
   */
  purgeSettled(tenantId: string, cutoffs: KeyDownloadSweepCutoffs, limit: number, lockWaitMs?: number): Promise<number>;
  /**
   * Read-only: whether every one of `ids` is a staged file of `apiKeyId` that no pending proposal unexpired at `now`
   * attaches. One answer for an unknown, another key's, discarded or attached file, so a key learns nothing more.
   */
  proposable(tenantId: string, apiKeyId: string, ids: readonly string[], now: string): Promise<boolean>;
  /**
   * In one transaction holding the staged rows: `proposals` releases (moves to the owed deletions) the files each decided
   * proposal held when `release`, and otherwise only clears their hold, so the key can propose them again; `key` releases
   * every file of a key, and `ended_holds` every file held by a proposal that was rejected or withdrawn or expired by
   * `now`. A file a pending proposal unexpired at `now` holds is never released.
   */
  release(tenantId: string, selection: KeyDownloadFileRelease, now: string): Promise<KeyDownloadRelease>;
  /** The staged rows among `ids`, whoever holds them, for the owner view. */
  listProposed(tenantId: string, ids: readonly string[]): Promise<KeyDownloadProposedFile[]>;
}

/** A ready product file as a proposal snapshot shows it: no timestamp, the fingerprint of a key-staged file or null. */
interface ChangeProposalFileSnapshotRow {
  id: string;
  lineageId: string;
  versionNumber: number;
  latest: boolean;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  fingerprint: string | null;
  versionNote: string | null;
}

/** Inside a change proposal transaction: the file reads of a snapshot and the staged file locks of an approval. */
export interface ChangeProposalProductFiles {
  listReady(tenantId: string, productId: string): Promise<ChangeProposalFileSnapshotRow[]>;
  /** Locks the staged row of `apiKeyId` until the surrounding transaction ends; null when that key holds no such file. */
  lockStaged(tenantId: string, apiKeyId: string, id: string): Promise<KeyDownloadStagedFile | null>;
}

export type KeyDownloadRelease = { kind: 'released'; owed: KeyDownloadPendingDeletion[] } | { kind: 'busy' };

/** What the owner view shows of a staged file a proposal attaches, with the live title of the product a copy came from. */
interface KeyDownloadProposedFile {
  file: KeyDownloadStagedFile;
  copiedFromTitle: string | null;
}

export type KeyDownloadFileRelease =
  | { kind: 'proposals'; decisions: ReadonlyArray<{ proposalId: string; apiKeyId: string; release: boolean }> }
  | { kind: 'key'; apiKeyId: string }
  | { kind: 'ended_holds' };

export type KeyDownloadAttachment =
  | { kind: 'attached'; asset: ProductDownloadAsset }
  | { kind: 'product_not_found' }
  | { kind: 'not_digital' }
  | { kind: 'staged_not_found' }
  | { kind: 'applied_otherwise' }
  | { kind: 'replacement_not_found' }
  | { kind: 'replacement_not_ready' }
  | { kind: 'cap_exceeded'; cap: KeyDownloadFileCap };

type KeyDownloadAssetRemoval =
  | { kind: 'removed'; asset: ProductDownloadAsset; owedDeletion: KeyDownloadPendingDeletion | null }
  | { kind: 'not_ready' }
  | { kind: 'not_found' };

/**
 * Product file writes of staged files. They run in the executor's transaction (a savepoint inside a caller's
 * transaction) and make no storage request, so they run unchanged inside a change proposal dry run or approval. Each
 * locks the product as a product deletion does: the product key-share compatibly, its stock row, then the product
 * exclusively, then the rows it changes.
 */
export interface KeyDownloadAttachRepository {
  /**
   * Inserts a ready file whose id is the staged file's id and whose object is the staged object, as a new file or as the
   * next version of `replacesAssetId`, and deletes the staged row; only a staged file of `apiKeyId` is attached. A retry
   * of an attach that already applied finds no staged row and answers the product file it made when it asks for what
   * was applied (no replacement and a lineage of its own, or a replacement in the same lineage, or exactly the stored
   * target once that version is gone, and the same version note); any other retry answers `applied_otherwise`.
   */
  attach(tenantId: string, input: {
    productId: string;
    stagedFileId: string;
    apiKeyId: string;
    replacesAssetId: string | undefined;
    versionNote: string | null;
    now: string;
  }): Promise<KeyDownloadAttachment>;
  /**
   * Deletes a file version, promotes the newest remaining ready version, and owes the deletion of a staged object; with
   * `readyOnly`, a file that is not ready is left in place and answered `not_ready`.
   */
  remove(tenantId: string, input: { productId: string; assetId: string; readyOnly: boolean; now: string }): Promise<KeyDownloadAssetRemoval>;
}
