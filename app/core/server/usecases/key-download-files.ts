import {
  appError,
  err,
  forbidden,
  integrationUnavailable,
  KEY_DOWNLOAD_FILE_LIMITS,
  KEY_DOWNLOAD_STORAGE_DEADLINES,
  keyDownloadBytesMatch,
  keyDownloadCandidateKey,
  keyDownloadCompleteInputSchema,
  keyDownloadContentTypeSchema,
  keyDownloadCopyInputSchema,
  keyDownloadCopyRefused,
  keyDownloadFileCapExceeded,
  keyDownloadFileNameSchema,
  keyDownloadFilesBusy,
  keyDownloadStagedFileView,
  keyDownloadStagedKey,
  keyDownloadTypeMismatch,
  keyDownloadUploadInputSchema,
  notFound,
  ok,
  storageFailureIsDefinite,
  validation,
  type AppError,
  type KeyDownloadCompleteInput,
  type KeyDownloadCopyInput,
  type KeyDownloadStagedFile,
  type KeyDownloadStagedFileView,
  type KeyDownloadUploadInput,
  type KeyDownloadUploadRecord,
  type Result,
  type StorageConfiguration,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import { bothAuthorized, invalid } from '../change-proposal-access.js';
import type { Ctx } from '../context.js';
import type { KeyDownloadFileRepository, KeyDownloadSweepCutoffs } from '../key-download-ports.js';
import { serializeErrorChain } from '../log-safety.js';
import type { Clock, IdGenerator, ProductDownloadAssetRepository, StorageProvider, TenantSecretResolver } from '../ports.js';
import { resolveStorageConfiguration, storageAssetExpiresAt, storageFileName } from './storage-assets.js';

export interface KeyDownloadStagingDeps {
  keyDownloadFiles: KeyDownloadFileRepository;
  downloadAssets: Pick<ProductDownloadAssetRepository, 'findById'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  ids: IdGenerator;
  clock: Clock;
  logger: { error(message: string): void };
}

interface StagingKey {
  tenantId: string;
  keyId: string;
}

/**
 * Staging belongs to shop management keys alone: a direct-mode key with catalogue write, or a propose-mode key that may
 * upload assets for catalogue proposals. A session, an impersonation or any other caller is refused.
 */
const stagingKey = (ctx: Ctx): Result<StagingKey, AppError> => {
  const actor = ctx.machineActor;
  if (actor?.kind !== 'shop_management_key' || ctx.capabilities === undefined || ctx.impersonation !== undefined) {
    return err(forbidden('Download files are staged only with a shop management key'));
  }
  const tenant = actor.mode === 'direct'
    ? authorizeTenant(ctx, 'product:write')
    : bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:catalog'));
  return tenant.ok ? ok({ tenantId: tenant.value, keyId: actor.apiKeyId }) : tenant;
};

const credentialsOf = (configuration: StorageConfiguration) => ({
  accessKeyId: configuration.accessKeyId,
  secretAccessKey: configuration.secretAccessKey,
  region: configuration.region,
});

const logFailure = (deps: { logger: { error(message: string): void } }, tenantId: string, what: string, cause: unknown): void => {
  deps.logger.error(`[key-download] ${what} tenant=${tenantId}: ${cause instanceof Error ? serializeErrorChain(cause) : String(cause)}`);
};

const deleteObjects = (
  tenantId: string,
  configuration: StorageConfiguration,
  deps: Pick<KeyDownloadStagingDeps, 'storage' | 'logger'>,
  deadlineMs: () => number = () => KEY_DOWNLOAD_STORAGE_DEADLINES.deleteMs,
) => async (objectKeys: readonly string[]): Promise<boolean> => {
  let removed = true;
  for (const objectKey of objectKeys) {
    const deleted = await deps.storage.delete({
      url: deps.storage.objectUrl(configuration, objectKey).toString(),
      ...credentialsOf(configuration),
      deadlineMs: deadlineMs(),
    });
    if (!deleted.ok) {
      logFailure(deps, tenantId, 'could not delete a staged download object', deleted.error.message);
      removed = false;
    }
  }
  return removed;
};

export interface KeyDownloadUploadStart {
  upload: {
    id: string;
    url: string;
    headers: { 'content-type': string; 'content-length': string };
    expiresAt: string;
  };
}

const reservationError = (reservation: Awaited<ReturnType<KeyDownloadFileRepository['reserve']>>): AppError | null => {
  if (reservation.kind === 'busy') return keyDownloadFilesBusy();
  if (reservation.kind === 'cap_exceeded') return keyDownloadFileCapExceeded(reservation.cap);
  return null;
};

/** The presigned write is signed for the declared size and handed out only once the record holding its share of the limits committed. */
export const beginKeyDownloadUpload = async (
  ctx: Ctx,
  input: KeyDownloadUploadInput,
  deps: KeyDownloadStagingDeps,
): Promise<Result<KeyDownloadUploadStart, AppError>> => {
  const key = stagingKey(ctx);
  if (!key.ok) return key;
  const { tenantId, keyId } = key.value;
  const parsed = keyDownloadUploadInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid download file upload', parsed.error);
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const uploadId = deps.ids.nextId();
  const fileId = deps.ids.nextId();
  const candidateKey = keyDownloadCandidateKey(tenantId, keyId, uploadId);
  const signed = deps.storage.presignPut({
    url: deps.storage.objectUrl(configuration.value, candidateKey).toString(),
    ...credentialsOf(configuration.value),
    expiresInSeconds: KEY_DOWNLOAD_FILE_LIMITS.uploadTtlSeconds,
    contentLength: parsed.data.sizeBytes,
  });
  if (!signed.ok) return signed;
  const now = deps.clock.nowIso();
  const reservation = await deps.keyDownloadFiles.reserve(tenantId, {
    tenantId,
    id: uploadId,
    apiKeyId: keyId,
    kind: 'upload',
    state: 'started',
    fileId,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    declaredBytes: parsed.data.sizeBytes,
    candidateKey,
    stagedKey: keyDownloadStagedKey(tenantId, keyId, fileId, storageFileName(parsed.data.fileName, 'download')),
    copiedFrom: null,
    attemptId: null,
    attemptAt: null,
    createdAt: now,
    completedAt: null,
  }, now);
  const refused = reservationError(reservation);
  if (refused !== null) return err(refused);
  return ok({
    upload: {
      id: uploadId,
      url: signed.value,
      headers: { 'content-type': parsed.data.contentType, 'content-length': String(parsed.data.sizeBytes) },
      expiresAt: storageAssetExpiresAt(now, KEY_DOWNLOAD_FILE_LIMITS.uploadTtlSeconds),
    },
  });
};

interface StagingAttempt {
  record: KeyDownloadUploadRecord;
  attemptId: string;
  attemptAt: string;
  destination: string;
  sourceKey: string;
  configuration: StorageConfiguration;
}

const leaseEnd = (attemptAt: string): string => new Date(Date.parse(attemptAt) + KEY_DOWNLOAD_FILE_LIMITS.completionDeadlineMs).toISOString();

const uploadExpiresAt = (record: Pick<KeyDownloadUploadRecord, 'createdAt'>): string =>
  storageAssetExpiresAt(record.createdAt, KEY_DOWNLOAD_FILE_LIMITS.uploadTtlSeconds);

/** A takeover is allowed only once the attempt's lease ended, so a storage write it left in flight has landed by then. */
const completeAgainLater = (until: string, reclaimable: boolean, now: string): AppError => reclaimable
  ? appError('unavailable', `The storage did not confirm this completion; nothing was staged. Complete this upload again after ${until}`, {
    retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(until) - Date.parse(now)) / 1000)),
  })
  : integrationUnavailable('The storage did not confirm this completion; nothing was staged. Start a new upload');

