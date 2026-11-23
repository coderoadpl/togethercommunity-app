import { describe, expect, it } from 'vitest';

import {
  changeProposalCreatedKind,
  checkChangeProposalReferences,
  resolveChangeProposalReferences,
} from './change-proposal-group.js';
import { CHANGE_PROPOSAL_INPUT_SCHEMAS } from './change-proposal-inputs.js';
import {
  changeProposalFamily,
  changeProposalOperationSchema,
  changeProposalSchema,
  changeProposalTargetKind,
  registeredChangeProposalOperation,
} from './change-proposal.js';
import {
  changeProposalFileMissingNote,
  changeProposalFileUnavailable,
  changeProposalStagedFileId,
  changeProposalStagedFileIds,
  isChangeProposalFileMissingNote,
  KEY_DOWNLOAD_CONTENT_TYPES,
  KEY_DOWNLOAD_FILE_LIMITS,
  keyDownloadBytesMatch,
  keyDownloadDiscardInputSchema,
  keyDownloadFileCapExceeded,
  keyDownloadFileNameSchema,
  keyDownloadObjectOwner,
  keyDownloadStagedFileView,
  keyDownloadStagedKey,
  keyDownloadNameMatchesType,
  keyDownloadUploadInputSchema,
  type KeyDownloadContentType,
  type KeyDownloadFileCap,
  type KeyDownloadStagedFile,
} from './change-proposal-download.js';

const bytes = (...parts: Array<string | number[]>): Uint8Array =>
  new Uint8Array(parts.flatMap((part) => typeof part === 'string' ? [...part].map((character) => character.charCodeAt(0)) : part));

const le16 = (value: number): number[] => [value & 0xff, value >> 8];

