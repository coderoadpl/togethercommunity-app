import { z } from 'zod';

import { appError, validation, type AppError } from './errors.js';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const binarySizeText = (bytes: number): string =>
  bytes % GIB === 0 ? `${String(bytes / GIB)} GiB` : `${String(bytes / MIB)} MiB`;

export const KEY_DOWNLOAD_FILE_LIMITS = {
  maxBytes: 256 * MIB,
  stagedFilesPerKey: 20,
  stagedBytesPerKey: 2 * GIB,
  stagedBytesPerWorkspace: 10 * GIB,
  startsPerKey: 20,
  startsWindowMs: 15 * MINUTE_MS,
  declaredBytesPerKeyDaily: 10 * GIB,
  dailyWindowMs: DAY_MS,
  filesPerProduct: 100,
  uploadTtlSeconds: 15 * 60,
  completionDeadlineMs: 10 * MINUTE_MS,
  supersededDestinationDeleteAfterMs: 30 * MINUTE_MS,
  uploadObjectDeleteAgainAfterMs: DAY_MS,
  recordSweepAfterMs: 20 * MINUTE_MS,
  recordRetentionMs: DAY_MS,
  recordEventRetentionMs: 30 * DAY_MS,
  stagedMaxAgeMs: 7 * DAY_MS,
  sweepTenantsPerRun: 50,
  sweepRowsPerTenant: 50,
  sweepBudgetMs: 10_000,
  headBytes: 4096,
} as const;

export const KEY_DOWNLOAD_STORAGE_DEADLINES = {
  headMs: 5_000,
  deleteMs: 10_000,
  copyMs: 20_000,
  digestMs: 30_000,
} as const;

/** `maxDuration` of the hosted server function in vercel.json: a request still running then is ended unanswered. */
export const SERVER_FUNCTION_LIMIT_MS = 60_000;

const APPROVAL_FILE_CHECK_CONCURRENCY = 4;

const APPROVAL_FILE_CHECK_BUDGET_MS = Math.ceil(KEY_DOWNLOAD_FILE_LIMITS.stagedFilesPerKey / APPROVAL_FILE_CHECK_CONCURRENCY)
  * KEY_DOWNLOAD_STORAGE_DEADLINES.headMs;

/**
 * The file checks before an approval transaction: a group holds at most as many file items as its key has staged
 * files, so every check of the largest group fits the budget even when each storage answer takes its whole deadline,
 * and the rest of the function's time is left to the transaction and the answer.
 */
export const CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS = {
  concurrency: APPROVAL_FILE_CHECK_CONCURRENCY,
  budgetMs: APPROVAL_FILE_CHECK_BUDGET_MS,
  leftForDecisionMs: SERVER_FUNCTION_LIMIT_MS - APPROVAL_FILE_CHECK_BUDGET_MS,
  minimumHeadMs: 1_000,
  retryAfterSeconds: 5,
} as const;

export const changeProposalFileChecksOutOfTime = (): AppError =>
  appError('unavailable', 'The storage did not confirm every proposed file in time; nothing was decided, retry the request', {
    retryAfterSeconds: CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.retryAfterSeconds,
  });

export const KEY_DOWNLOAD_CONTENT_TYPES = [
  'application/pdf',
  'application/epub+zip',
  'application/zip',
  'audio/mpeg',
  'audio/mp4',
  'video/mp4',
  'image/png',
  'image/jpeg',
] as const;

export const keyDownloadContentTypeSchema = z.enum(KEY_DOWNLOAD_CONTENT_TYPES);

export type KeyDownloadContentType = z.output<typeof keyDownloadContentTypeSchema>;

export const KEY_DOWNLOAD_CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, KeyDownloadContentType>> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const startsWith = (head: Uint8Array, offset: number, expected: readonly number[]): boolean =>
  head.byteLength >= offset + expected.length && expected.every((byte, index) => head[offset + index] === byte);

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];

const littleEndian16 = (head: Uint8Array, offset: number): number | null => {
  const low = head[offset];
  const high = head[offset + 1];
  return low === undefined || high === undefined ? null : low + high * 256;
};

