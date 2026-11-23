import {
  CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS,
  CHANGE_PROPOSAL_FILE_LINK_TTL_SECONDS,
  changeProposalFileChecksOutOfTime,
  changeProposalDisplayStatus,
  changeProposalFileInputSchema,
  changeProposalFileUnavailable,
  changeProposalStagedFileId,
  err,
  KEY_DOWNLOAD_STORAGE_DEADLINES,
  notFound,
  ok,
  type AppError,
  type ChangeProposal,
  type ChangeProposalFileInput,
  type ChangeProposalFileLink,
  type ChangeProposalInput,
  type KeyDownloadStagedFile,
  type Result,
  type StorageConfiguration,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import { invalid, ownerSession } from '../change-proposal-access.js';
import type { Ctx } from '../context.js';
import type { KeyDownloadFileRelease, KeyDownloadFileRepository } from '../key-download-ports.js';
import { serializeErrorChain } from '../log-safety.js';
import type { ChangeProposalRepository, ChangeProposalTransactionScope, Clock, StorageProvider, TenantSecretResolver } from '../ports.js';
import { finishOwedDeletion } from './key-download-files.js';
import { resolveStorageConfiguration, storageAssetExpiresAt } from './storage-assets.js';

const credentialsOf = (configuration: StorageConfiguration) => ({
  accessKeyId: configuration.accessKeyId,
  secretAccessKey: configuration.secretAccessKey,
  region: configuration.region,
});

const logFileFailure = (deps: { logger: { error(message: string): void } }, tenantId: string, what: string, cause: unknown): void => {
  deps.logger.error(`[change-proposal] ${what} tenant=${tenantId}: ${cause instanceof Error ? serializeErrorChain(cause) : String(cause)}`);
};

export interface ProposedFileCheckDeps {
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'proposable'>;
  clock: Clock;
}

/** Read-only, before the dry run; the storing transaction checks again holding the row. */
export const checkProposedFiles = async (
  tenantId: string,
  keyId: string,
  operation: string,
  input: ChangeProposalInput,
  invalidInputMessage: string,
  deps: ProposedFileCheckDeps,
): Promise<Result<string[], AppError>> => {
  const fileId = changeProposalStagedFileId(operation, input);
  if (fileId === null) return ok([]);
  if (!await deps.keyDownloadFiles.proposable(tenantId, keyId, [fileId], deps.clock.nowIso())) {
    return err(changeProposalFileUnavailable(invalidInputMessage));
  }
  return ok([fileId]);
};

export interface ChangeProposalFileApprovalDeps {
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'findStaged'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  clock: Clock;
}

export interface ApprovalFileChecks {
  seen: ReadonlyMap<string, KeyDownloadStagedFile | null>;
}

const fileCheckKey = (proposalId: string, fileId: string): string => `${proposalId}/${fileId}`;

type FileCheck = Result<KeyDownloadStagedFile | null, AppError>;

/**
 * Runs before the approval transaction, so none of these storage requests waits under the workspace's approval lock,
 * a few at a time within one wall-clock budget. A file whose row is gone, whose object the storage reports missing or
 * whose size differs is recorded as gone; a budget that runs out or any other storage failure is answered (the first
 * in the order of the proposals) and nothing is decided.
 */
export const checkApprovalFiles = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
  deps: ChangeProposalFileApprovalDeps,
): Promise<Result<ApprovalFileChecks, AppError>> => {
  const limits = CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS;
  const endsAt = Date.parse(deps.clock.nowIso()) + limits.budgetMs;
  const left = (): number => endsAt - Date.parse(deps.clock.nowIso());
  const files = proposals.flatMap((proposal) => {
    const fileId = changeProposalStagedFileId(proposal.operation, proposal.input);
    return fileId === null ? [] : [{ proposal, fileId }];
  });
  let configuration: Promise<Result<StorageConfiguration, AppError>> | null = null;
  const configured = (): Promise<Result<StorageConfiguration, AppError>> => {
    configuration ??= resolveStorageConfiguration(tenantId, deps.secretResolver);
    return configuration;
  };
  const check = async (proposal: ChangeProposal, fileId: string): Promise<FileCheck> => {
    if (left() < limits.minimumHeadMs) return err(changeProposalFileChecksOutOfTime());
    const file = await deps.keyDownloadFiles.findStaged(tenantId, proposal.proposedByKeyId, fileId);
    if (file?.proposalId !== proposal.id) return ok(null);
    const resolved = await configured();
    if (!resolved.ok) return resolved;
    const remaining = left();
    if (remaining < limits.minimumHeadMs) return err(changeProposalFileChecksOutOfTime());
    const deadlineMs = Math.min(KEY_DOWNLOAD_STORAGE_DEADLINES.headMs, remaining);
    const head = await deps.storage.head({
      url: deps.storage.objectUrl(resolved.value, file.objectKey).toString(),
      ...credentialsOf(resolved.value),
      deadlineMs,
    });
    if (head.ok) return ok(head.value.sizeBytes === file.sizeBytes ? file : null);
    if (head.error.code === 'not_found') return ok(null);
    return deadlineMs < KEY_DOWNLOAD_STORAGE_DEADLINES.headMs ? err(changeProposalFileChecksOutOfTime()) : head;
  };
  const answers: Array<FileCheck | undefined> = files.map(() => undefined);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const index = next;
      next += 1;
      const entry = files[index];
      if (entry === undefined) return;
      const answer = await check(entry.proposal, entry.fileId);
      answers[index] = answer;
      if (!answer.ok) next = files.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limits.concurrency, files.length) }, worker));
  const seen = new Map<string, KeyDownloadStagedFile | null>();
  for (const [index, { proposal, fileId }] of files.entries()) {
    const answer = answers[index] ?? err(changeProposalFileChecksOutOfTime());
    if (!answer.ok) return answer;
    seen.set(fileCheckKey(proposal.id, fileId), answer.value);
  }
  return ok({ seen });
};