interface AttemptFailure {
  error: AppError;
  reason: string;
}

const uploadRefusal = (record: KeyDownloadUploadRecord, error: AppError, reason: string): AttemptFailure => ({
  error: record.kind === 'copy' ? keyDownloadCopyRefused() : error,
  reason,
});

/** A failure whose storage outcome is unknown deletes nothing, because a copy the provider still runs may land after any delete. */
const stageAttempt = async (
  tenantId: string,
  attempt: StagingAttempt,
  deps: KeyDownloadStagingDeps,
): Promise<Result<KeyDownloadStagedFile, AppError>> => {
  const { record, attemptId, destination, configuration } = attempt;
  const fail = async ({ error, reason }: AttemptFailure): Promise<Result<never, AppError>> => {
    await deps.keyDownloadFiles.releaseRecord(tenantId, record.id, { kind: 'attempt', attemptId, destination, reason, now: deps.clock.nowIso() }, deleteObjects(tenantId, configuration, deps));
    return err(error);
  };
  const interrupt = async (reason: string): Promise<Result<never, AppError>> => {
    const now = deps.clock.nowIso();
    await deps.keyDownloadFiles.interruptAttempt(tenantId, record.id, attemptId, reason, now);
    const until = leaseEnd(attempt.attemptAt);
    return err(record.kind === 'copy' ? keyDownloadCopyRefused() : completeAgainLater(until, until <= uploadExpiresAt(record), now));
  };
  const storageFailure = (what: string, error: AppError, definite: AttemptFailure): Promise<Result<never, AppError>> => {
    logFailure(deps, tenantId, `${what} of record ${record.id} failed`, error.message);
    return storageFailureIsDefinite(error) ? fail(definite) : interrupt(`${what.replace(/ /gu, '_')}_unconfirmed`);
  };
  const copied = await deps.storage.copyObject({
    configuration, sourceKey: attempt.sourceKey, key: destination, deadlineMs: KEY_DOWNLOAD_STORAGE_DEADLINES.copyMs,
  });
  if (!copied.ok) {
    return storageFailure('copy', copied.error, copied.error.code === 'not_found'
      ? uploadRefusal(record, validation('No file was uploaded for this upload; start a new upload'), 'source_missing')
      : uploadRefusal(record, integrationUnavailable('The storage refused to copy the uploaded file; start a new upload'), 'copy_refused'));
  }
  const digest = await deps.storage.digestObject({
    url: deps.storage.objectUrl(configuration, destination).toString(),
    ...credentialsOf(configuration),
    deadlineMs: KEY_DOWNLOAD_STORAGE_DEADLINES.digestMs,
  }, { maxBytes: record.declaredBytes, headBytes: KEY_DOWNLOAD_FILE_LIMITS.headBytes });
  const sizeMismatch = uploadRefusal(record, validation(`The uploaded file does not have the declared ${String(record.declaredBytes)} bytes; start a new upload`), 'size_mismatch');
  if (!digest.ok) return storageFailure('digest', digest.error, sizeMismatch);
  if (digest.value.sizeBytes !== record.declaredBytes) return fail(sizeMismatch);
  if (!keyDownloadBytesMatch(record.contentType, digest.value.head)) {
    return fail(uploadRefusal(record, keyDownloadTypeMismatch(record.contentType), 'type_mismatch'));
  }
  const now = deps.clock.nowIso();
  const finished = await deps.keyDownloadFiles.finishCompletion(tenantId, record.id, attemptId, {
    tenantId,
    id: record.fileId,
    apiKeyId: record.apiKeyId,
    fileName: record.fileName,
    contentType: record.contentType,
    sizeBytes: digest.value.sizeBytes,
    sha256: digest.value.sha256,
    objectKey: destination,
    copiedFrom: record.copiedFrom,
    proposalId: null,
    createdAt: now,
  }, now);
  switch (finished.kind) {
    case 'busy':
      return err(record.kind === 'copy' ? keyDownloadCopyRefused() : keyDownloadFilesBusy());
    case 'lost':
      return err(record.kind === 'copy' ? keyDownloadCopyRefused()
        : appError('conflict', 'This upload is no longer completed by this request; complete it again for its result, or start a new upload'));
    case 'lease_expired': {
      const until = leaseEnd(attempt.attemptAt);
      return err(record.kind === 'copy' ? keyDownloadCopyRefused() : completeAgainLater(until, until <= uploadExpiresAt(record), now));
    }
    case 'stored':
      break;
  }
  if (record.kind === 'upload') {
    await deps.keyDownloadFiles.releaseRecord(tenantId, record.id, { kind: 'attempt', attemptId, destination, reason: 'completed', now }, deleteObjects(tenantId, configuration, deps));
  }
  return ok(finished.file);
};

