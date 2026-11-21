import { z } from 'zod';

import { changeProposalIdentifierSchema, type ChangeProposalEffect, type ChangeProposalInput } from './change-proposal.js';
import { appError, validation, type AppError } from './errors.js';
import { IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION, IMAGE_ASSET_MAX_BYTES, IMAGE_ASSET_UPLOAD_TTL_SECONDS, imageAssetContentTypesFor } from './image-asset.js';

export const proposalImageKindSchema = z.enum(['product-cover', 'logo', 'logo-dark', 'favicon', 'share-image']);

export type ProposalImageKind = z.output<typeof proposalImageKindSchema>;

export const PRODUCT_COVER_PROPOSAL_IMAGE_KINDS = ['product-cover'] as const satisfies readonly ProposalImageKind[];

export const BRANDING_PROPOSAL_IMAGE_KINDS = ['logo', 'logo-dark', 'favicon', 'share-image'] as const satisfies readonly ProposalImageKind[];

const proposalImageExtensionSchema = z.enum(['png', 'jpg', 'webp', 'svg', 'ico']);

export type ProposalImageExtension = z.output<typeof proposalImageExtensionSchema>;

const proposalImageDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const QUARANTINED_IMAGE_LIMITS = {
  assetsPerKey: 100,
  bytesPerKey: 50 * 1024 * 1024,
  unattachedMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  sweepTenantsPerRun: 50,
  sweepAssetsPerTenant: 200,
  uploadsPerKey: 60,
  uploadSweepAfterMs: (IMAGE_ASSET_UPLOAD_TTL_SECONDS + 5 * 60) * 1000,
  sweepUploadsPerTenant: 200,
  publicationSweepAfterMs: 10 * 60 * 1000,
  sweepPublicationsPerTenant: 20,
} as const;

export const PROPOSAL_IMAGE_QUARANTINE_PREFIX = 'image-asset-quarantine';

export interface ProposalImageReference {
  kind: ProposalImageKind;
  digest: string;
  extension: ProposalImageExtension;
}

export const quarantinedImageAssetSchema = z.object({
  tenantId: z.string().min(1),
  apiKeyId: z.string().min(1),
  kind: proposalImageKindSchema,
  digest: proposalImageDigestSchema,
  extension: proposalImageExtensionSchema,
  sizeBytes: z.number().int().min(1).max(IMAGE_ASSET_MAX_BYTES),
  createdAt: z.string().datetime({ precision: 3 }),
}).strict();

export type QuarantinedImageAsset = z.output<typeof quarantinedImageAssetSchema>;

export const quarantinedImageUploadSchema = z.object({
  apiKeyId: z.string().min(1),
  objectKey: z.string().startsWith('image-asset-candidates/'),
  createdAt: z.string().datetime({ precision: 3 }),
}).strict();

export type QuarantinedImageUpload = z.output<typeof quarantinedImageUploadSchema>;

export const proposalImagePublicationSchema = z.object({
  attemptId: z.string().min(1),
  image: z.object({ kind: proposalImageKindSchema, digest: proposalImageDigestSchema, extension: proposalImageExtensionSchema }).strict(),
  startedAt: z.string().datetime({ precision: 3 }),
}).strict();

export type ProposalImagePublication = z.output<typeof proposalImagePublicationSchema>;

export const proposalImageExtensionFor = (file: string): ProposalImageExtension | null => {
  const parsed = proposalImageExtensionSchema.safeParse(file.split('.').at(-1));
  return parsed.success ? parsed.data : null;
};

export const proposalImageContentType = (extension: ProposalImageExtension): string =>
  IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION[extension];

const proposalImageKindAccepts = (kind: ProposalImageKind, extension: ProposalImageExtension): boolean =>
  imageAssetContentTypesFor(kind).includes(proposalImageContentType(extension));

export const proposalImageExtensionsFor = (kind: ProposalImageKind): ProposalImageExtension[] =>
  proposalImageExtensionSchema.options.filter((extension) => proposalImageKindAccepts(kind, extension));

export const proposalImagePublicPath = (reference: ProposalImageReference): string =>
  `/api/public/assets/${reference.kind}/${reference.digest}.${reference.extension}`;

export const proposalImageQuarantineKey = (tenantId: string, apiKeyId: string, reference: ProposalImageReference): string =>
  `${PROPOSAL_IMAGE_QUARANTINE_PREFIX}/${tenantId}/${apiKeyId}/${reference.kind}/${reference.digest}.${reference.extension}`;

export const proposalImagePublishedKey = (tenantId: string, reference: ProposalImageReference): string =>
  `image-assets/${tenantId}/${reference.kind}/${reference.digest}.${reference.extension}`;

export const sameProposalImage = (left: ProposalImageReference, right: ProposalImageReference): boolean =>
  left.kind === right.kind && left.digest === right.digest && left.extension === right.extension;

const contentAddressedPathPattern = /^\/api\/public\/assets\/([a-z-]+)\/([0-9a-f]{64})\.([a-z]+)$/;