const sameStagedFile = (left: KeyDownloadStagedFile, right: KeyDownloadStagedFile): boolean =>
  left.id === right.id && left.apiKeyId === right.apiKeyId && left.objectKey === right.objectKey
  && left.sizeBytes === right.sizeBytes && left.sha256 === right.sha256 && left.proposalId === right.proposalId;

export type ApprovalFiles = { kind: 'ready' } | { kind: 'missing'; proposal: ChangeProposal; fileId: string };

/**
 * Inside the approval transaction, before any target lock: locks each attached staged row of the proposing key and
 * checks it is the file the storage confirmed and that this proposal still holds it. Only rows of the proposing key are
 * locked, and a key that proposes never attaches live, so this order never meets a live attach's product-then-file order
 * on the same row.
 */
export const prepareApprovalFiles = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
  checks: ApprovalFileChecks,
  scope: ChangeProposalTransactionScope,
): Promise<ApprovalFiles> => {
  for (const proposal of proposals) {
    const fileId = changeProposalStagedFileId(proposal.operation, proposal.input);
    if (fileId === null) continue;
    const confirmed = checks.seen.get(fileCheckKey(proposal.id, fileId)) ?? null;
    const locked = await scope.repositories.productFiles.lockStaged(tenantId, proposal.proposedByKeyId, fileId);
    if (confirmed === null || locked === null || locked.proposalId !== proposal.id || !sameStagedFile(locked, confirmed)) {
      return { kind: 'missing', proposal, fileId };
    }
  }
  return { kind: 'ready' };
};

export interface ChangeProposalFileReleaseDeps {
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'release' | 'finishDeletion'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  clock: Clock;
  logger: { error(message: string): void };
}