export interface KeyDownloadStagedAnswer {
  file: KeyDownloadStagedFileView;
}

export const completeKeyDownloadUpload = async (
  ctx: Ctx,
  input: KeyDownloadCompleteInput,
  deps: KeyDownloadStagingDeps,
): Promise<Result<KeyDownloadStagedAnswer, AppError>> => {
  const key = stagingKey(ctx);
  if (!key.ok) return key;
  const { tenantId, keyId } = key.value;
  const parsed = keyDownloadCompleteInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid download file completion', parsed.error);
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const attemptId = deps.ids.nextId();
  const now = deps.clock.nowIso();
  const claim = await deps.keyDownloadFiles.claimCompletion(tenantId, keyId, parsed.data.uploadId, attemptId, now);
  switch (claim.kind) {
    case 'not_found':
      return err(notFound(`No upload "${parsed.data.uploadId}" of this key`));
    case 'busy':
      return err(keyDownloadFilesBusy());
    case 'expired':
      return err(appError('conflict', 'This upload expired before it was completed; start a new upload'));
    case 'in_progress':
      return err(appError('conflict', 'This upload is being completed by another request'));
    case 'interrupted':
      return err(completeAgainLater(claim.until, claim.reclaimable, now));
    case 'closed':
      return err(appError('conflict', 'This upload can no longer be completed; start a new upload'));
    case 'completed':
      return claim.file === null
        ? err(appError('conflict', 'This upload was completed and its file is no longer staged'))
        : ok({ file: keyDownloadStagedFileView(claim.file) });
    case 'claimed': {
      const { candidateKey, stagedKey, attemptAt } = claim.record;
      if (candidateKey === null || stagedKey === null || attemptAt === null) throw new Error('A claimed upload record has no objects');
      const staged = await stageAttempt(tenantId, {
        record: claim.record, attemptId, attemptAt, destination: stagedKey, sourceKey: candidateKey, configuration: configuration.value,
      }, deps);
      return staged.ok ? ok({ file: keyDownloadStagedFileView(staged.value) }) : staged;
    }
  }
};

