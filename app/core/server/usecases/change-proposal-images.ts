import {
  BRANDING_PROPOSAL_IMAGE_KINDS,
  changeProposalDisplayStatus,
  changeProposalsBusy,
  changeProposalImageChanges,
  changeProposalImageInputSchema,
  changeProposalImageReferences,
  changeProposalImageNotProposable,
  changeProposalImageRefused,
  changeProposalUnproposableImageChanges,
  err,
  IMAGE_ASSET_MAX_BYTES,
  notFound,
  ok,
  parseProposalImagePath,
  parseUploadedImagePath,
  PRODUCT_COVER_PROPOSAL_IMAGE_KINDS,
  PROPOSAL_IMAGE_STORAGE_DEADLINES,
  proposalImageContentType,
  proposalImageExtensionFor,
  proposalImageKindSchema,
  proposalImagePublicPath,
  proposalImagePublishedKey,
  proposalImageQuarantineKey,
  QUARANTINED_IMAGE_LIMITS,
  sameProposalImage,
  changeProposalImageCapExceeded,
  changeProposalImageChecksOutOfTime,
  PROPOSAL_IMAGE_REUSE_CHECKS,
  storageFailureIsDefinite,
  type AppError,
  type ChangeProposal,
  type ChangeProposalEffect,
  type ChangeProposalImageInput,
  type ImageAssetUploadInput,
  type ProposalImageKind,
  type ProposalImageReference,
  type QuarantinedImageAsset,
  type Result,
  type StorageConfiguration,
  IMAGE_ASSET_UPLOAD_TTL_SECONDS,
  validation,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import { bothAuthorized, invalid, ownerSession, proposingKey, type ProposingKey } from '../change-proposal-access.js';
import type { Ctx } from '../context.js';
import { strongEntityTag } from '../entity-tag.js';
import { serializeErrorChain } from '../log-safety.js';
import type {
  ChangeProposalRepository,
  ChangeProposalTransaction,
  ChangeProposalTransactionScope,
  Clock,
  ContentHash,
  IdGenerator,
  QuarantinedImageLocks,
  QuarantinedImageRelease,
  QuarantinedImageRepository,
  StorageProvider,
  TenantSecretResolver,
} from '../ports.js';
import { beginCandidateUpload, readCandidateImage, type ImageAssetDeps, type ImageAssetUploadStart } from './image-assets.js';
import { resolveStorageConfiguration } from './storage-assets.js';
import { sweepDeleteDeadline, sweepLockWait, sweepStageBudget, sweepStatementBound, UNBOUNDED, type StagingSweepOutcome, type SweepBudget } from './sweep-budget.js';

type ProposedImageFamily = 'catalog' | 'settings';

const KINDS_BY_FAMILY: Record<ProposedImageFamily, readonly ProposalImageKind[]> = {
  catalog: PRODUCT_COVER_PROPOSAL_IMAGE_KINDS,
  settings: BRANDING_PROPOSAL_IMAGE_KINDS,
};

const credentialsOf = (configuration: StorageConfiguration) => ({
  accessKeyId: configuration.accessKeyId,
  secretAccessKey: configuration.secretAccessKey,
  region: configuration.region,
});

export interface ChangeProposalImageReleaseDeps {
  quarantinedImages: Pick<QuarantinedImageRepository, 'release' | 'finishRelease' | 'markReleaseAttempted'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  logger: { error(message: string): void };
  clock: Clock;
}

const logImageFailure = (deps: { logger: { error(message: string): void } }, tenantId: string, what: string, cause: unknown): void => {
  deps.logger.error(`[change-proposal] ${what} tenant=${tenantId}: ${cause instanceof Error ? serializeErrorChain(cause) : String(cause)}`);
};

const deleteDeadline = (budget: SweepBudget): number => sweepDeleteDeadline(budget, PROPOSAL_IMAGE_STORAGE_DEADLINES.deleteMs, 0);

const spent = (budget: SweepBudget): boolean => sweepLockWait(budget, 1) === null;

const finishReleases = async (
  tenantId: string,
  assets: readonly QuarantinedImageAsset[],
  deps: ChangeProposalImageReleaseDeps,
  budget: SweepBudget,
): Promise<number> => {
  if (assets.length === 0) return 0;
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) {
    logImageFailure(deps, tenantId, 'could not remove released quarantined images', configuration.error.message);
    await deps.quarantinedImages.markReleaseAttempted(tenantId, assets, deps.clock.nowIso(), sweepStatementBound(budget));
    return 0;
  }
  let removed = 0;
  for (const asset of assets) {
    const wait = sweepLockWait(budget, 1);
    if (wait === null) break;
    const finished = await deps.quarantinedImages.finishRelease(tenantId, asset, async () => {
      const deleted = await deps.storage.delete({
        url: deps.storage.objectUrl(configuration.value, proposalImageQuarantineKey(tenantId, asset.apiKeyId, asset)).toString(),
        ...credentialsOf(configuration.value),
        deadlineMs: deleteDeadline(budget),
      });
      if (deleted.ok) return 'deleted';
      logImageFailure(deps, tenantId, 'could not remove a released quarantined image', deleted.error.message);
      return storageFailureIsDefinite(deleted.error) ? 'failed' : 'unresolved';
    }, deps.clock.nowIso(), wait);
    if (finished === 'removed') removed += 1;
  }
  return removed;
};