const isEpub = (head: Uint8Array): boolean => {
  if (!startsWith(head, 0, ZIP_LOCAL_HEADER) || littleEndian16(head, 8) !== 0 || littleEndian16(head, 26) !== 8) return false;
  const extraLength = littleEndian16(head, 28);
  return extraLength !== null && startsWith(head, 30, ascii('mimetype'))
    && startsWith(head, 38 + extraLength, ascii('application/epub+zip'));
};

const isId3Tag = (head: Uint8Array): boolean => {
  const version = head[3];
  const revision = head[4];
  const size = head.subarray(6, 10);
  return startsWith(head, 0, ascii('ID3')) && version !== undefined && version >= 2 && version <= 4
    && revision !== undefined && revision !== 0xff && size.byteLength === 4 && size.every((byte) => byte < 0x80);
};

const isMpegFrame = (head: Uint8Array): boolean => {
  const [first, second, third] = head;
  if (first !== 0xff || second === undefined || third === undefined || (second & 0xe0) !== 0xe0) return false;
  return ((second >> 3) & 0x03) !== 0x01 && ((second >> 1) & 0x03) !== 0x00 && (third >> 4) !== 0x0f && ((third >> 2) & 0x03) !== 0x03;
};

const PDF_HEADER_WINDOW = 1024;

const isPdf = (head: Uint8Array): boolean => {
  const marker = ascii('%PDF-');
  const last = Math.min(PDF_HEADER_WINDOW, head.byteLength) - marker.length;
  for (let offset = 0; offset <= last; offset += 1) {
    if (startsWith(head, offset, marker)) return true;
  }
  return false;
};

const SHARED_MP4_BRANDS = ['isom', 'iso2', 'mp41', 'mp42', 'dash'];

const MP4_BRANDS = {
  audio: [...SHARED_MP4_BRANDS, 'M4A ', 'M4B '],
  video: [...SHARED_MP4_BRANDS, 'M4V ', 'avc1'],
} as const;

const hasMp4Brand = (brands: readonly string[]) => (head: Uint8Array): boolean =>
  startsWith(head, 4, ascii('ftyp')) && brands.some((brand) => startsWith(head, 8, ascii(brand)));