export const parseProposalImagePath = (value: string): ProposalImageReference | null => {
  const match = contentAddressedPathPattern.exec(value);
  if (match === null) return null;
  const kind = proposalImageKindSchema.safeParse(match[1]);
  const extension = proposalImageExtensionSchema.safeParse(match[3]);
  if (!kind.success || !extension.success || match[2] === undefined) return null;
  return proposalImageKindAccepts(kind.data, extension.data) ? { kind: kind.data, digest: match[2], extension: extension.data } : null;
};

const uploadedPublicPathPattern = /^\/api\/public\/assets\/([a-z-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z]+)$/;

export const parseUploadedImagePath = (value: string): { kind: ProposalImageKind; file: string } | null => {
  const match = uploadedPublicPathPattern.exec(value);
  if (match === null || match[2] === undefined) return null;
  const kind = proposalImageKindSchema.safeParse(match[1]);
  const extension = proposalImageExtensionFor(match[2]);
  if (!kind.success || extension === null || !proposalImageKindAccepts(kind.data, extension)) return null;
  return { kind: kind.data, file: match[2] };
};

const PRODUCT_IMAGE_FIELDS: Readonly<Record<string, ProposalImageKind>> = { coverUrl: 'product-cover' };

const SETTINGS_IMAGE_FIELDS: Readonly<Record<string, ProposalImageKind>> = {
  logoUrl: 'logo',
  logoDarkUrl: 'logo-dark',
  faviconUrl: 'favicon',
  ogImageUrl: 'share-image',
};

const IMAGE_FIELDS_BY_OPERATION: Readonly<Record<string, Readonly<Record<string, ProposalImageKind>>>> = {
  'product.create': PRODUCT_IMAGE_FIELDS,
  'product.update': PRODUCT_IMAGE_FIELDS,
  'settings.update': SETTINGS_IMAGE_FIELDS,
};

export interface ChangeProposalImageField {
  field: string;
  kind: ProposalImageKind;
}

const changeProposalImageFields = (operation: string): ChangeProposalImageField[] =>
  Object.entries(IMAGE_FIELDS_BY_OPERATION[operation] ?? {}).map(([field, kind]) => ({ field, kind }));

/** Every operation and input field that can attach an image, the same fields `changeProposalImageReferences` reads. */
export const CHANGE_PROPOSAL_IMAGE_FIELDS: ReadonlyArray<ChangeProposalImageField & { operation: string }> =
  Object.keys(IMAGE_FIELDS_BY_OPERATION).flatMap((operation) => changeProposalImageFields(operation).map((field) => ({ operation, ...field })));

export const changeProposalImageReferences = (operation: string, input: ChangeProposalInput): ProposalImageReference[] => {
  const references: ProposalImageReference[] = [];
  for (const { field, kind } of changeProposalImageFields(operation)) {
    const value = input[field];
    const reference = typeof value === 'string' ? parseProposalImagePath(value) : null;
    if (reference !== null && reference.kind === kind && !references.some((known) => sameProposalImage(known, reference))) {
      references.push(reference);
    }
  }
  return references;
};

export const changeProposalImageChanges = (
  operation: string,
  effect: ChangeProposalEffect,
): Array<ChangeProposalImageField & { value: string }> =>
  changeProposalImageFields(operation).flatMap((field) => {
    const change = effect[field.field];
    if (change === undefined || !('after' in change) || typeof change.after !== 'string') return [];
    return [{ ...field, value: change.after }];
  });

export type ChangeProposalImageCap = 'key_quarantined_images' | 'key_quarantined_bytes' | 'key_image_uploads';

const imageCapMessages: Record<ChangeProposalImageCap, string> = {
  key_quarantined_images: `This key already holds ${String(QUARANTINED_IMAGE_LIMITS.assetsPerKey)} uploaded images awaiting approval`,
  key_quarantined_bytes: `This key already holds ${String(QUARANTINED_IMAGE_LIMITS.bytesPerKey)} bytes of uploaded images awaiting approval`,
  key_image_uploads: `This key already started ${String(QUARANTINED_IMAGE_LIMITS.uploadsPerKey)} image uploads for approval in the last ${String(IMAGE_ASSET_UPLOAD_TTL_SECONDS / 60)} minutes`,
};

export const changeProposalImageCapExceeded = (cap: ChangeProposalImageCap): AppError =>
  appError('conflict', imageCapMessages[cap], { changeProposalCap: cap });

export const changeProposalImageRefused = (invalidInputMessage: string, field: string, kind: ProposalImageKind): AppError =>
  validation(invalidInputMessage, {
    formErrors: [],
    fieldErrors: { [field]: [`Must be empty, unchanged, an existing ${kind} image of this workspace, or an image this key uploaded for approval`] },
  });

export const changeProposalImageInputSchema = z.object({
  id: changeProposalIdentifierSchema,
  digest: proposalImageDigestSchema,
}).strict();

export type ChangeProposalImageInput = z.input<typeof changeProposalImageInputSchema>;

export const changeProposalImageMissingNote = (reference: ProposalImageReference): string =>
  `The proposed image ${proposalImagePublicPath(reference)} is no longer available, so the proposal cannot be applied; nothing was changed`;