const releaseImages = async (
  tenantId: string,
  selection: QuarantinedImageRelease,
  deps: ChangeProposalImageReleaseDeps,
  budget: SweepBudget = UNBOUNDED,
): Promise<number> => {
  const wait = sweepLockWait(budget, 1);
  if (wait === null) return 0;
  const released = await deps.quarantinedImages.release(tenantId, selection, deps.clock.nowIso(), wait);
  if (released.kind === 'busy') {
    logImageFailure(deps, tenantId, 'quarantined image release was busy', 'left for the scheduled sweep');
    return 0;
  }
  return finishReleases(tenantId, released.value, deps, budget);
};

/**
 * Never fails the decision that committed before it: rows are marked released in one transaction and each object is
 * removed afterwards with its row; what a failed or busy step leaves released, the sweep finishes.
 */
export const releaseQuarantinedImages = async (
  tenantId: string,
  selection: QuarantinedImageRelease,
  deps: ChangeProposalImageReleaseDeps,
): Promise<void> => {
  try {
    await releaseImages(tenantId, selection, deps);
  } catch (cause) {
    logImageFailure(deps, tenantId, 'quarantined image release failed', cause);
  }
};

export const releaseImagesOfProposals = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
  deps: ChangeProposalImageReleaseDeps,
): Promise<void> => {
  const byKey = new Map<string, ProposalImageReference[]>();
  for (const proposal of proposals) {
    const images = byKey.get(proposal.proposedByKeyId) ?? [];
    for (const image of changeProposalImageReferences(proposal.operation, proposal.input)) {
      if (!images.some((known) => sameProposalImage(known, image))) images.push(image);
    }
    byKey.set(proposal.proposedByKeyId, images);
  }
  for (const [apiKeyId, images] of byKey) {
    if (images.length > 0) await releaseQuarantinedImages(tenantId, { kind: 'key', apiKeyId, images }, deps);
  }
};

export interface ProposedImageUploadDeps extends ImageAssetDeps {
  quarantinedImages: Pick<QuarantinedImageRepository, 'recordUpload'>;
}

/** The presigned write is signed for the declared size, and recorded first so the sweep removes whatever it leaves behind. */
const beginProposedImageUpload = async (
  key: Result<ProposingKey, AppError>,
  family: ProposedImageFamily,
  input: ImageAssetUploadInput,
  deps: ProposedImageUploadDeps,
): Promise<Result<ImageAssetUploadStart, AppError>> => {
  if (!key.ok) return key;
  const { keyId } = key.value;
  return beginCandidateUpload(key.value.tenantId, KINDS_BY_FAMILY[family], input, deps, {
    signContentLength: true,
    maxBytes: QUARANTINED_IMAGE_LIMITS.imageMaxBytes,
    reserve: async (tenantId, objectKey) => {
      const createdAt = deps.clock.nowIso();
      const countedAfter = new Date(Date.parse(createdAt) - IMAGE_ASSET_UPLOAD_TTL_SECONDS * 1000).toISOString();
      const recorded = await deps.quarantinedImages.recordUpload(tenantId, { apiKeyId: keyId, objectKey, createdAt }, countedAfter);
      return recorded.kind === 'recorded' ? ok(undefined) : err(changeProposalImageCapExceeded(recorded.cap));
    },
  });
};