/** Never fails the change that committed before it: a release or deletion it cannot finish is left for the sweep. */
export const releaseStagedFiles = async (
  tenantId: string,
  selection: KeyDownloadFileRelease,
  deps: ChangeProposalFileReleaseDeps,
): Promise<void> => {
  try {
    const released = await deps.keyDownloadFiles.release(tenantId, selection, deps.clock.nowIso());
    if (released.kind === 'busy') {
      logFileFailure(deps, tenantId, 'staged file release was busy', 'left for the scheduled sweep');
      return;
    }
    if (released.owed.length === 0) return;
    const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
    if (!configuration.ok) {
      logFileFailure(deps, tenantId, 'could not delete released staged files', configuration.error.message);
      return;
    }
    for (const owed of released.owed) await finishOwedDeletion(tenantId, owed.objectKey, configuration.value, deps);
  } catch (cause) {
    logFileFailure(deps, tenantId, 'staged file release failed', cause);
  }
};

/**
 * A rejected, withdrawn or expired proposal releases the staged files it holds; a stale or failed one only lets go of
 * them, so the key can propose them again without uploading again; an applied one has consumed them.
 */
export const releaseFilesOfProposals = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
  deps: ChangeProposalFileReleaseDeps,
): Promise<void> => {
  const now = deps.clock.nowIso();
  const decisions = proposals.flatMap((proposal) => {
    if (changeProposalStagedFileId(proposal.operation, proposal.input) === null) return [];
    const status = changeProposalDisplayStatus(proposal, now);
    if (status === 'pending' || status === 'applied') return [];
    return [{ proposalId: proposal.id, apiKeyId: proposal.proposedByKeyId, release: status !== 'stale' && status !== 'failed' }];
  });
  if (decisions.length > 0) await releaseStagedFiles(tenantId, { kind: 'proposals', decisions }, deps);
};

export interface ChangeProposalFileLinkDeps {
  changeProposals: Pick<ChangeProposalRepository, 'findById'>;
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'findStaged'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  clock: Clock;
}

/**
 * A short-lived bearer link: whoever holds the address can fetch the file until it expires, so the answer is never
 * cached or logged. The signed request forces a download of an opaque type, so the bytes are never rendered.
 */
export const getChangeProposalFileLink = async (
  ctx: Ctx,
  input: ChangeProposalFileInput,
  deps: ChangeProposalFileLinkDeps,
): Promise<Result<ChangeProposalFileLink, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:read'));
  if (!tenant.ok) return tenant;
  const parsed = changeProposalFileInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal file', parsed.error);
  const tenantId = tenant.value;
  const missing = notFound('No proposed file awaiting approval under this address');
  const now = deps.clock.nowIso();
  const proposal = await deps.changeProposals.findById(tenantId, parsed.data.id);
  if (proposal === null || changeProposalDisplayStatus(proposal, now) !== 'pending') return err(missing);
  if (changeProposalStagedFileId(proposal.operation, proposal.input) !== parsed.data.fileId) return err(missing);
  const file = await deps.keyDownloadFiles.findStaged(tenantId, proposal.proposedByKeyId, parsed.data.fileId);
  if (file?.proposalId !== proposal.id) return err(missing);
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const target = deps.storage.objectUrl(configuration.value, file.objectKey);
  const head = await deps.storage.head({
    url: target.toString(),
    ...credentialsOf(configuration.value),
    deadlineMs: KEY_DOWNLOAD_STORAGE_DEADLINES.headMs,
  });
  if (!head.ok) return head.error.code === 'not_found' ? err(missing) : head;
  if (head.value.sizeBytes !== file.sizeBytes) return err(missing);
  target.searchParams.set('response-content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  target.searchParams.set('response-content-type', 'application/octet-stream');
  target.searchParams.set('response-cache-control', 'no-store');
  const signed = deps.storage.presignGet({
    url: target.toString(),
    ...credentialsOf(configuration.value),
    expiresInSeconds: CHANGE_PROPOSAL_FILE_LINK_TTL_SECONDS,
  });
  if (!signed.ok) return signed;
  return ok({
    download: {
      url: signed.value,
      expiresAt: storageAssetExpiresAt(deps.clock.nowIso(), CHANGE_PROPOSAL_FILE_LINK_TTL_SECONDS),
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
    },
  });
};