/**
 * A server-side copy of a ready product file of the workspace; the key never receives its bytes or a fact derived from
 * them: once the source row was found and the copy reserved, every failure answers the same refusal.
 */
export const copyKeyDownloadFile = async (
  ctx: Ctx,
  input: KeyDownloadCopyInput,
  deps: KeyDownloadStagingDeps,
): Promise<Result<KeyDownloadStagedAnswer, AppError>> => {
  const staging = stagingKey(ctx);
  if (!staging.ok) return staging;
  const read = authorizeTenant(ctx, 'product:read');
  if (!read.ok) return read;
  const { tenantId, keyId } = staging.value;
  const parsed = keyDownloadCopyInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid download file copy', parsed.error);
  const asset = await deps.downloadAssets.findById(tenantId, parsed.data.assetId);
  if (asset === null || asset.productId !== parsed.data.productId || asset.status !== 'ready') {
    return err(notFound(`No ready file "${parsed.data.assetId}" on this product`));
  }
  if (asset.sizeBytes > KEY_DOWNLOAD_FILE_LIMITS.maxBytes) {
    return err(validation(`Files larger than ${String(KEY_DOWNLOAD_FILE_LIMITS.maxBytes)} bytes cannot be copied by a key`));
  }
  const contentType = keyDownloadContentTypeSchema.safeParse(asset.contentType);
  const fileName = keyDownloadFileNameSchema.safeParse(asset.fileName);
  if (!contentType.success || !fileName.success) return err(keyDownloadCopyRefused());
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const recordId = deps.ids.nextId();
  const fileId = deps.ids.nextId();
  const attemptId = deps.ids.nextId();
  const destination = keyDownloadStagedKey(tenantId, keyId, fileId, storageFileName(fileName.data, 'download'));
  const now = deps.clock.nowIso();
  const reservation = await deps.keyDownloadFiles.reserve(tenantId, {
    tenantId,
    id: recordId,
    apiKeyId: keyId,
    kind: 'copy',
    state: 'completing',
    fileId,
    fileName: fileName.data,
    contentType: contentType.data,
    declaredBytes: asset.sizeBytes,
    candidateKey: null,
    stagedKey: destination,
    copiedFrom: { productId: asset.productId, assetId: asset.id, versionNumber: asset.versionNumber },
    attemptId,
    attemptAt: now,
    createdAt: now,
    completedAt: null,
  }, now);
  if (reservation.kind !== 'reserved') return err(reservationError(reservation) ?? keyDownloadFilesBusy());
  const staged = await stageAttempt(tenantId, {
    record: reservation.record, attemptId, attemptAt: now, destination, sourceKey: asset.storageKey, configuration: configuration.value,
  }, deps);
  return staged.ok ? ok({ file: keyDownloadStagedFileView(staged.value) }) : staged;
};