export const beginProposedProductCoverUpload = (ctx: Ctx, input: ImageAssetUploadInput, deps: ProposedImageUploadDeps) => beginProposedImageUpload(
  proposingKey(ctx, bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:catalog'))),
  'catalog',
  input,
  deps,
);

export const beginProposedBrandingAssetUpload = (ctx: Ctx, input: ImageAssetUploadInput, deps: ProposedImageUploadDeps) => beginProposedImageUpload(
  proposingKey(ctx, bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:settings'))),
  'settings',
  input,
  deps,
);

export interface ProposedImageCompleteDeps {
  quarantinedImages: Pick<QuarantinedImageRepository, 'insert' | 'findUpload' | 'markUploadCompleted'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  contentHash: ContentHash;
  clock: Clock;
}

export interface QuarantinedImageUpload {
  url: string;
  quarantined: true;
}

const completeProposedImageUpload = async (
  key: Result<ProposingKey, AppError>,
  family: ProposedImageFamily,
  input: { key: string },
  deps: ProposedImageCompleteDeps,
): Promise<Result<QuarantinedImageUpload, AppError>> => {
  if (!key.ok) return key;
  const { tenantId, keyId } = key.value;
  const started = await deps.quarantinedImages.findUpload(tenantId, input.key);
  if (started?.apiKeyId !== keyId) return err(notFound('Image asset not found'));
  if (started.completed !== null) {
    const completedKind = proposalImageKindSchema.safeParse(input.key.split('/')[2]);
    if (!completedKind.success || !KINDS_BY_FAMILY[family].includes(completedKind.data)) return err(notFound('Image asset not found'));
    return ok({ url: proposalImagePublicPath({ kind: completedKind.data, ...started.completed }), quarantined: true });
  }
  const candidate = await readCandidateImage(tenantId, KINDS_BY_FAMILY[family], input, deps);
  if (!candidate.ok) return candidate;
  const { file, bytes, configuration, credentials, candidateUrl, contentType } = candidate.value;
  const kind = proposalImageKindSchema.safeParse(candidate.value.kind);
  const extension = proposalImageExtensionFor(file);
  if (!kind.success || extension === null) return err(notFound('Image asset not found'));
  const image: ProposalImageReference = { kind: kind.data, digest: deps.contentHash.sha256(bytes), extension };
  const quarantinedUrl = deps.storage.objectUrl(configuration, proposalImageQuarantineKey(tenantId, keyId, image)).toString();
  const inserted = await deps.quarantinedImages.insert(tenantId, {
    tenantId,
    apiKeyId: keyId,
    ...image,
    sizeBytes: bytes.byteLength,
    createdAt: deps.clock.nowIso(),
  }, {
    present: async (existing) => {
      const found = await deps.storage.head({ url: quarantinedUrl, ...credentials, deadlineMs: PROPOSAL_IMAGE_STORAGE_DEADLINES.headMs });
      if (found.ok) return ok(found.value.sizeBytes === existing.sizeBytes);
      return found.error.code === 'not_found' ? ok(false) : err(found.error);
    },
    store: () => deps.storage.putObject({ url: quarantinedUrl, ...credentials, body: bytes, contentType }),
  });
  if (inserted.kind === 'busy') return err(changeProposalsBusy());
  if (inserted.kind === 'cap_exceeded' || inserted.kind === 'store_failed') {
    const removed = await deps.storage.delete({ url: candidateUrl, ...credentials });
    if (!removed.ok) return removed;
    return err(inserted.kind === 'cap_exceeded' ? changeProposalImageCapExceeded(inserted.cap) : inserted.error);
  }
  const recorded = await deps.quarantinedImages.markUploadCompleted(tenantId, input.key, { digest: image.digest, extension: image.extension });
  const removed = await deps.storage.delete({ url: candidateUrl, ...credentials });
  if (!removed.ok) return removed;
  return ok({ url: proposalImagePublicPath({ kind: image.kind, ...(recorded ?? image) }), quarantined: true });
};

export const completeProposedProductCoverUpload = (ctx: Ctx, input: { key: string }, deps: ProposedImageCompleteDeps) => completeProposedImageUpload(
  proposingKey(ctx, bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:catalog'))),
  'catalog',
  input,
  deps,
);

export const completeProposedBrandingAssetUpload = (ctx: Ctx, input: { key: string }, deps: ProposedImageCompleteDeps) => completeProposedImageUpload(
  proposingKey(ctx, bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:settings'))),
  'settings',
  input,
  deps,
);

export interface ProposedImageCheckDeps {
  quarantinedImages: Pick<QuarantinedImageRepository, 'find' | 'inLiveUse'>;
}

/** Clearing a field or leaving it unchanged puts no image change into the effect, so neither is checked. */
export const checkProposedImages = async (
  tenantId: string,
  keyId: string,
  operation: string,
  effect: ChangeProposalEffect,
  invalidInputMessage: string,
  deps: ProposedImageCheckDeps,
): Promise<Result<ProposalImageReference[], AppError>> => {
  const unproposable = changeProposalUnproposableImageChanges(operation, effect);
  if (unproposable.length > 0) return err(changeProposalImageNotProposable(invalidInputMessage, unproposable));
  const images: ProposalImageReference[] = [];
  for (const change of changeProposalImageChanges(operation, effect)) {
    const quarantined = parseProposalImagePath(change.value);
    if (quarantined !== null && quarantined.kind === change.kind && await deps.quarantinedImages.find(tenantId, keyId, quarantined) !== null) {
      images.push(quarantined);
      continue;
    }
    const pathKind = quarantined?.kind ?? parseUploadedImagePath(change.value)?.kind ?? null;
    if (pathKind === change.kind && await deps.quarantinedImages.inLiveUse(tenantId, change.value)) continue;
    return err(changeProposalImageRefused(invalidInputMessage, change.field, change.kind));
  }
  return ok(images);
};

export const changeProposalImageGone = (invalidInputMessage: string): AppError => validation(invalidInputMessage, {
  formErrors: ['An image this key uploaded for approval is no longer available; upload it again'],
  fieldErrors: {},
});

/** `bytes` is null for a reused public copy, which approval never writes. */
interface PreparedImage {
  image: ProposalImageReference;
  bytes: Uint8Array | null;
}

export type ApprovalImages =
  | { kind: 'ready'; images: PreparedImage[]; configuration: StorageConfiguration | null }
  | { kind: 'missing'; proposal: ChangeProposal; image: ProposalImageReference }
  | { kind: 'failed'; error: AppError };

export interface ChangeProposalImagePrepareDeps {
  storage: StorageProvider;
  contentHash: ContentHash;
}

/** The images the stored effect sets, the effect the owner reviewed; an unchanged address the input repeats is not one of them. */
const changedImagesOf = (proposals: readonly ChangeProposal[]): Array<{ proposal: ChangeProposal; image: ProposalImageReference }> => {
  const changed: Array<{ proposal: ChangeProposal; image: ProposalImageReference }> = [];
  for (const proposal of proposals) {
    for (const change of changeProposalImageChanges(proposal.operation, proposal.effect)) {
      const image = parseProposalImagePath(change.value);
      if (image === null || image.kind !== change.kind || changed.some((known) => sameProposalImage(known.image, image))) continue;
      changed.push({ proposal, image });
    }
  }
  return changed;
};

const readVerified = async (
  configuration: StorageConfiguration,
  key: string,
  image: ProposalImageReference,
  deps: ChangeProposalImagePrepareDeps,
): Promise<Result<Uint8Array | null, AppError>> => {
  const read = await deps.storage.getObject({
    url: deps.storage.objectUrl(configuration, key).toString(),
    ...credentialsOf(configuration),
    deadlineMs: PROPOSAL_IMAGE_STORAGE_DEADLINES.getMs,
  }, { maxBytes: IMAGE_ASSET_MAX_BYTES });
  if (!read.ok) return read.error.code === 'not_found' ? ok(null) : read;
  return ok(deps.contentHash.sha256(read.value) === image.digest ? read.value : null);
};

/** `etag` is the strong entity tag of the read whose bytes hashed to the digest, null when that read carried none. */
interface ReusedPublicCopy {
  image: ProposalImageReference;
  sizeBytes: number;
  etag: string | null;
}

/** Without a strong entity tag, equal metadata says nothing about the bytes, so the copy is read and hashed again. */
const stillTheReusedCopy = async (
  tenantId: string,
  configuration: StorageConfiguration,
  copy: ReusedPublicCopy,
  deps: ChangeProposalImagePrepareDeps,
): Promise<Result<boolean, AppError>> => {
  const url = deps.storage.objectUrl(configuration, proposalImagePublishedKey(tenantId, copy.image)).toString();
  if (copy.etag === null) {
    const read = await deps.storage.getObject({ url, ...credentialsOf(configuration), deadlineMs: PROPOSAL_IMAGE_STORAGE_DEADLINES.getMs }, { maxBytes: IMAGE_ASSET_MAX_BYTES });
    if (!read.ok) return read.error.code === 'not_found' ? ok(false) : err(read.error);
    return ok(deps.contentHash.sha256(read.value) === copy.image.digest);
  }
  const head = await deps.storage.head({ url, ...credentialsOf(configuration), deadlineMs: PROPOSAL_IMAGE_STORAGE_DEADLINES.headMs });
  if (!head.ok) return head.error.code === 'not_found' ? ok(false) : err(head.error);
  return ok(head.value.sizeBytes === copy.sizeBytes && head.value.etag === copy.etag);
};

/**
 * An address that is no longer quarantined is fine only when a live field already shows it and its public copy hashed
 * to the digest before the transaction, the copy the owner preview showed. A public copy that changed since that check
 * makes an address without a quarantined copy stale and answers busy for one with a quarantined copy.
 */
export const prepareApprovalImages = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
  publication: ApprovalPublication,
  scope: ChangeProposalTransactionScope,
  deps: ChangeProposalImagePrepareDeps,
): Promise<ApprovalImages> => {
  const images: PreparedImage[] = [];
  let configuration: StorageConfiguration | null = null;
  for (const { proposal, image } of changedImagesOf(proposals)) {
    const quarantined = await scope.repositories.quarantinedImages.lockForPublication(tenantId, proposal.proposedByKeyId, image);
    const published = quarantined === null;
    if (published && !await scope.repositories.quarantinedImages.inLiveUse(tenantId, proposalImagePublicPath(image))) {
      return { kind: 'missing', proposal, image };
    }
    if (configuration === null) {
      const resolved = await resolveStorageConfiguration(tenantId, scope.secretResolver);
      if (!resolved.ok) return { kind: 'failed', error: resolved.error };
      configuration = resolved.value;
    }
    const reused = publication.reused.find((copy) => sameProposalImage(copy.image, image));
    if (reused !== undefined) {
      const same = await stillTheReusedCopy(tenantId, configuration, reused, deps);
      if (!same.ok) return { kind: 'failed', error: same.error };
      if (!same.value) return published ? { kind: 'missing', proposal, image } : { kind: 'failed', error: changeProposalsBusy() };
      images.push({ image, bytes: null });
      continue;
    }
    if (published) return { kind: 'missing', proposal, image };
    const read = await readVerified(configuration, proposalImageQuarantineKey(tenantId, proposal.proposedByKeyId, image), image, deps);
    if (!read.ok) return { kind: 'failed', error: read.error };
    if (read.value === null) return { kind: 'missing', proposal, image };
    images.push({ image, bytes: read.value });
  }
  return { kind: 'ready', images, configuration };
};

export interface ApprovalPublication {
  attemptId: string;
  images: ProposalImageReference[];
  startedAt: string;
  reused: ReusedPublicCopy[];
}

export interface ChangeProposalImagePublishDeps extends ChangeProposalImagePrepareDeps {
  quarantinedImages: Pick<QuarantinedImageRepository, 'recordPublications'>;
  secretResolver: TenantSecretResolver;
  ids: IdGenerator;
  clock: Clock;
}

const checkPublicCopy = async (
  tenantId: string,
  configuration: StorageConfiguration,
  image: ProposalImageReference,
  deps: ChangeProposalImagePublishDeps,
  left: () => number,
): Promise<Result<ReusedPublicCopy | null, AppError>> => {
  const url = deps.storage.objectUrl(configuration, proposalImagePublishedKey(tenantId, image)).toString();
  const deadline = (requestMs: number): number | null => {
    const remaining = left();
    return remaining < PROPOSAL_IMAGE_REUSE_CHECKS.minimumRequestMs ? null : Math.min(requestMs, remaining);
  };
  const getMs = deadline(PROPOSAL_IMAGE_STORAGE_DEADLINES.getMs);
  if (getMs === null) return err(changeProposalImageChecksOutOfTime());
  const request = { url, ...credentialsOf(configuration), deadlineMs: getMs };
  const options = { maxBytes: IMAGE_ASSET_MAX_BYTES };
  const read = deps.storage.getObjectVersion === undefined
    ? await deps.storage.getObject(request, options).then((bytes) => bytes.ok ? ok({ bytes: bytes.value, etag: null }) : bytes)
    : await deps.storage.getObjectVersion(request, options);
  if (!read.ok) return read.error.code === 'not_found' ? ok(null) : err(read.error);
  if (deps.contentHash.sha256(read.value.bytes) !== image.digest) return ok(null);
  return ok({ image, sizeBytes: read.value.bytes.byteLength, etag: strongEntityTag(read.value.etag) });
};

/**
 * Runs before the approval transaction, so its single insert never waits for a second connection while the approval
 * holds one, and a public copy whose read carried a strong entity tag is not read again under the workspace's approval
 * lock. It checks the public copy of
 * each image the effect sets, `PROPOSAL_IMAGE_REUSE_CHECKS.concurrency` at a time within its budget, and records, in a
 * commit of its own, the attempt's intent to write each image whose public object is missing or no longer hashes to
 * the digest; an object that does is never written or recorded. What a record leaves behind when the attempt does not
 * end applied, the withdrawal or the sweep removes.
 */
export const recordApprovalPublications = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
  deps: ChangeProposalImagePublishDeps,
): Promise<Result<ApprovalPublication, AppError>> => {
  const images = changedImagesOf(proposals).map(({ image }) => image);
  const none = { attemptId: '', images: [], startedAt: '' };
  if (images.length === 0) return ok({ ...none, reused: [] });
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const endsAt = Date.parse(deps.clock.nowIso()) + PROPOSAL_IMAGE_REUSE_CHECKS.budgetMs;
  const left = (): number => endsAt - Date.parse(deps.clock.nowIso());
  const answers: Array<Result<ReusedPublicCopy | null, AppError> | undefined> = images.map(() => undefined);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next; index < images.length; index = next) {
      next += 1;
      const image = images[index];
      if (image === undefined) return;
      const answer = await checkPublicCopy(tenantId, configuration.value, image, deps, left);
      answers[index] = answer;
      if (!answer.ok) next = images.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROPOSAL_IMAGE_REUSE_CHECKS.concurrency, images.length) }, worker));
  const absent: ProposalImageReference[] = [];
  const reused: ReusedPublicCopy[] = [];
  for (const [index, image] of images.entries()) {
    const answer = answers[index] ?? err(changeProposalImageChecksOutOfTime());
    if (!answer.ok) return answer;
    if (answer.value === null) absent.push(image);
    else reused.push(answer.value);
  }
  if (absent.length === 0) return ok({ ...none, reused });
  const attemptId = deps.ids.nextId();
  const startedAt = deps.clock.nowIso();
  await deps.quarantinedImages.recordPublications(tenantId, attemptId, absent, startedAt);
  return ok({ attemptId, images: absent, startedAt, reused });
};

