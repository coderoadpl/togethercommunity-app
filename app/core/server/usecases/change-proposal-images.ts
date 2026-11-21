import {
  BRANDING_PROPOSAL_IMAGE_KINDS,
  changeProposalDisplayStatus,
  changeProposalImageChanges,
  changeProposalImageInputSchema,
  changeProposalImageReferences,
  changeProposalImageRefused,
  err,
  IMAGE_ASSET_MAX_BYTES,
  notFound,
  ok,
  parseProposalImagePath,
  parseUploadedImagePath,
  PRODUCT_COVER_PROPOSAL_IMAGE_KINDS,
  proposalImageContentType,
  proposalImageExtensionFor,
  proposalImageKindSchema,
  proposalImagePublicPath,
  proposalImagePublishedKey,
  proposalImageQuarantineKey,
  QUARANTINED_IMAGE_LIMITS,
  sameProposalImage,
  changeProposalImageCapExceeded,
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
  QuarantinedImageRelease,
  QuarantinedImageRepository,
  StorageProvider,
  TenantSecretResolver,
} from '../ports.js';
import { beginCandidateUpload, readCandidateImage, type ImageAssetDeps, type ImageAssetUploadStart } from './image-assets.js';
import { resolveStorageConfiguration } from './storage-assets.js';

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
  quarantinedImages: Pick<QuarantinedImageRepository, 'release'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  logger: { error(message: string): void };
  clock: Clock;
}

const logImageFailure = (deps: { logger: { error(message: string): void } }, tenantId: string, what: string, cause: unknown): void => {
  deps.logger.error(`[change-proposal] ${what} tenant=${tenantId}: ${cause instanceof Error ? serializeErrorChain(cause) : String(cause)}`);
};

const deleteQuarantinedObjects = async (
  tenantId: string,
  assets: readonly QuarantinedImageAsset[],
  deps: Omit<ChangeProposalImageReleaseDeps, 'quarantinedImages' | 'clock'>,
): Promise<void> => {
  if (assets.length === 0) return;
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) {
    logImageFailure(deps, tenantId, 'could not remove released quarantined images', configuration.error.message);
    return;
  }
  for (const asset of assets) {
    const removed = await deps.storage.delete({
      url: deps.storage.objectUrl(configuration.value, proposalImageQuarantineKey(tenantId, asset.apiKeyId, asset)).toString(),
      ...credentialsOf(configuration.value),
    });
    if (!removed.ok) logImageFailure(deps, tenantId, 'could not remove a released quarantined image', removed.error.message);
  }
};