export const listKeyDownloadFiles = async (
  ctx: Ctx,
  deps: Pick<KeyDownloadStagingDeps, 'keyDownloadFiles'>,
): Promise<Result<{ files: KeyDownloadStagedFileView[] }, AppError>> => {
  const key = stagingKey(ctx);
  if (!key.ok) return key;
  const files = await deps.keyDownloadFiles.listStaged(key.value.tenantId, key.value.keyId);
  return ok({ files: files.map(keyDownloadStagedFileView) });
};

export const discardKeyDownloadFile = async (
  ctx: Ctx,
  input: { id: string },
  deps: Pick<KeyDownloadStagingDeps, 'keyDownloadFiles' | 'storage' | 'secretResolver' | 'clock' | 'logger'>,
): Promise<Result<{ discarded: true }, AppError>> => {
  const key = stagingKey(ctx);
  if (!key.ok) return key;
  const { tenantId, keyId } = key.value;
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const owed = await deps.keyDownloadFiles.discard(tenantId, keyId, input.id, deps.clock.nowIso());
  if (owed === null) return err(notFound(`No staged file "${input.id}" of this key`));
  await finishOwedDeletion(tenantId, owed.objectKey, configuration.value, deps);
  return ok({ discarded: true });
};

/** Never fails the change that committed before it: a deletion it cannot finish stays owed for the sweep. */
export const finishOwedDeletion = async (
  tenantId: string,
  objectKey: string,
  configuration: StorageConfiguration,
  deps: Pick<KeyDownloadStagingDeps, 'storage' | 'clock' | 'logger'> & { keyDownloadFiles: Pick<KeyDownloadFileRepository, 'finishDeletion'> },
): Promise<void> => {
  try {
    await deps.keyDownloadFiles.finishDeletion(tenantId, objectKey, deps.clock.nowIso(), () => deleteObjects(tenantId, configuration, deps)([objectKey]));
  } catch (cause) {
    logFailure(deps, tenantId, 'owed download object deletion failed', cause);
  }
};

const before = (now: string, ms: number): string => new Date(Date.parse(now) - ms).toISOString();

const keyDownloadSweepCutoffs = (now: string): KeyDownloadSweepCutoffs => ({
  now,
  recordsStartedBefore: before(now, KEY_DOWNLOAD_FILE_LIMITS.recordSweepAfterMs),
  attemptsStartedBefore: before(now, KEY_DOWNLOAD_FILE_LIMITS.completionDeadlineMs),
  stagedCreatedBefore: before(now, KEY_DOWNLOAD_FILE_LIMITS.stagedMaxAgeMs),
  settledStartedBefore: before(now, KEY_DOWNLOAD_FILE_LIMITS.recordRetentionMs),
  eventsBefore: before(now, KEY_DOWNLOAD_FILE_LIMITS.recordEventRetentionMs),
});

