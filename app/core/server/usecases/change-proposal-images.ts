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
import { serializeErrorChain } from '../log-safety.js';
import type {
  ChangeProposalRepository,
  ChangeProposalTransaction,
  ChangeProposalTransactionScope,
  Clock,
  ContentHash,
  IdGenerator,
  QuarantinedImageRelease,
  QuarantinedImageRepository,
  StorageProvider,
  TenantSecretResolver,
} from '../ports.js';
import { beginCandidateUpload, readCandidateImage, type ImageAssetDeps, type ImageAssetUploadStart } from './image-assets.js';
import { resolveStorageConfiguration } from './storage-assets.js';
import { sweepDeleteDeadline, sweepLockWait, UNBOUNDED, type SweepBudget } from './sweep-budget.js';

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
  quarantinedImages: Pick<QuarantinedImageRepository, 'release' | 'finishRelease'>;
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

/**
 * Never fails the decision that committed before it: rows are marked released in one transaction and each object is
 * removed afterwards with its row; what a failed or busy step leaves released, the sweep finishes.
 */
export const releaseQuarantinedImages = async (
  tenantId: string,
  selection: QuarantinedImageRelease,
  deps: ChangeProposalImageReleaseDeps,
  budget: SweepBudget = UNBOUNDED,
): Promise<number> => {
  try {
    const wait = sweepLockWait(budget, 1);
    if (wait === null) return 0;
    const released = await deps.quarantinedImages.release(tenantId, selection, deps.clock.nowIso(), wait);
    if (released.kind === 'busy') {
      logImageFailure(deps, tenantId, 'quarantined image release was busy', 'left for the scheduled sweep');
      return 0;
    }
    return await finishReleases(tenantId, released.value, deps, budget);
  } catch (cause) {
    logImageFailure(deps, tenantId, 'quarantined image release failed', cause);
    return 0;
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
  quarantinedImages: Pick<QuarantinedImageRepository, 'insert' | 'findUpload'>;
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
  const candidate = await readCandidateImage(tenantId, KINDS_BY_FAMILY[family], input, deps);
  if (!candidate.ok) return candidate;
  const { file, bytes, configuration, credentials, candidateUrl, contentType } = candidate.value;
  const kind = proposalImageKindSchema.safeParse(candidate.value.kind);
  const extension = proposalImageExtensionFor(file);
  if (!kind.success || extension === null) return err(notFound('Image asset not found'));
  const image: ProposalImageReference = { kind: kind.data, digest: deps.contentHash.sha256(bytes), extension };
  const inserted = await deps.quarantinedImages.insert(tenantId, {
    tenantId,
    apiKeyId: keyId,
    ...image,
    sizeBytes: bytes.byteLength,
    createdAt: deps.clock.nowIso(),
  }, () => deps.storage.putObject({
    url: deps.storage.objectUrl(configuration, proposalImageQuarantineKey(tenantId, keyId, image)).toString(),
    ...credentials,
    body: bytes,
    contentType,
  }));
  if (inserted.kind === 'busy') return err(changeProposalsBusy());
  if (inserted.kind === 'cap_exceeded' || inserted.kind === 'store_failed') {
    const removed = await deps.storage.delete({ url: candidateUrl, ...credentials });
    if (!removed.ok) return removed;
    return err(inserted.kind === 'cap_exceeded' ? changeProposalImageCapExceeded(inserted.cap) : inserted.error);
  }
  const removed = await deps.storage.delete({ url: candidateUrl, ...credentials });
  if (!removed.ok) return removed;
  return ok({ url: proposalImagePublicPath(image), quarantined: true });
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

interface PreparedImage {
  image: ProposalImageReference;
  bytes: Uint8Array;
  /** Read from the public copy a live field already shows, so approval writes nothing for it. */
  published: boolean;
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

/**
 * An address that is no longer quarantined is fine only when a live field already shows it and its public copy still
 * hashes to the digest, the copy the owner preview showed.
 */
export const prepareApprovalImages = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
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
    const key = published ? proposalImagePublishedKey(tenantId, image) : proposalImageQuarantineKey(tenantId, proposal.proposedByKeyId, image);
    const read = await readVerified(configuration, key, image, deps);
    if (!read.ok) return { kind: 'failed', error: read.error };
    if (read.value === null) return { kind: 'missing', proposal, image };
    images.push({ image, bytes: read.value, published });
  }
  return { kind: 'ready', images, configuration };
};

export interface ApprovalPublication {
  attemptId: string;
  images: ProposalImageReference[];
}

export interface ChangeProposalImagePublishDeps extends ChangeProposalImagePrepareDeps {
  quarantinedImages: Pick<QuarantinedImageRepository, 'recordPublications'>;
  secretResolver: TenantSecretResolver;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Runs before the approval transaction, so its single insert never waits for a second connection while the approval
 * holds one. It records, in a commit of its own, the attempt's intent to write each image the effect sets whose public
 * object is missing or no longer hashes to the digest; an object that does is never written or recorded. What a record
 * leaves behind when the attempt does not end applied, the withdrawal or the sweep removes.
 */
export const recordApprovalPublications = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
  deps: ChangeProposalImagePublishDeps,
): Promise<Result<ApprovalPublication, AppError>> => {
  const images = changedImagesOf(proposals).map(({ image }) => image);
  if (images.length === 0) return ok({ attemptId: '', images: [] });
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const absent: ProposalImageReference[] = [];
  for (const image of images) {
    const found = await readVerified(configuration.value, proposalImagePublishedKey(tenantId, image), image, deps);
    if (!found.ok) return found;
    if (found.value === null) absent.push(image);
  }
  if (absent.length === 0) return ok({ attemptId: '', images: [] });
  const attemptId = deps.ids.nextId();
  await deps.quarantinedImages.recordPublications(tenantId, attemptId, absent, deps.clock.nowIso());
  return ok({ attemptId, images: absent });
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
 * recorded must still be public with bytes that hash to its digest, or the approval answers busy; the workspace lock
 * this transaction holds, and the refusal of any address with an unresolved delete, keep it there until the commit.
 */
export const publishApprovalImages = async (
  tenantId: string,
  prepared: Extract<ApprovalImages, { kind: 'ready' }>,
  publication: ApprovalPublication,
  scope: ChangeProposalTransactionScope,
  deps: ChangeProposalImagePrepareDeps,
  writes: ApprovalImageWrites,
): Promise<Result<void, AppError>> => {
  const images = scope.repositories.quarantinedImages;
  const recorded = (image: ProposalImageReference) => publication.images.some((known) => sameProposalImage(known, image));
  for (const image of [...publication.images, ...prepared.images.map((known) => known.image)]) {
    if (await images.deleteUnresolved(tenantId, image)) return err(changeProposalsBusy());
  }
  const toWrite = prepared.images.filter(({ image, published }) => !published && recorded(image)).map(({ image }) => image);
  if (toWrite.length > 0 && !await images.claimPublications(tenantId, publication.attemptId, toWrite)) return err(changeProposalsBusy());
  const { configuration } = prepared;
  if (configuration !== null) {
    for (const { image, bytes, published } of prepared.images) {
      if (published) continue;
      if (!recorded(image)) {
        const present = await readVerified(configuration, proposalImagePublishedKey(tenantId, image), image, deps);
        if (!present.ok) return present;
        if (present.value !== null) continue;
        return err(changeProposalsBusy());
      }
      writes.written.push(image);
      const stored = await deps.storage.putObject({
        url: deps.storage.objectUrl(configuration, proposalImagePublishedKey(tenantId, image)).toString(),
        ...credentialsOf(configuration),
        body: bytes,
        contentType: proposalImageContentType(image.extension),
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

/**
 * Holds the workspace's approval lock, so no approval can publish the same address between the check and the deletion.
 * When `written`, it deletes the public object first, except when a live field shows the address or an applied
 * proposal carries it: then an applied approval published it, and product history may still point at it. When
 * `keepRecord`, the record stays after the delete, so the sweep deletes the object once more after the record's age
 * bound: a write whose outcome was unknown may still land after this delete. A delete without a definite answer may
 * still land later too, so it keeps the record and marks it: no approval reuses the address until the sweep, after the
 * record's age bound counted from that delete, has deleted the object again.
 */
const removePublication = async (
  tenantId: string,
  attemptId: string,
  image: ProposalImageReference,
  written: { written: boolean; keepRecord: boolean },
  deps: ChangeProposalImageWithdrawDeps,
  budget: SweepBudget = UNBOUNDED,
): Promise<boolean> => {
  const failure = 'could not withdraw an image published by an approval that did not apply';
  const lockWaitMs = sweepLockWait(budget, 1);
  if (lockWaitMs === null) return false;
  try {
    const removed = await deps.changeProposalTransaction.run(tenantId, async (scope): Promise<Result<boolean, AppError>> => {
      const images = scope.repositories.quarantinedImages;
      if (!await images.claimPublications(tenantId, attemptId, [image])) return ok(false);
      const path = proposalImagePublicPath(image);
      if (written.written && !await images.inLiveUse(tenantId, path) && !await images.inAppliedProposal(tenantId, path)) {
        const configuration = await resolveStorageConfiguration(tenantId, scope.secretResolver);
        if (!configuration.ok) return configuration;
        const deleted = await deps.storage.delete({
          url: deps.storage.objectUrl(configuration.value, proposalImagePublishedKey(tenantId, image)).toString(),
          ...credentialsOf(configuration.value),
          deadlineMs: deleteDeadline(budget),
        });
        if (!deleted.ok && storageFailureIsDefinite(deleted.error)) return deleted;
        if (!deleted.ok) {
          logImageFailure(deps, tenantId, failure, deleted.error.message);
          await images.markDeleteUnresolved(tenantId, attemptId, image, deps.clock.nowIso());
          return ok(false);
        }
      }
      if (written.keepRecord) return ok(false);
      await images.deletePublication(tenantId, attemptId, image);
      return ok(true);
    }, lockWaitMs === undefined ? {} : { lockWaitMs });
    if (!removed.ok) logImageFailure(deps, tenantId, failure, removed.error.message);
    return removed.ok && removed.value;
  } catch (cause) {
    logImageFailure(deps, tenantId, failure, cause);
    return false;
  }
};

/** Runs after an approval that did not end applied; a record it cannot remove, or keeps after an unknown write, stays for the sweep. */
export const withdrawPublishedImages = async (
  tenantId: string,
  publication: ApprovalPublication,
  writes: ApprovalImageWrites,
  deps: ChangeProposalImageWithdrawDeps,
): Promise<void> => {
  for (const image of publication.images) {
    await removePublication(tenantId, publication.attemptId, image, {
      written: writes.written.some((known) => sameProposalImage(known, image)),
      keepRecord: writes.unconfirmed.some((known) => sameProposalImage(known, image)),
    }, deps);
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
    | 'listTenantIdsToSweep'
    | 'listTenantIdsWithUploadsBefore'
    | 'listUploadsBefore'
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

const sweepUploads = async (tenantId: string, createdBefore: string, budget: SweepBudget, deps: QuarantinedImageSweepDeps): Promise<number> => {
  const uploads = await deps.quarantinedImages.listUploadsBefore(tenantId, createdBefore, QUARANTINED_IMAGE_LIMITS.sweepUploadsPerTenant);
  if (uploads.length === 0) return 0;
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) {
    logImageFailure(deps, tenantId, 'could not remove expired image uploads', configuration.error.message);
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
      await deps.quarantinedImages.markUploadAttempted(tenantId, upload.objectKey, deps.clock.nowIso());
      continue;
    }
    await deps.quarantinedImages.deleteUpload(tenantId, upload.objectKey);
    removed += 1;
  }
  return removed;
};

/** Rows are served by the time of their last failed attempt or else their creation, so rows whose removal keeps failing move behind the others. */
export const sweepQuarantinedImages = async (
  deps: QuarantinedImageSweepDeps,
): Promise<Result<{ tenants: number; removed: number }, AppError>> => {
  const now = deps.clock.nowIso();
  const endsAt = Math.min(Date.parse(now) + (deps.budgetMs ?? QUARANTINED_IMAGE_LIMITS.sweepBudgetMs), deps.deadlineAt ?? Number.POSITIVE_INFINITY);
  const budget: SweepBudget = () => endsAt - Date.parse(deps.clock.nowIso());
  const createdBefore = before(now, QUARANTINED_IMAGE_LIMITS.unattachedMaxAgeMs);
  const limit = QUARANTINED_IMAGE_LIMITS.sweepTenantsPerRun;
  const tenants = new Set<string>();
  let removed = 0;
  for (const tenantId of await deps.quarantinedImages.listTenantIdsToSweep(createdBefore, now, limit)) {
    if (spent(budget)) break;
    tenants.add(tenantId);
    removed += await releaseQuarantinedImages(tenantId, { kind: 'sweep', createdBefore, limit: QUARANTINED_IMAGE_LIMITS.sweepAssetsPerTenant }, deps, budget);
  }
  const uploadsBefore = before(now, QUARANTINED_IMAGE_LIMITS.uploadSweepAfterMs);
  for (const tenantId of spent(budget) ? [] : await deps.quarantinedImages.listTenantIdsWithUploadsBefore(uploadsBefore, limit)) {
    if (spent(budget)) break;
    tenants.add(tenantId);
    try {
      removed += await sweepUploads(tenantId, uploadsBefore, budget, deps);
    } catch (cause) {
      logImageFailure(deps, tenantId, 'expired image upload sweep failed', cause);
    }
  }
  const publicationsBefore = before(now, QUARANTINED_IMAGE_LIMITS.publicationSweepAfterMs);
  for (const tenantId of spent(budget) ? [] : await deps.quarantinedImages.listTenantIdsWithPublicationsBefore(publicationsBefore, limit)) {
    if (spent(budget)) break;
    tenants.add(tenantId);
    const records = await deps.quarantinedImages.listPublicationsBefore(tenantId, publicationsBefore, QUARANTINED_IMAGE_LIMITS.sweepPublicationsPerTenant);
    for (const record of records) {
      if (spent(budget)) break;
      if (await removePublication(tenantId, record.attemptId, record.image, { written: true, keepRecord: false }, deps, budget)) {
        removed += 1;
      } else {
        await deps.quarantinedImages.markPublicationAttempted(tenantId, record.attemptId, record.image, deps.clock.nowIso());
      }
    }
  }
  return ok({ tenants: tenants.size, removed });
};