/** Never fails the decision that committed before it: what a failed release leaves behind, the sweep removes. */
export const releaseQuarantinedImages = async (
  tenantId: string,
  selection: QuarantinedImageRelease,
  deps: ChangeProposalImageReleaseDeps,
): Promise<number> => {
  try {
    const released = await deps.quarantinedImages.release(tenantId, selection, deps.clock.nowIso());
    if (released.kind === 'busy') {
      logImageFailure(deps, tenantId, 'quarantined image release was busy', 'left for the scheduled sweep');
      return 0;
    }
    await deleteQuarantinedObjects(tenantId, released.value, deps);
    return released.value.length;
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

const beginProposedImageUpload = async (
  key: Result<ProposingKey, AppError>,
  family: ProposedImageFamily,
  input: ImageAssetUploadInput,
  deps: ImageAssetDeps,
): Promise<Result<ImageAssetUploadStart, AppError>> => {
  if (!key.ok) return key;
  return beginCandidateUpload(key.value.tenantId, KINDS_BY_FAMILY[family], input, deps);
};

export const beginProposedProductCoverUpload = (ctx: Ctx, input: ImageAssetUploadInput, deps: ImageAssetDeps) => beginProposedImageUpload(
  proposingKey(ctx, bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:catalog'))),
  'catalog',
  input,
  deps,
);

export const beginProposedBrandingAssetUpload = (ctx: Ctx, input: ImageAssetUploadInput, deps: ImageAssetDeps) => beginProposedImageUpload(
  proposingKey(ctx, bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:settings'))),
  'settings',
  input,
  deps,
);

export interface ProposedImageCompleteDeps extends ChangeProposalImageReleaseDeps {
  quarantinedImages: Pick<QuarantinedImageRepository, 'insert' | 'release'>;
  contentHash: ContentHash;
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
  });
  if (inserted.kind === 'cap_exceeded') {
    const removed = await deps.storage.delete({ url: candidateUrl, ...credentials });
    if (!removed.ok) return removed;
    return err(changeProposalImageCapExceeded(inserted.cap));
  }
  const stored = await deps.storage.putObject({
    url: deps.storage.objectUrl(configuration, proposalImageQuarantineKey(tenantId, keyId, image)).toString(),
    ...credentials,
    body: bytes,
    contentType,
  });
  if (!stored.ok) {
    if (inserted.kind === 'stored') await releaseQuarantinedImages(tenantId, { kind: 'key', apiKeyId: keyId, images: [image] }, deps);
    return stored;
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
}

export type ApprovalImages =
  | { kind: 'ready'; images: PreparedImage[]; configuration: StorageConfiguration | null }
  | { kind: 'missing'; proposal: ChangeProposal; image: ProposalImageReference }
  | { kind: 'failed'; error: AppError };

export interface ChangeProposalImagePublishDeps {
  storage: StorageProvider;
  contentHash: ContentHash;
}

/** An address that is no longer quarantined is fine only when a live field already shows it, so it is public already. */
export const prepareApprovalImages = async (
  tenantId: string,
  proposals: readonly ChangeProposal[],
  scope: ChangeProposalTransactionScope,
  deps: ChangeProposalImagePublishDeps,
): Promise<ApprovalImages> => {
  const images: PreparedImage[] = [];
  const settled: ProposalImageReference[] = [];
  let configuration: StorageConfiguration | null = null;
  for (const proposal of proposals) {
    for (const image of changeProposalImageReferences(proposal.operation, proposal.input)) {
      if (settled.some((known) => sameProposalImage(known, image))) continue;
      settled.push(image);
      const quarantined = await scope.repositories.quarantinedImages.lockForPublication(tenantId, proposal.proposedByKeyId, image);
      if (quarantined === null) {
        if (await scope.repositories.quarantinedImages.inLiveUse(tenantId, proposalImagePublicPath(image))) continue;
        return { kind: 'missing', proposal, image };
      }
      if (configuration === null) {
        const resolved = await resolveStorageConfiguration(tenantId, scope.secretResolver);
        if (!resolved.ok) return { kind: 'failed', error: resolved.error };
        configuration = resolved.value;
      }
      const read = await deps.storage.getObject({
        url: deps.storage.objectUrl(configuration, proposalImageQuarantineKey(tenantId, proposal.proposedByKeyId, image)).toString(),
        ...credentialsOf(configuration),
      }, { maxBytes: IMAGE_ASSET_MAX_BYTES });
      if (!read.ok) return { kind: 'failed', error: read.error };
      if (deps.contentHash.sha256(read.value) !== image.digest) return { kind: 'missing', proposal, image };
      images.push({ image, bytes: read.value });
    }
  }
  return { kind: 'ready', images, configuration };
};

/**
 * Copies the verified bytes to their public, content-addressed key. This runs inside the approval transaction once the
 * outcome is applied and before COMMIT, so committed live state never points at an object that does not exist; every
 * image it writes, a failed write included, is added to `published` for `withdrawPublishedImages` when the approval does
 * not commit.
 */
export const publishApprovalImages = async (
  tenantId: string,
  prepared: Extract<ApprovalImages, { kind: 'ready' }>,
  deps: ChangeProposalImagePublishDeps,
  published: ProposalImageReference[],
): Promise<Result<void, AppError>> => {
  const { configuration } = prepared;
  if (configuration === null) return ok(undefined);
  for (const { image, bytes } of prepared.images) {
    published.push(image);
    const written = await deps.storage.putObject({
      url: deps.storage.objectUrl(configuration, proposalImagePublishedKey(tenantId, image)).toString(),
      ...credentialsOf(configuration),
      body: bytes,
      contentType: proposalImageContentType(image.extension),
    });
    if (!written.ok) return written;
  }
  return ok(undefined);
};

export interface ChangeProposalImageWithdrawDeps {
  changeProposalTransaction: ChangeProposalTransaction;
  storage: StorageProvider;
  logger: { error(message: string): void };
}

/**
 * Removes the public copies an approval wrote when it did not end applied, unless a live field shows the address. It
 * deletes under the workspace's approval lock, before that transaction ends, so no concurrent approval can publish the
 * same address again between the check and the deletion.
 */
export const withdrawPublishedImages = async (
  tenantId: string,
  published: readonly ProposalImageReference[],
  deps: ChangeProposalImageWithdrawDeps,
): Promise<void> => {
  if (published.length === 0) return;
  try {
    const withdrawn = await deps.changeProposalTransaction.run(tenantId, async (scope): Promise<Result<void, AppError>> => {
      const configuration = await resolveStorageConfiguration(tenantId, scope.secretResolver);
      if (!configuration.ok) return configuration;
      for (const image of published) {
        if (await scope.repositories.quarantinedImages.inLiveUse(tenantId, proposalImagePublicPath(image))) continue;
        const removed = await deps.storage.delete({
          url: deps.storage.objectUrl(configuration.value, proposalImagePublishedKey(tenantId, image)).toString(),
          ...credentialsOf(configuration.value),
        });
        if (!removed.ok) return removed;
      }
      return ok(undefined);
    });
    if (!withdrawn.ok) logImageFailure(deps, tenantId, 'could not withdraw an image published by an approval that did not apply', withdrawn.error.message);
  } catch (cause) {
    logImageFailure(deps, tenantId, 'could not withdraw an image published by an approval that did not apply', cause);
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
  quarantinedImages: Pick<QuarantinedImageRepository, 'find'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  contentHash: ContentHash;
  clock: Clock;
}

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
  if (image === undefined || await deps.quarantinedImages.find(tenantId, proposal.proposedByKeyId, image) === null) return err(missing);
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const read = await deps.storage.getObject({
    url: deps.storage.objectUrl(configuration.value, proposalImageQuarantineKey(tenantId, proposal.proposedByKeyId, image)).toString(),
    ...credentialsOf(configuration.value),
  }, { maxBytes: IMAGE_ASSET_MAX_BYTES });
  if (!read.ok) return read;
  if (deps.contentHash.sha256(read.value) !== image.digest) return err(missing);
  return ok({
    bytes: read.value,
    contentType: proposalImageContentType(image.extension),
    disposition: image.extension === 'svg' ? 'attachment' : 'inline',
    fileName: `${image.digest}.${image.extension}`,
  });
};

export interface QuarantinedImageSweepDeps extends ChangeProposalImageReleaseDeps {
  quarantinedImages: Pick<QuarantinedImageRepository, 'release' | 'listTenantIdsToSweep'>;
}

export const sweepQuarantinedImages = async (
  deps: QuarantinedImageSweepDeps,
): Promise<Result<{ tenants: number; removed: number }, AppError>> => {
  const createdBefore = new Date(Date.parse(deps.clock.nowIso()) - QUARANTINED_IMAGE_LIMITS.unattachedMaxAgeMs).toISOString();
  const tenantIds = await deps.quarantinedImages.listTenantIdsToSweep(createdBefore, QUARANTINED_IMAGE_LIMITS.sweepTenantsPerRun);
  let removed = 0;
  for (const tenantId of tenantIds) {
    removed += await releaseQuarantinedImages(tenantId, { kind: 'sweep', createdBefore, limit: QUARANTINED_IMAGE_LIMITS.sweepAssetsPerTenant }, deps);
  }
  return ok({ tenants: tenantIds.length, removed });
};