const epubHead = (extra = 0, mimetype = 'application/epub+zip', method = 0): Uint8Array => bytes(
  [0x50, 0x4b, 0x03, 0x04], le16(10), le16(0), le16(method), [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
  le16(8), le16(extra), 'mimetype', new Array<number>(extra).fill(0), mimetype,
);

const SAMPLES: Record<KeyDownloadContentType, Uint8Array> = {
  'application/pdf': bytes('%PDF-1.7\n'),
  'application/epub+zip': epubHead(),
  'application/zip': bytes([0x50, 0x4b, 0x03, 0x04, 20, 0]),
  'audio/mpeg': bytes('ID3', [4, 0, 0, 0, 0, 0, 1]),
  'audio/mp4': bytes([0, 0, 0, 32], 'ftypM4A '),
  'video/mp4': bytes([0, 0, 0, 32], 'ftypisom'),
  'image/png': bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': bytes([0xff, 0xd8, 0xff, 0xe0]),
};

describe('the type check of a staged download file', () => {
  it.each(KEY_DOWNLOAD_CONTENT_TYPES.map((type) => [type]))('accepts the first bytes of %s', (type) => {
    expect(keyDownloadBytesMatch(type, SAMPLES[type])).toBe(true);
  });

  it('refuses first bytes of another type, an empty head and plain text', () => {
    expect(keyDownloadBytesMatch('application/pdf', SAMPLES['image/png'])).toBe(false);
    expect(keyDownloadBytesMatch('image/png', new Uint8Array())).toBe(false);
    expect(keyDownloadBytesMatch('application/zip', bytes('<html>'))).toBe(false);
    expect(keyDownloadBytesMatch('image/jpeg', bytes('%PDF-'))).toBe(false);
  });

  it('takes an EPUB only with a stored first mimetype entry naming EPUB, and an extra field is skipped', () => {
    expect(keyDownloadBytesMatch('application/epub+zip', epubHead(4))).toBe(true);
    expect(keyDownloadBytesMatch('application/epub+zip', epubHead(0, 'application/zip+xyz'))).toBe(false);
    expect(keyDownloadBytesMatch('application/epub+zip', epubHead(0, 'application/epub+zip', 8))).toBe(false);
    expect(keyDownloadBytesMatch('application/epub+zip', SAMPLES['application/zip'])).toBe(false);
  });

  const ftyp = (brand: string): Uint8Array => bytes([0, 0, 0, 24], 'ftyp', brand, [0, 0, 2, 0], 'isom');
  const id3 = (version: number, revision: number, size: number[]): Uint8Array => bytes('ID3', [version, revision, 0], size);
  const ZERO_BYTES = new Array<number>(16).fill(0);

  it.each<[string, KeyDownloadContentType, Uint8Array]>([
    ['a PDF header at the first byte', 'application/pdf', bytes('%PDF-1.4\n')],
    ['a PDF header after a preamble inside the first 1024 bytes', 'application/pdf', bytes(new Array<number>(1019).fill(0x20), '%PDF-1.7')],
    ['a ZIP local file header', 'application/zip', bytes([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0])],
    ['an ID3v2.3 tag', 'audio/mpeg', id3(3, 0, [0, 0, 0x0f, 0x76])],
    ['an ID3v2.4 tag', 'audio/mpeg', id3(4, 0, [0, 0, 0x02, 0x01])],
    ['an MPEG-1 layer III frame at 128 kbit/s, 44.1 kHz', 'audio/mpeg', bytes([0xff, 0xfb, 0x90, 0x64])],
    ['an MPEG-2 layer III frame', 'audio/mpeg', bytes([0xff, 0xf3, 0x40, 0xc4])],
    ['an M4A brand', 'audio/mp4', ftyp('M4A ')],
    ['an M4B audiobook brand', 'audio/mp4', ftyp('M4B ')],
    ['a generic isom brand as audio', 'audio/mp4', ftyp('isom')],
    ['an mp42 brand as video', 'video/mp4', ftyp('mp42')],
    ['an M4V brand', 'video/mp4', ftyp('M4V ')],
    ['an avc1 brand', 'video/mp4', ftyp('avc1')],
    ['a dash brand', 'video/mp4', ftyp('dash')],
  ])('accepts %s', (_shape, type, head) => {
    expect(keyDownloadBytesMatch(type, head)).toBe(true);
  });

  it.each<[string, KeyDownloadContentType, Uint8Array]>([
    ['a PDF header past the first 1024 bytes', 'application/pdf', bytes(new Array<number>(1020).fill(0x20), '%PDF-1.7')],
    ['an empty ZIP (end of central directory first)', 'application/zip', bytes([0x50, 0x4b, 0x05, 0x06], ZERO_BYTES)],
    ['a spanned ZIP (data descriptor marker first)', 'application/zip', bytes([0x50, 0x4b, 0x07, 0x08, 0x50, 0x4b, 0x03, 0x04])],
    ['an EPUB whose first entry is not the stored mimetype', 'application/epub+zip', epubHead(0, 'application/epub+zip', 8)],
    ['text that starts with ID3', 'audio/mpeg', bytes('ID3 notes for the lesson')],
    ['an ID3 tag of reserved version 5', 'audio/mpeg', id3(5, 0, [0, 0, 0, 1])],
    ['an ID3 tag with a size byte that is not synchsafe', 'audio/mpeg', id3(3, 0, [0, 0, 0x80, 0])],
    ['an MP3 with leading zero padding before its first frame', 'audio/mpeg', bytes([0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64])],
    ['an MPEG frame with the forbidden bitrate index 15', 'audio/mpeg', bytes([0xff, 0xfb, 0xf0, 0x64])],
    ['an MPEG frame with a reserved sampling rate', 'audio/mpeg', bytes([0xff, 0xfb, 0x9c, 0x64])],
    ['a HEIC image named as video', 'video/mp4', ftyp('heic')],
    ['an AVIF image named as video', 'video/mp4', ftyp('avif')],
    ['a QuickTime movie', 'video/mp4', ftyp('qt  ')],
    ['a 3GP movie', 'video/mp4', ftyp('3gp4')],
    ['an M4A declared as video', 'video/mp4', ftyp('M4A ')],
    ['an M4V declared as audio', 'audio/mp4', ftyp('M4V ')],
    ['an ftyp box cut before its brand', 'audio/mp4', bytes([0, 0, 0, 24], 'ftypM4')],
  ])('refuses %s', (_shape, type, head) => {
    expect(keyDownloadBytesMatch(type, head)).toBe(false);
  });

  it('keeps enough first bytes for the whole PDF header window', () => {
    expect(KEY_DOWNLOAD_FILE_LIMITS.headBytes).toBeGreaterThanOrEqual(1024);
  });
});

describe('limit messages', () => {
  it.each<[KeyDownloadFileCap, string]>([
    ['key_staged_bytes', 'Staging this file would take this key past 2 GiB of staged files'],
    ['workspace_staged_bytes', 'Staging this file would take the workspace past 10 GiB of staged files'],
    ['key_file_bytes_daily', 'Staging this file would take this key past 10 GiB of uploads and copies started in 24 hours'],
  ])('states the %s limit in binary units', (cap, message) => {
    expect(keyDownloadFileCapExceeded(cap)).toStrictEqual({ code: 'conflict', message, details: { changeProposalCap: cap } });
  });

  it('states the file size limit in MiB', () => {
    const refused = keyDownloadUploadInputSchema.safeParse({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: KEY_DOWNLOAD_FILE_LIMITS.maxBytes + 1 });
    expect(refused.error?.issues.map((issue) => issue.message)).toEqual(['A file a key stages is at most 256 MiB']);
  });
});

describe('file names and upload inputs of keys', () => {
  it('refuses control and bidirectional formatting characters and keeps ordinary names', () => {
    expect(keyDownloadFileNameSchema.safeParse(' workbook (2nd edition).pdf ').data).toBe('workbook (2nd edition).pdf');
    for (const name of ['a\u0000.pdf', 'a\n.pdf', 'a\u0085.pdf', 'fdp.‮gnp', 'a⁦b.pdf', 'a‏b.pdf', 'a؜b.pdf', '   ', 'x'.repeat(256)]) {
      expect(keyDownloadFileNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it('takes only listed types and sizes up to the key file limit', () => {
    const input = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: KEY_DOWNLOAD_FILE_LIMITS.maxBytes };
    expect(keyDownloadUploadInputSchema.safeParse(input).success).toBe(true);
    expect(keyDownloadUploadInputSchema.safeParse({ ...input, sizeBytes: KEY_DOWNLOAD_FILE_LIMITS.maxBytes + 1 }).success).toBe(false);
    expect(keyDownloadUploadInputSchema.safeParse({ ...input, contentType: 'text/html' }).success).toBe(false);
    expect(keyDownloadUploadInputSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('takes a file name only when its last extension names the declared type, in any letter case', () => {
    const input = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 };
    for (const [fileName, contentType] of [['Guide.PDF', 'application/pdf'], ['book.epub', 'application/epub+zip'], ['track.m4b', 'audio/mp4'], ['photo.jpeg', 'image/jpeg']]) {
      expect(keyDownloadUploadInputSchema.safeParse({ ...input, fileName, contentType }).success).toBe(true);
    }
    for (const fileName of ['page.html', 'tool.exe', 'guide', 'guide.pdf.html', 'guide.', 'a.constructor']) {
      const refused = keyDownloadUploadInputSchema.safeParse({ ...input, fileName });
      expect(refused.error?.issues.map((issue) => issue.path)).toEqual([['fileName']]);
    }
    expect(keyDownloadUploadInputSchema.safeParse({ ...input, fileName: 'a.png' }).success).toBe(false);
    expect(keyDownloadNameMatchesType('a.pdf', 'application/pdf')).toBe(true);
    expect(keyDownloadNameMatchesType('a.pdf', 'image/png')).toBe(false);
  });

  it('bounds the id of a staged file to discard', () => {
    expect(keyDownloadDiscardInputSchema.safeParse({ id: 'x'.repeat(200) }).success).toBe(true);
    expect(keyDownloadDiscardInputSchema.safeParse({ id: 'x'.repeat(201) }).success).toBe(false);
    expect(keyDownloadDiscardInputSchema.safeParse({ id: '' }).success).toBe(false);
  });
});

describe('staged file keys and views', () => {
  const file: KeyDownloadStagedFile = {
    tenantId: 'acme', id: 'file-1', apiKeyId: 'key-1', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10,
    sha256: 'a'.repeat(64), objectKey: keyDownloadStagedKey('acme', 'key-1', 'file-1', 'a.pdf'), copiedFrom: null,
    proposalId: null, createdAt: '2026-03-01T10:00:00.000Z',
  };

  it('reads the staging key from a staged object key of the workspace only', () => {
    expect(keyDownloadObjectOwner('acme', file.objectKey)).toBe('key-1');
    expect(keyDownloadObjectOwner('studio', file.objectKey)).toBeNull();
    expect(keyDownloadObjectOwner('acme', 'acme/product-downloads/product-1/asset-1/a.pdf')).toBeNull();
  });

  it('shows the fingerprint of an uploaded file and never one of a copy', () => {
    expect(keyDownloadStagedFileView(file)).toMatchObject({ sha256: 'a'.repeat(64), expiresAt: '2026-03-08T10:00:00.000Z' });
    const copy = keyDownloadStagedFileView({ ...file, copiedFrom: { productId: 'p', assetId: 'x', versionNumber: 2 } });
    expect(copy.sha256).toBeNull();
    expect(JSON.stringify(copy)).not.toContain('a'.repeat(64));
  });
});

describe('download file proposals', () => {
  it('registers the three file operations as catalogue proposals on a product, outside the list of operations that need no file', () => {
    for (const operation of ['download.add', 'download.replace', 'download.remove'] as const) {
      expect(registeredChangeProposalOperation(operation)).toBe(operation);
      expect(changeProposalFamily(operation)).toBe('catalog');
      expect(changeProposalTargetKind(operation)).toBe('product');
      expect(changeProposalOperationSchema.safeParse(operation).success).toBe(false);
      expect(changeProposalCreatedKind(operation)).toBeNull();
    }
    expect(registeredChangeProposalOperation('download.rename')).toBeNull();
  });

  it('validates each file operation strictly, with the version note trimmed and optional', () => {
    const add = CHANGE_PROPOSAL_INPUT_SCHEMAS['download.add'];
    expect(add.safeParse({ productId: 'p', stagedFileId: 'f', versionNote: '  First  ' })).toEqual({ success: true, data: { productId: 'p', stagedFileId: 'f', versionNote: 'First' } });
    expect(add.safeParse({ productId: 'p', stagedFileId: 'f', replacesAssetId: 'a' }).success).toBe(false);
    expect(add.safeParse({ productId: 'p', stagedFileId: 'f', storageKey: 'x' }).success).toBe(false);
    const replace = CHANGE_PROPOSAL_INPUT_SCHEMAS['download.replace'];
    expect(replace.safeParse({ productId: 'p', stagedFileId: 'f' }).success).toBe(false);
    expect(replace.safeParse({ productId: 'p', stagedFileId: 'f', replacesAssetId: 'a' }).success).toBe(true);
    const remove = CHANGE_PROPOSAL_INPUT_SCHEMAS['download.remove'];
    expect(remove.safeParse({ productId: 'p', assetId: 'a' }).success).toBe(true);
    expect(remove.safeParse({ productId: 'p', assetId: 'a', stagedFileId: 'f' }).success).toBe(false);
  });

  it('accepts a group reference only in the product position and resolves it to the created product', () => {
    const earlier = [{ id: 'create', operation: 'product.create' }, { id: 'price', operation: 'price.create' }];
    expect(checkChangeProposalReferences('download.add', { productId: '$proposal:create', stagedFileId: 'f' }, earlier)).toEqual({ ok: true, value: undefined });
    expect(checkChangeProposalReferences('download.add', { productId: 'p', stagedFileId: '$proposal:create' }, earlier).ok).toBe(false);
    expect(checkChangeProposalReferences('download.remove', { productId: '$proposal:price', assetId: 'a' }, earlier).ok).toBe(false);
    expect(checkChangeProposalReferences('download.replace', { productId: 'p', stagedFileId: 'f', replacesAssetId: 'a', versionNote: '$proposal:create' }, earlier).ok).toBe(false);
    expect(resolveChangeProposalReferences('download.add', { productId: '$proposal:create', stagedFileId: 'f' }, (id) => id === 'create' ? 'product-1' : null))
      .toEqual({ productId: 'product-1', stagedFileId: 'f' });
  });

  it('reads the staged file of an attaching operation only', () => {
    expect(changeProposalStagedFileId('download.add', { productId: 'p', stagedFileId: 'f' })).toBe('f');
    expect(changeProposalStagedFileId('download.replace', { productId: 'p', stagedFileId: 'g', replacesAssetId: 'a' })).toBe('g');
    expect(changeProposalStagedFileId('download.remove', { productId: 'p', assetId: 'f' })).toBeNull();
    expect(changeProposalStagedFileId('product.update', { id: 'p', stagedFileId: 'f' })).toBeNull();
    expect(changeProposalStagedFileIds([
      { operation: 'download.add', input: { stagedFileId: 'f' } },
      { operation: 'download.replace', input: { stagedFileId: 'f' } },
      { operation: 'download.add', input: { stagedFileId: 'g' } },
    ])).toEqual(['f', 'g']);
  });

  it('builds and recognises the coded note of a file that is gone, and one refusal names no other key', () => {
    const note = changeProposalFileMissingNote('staged-1');
    expect(note).toBe('file_unavailable: The proposed file staged-1 is no longer available, so the proposal cannot be applied; nothing was changed');
    expect(isChangeProposalFileMissingNote(note)).toBe(true);
    expect(isChangeProposalFileMissingNote('image_unavailable: gone')).toBe(false);
    expect(isChangeProposalFileMissingNote(null)).toBe(false);
    expect(changeProposalFileUnavailable('Invalid product file attachment')).toMatchObject({
      code: 'validation', message: 'Invalid product file attachment',
      details: { fieldErrors: { stagedFileId: ['Must be a file this key staged that no other pending proposal attaches'] } },
    });
  });

  it('checks the target kind of a stored file proposal', () => {
    const stored = {
      id: 'p-1', tenantId: 't', groupId: null, groupPosition: null, operation: 'download.add', input: { productId: 'x', stagedFileId: 'f' }, effect: {},
      target: { kind: 'price', id: 'x' }, status: 'pending', proposedByKeyId: 'k', proposedByKeyName: 'Agent', proposedByIssuerUserId: 'u',
      createdAt: '2026-03-01T10:00:00.000Z', expiresAt: '2026-03-31T10:00:00.000Z', decidedByUserId: null, decidedAt: null, decisionNote: null,
      appliedResourceId: null, failureCode: null, failureMessage: null,
    };
    expect(changeProposalSchema.safeParse(stored).success).toBe(false);
    expect(changeProposalSchema.safeParse({ ...stored, target: { kind: 'product', id: 'x' } }).success).toBe(true);
  });
});