export interface KeyDownloadSweepDeps extends Pick<KeyDownloadStagingDeps, 'keyDownloadFiles' | 'storage' | 'secretResolver' | 'clock' | 'logger'> {
  batch?: { tenants: number; rows: number };
  /** Wall-clock milliseconds one run may take, checked between workspaces and rows; each storage delete gets what is left. */
  budgetMs?: number;
  /** An absolute end the caller sets, in epoch milliseconds; the run stops at the earlier of this and its own budget. */
  deadlineAt?: number;
}

const sweepTenant = async (tenantId: string, cutoffs: KeyDownloadSweepCutoffs, rows: number, left: () => number, deps: KeyDownloadSweepDeps): Promise<number> => {
  const files = deps.keyDownloadFiles;
  await files.purgeSettled(tenantId, cutoffs);
  const batch = await files.listToSweep(tenantId, cutoffs, rows);
  if (batch.rows.length === 0) return 0;
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) {
    logFailure(deps, tenantId, 'could not sweep staged download files', configuration.error.message);
    await files.markAttempted(tenantId, batch, cutoffs.now);
    return 0;
  }
  const remove = deleteObjects(tenantId, configuration.value, deps, () => Math.max(1, Math.min(KEY_DOWNLOAD_STORAGE_DEADLINES.deleteMs, left())));
  let removed = 0;
  for (const row of batch.rows) {
    if (left() < KEY_DOWNLOAD_FILE_LIMITS.sweepMinimumDeleteMs) break;
    const outcome = row.kind === 'record'
      ? await files.releaseRecord(tenantId, row.record.id, { kind: 'sweep', cutoffs }, remove)
      : row.kind === 'staged'
        ? await files.sweepStaged(tenantId, row.file.id, cutoffs, () => remove([row.file.objectKey]))
        : await files.finishDeletion(tenantId, row.deletion.objectKey, cutoffs.now, () => remove([row.deletion.objectKey]));
    if (outcome === 'removed') removed += 1;
  }
  return removed;
};

/**
 * One pass over abandoned upload and copy records, staged files past their age or of a revoked, expired or deleted
 * key, and owed deletions, within a wall-clock budget. Workspaces and rows are served longest-waiting first, and a
 * failed row records its attempt, so rows whose deletion keeps failing move behind the others instead of filling every
 * batch.
 */
export const sweepKeyDownloadFiles = async (deps: KeyDownloadSweepDeps): Promise<Result<{ tenants: number; removed: number }, AppError>> => {
  const now = deps.clock.nowIso();
  const cutoffs = keyDownloadSweepCutoffs(now);
  const endsAt = Math.min(Date.parse(now) + (deps.budgetMs ?? KEY_DOWNLOAD_FILE_LIMITS.sweepBudgetMs), deps.deadlineAt ?? Number.POSITIVE_INFINITY);
  const left = (): number => endsAt - Date.parse(deps.clock.nowIso());
  const batch = deps.batch ?? { tenants: KEY_DOWNLOAD_FILE_LIMITS.sweepTenantsPerRun, rows: KEY_DOWNLOAD_FILE_LIMITS.sweepRowsPerTenant };
  const tenants = await deps.keyDownloadFiles.listTenantIdsToSweep(cutoffs, batch.tenants);
  let removed = 0;
  let visited = 0;
  for (const tenantId of tenants) {
    if (left() < KEY_DOWNLOAD_FILE_LIMITS.sweepMinimumDeleteMs) break;
    visited += 1;
    try {
      removed += await sweepTenant(tenantId, cutoffs, batch.rows, left, deps);
    } catch (cause) {
      logFailure(deps, tenantId, 'staged download file sweep failed', cause);
    }
  }
  return ok({ tenants: visited, removed });
};