export interface ApprovalImageWrites {
  written: ProposalImageReference[];
  unconfirmed: ProposalImageReference[];
}

export const noApprovalImageWrites = (): ApprovalImageWrites => ({ written: [], unconfirmed: [] });

/**
 * Writes the verified bytes of each recorded image to its public, content-addressed key and deletes the attempt's
 * records, inside the approval transaction once the outcome is applied and before COMMIT, so committed live state
 * never points at an object that does not exist and the records disappear exactly when the approval commits. Every
 * image it tries to write, a failed write included, is added to `writes.written`, and a write whose outcome is unknown
 * (no answer before the deadline, a connection error, a server error) also to `writes.unconfirmed`. An image not
 * recorded was checked under this transaction's lock by `prepareApprovalImages`; that lock, and the refusal of any
 * address with an unresolved delete, keep it there until the commit.
 * A write starts only within `publicationWriteWindowMs` of the intent record, or the approval answers busy; the sweep's
 * age bound is that window plus `unresolvedDeleteGraceMs`, so a process that dies mid-write still leaves the storage the
 * whole grace after the latest write it could have started.
 */
export const publishApprovalImages = async (
  tenantId: string,
  prepared: Extract<ApprovalImages, { kind: 'ready' }>,
  publication: ApprovalPublication,
  scope: ChangeProposalTransactionScope,
  deps: ChangeProposalImagePrepareDeps & { clock: Clock },
  writes: ApprovalImageWrites,
): Promise<Result<void, AppError>> => {
  const images = scope.repositories.quarantinedImages;
  const recorded = (image: ProposalImageReference) => publication.images.some((known) => sameProposalImage(known, image));
  for (const image of [...publication.images, ...prepared.images.map((known) => known.image)]) {
    if (await images.deleteUnresolved(tenantId, image)) return err(changeProposalsBusy());
  }
  const toWrite = prepared.images.filter(({ bytes }) => bytes !== null).map(({ image }) => image);
  if (toWrite.some((image) => !recorded(image))) return err(changeProposalsBusy());
  if (toWrite.length > 0 && !await images.claimPublications(tenantId, publication.attemptId, toWrite)) return err(changeProposalsBusy());
  const { configuration } = prepared;
  if (configuration !== null) {
    for (const { image, bytes } of prepared.images) {
      if (bytes === null) continue;
      if (Date.parse(deps.clock.nowIso()) - Date.parse(publication.startedAt) > QUARANTINED_IMAGE_LIMITS.publicationWriteWindowMs) {
        return err(changeProposalsBusy());
      }
      writes.written.push(image);
      const stored = await deps.storage.putObject({
        url: deps.storage.objectUrl(configuration, proposalImagePublishedKey(tenantId, image)).toString(),
        ...credentialsOf(configuration),
        body: bytes,
        contentType: proposalImageContentType(image.extension),
        ...(image.extension === 'svg' ? { contentDisposition: 'attachment' } : {}),
        deadlineMs: PROPOSAL_IMAGE_STORAGE_DEADLINES.putMs,
      });
      if (!stored.ok) {
        if (!storageFailureIsDefinite(stored.error)) writes.unconfirmed.push(image);
        return stored;
      }
    }
  }
  if (publication.images.length > 0) await images.settlePublications(tenantId, publication.attemptId);
  return ok(undefined);
};

export interface ChangeProposalImageWithdrawDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  storage: StorageProvider;
  logger: { error(message: string): void };
  clock: Clock;
}

type PublicationRemoval = 'removed' | 'kept' | 'stale';

const PUBLICATION_REMOVAL_FAILURE = 'could not withdraw an image published by an approval that did not apply';

/**
 * Holds the workspace's approval lock, so no approval can publish the same address between the check and the deletion.
 * When `written`, it deletes the public object, except when a live field shows the address or an applied proposal
 * carries it: then an applied approval published it, and product history may still point at it. The delete is sent
 * only after a commit has marked the record with an unresolved delete, which every approval of the address refuses, so
 * a delete that outlives this process never removes an image a later approval published; a confirmed delete or a
 * refused one clears the mark, and one without a definite answer leaves it for the sweep, which deletes the object
 * again after the record's age bound counted from the mark. When `keepRecord`, the record stays after the delete, so
 * the sweep deletes the object once more after the record's age bound: a write whose outcome was unknown may still land
 * after this delete. With `dueBefore`, a record that is no longer due under the lock, because another sweep marked its
 * delete after this one listed it, is `stale`: nothing is sent and nothing is written. Without it, a record that carries
 * a mark is left as it is, since the delete of that mark may still be in flight. After its delete, a removal whose
 * mark another removal has replaced meanwhile is `stale` too and changes nothing, so it never clears the fence of a
 * delete still in flight.
 */
