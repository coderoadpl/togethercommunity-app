import type {
  KeyDownloadFileCap,
  KeyDownloadPendingDeletion,
  KeyDownloadStagedFile,
  KeyDownloadUploadRecord,
  ProductDownloadAsset,
} from '#core/domain/index.js';

export type KeyDownloadReservation =
  | { kind: 'reserved'; record: KeyDownloadUploadRecord }
  | { kind: 'cap_exceeded'; cap: KeyDownloadFileCap }
  | { kind: 'busy' };

export type KeyDownloadClaim =
  | { kind: 'claimed'; record: KeyDownloadUploadRecord }
  | { kind: 'completed'; record: KeyDownloadUploadRecord; file: KeyDownloadStagedFile | null }
  | { kind: 'in_progress' }
  | { kind: 'expired' }
  | { kind: 'closed' }
  | { kind: 'not_found' };

export type KeyDownloadCompletion =
  | { kind: 'stored'; file: KeyDownloadStagedFile }
  | { kind: 'lost' };

/** What a locked removal step found: the objects it may delete, or why it deletes nothing. */
export type KeyDownloadObjectRemoval = 'removed' | 'failed' | 'gone' | 'kept' | 'busy';

interface KeyDownloadSweepBatch {
  records: KeyDownloadUploadRecord[];
  stagedFiles: KeyDownloadStagedFile[];
  deletions: KeyDownloadPendingDeletion[];
}

export interface KeyDownloadSweepCutoffs {
  now: string;
  recordsStartedBefore: string;
  attemptsStartedBefore: string;
  stagedCreatedBefore: string;
  settledStartedBefore: string;
}

/**
 * The staging area of shop management keys: upload and copy records (also the accounting rows of the limits, kept for
 * a day), staged files, and the object deletions still owed. Rows, never a storage listing, are what is counted and swept.
 */
export interface KeyDownloadFileRepository {
  /**
   * Under the workspace's staging lock and then the key's, counts everything the limits count (open records, staged
   * files, owed deletions, and the records started inside each window) and inserts the record only when it fits.
   */
  reserve(tenantId: string, record: KeyDownloadUploadRecord, now: string): Promise<KeyDownloadReservation>;
  /**
   * In a short transaction of its own, holding the record row: moves a started upload of the key to completing under
   * `attemptId`, so exactly one request performs its storage requests.
   */
  claimCompletion(tenantId: string, apiKeyId: string, uploadId: string, attemptId: string, now: string): Promise<KeyDownloadClaim>;
  /**
   * Holding the record row: when the record is still completing under `attemptId`, inserts the staged row, which takes
   * ownership of the staged object, and closes the record in the same transaction; otherwise changes nothing.
   */
  finishCompletion(tenantId: string, uploadId: string, attemptId: string, file: KeyDownloadStagedFile, now: string): Promise<KeyDownloadCompletion>;
  /**
   * Holding the record row until `remove` answered, deletes what the record still owns: its candidate, and its staged
   * destination only while no staged row and no product file row points at it. An `attempt` acts only for the attempt
   * that claimed the record and marks a completing record failed; a `sweep` acts only on a record it still selects and
   * settles it. A failed `remove` keeps the keys for the sweep.
   */
  releaseRecord(
    tenantId: string,
    uploadId: string,
    selection: { kind: 'attempt'; attemptId: string; destination: string } | { kind: 'sweep'; cutoffs: KeyDownloadSweepCutoffs },
    remove: (objectKeys: readonly string[]) => Promise<boolean>,
  ): Promise<KeyDownloadObjectRemoval>;
  findStaged(tenantId: string, apiKeyId: string, id: string): Promise<KeyDownloadStagedFile | null>;
  listStaged(tenantId: string, apiKeyId: string): Promise<KeyDownloadStagedFile[]>;
  /** Moves the key's staged file to the owed deletions in one transaction; null when the key has no such file. */
  discard(tenantId: string, apiKeyId: string, id: string, now: string): Promise<KeyDownloadPendingDeletion | null>;
  /** Holding the owed deletion's row until `remove` answered: deletes the row once `remove` answers true. */
  finishDeletion(tenantId: string, objectKey: string, now: string, remove: () => Promise<boolean>): Promise<KeyDownloadObjectRemoval>;
  /**
   * Holding the staged row until `remove` answered: when the file is still past its age or of a revoked or deleted key,
   * and no pending, unexpired proposal attaches it, deletes the row once `remove` answers true.
   */
  sweepStaged(tenantId: string, id: string, cutoffs: KeyDownloadSweepCutoffs, remove: () => Promise<boolean>): Promise<KeyDownloadObjectRemoval>;
  /** Workspaces with rows the sweep selects, the one waiting longest first, by the attempt time or else the creation time. */
  listTenantIdsToSweep(cutoffs: KeyDownloadSweepCutoffs, limit: number): Promise<string[]>;
  /** The rows of one workspace the sweep selects, each kind ordered by its attempt time or else its creation time. */
  listToSweep(tenantId: string, cutoffs: KeyDownloadSweepCutoffs, limit: number): Promise<KeyDownloadSweepBatch>;
  /** Writes the attempt time on every row of the batch, so a workspace the sweep cannot serve moves behind the others. */
  markAttempted(tenantId: string, batch: KeyDownloadSweepBatch, now: string): Promise<void>;
  /** Deletes settled records started before `settledStartedBefore`; they own no object. */
  purgeSettled(tenantId: string, cutoffs: KeyDownloadSweepCutoffs): Promise<number>;
}

export type KeyDownloadAttachment =
  | { kind: 'attached'; asset: ProductDownloadAsset }
  | { kind: 'product_not_found' }
  | { kind: 'not_digital' }
  | { kind: 'staged_not_found' }
  | { kind: 'replacement_not_found' }
  | { kind: 'replacement_not_ready' }
  | { kind: 'cap_exceeded'; cap: KeyDownloadFileCap };

type KeyDownloadAssetRemoval =
  | { kind: 'removed'; asset: ProductDownloadAsset; owedDeletion: KeyDownloadPendingDeletion | null }
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
   * next version of `replacesAssetId`, and deletes the staged row; only a staged file of `apiKeyId` is attached.
   */
  attach(tenantId: string, input: {
    productId: string;
    stagedFileId: string;
    apiKeyId: string;
    replacesAssetId: string | undefined;
    versionNote: string | null;
    now: string;
  }): Promise<KeyDownloadAttachment>;
  /** Deletes a file version, promotes the newest remaining ready version, and owes the deletion of a staged object. */
  remove(tenantId: string, input: { productId: string; assetId: string; now: string }): Promise<KeyDownloadAssetRemoval>;
}
