import { z } from 'zod';

import { appError, validation, type AppError } from './errors.js';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

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
  recordSweepAfterMs: 20 * MINUTE_MS,
  recordRetentionMs: DAY_MS,
  stagedMaxAgeMs: 7 * DAY_MS,
  sweepTenantsPerRun: 50,
  sweepRowsPerTenant: 50,
  headBytes: 4096,
} as const;

export const KEY_DOWNLOAD_STORAGE_DEADLINES = {
  headMs: 5_000,
  deleteMs: 10_000,
  copyMs: 120_000,
  digestMs: 240_000,
} as const;

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

const isMpegAudio = (head: Uint8Array): boolean => {
  if (startsWith(head, 0, ascii('ID3'))) return true;
  const first = head[0];
  const second = head[1];
  if (first !== 0xff || second === undefined || (second & 0xe0) !== 0xe0) return false;
  return ((second >> 3) & 0x03) !== 0x01 && ((second >> 1) & 0x03) !== 0x00;
};

const MATCHERS: Readonly<Record<KeyDownloadContentType, (head: Uint8Array) => boolean>> = {
  'application/pdf': (head) => startsWith(head, 0, ascii('%PDF-')),
  'application/epub+zip': isEpub,
  'application/zip': (head) => startsWith(head, 0, ZIP_LOCAL_HEADER),
  'audio/mpeg': isMpegAudio,
  'audio/mp4': (head) => startsWith(head, 4, ascii('ftyp')),
  'video/mp4': (head) => startsWith(head, 4, ascii('ftyp')),
  'image/png': (head) => startsWith(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (head) => startsWith(head, 0, [0xff, 0xd8, 0xff]),
};

export const keyDownloadBytesMatch = (contentType: KeyDownloadContentType, head: Uint8Array): boolean => MATCHERS[contentType](head);

const FORBIDDEN_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export const keyDownloadFileNameSchema = z.string().trim().min(1).max(255)
  .refine((name) => !FORBIDDEN_NAME_CHARACTERS.test(name), { message: 'File names cannot contain control or bidirectional formatting characters' });

export const keyDownloadUploadInputSchema = z.object({
  fileName: keyDownloadFileNameSchema,
  contentType: keyDownloadContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(KEY_DOWNLOAD_FILE_LIMITS.maxBytes),
}).strict();

export type KeyDownloadUploadInput = z.input<typeof keyDownloadUploadInputSchema>;

export const keyDownloadCompleteInputSchema = z.object({ uploadId: z.string().min(1).max(200) }).strict();

export type KeyDownloadCompleteInput = z.input<typeof keyDownloadCompleteInputSchema>;

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

type KeyDownloadCopySource = z.output<typeof keyDownloadCopySourceSchema>;

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

const KEY_DOWNLOAD_RECORD_STATES = ['started', 'completing', 'completed', 'failed', 'settled'] as const;

const keyDownloadRecordStateSchema = z.enum(KEY_DOWNLOAD_RECORD_STATES);

export type KeyDownloadRecordState = z.output<typeof keyDownloadRecordStateSchema>;

/**
 * One upload or server-side copy a key started: the accounting row its limits count for a day, and until it settles the
 * owner of its candidate object and of its staged destination. `attemptId` names the one completion that may write the
 * destination.
 */
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

export const keyDownloadPendingDeletionSchema = z.object({
  tenantId: z.string().min(1),
  apiKeyId: z.string().min(1),
  objectKey: keyFileObjectSchema,
  sizeBytes: z.number().int().min(1).max(2147483647),
  createdAt: isoMilliseconds,
}).strict();

export type KeyDownloadPendingDeletion = z.output<typeof keyDownloadPendingDeletionSchema>;

export const keyDownloadCandidateKey = (tenantId: string, apiKeyId: string, uploadId: string): string =>
  `${tenantId}${KEY_UPLOADS_SEGMENT}${apiKeyId}/${uploadId}`;

export const keyDownloadStagedKey = (tenantId: string, apiKeyId: string, fileId: string, safeName: string): string =>
  `${tenantId}${KEY_FILES_SEGMENT}${apiKeyId}/${fileId}/${safeName}`;

export const keyDownloadObjectOwner = (tenantId: string, objectKey: string): string | null => {
  const prefix = `${tenantId}${KEY_FILES_SEGMENT}`;
  if (!objectKey.startsWith(prefix)) return null;
  const owner = objectKey.slice(prefix.length).split('/')[0];
  return owner === undefined || owner.length === 0 ? null : owner;
};

export interface KeyDownloadStagedFileView {
  id: string;
  fileName: string;
  contentType: KeyDownloadContentType;
  sizeBytes: number;
  sha256: string | null;
  copiedFrom: KeyDownloadCopySource | null;
  createdAt: string;
  expiresAt: string;
}

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
  key_staged_bytes: `Staging this file would take this key past ${String(KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerKey)} staged bytes`,
  workspace_staged_bytes: `Staging this file would take the workspace past ${String(KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerWorkspace)} staged bytes`,
  key_file_uploads: `This key already started ${String(KEY_DOWNLOAD_FILE_LIMITS.startsPerKey)} file uploads or copies in the last ${String(KEY_DOWNLOAD_FILE_LIMITS.startsWindowMs / 60_000)} minutes`,
  key_file_bytes_daily: `Staging this file would take this key past ${String(KEY_DOWNLOAD_FILE_LIMITS.declaredBytesPerKeyDaily)} bytes started in 24 hours`,
  product_files: `This product already has ${String(KEY_DOWNLOAD_FILE_LIMITS.filesPerProduct)} files`,
};

export const keyDownloadFileCapExceeded = (cap: KeyDownloadFileCap): AppError =>
  appError('conflict', capMessages[cap], { changeProposalCap: cap });

export const keyDownloadTypeMismatch = (contentType: KeyDownloadContentType): AppError =>
  validation(`The uploaded file is not of type ${contentType}; nothing was staged`, {
    formErrors: [],
    fieldErrors: { contentType: ['Must match the first bytes of the file'] },
  });

export const keyDownloadFilesBusy = (): AppError =>
  appError('unavailable', 'Staged files of this workspace are busy; nothing was changed, retry the request', { retryAfterSeconds: 1 });