const removePublication = async (
  tenantId: string,
  attemptId: string,
  image: ProposalImageReference,
  written: { written: boolean; keepRecord: boolean; dueBefore?: string },
  deps: ChangeProposalImageWithdrawDeps,
  budget: SweepBudget = UNBOUNDED,
): Promise<PublicationRemoval> => {
  const lockWaitMs = sweepLockWait(budget, 1);
  if (lockWaitMs === null) return 'kept';
  const underLock = async <T>(work: (images: QuarantinedImageLocks, scope: ChangeProposalTransactionScope) => Promise<Result<T, AppError>>) => {
    const done = await deps.changeProposalTransaction.run(tenantId, (scope) => work(scope.repositories.quarantinedImages, scope),
      lockWaitMs === undefined ? {} : { lockWaitMs });
    if (!done.ok) logImageFailure(deps, tenantId, PUBLICATION_REMOVAL_FAILURE, done.error.message);
    return done;
  };
  const settle = (images: QuarantinedImageLocks): Promise<PublicationRemoval> => written.keepRecord
    ? images.restartPublication(tenantId, attemptId, image, deps.clock.nowIso()).then(() => 'kept')
    : images.deletePublication(tenantId, attemptId, image).then(() => 'removed');
  const claimed = await underLock(async (images, scope): Promise<Result<PublicationRemoval | { configuration: StorageConfiguration; mark: string }, AppError>> => {
    const record = await images.lockPublication(tenantId, attemptId, image, written.dueBefore);
    if (record === null) return ok('stale');
    if (written.dueBefore === undefined && record.deleteUnresolvedAt !== null) return ok('kept');
    const path = proposalImagePublicPath(image);
    if (!written.written || await images.inLiveUse(tenantId, path) || await images.inAppliedProposal(tenantId, path)) return ok(await settle(images));
    const configuration = await resolveStorageConfiguration(tenantId, scope.secretResolver);
    if (!configuration.ok) return configuration;
    const mark = deps.clock.nowIso();
    await images.markDeleteUnresolved(tenantId, attemptId, image, mark);
    return ok({ configuration: configuration.value, mark });
  });
  if (!claimed.ok) return 'kept';
  if (typeof claimed.value === 'string') return claimed.value;
  const { configuration, mark } = claimed.value;
  const deleted = await deps.storage.delete({
    url: deps.storage.objectUrl(configuration, proposalImagePublishedKey(tenantId, image)).toString(),
    ...credentialsOf(configuration),
    deadlineMs: deleteDeadline(budget),
  });
  if (!deleted.ok) logImageFailure(deps, tenantId, PUBLICATION_REMOVAL_FAILURE, deleted.error.message);
  if (!deleted.ok && !storageFailureIsDefinite(deleted.error)) return 'kept';
  const settled = await underLock(async (images): Promise<Result<PublicationRemoval, AppError>> => {
    if ((await images.lockPublication(tenantId, attemptId, image))?.deleteUnresolvedAt !== mark) return ok('stale');
    await images.markDeleteUnresolved(tenantId, attemptId, image, null);
    return ok(deleted.ok ? await settle(images) : 'kept');
  });
  return settled.ok ? settled.value : 'kept';
};