const MATCHERS: Readonly<Record<KeyDownloadContentType, (head: Uint8Array) => boolean>> = {
  'application/pdf': isPdf,
  'application/epub+zip': isEpub,
  'application/zip': (head) => startsWith(head, 0, ZIP_LOCAL_HEADER),
  'audio/mpeg': (head) => isId3Tag(head) || isMpegFrame(head),
  'audio/mp4': hasMp4Brand(MP4_BRANDS.audio),
  'video/mp4': hasMp4Brand(MP4_BRANDS.video),
  'image/png': (head) => startsWith(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (head) => startsWith(head, 0, [0xff, 0xd8, 0xff]),
};

export const keyDownloadBytesMatch = (contentType: KeyDownloadContentType, head: Uint8Array): boolean => MATCHERS[contentType](head);

const FORBIDDEN_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export const keyDownloadFileNameSchema = z.string().trim().min(1).max(255)
  .refine((name) => !FORBIDDEN_NAME_CHARACTERS.test(name), { message: 'File names cannot contain control or bidirectional formatting characters' });

/** The saved file opens by its name, so a name whose extension names another type than the checked one is refused. */
export const keyDownloadNameMatchesType = (fileName: string, contentType: KeyDownloadContentType): boolean => {
  const name = fileName.trim();
  const dot = name.lastIndexOf('.');
  const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(KEY_DOWNLOAD_CONTENT_TYPE_BY_EXTENSION, extension) && KEY_DOWNLOAD_CONTENT_TYPE_BY_EXTENSION[extension] === contentType;
};

export const keyDownloadUploadInputSchema = z.object({
  fileName: keyDownloadFileNameSchema,
  contentType: keyDownloadContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(KEY_DOWNLOAD_FILE_LIMITS.maxBytes, { message: `A file a key stages is at most ${binarySizeText(KEY_DOWNLOAD_FILE_LIMITS.maxBytes)}` }),
}).strict().refine((input) => keyDownloadNameMatchesType(input.fileName, input.contentType), {
  message: 'The file name must end in an extension of the declared type',
  path: ['fileName'],
});

export type KeyDownloadUploadInput = z.input<typeof keyDownloadUploadInputSchema>;

export const keyDownloadCompleteInputSchema = z.object({ uploadId: z.string().min(1).max(200) }).strict();

export type KeyDownloadCompleteInput = z.input<typeof keyDownloadCompleteInputSchema>;

export const keyDownloadDiscardInputSchema = z.object({ id: z.string().min(1).max(200) }).strict();

export type KeyDownloadDiscardInput = z.input<typeof keyDownloadDiscardInputSchema>;

export const keyDownloadCopyInputSchema = z.object({
  productId: z.string().min(1).max(200),
  assetId: z.string().min(1).max(200),
}).strict();

export type KeyDownloadCopyInput = z.input<typeof keyDownloadCopyInputSchema>;

const versionNoteSchema = z.string().trim().max(500);

export const keyDownloadAttachInputSchema = z.object({
  productId: z.string().min(1).max(200),
  stagedFileId: z.string().min(1).max(200),
  replacesAssetId: z.string().min(1).max(200).optional(),
  versionNote: versionNoteSchema.optional(),
}).strict();

export type KeyDownloadAttachInput = z.input<typeof keyDownloadAttachInputSchema>;

export const keyDownloadAddInputSchema = keyDownloadAttachInputSchema.omit({ replacesAssetId: true });

export const keyDownloadReplaceInputSchema = keyDownloadAttachInputSchema.extend({ replacesAssetId: z.string().min(1).max(200) });

export const keyDownloadRemoveInputSchema = z.object({
  productId: z.string().min(1).max(200),
  assetId: z.string().min(1).max(200),
}).strict();

export type KeyDownloadRemoveInput = z.input<typeof keyDownloadRemoveInputSchema>;

const isoMilliseconds = z.string().datetime({ precision: 3 });

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const KEY_FILES_SEGMENT = '/product-downloads/key-files/';

const KEY_UPLOADS_SEGMENT = '/product-downloads/key-uploads/';

const keyFileObjectSchema = z.string().min(1).refine((key) => key.includes(KEY_FILES_SEGMENT));

const keyUploadObjectSchema = z.string().min(1).refine((key) => key.includes(KEY_UPLOADS_SEGMENT));

const keyDownloadCopySourceSchema = z.object({
  productId: z.string().min(1),
  assetId: z.string().min(1),
  versionNumber: z.number().int().positive(),
}).strict();

export const keyDownloadStagedFileSchema = z.object({
  tenantId: z.string().min(1),
  id: z.string().min(1),
  apiKeyId: z.string().min(1),
  fileName: keyDownloadFileNameSchema,
  contentType: keyDownloadContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(KEY_DOWNLOAD_FILE_LIMITS.maxBytes),
  sha256: sha256Schema,
  objectKey: keyFileObjectSchema,
  copiedFrom: keyDownloadCopySourceSchema.nullable(),
  proposalId: z.string().min(1).nullable(),
  createdAt: isoMilliseconds,
}).strict();

export type KeyDownloadStagedFile = z.output<typeof keyDownloadStagedFileSchema>;

const KEY_DOWNLOAD_RECORD_STATES = ['started', 'completing', 'interrupted', 'completed', 'failed', 'settled'] as const;

const keyDownloadRecordStateSchema = z.enum(KEY_DOWNLOAD_RECORD_STATES);

export type KeyDownloadRecordState = z.output<typeof keyDownloadRecordStateSchema>;

/** `attemptId` names the one completion that may write the destination. */
export const keyDownloadUploadRecordSchema = z.object({
  tenantId: z.string().min(1),
  id: z.string().min(1),
  apiKeyId: z.string().min(1),
  kind: z.enum(['upload', 'copy']),
  state: keyDownloadRecordStateSchema,
  fileId: z.string().min(1),
  fileName: keyDownloadFileNameSchema,
  contentType: keyDownloadContentTypeSchema,
  declaredBytes: z.number().int().min(1).max(KEY_DOWNLOAD_FILE_LIMITS.maxBytes),
  candidateKey: keyUploadObjectSchema.nullable(),
  stagedKey: keyFileObjectSchema.nullable(),
  copiedFrom: keyDownloadCopySourceSchema.nullable(),
  attemptId: z.string().min(1).nullable(),
  attemptAt: isoMilliseconds.nullable(),
  createdAt: isoMilliseconds,
  completedAt: isoMilliseconds.nullable(),
}).strict();

export type KeyDownloadUploadRecord = z.output<typeof keyDownloadUploadRecordSchema>;

const KEY_DOWNLOAD_RECORD_EVENT_KINDS = ['started', 'claimed', 'completed', 'failed', 'interrupted', 'settled', 'purged'] as const;

export type KeyDownloadRecordEventKind = (typeof KEY_DOWNLOAD_RECORD_EVENT_KINDS)[number];

export const keyDownloadRecordEventSchema = z.object({
  tenantId: z.string().min(1),
  recordId: z.string().min(1),
  apiKeyId: z.string().min(1),
  kind: z.enum(KEY_DOWNLOAD_RECORD_EVENT_KINDS),
  attemptId: z.string().min(1).nullable(),
  reason: z.string().regex(/^[a-z_]{1,64}$/).nullable(),
  at: isoMilliseconds,
}).strict();

export type KeyDownloadRecordEvent = z.output<typeof keyDownloadRecordEventSchema>;

export const keyDownloadPendingDeletionSchema = z.object({
  tenantId: z.string().min(1),
  apiKeyId: z.string().min(1),
  objectKey: z.union([keyFileObjectSchema, keyUploadObjectSchema]),
  sizeBytes: z.number().int().min(1).max(2147483647),
  createdAt: isoMilliseconds,
  notBefore: isoMilliseconds.nullable(),
}).strict();

export type KeyDownloadPendingDeletion = z.output<typeof keyDownloadPendingDeletionSchema>;

export const keyDownloadCandidateKey = (tenantId: string, apiKeyId: string, uploadId: string): string =>
  `${tenantId}${KEY_UPLOADS_SEGMENT}${apiKeyId}/${uploadId}`;

export const keyDownloadStagedKey = (tenantId: string, apiKeyId: string, fileId: string, safeName: string): string =>
  `${tenantId}${KEY_FILES_SEGMENT}${apiKeyId}/${fileId}/${safeName}`;

export const keyDownloadDestinationForFile = (stagedKey: string, apiKeyId: string, fileId: string): string | null => {
  const marker = `${KEY_FILES_SEGMENT}${apiKeyId}/`;
  const at = stagedKey.indexOf(marker);
  if (at < 0) return null;
  const rest = stagedKey.slice(at + marker.length);
  const slash = rest.indexOf('/');
  return slash < 1 ? null : `${stagedKey.slice(0, at + marker.length)}${fileId}${rest.slice(slash)}`;
};

export const keyDownloadObjectOwner = (tenantId: string, objectKey: string): string | null => {
  const prefix = `${tenantId}${KEY_FILES_SEGMENT}`;
  if (!objectKey.startsWith(prefix)) return null;
  const owner = objectKey.slice(prefix.length).split('/')[0];
  return owner === undefined || owner.length === 0 ? null : owner;
};

export const keyDownloadStagedFileViewSchema = keyDownloadStagedFileSchema.pick({
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  copiedFrom: true,
  createdAt: true,
}).extend({
  sha256: sha256Schema.nullable(),
  expiresAt: isoMilliseconds,
}).strip();

export type KeyDownloadStagedFileView = z.output<typeof keyDownloadStagedFileViewSchema>;

/** A copy of an existing product file never shows the key a fact derived from the original bytes. */
export const keyDownloadStagedFileView = (file: KeyDownloadStagedFile): KeyDownloadStagedFileView => ({
  id: file.id,
  fileName: file.fileName,
  contentType: file.contentType,
  sizeBytes: file.sizeBytes,
  sha256: file.copiedFrom === null ? file.sha256 : null,
  copiedFrom: file.copiedFrom,
  createdAt: file.createdAt,
  expiresAt: new Date(Date.parse(file.createdAt) + KEY_DOWNLOAD_FILE_LIMITS.stagedMaxAgeMs).toISOString(),
});

export type KeyDownloadFileCap =
  | 'key_staged_files'
  | 'key_staged_bytes'
  | 'workspace_staged_bytes'
  | 'key_file_uploads'
  | 'key_file_bytes_daily'
  | 'product_files';

const capMessages: Record<KeyDownloadFileCap, string> = {
  key_staged_files: `This key already holds ${String(KEY_DOWNLOAD_FILE_LIMITS.stagedFilesPerKey)} staged or uploading files`,
  key_staged_bytes: `Staging this file would take this key past ${binarySizeText(KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerKey)} of staged files`,
  workspace_staged_bytes: `Staging this file would take the workspace past ${binarySizeText(KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerWorkspace)} of staged files`,
  key_file_uploads: `This key already started ${String(KEY_DOWNLOAD_FILE_LIMITS.startsPerKey)} file uploads or copies in the last ${String(KEY_DOWNLOAD_FILE_LIMITS.startsWindowMs / 60_000)} minutes`,
  key_file_bytes_daily: `Staging this file would take this key past ${binarySizeText(KEY_DOWNLOAD_FILE_LIMITS.declaredBytesPerKeyDaily)} of uploads and copies started in 24 hours`,
  product_files: `This product already has ${String(KEY_DOWNLOAD_FILE_LIMITS.filesPerProduct)} files`,
};

export const keyDownloadFileCapExceeded = (cap: KeyDownloadFileCap): AppError =>
  appError('conflict', capMessages[cap], { changeProposalCap: cap });

export const keyDownloadTypeMismatch = (contentType: KeyDownloadContentType): AppError =>
  validation(`The uploaded file is not of type ${contentType}; nothing was staged`, {
    formErrors: [],
    fieldErrors: { contentType: ['Must match the first bytes of the file'] },
  });

const definiteFailureSchema = z.object({ definite: z.literal(true) });

/** A storage answer that settles the request: the provider refused it, or the object it read cannot be the declared one. */
export const storageDefiniteFailure = (message: string): AppError => appError('integration_unavailable', message, { definite: true });

/** A missing object or a definite answer; any other storage failure leaves the outcome unknown, so a copy may still land. */
export const storageFailureIsDefinite = (error: AppError): boolean =>
  error.code === 'not_found' || definiteFailureSchema.safeParse(error.details).success;

/** Every failure of a copy after its source was found answers this, so a key learns nothing about the stored bytes. */
export const keyDownloadCopyRefused = (): AppError => validation('This file cannot be copied by a key; nothing was staged');

export const keyDownloadFilesBusy = (): AppError =>
  appError('unavailable', 'Staged files of this workspace are busy; nothing was changed, retry the request', { retryAfterSeconds: 1 });

const ATTACHING_OPERATIONS: ReadonlySet<string> = new Set(['download.add', 'download.replace']);

export const changeProposalStagedFileId = (operation: string, input: Readonly<Record<string, unknown>>): string | null => {
  if (!ATTACHING_OPERATIONS.has(operation)) return null;
  const id = input['stagedFileId'];
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export const changeProposalStagedFileIds = (
  proposals: ReadonlyArray<{ operation: string; input: Readonly<Record<string, unknown>> }>,
): string[] => [...new Set(proposals.flatMap((proposal) => {
  const id = changeProposalStagedFileId(proposal.operation, proposal.input);
  return id === null ? [] : [id];
}))];

export const changeProposalFileUnavailable = (invalidInputMessage: string): AppError => validation(invalidInputMessage, {
  formErrors: [],
  fieldErrors: { stagedFileId: ['Must be a file this key staged that no other pending proposal attaches'] },
});

const CHANGE_PROPOSAL_FILE_MISSING_NOTE_CODE = 'file_unavailable';

export const changeProposalFileMissingNote = (stagedFileId: string): string =>
  `${CHANGE_PROPOSAL_FILE_MISSING_NOTE_CODE}: The proposed file ${stagedFileId} is no longer available, so the proposal cannot be applied; nothing was changed`;

export const isChangeProposalFileMissingNote = (note: string | null): boolean =>
  note !== null && note.startsWith(`${CHANGE_PROPOSAL_FILE_MISSING_NOTE_CODE}: `);

export const CHANGE_PROPOSAL_FILE_LINK_TTL_SECONDS = 60;

export const changeProposalFileInputSchema = z.object({
  id: z.string().min(1).max(200),
  fileId: z.string().min(1).max(200),
}).strict();

export type ChangeProposalFileInput = z.input<typeof changeProposalFileInputSchema>;

export interface ChangeProposalFileLink {
  download: { url: string; expiresAt: string; fileName: string; sizeBytes: number };
}
