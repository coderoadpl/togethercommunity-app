import { describe, expect, it } from 'vitest';

import {
  KEY_DOWNLOAD_CONTENT_TYPES,
  KEY_DOWNLOAD_FILE_LIMITS,
  keyDownloadBytesMatch,
  keyDownloadFileNameSchema,
  keyDownloadObjectOwner,
  keyDownloadStagedFileView,
  keyDownloadStagedKey,
  keyDownloadUploadInputSchema,
  type KeyDownloadContentType,
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
  'audio/mpeg': bytes('ID3', [4, 0, 0]),
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

  it('takes an MPEG frame sync but not a reserved version or layer', () => {
    expect(keyDownloadBytesMatch('audio/mpeg', bytes([0xff, 0xfb, 0x90]))).toBe(true);
    expect(keyDownloadBytesMatch('audio/mpeg', bytes([0xff, 0xe9, 0x90]))).toBe(false);
    expect(keyDownloadBytesMatch('audio/mpeg', bytes([0xff, 0xf9, 0x90]))).toBe(false);
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