/** Runs after an approval that did not end applied; a record it cannot remove, or keeps after an unknown write, stays for the sweep. */
export const withdrawPublishedImages = async (
  tenantId: string,
  publication: ApprovalPublication,
  writes: ApprovalImageWrites,
  deps: ChangeProposalImageWithdrawDeps,
): Promise<void> => {
  for (const image of publication.images) {
    try {
      await removePublication(tenantId, publication.attemptId, image, {
        written: writes.written.some((known) => sameProposalImage(known, image)),
        keepRecord: writes.unconfirmed.some((known) => sameProposalImage(known, image)),
      }, deps);
    } catch (cause) {
      logImageFailure(deps, tenantId, PUBLICATION_REMOVAL_FAILURE, cause);
    }
  }
};

export interface ChangeProposalImagePreview {
  bytes: Uint8Array;
  contentType: string;
  disposition: 'inline' | 'attachment';
  fileName: string;
}

export interface ChangeProposalImagePreviewDeps {
  changeProposals: Pick<ChangeProposalRepository, 'findById'>;
  quarantinedImages: Pick<QuarantinedImageRepository, 'find' | 'inLiveUse'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  contentHash: ContentHash;
  clock: Clock;
}

/** An attached address with no quarantined row is accepted only while a live field shows it, so its published copy is what approval keeps. */
const previewObjectKey = async (
  tenantId: string,
  proposal: ChangeProposal,
  image: ProposalImageReference,
  deps: ChangeProposalImagePreviewDeps,
): Promise<string | null> => {
  if (await deps.quarantinedImages.find(tenantId, proposal.proposedByKeyId, image) !== null) {
    return proposalImageQuarantineKey(tenantId, proposal.proposedByKeyId, image);
  }
  return await deps.quarantinedImages.inLiveUse(tenantId, proposalImagePublicPath(image)) ? proposalImagePublishedKey(tenantId, image) : null;
};

export const getChangeProposalImage = async (
  ctx: Ctx,
  input: ChangeProposalImageInput,
  deps: ChangeProposalImagePreviewDeps,
): Promise<Result<ChangeProposalImagePreview, AppError>> => {
  const tenant = ownerSession(ctx, authorizeTenant(ctx, 'proposal:read'));
  if (!tenant.ok) return tenant;
  const parsed = changeProposalImageInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid change proposal image', parsed.error);
  const tenantId = tenant.value;
  const missing = notFound('No image awaiting approval under this address');
  const proposal = await deps.changeProposals.findById(tenantId, parsed.data.id);
  if (proposal === null || changeProposalDisplayStatus(proposal, deps.clock.nowIso()) !== 'pending') return err(missing);
  const image = changeProposalImageReferences(proposal.operation, proposal.input).find((candidate) => candidate.digest === parsed.data.digest);
  if (image === undefined) return err(missing);
  const objectKey = await previewObjectKey(tenantId, proposal, image, deps);
  if (objectKey === null) return err(missing);
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const read = await deps.storage.getObject({
    url: deps.storage.objectUrl(configuration.value, objectKey).toString(),
    ...credentialsOf(configuration.value),
    deadlineMs: PROPOSAL_IMAGE_STORAGE_DEADLINES.getMs,
  }, { maxBytes: IMAGE_ASSET_MAX_BYTES });
  if (!read.ok) return read.error.code === 'not_found' ? err(missing) : read;
  if (deps.contentHash.sha256(read.value) !== image.digest) return err(missing);
  return ok({
    bytes: read.value,
    contentType: proposalImageContentType(image.extension),
    disposition: image.extension === 'svg' ? 'attachment' : 'inline',
    fileName: `${image.digest}.${image.extension}`,
  });
};

export interface QuarantinedImageSweepDeps extends ChangeProposalImageReleaseDeps, ChangeProposalImageWithdrawDeps {
  quarantinedImages: Pick<
    QuarantinedImageRepository,
    | 'release'
    | 'finishRelease'
    | 'markReleaseAttempted'
    | 'listTenantIdsToSweep'
    | 'listTenantIdsWithUploadsBefore'
    | 'listUploadsBefore'
    | 'markUploadDeleted'
    | 'deleteUpload'
    | 'markUploadAttempted'
    | 'listTenantIdsWithPublicationsBefore'
    | 'listPublicationsBefore'
    | 'markPublicationAttempted'
  >;
  /**
   * Wall-clock milliseconds one run may take. A step starts only when what is left covers a lock wait and its storage
   * delete; its lock waits and the delete, endpoint lookup included, come out of what is left.
   */
  budgetMs?: number;
  /** An absolute end the caller sets, in epoch milliseconds; the run stops at the earlier of this and its own budget. */
  deadlineAt?: number;
}

const before = (now: string, ageMs: number): string => new Date(Date.parse(now) - ageMs).toISOString();

/**
 * A write accepted before its presigned URL expired may still be streaming at the first delete, so the record stays and
 * the candidate is deleted once more `uploadSecondDeleteAfterMs` later, on the assumption that the storage finishes or
 * abandons a write it accepted by then.
 */
const sweepUploads = async (
  tenantId: string,
  due: { createdBefore: string; deletedBefore: string },
  budget: SweepBudget,
  deps: QuarantinedImageSweepDeps,
): Promise<number> => {
  const uploads = await deps.quarantinedImages.listUploadsBefore(
    tenantId, due.createdBefore, due.deletedBefore, QUARANTINED_IMAGE_LIMITS.sweepUploadsPerTenant, sweepStatementBound(budget),
  );
  if (uploads.length === 0) return 0;
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) {
    logImageFailure(deps, tenantId, 'could not remove expired image uploads', configuration.error.message);
    for (const upload of uploads) {
      await deps.quarantinedImages.markUploadAttempted(tenantId, upload.objectKey, deps.clock.nowIso(), sweepStatementBound(budget));
    }
    return 0;
  }
  let removed = 0;
  for (const upload of uploads) {
    if (spent(budget)) break;
    const deleted = await deps.storage.delete({
      url: deps.storage.objectUrl(configuration.value, upload.objectKey).toString(),
      ...credentialsOf(configuration.value),
      deadlineMs: deleteDeadline(budget),
    });
    if (!deleted.ok) {
      logImageFailure(deps, tenantId, 'could not remove an expired image upload', deleted.error.message);
      await deps.quarantinedImages.markUploadAttempted(tenantId, upload.objectKey, deps.clock.nowIso(), sweepStatementBound(budget));
      continue;
    }
    if (upload.deletedOnce) {
      await deps.quarantinedImages.deleteUpload(tenantId, upload.objectKey, sweepStatementBound(budget));
      continue;
    }
    await deps.quarantinedImages.markUploadDeleted(tenantId, upload.objectKey, deps.clock.nowIso(), sweepStatementBound(budget));
    removed += 1;
  }
  return removed;
};

/** Rows are served by the time of their last failed attempt or else their creation, so rows whose removal keeps failing move behind the others. */
export const sweepQuarantinedImages = async (
  deps: QuarantinedImageSweepDeps,
): Promise<Result<StagingSweepOutcome, AppError>> => {
  const now = deps.clock.nowIso();
  const endsAt = Math.min(Date.parse(now) + (deps.budgetMs ?? QUARANTINED_IMAGE_LIMITS.sweepBudgetMs), deps.deadlineAt ?? Number.POSITIVE_INFINITY);
  const budget: SweepBudget = () => endsAt - Date.parse(deps.clock.nowIso());
  const createdBefore = before(now, QUARANTINED_IMAGE_LIMITS.unattachedMaxAgeMs);
  const limit = QUARANTINED_IMAGE_LIMITS.sweepTenantsPerRun;
  const tenants = new Set<string>();
  let removed = 0;
  let failed = 0;
  const failedWith = (tenantId: string, what: string) => (cause: unknown): number => {
    logImageFailure(deps, tenantId, what, cause);
    failed += 1;
    return 0;
  };
  const uploadsDue = {
    createdBefore: before(now, QUARANTINED_IMAGE_LIMITS.uploadSweepAfterMs),
    deletedBefore: before(now, QUARANTINED_IMAGE_LIMITS.uploadSecondDeleteAfterMs),
  };
  const publicationsBefore = before(now, QUARANTINED_IMAGE_LIMITS.publicationSweepAfterMs);
  const images = deps.quarantinedImages;
  const releaseTenants = await images.listTenantIdsToSweep(createdBefore, now, limit, sweepStatementBound(budget));
  const uploadTenants = spent(budget) ? [] : await images.listTenantIdsWithUploadsBefore(uploadsDue.createdBefore, uploadsDue.deletedBefore, limit, sweepStatementBound(budget));
  const publicationTenants = spent(budget) ? [] : await images.listTenantIdsWithPublicationsBefore(publicationsBefore, limit, sweepStatementBound(budget));
  const stagesFrom = (lists: ReadonlyArray<readonly string[]>): number => lists.filter((list) => list.length > 0).length;
  const releases = sweepStageBudget(budget, stagesFrom([releaseTenants, uploadTenants, publicationTenants]));
  for (const tenantId of releaseTenants) {
    if (spent(releases)) break;
    tenants.add(tenantId);
    removed += await releaseImages(tenantId, { kind: 'sweep', createdBefore, limit: QUARANTINED_IMAGE_LIMITS.sweepAssetsPerTenant }, deps, releases)
      .catch(failedWith(tenantId, 'quarantined image release failed'));
  }
  const uploads = sweepStageBudget(budget, stagesFrom([uploadTenants, publicationTenants]));
  for (const tenantId of uploadTenants) {
    if (spent(uploads)) break;
    tenants.add(tenantId);
    removed += await sweepUploads(tenantId, uploadsDue, uploads, deps).catch(failedWith(tenantId, 'expired image upload sweep failed'));
  }
  const sweepPublications = async (tenantId: string): Promise<number> => {
    let withdrawn = 0;
    const records = await images.listPublicationsBefore(tenantId, publicationsBefore, QUARANTINED_IMAGE_LIMITS.sweepPublicationsPerTenant, sweepStatementBound(budget));
    for (const record of records) {
      if (spent(budget)) break;
      const removal = await removePublication(tenantId, record.attemptId, record.image, { written: true, keepRecord: false, dueBefore: publicationsBefore }, deps, budget)
        .catch((cause: unknown): PublicationRemoval => {
          failedWith(tenantId, PUBLICATION_REMOVAL_FAILURE)(cause);
          return 'kept';
        });
      if (removal === 'removed') withdrawn += 1;
      else if (removal === 'kept') {
        await images.markPublicationAttempted(tenantId, record.attemptId, record.image, deps.clock.nowIso(), sweepStatementBound(budget));
      }
    }
    return withdrawn;
  };
  for (const tenantId of publicationTenants) {
    if (spent(budget)) break;
    tenants.add(tenantId);
    removed += await sweepPublications(tenantId).catch(failedWith(tenantId, PUBLICATION_REMOVAL_FAILURE));
  }
  return ok({ tenants: tenants.size, removed, failed });
};
