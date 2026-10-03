import { copyIdentifierSchema, downloadCopyQuerySchema } from './product-download.js';
import { describe, expect, it } from 'vitest';

import { productDownloadAssetSchema, productDownloadCompleteInputSchema, productDownloadUploadInputSchema } from './product-download.js';

describe('download version schemas', () => {
  it('trims version notes and accepts optional replacement details', () => {
    expect(productDownloadCompleteInputSchema.parse({ versionNote: '  Corrected diagram  ', replacesAssetId: 'first' }))
      .toEqual({ versionNote: 'Corrected diagram', replacesAssetId: 'first' });
    expect(productDownloadCompleteInputSchema.parse({})).toEqual({});
    expect(productDownloadCompleteInputSchema.safeParse({ versionNote: 'x'.repeat(501) }).success).toBe(false);
    expect(productDownloadUploadInputSchema.safeParse({ fileName: 'book.pdf', contentType: 'application/pdf', sizeBytes: 100, replacesAssetId: '' }).success).toBe(false);
  });
  it('requires positive integral versions and supplies single-version defaults', () => {
    const row = { id: 'file', lineageId: 'file', tenantId: 'tenant', productId: 'product', fileName: 'book.pdf', contentType: 'application/pdf', sizeBytes: 100, storageKey: 'file', status: 'ready', createdAt: '2026-09-01T00:00:00.000Z' };
    expect(productDownloadAssetSchema.parse(row)).toMatchObject({ versionNumber: 1, versionNote: null, supersededAt: null });
    for (const versionNumber of [0, -1, 1.5]) expect(productDownloadAssetSchema.safeParse({ ...row, versionNumber }).success).toBe(false);
  });
});

it('validates copy entropy encoding and requires a scoped registry lookup', () => {
  expect(copyIdentifierSchema.safeParse('copy_AAAAAAAAAAAAAAAAAAAAAAAAAA').success).toBe(true);
  expect(copyIdentifierSchema.safeParse('copy_AAAAAAAAAAAAAAAAAAAAAAAAAB').success).toBe(false);
  expect(copyIdentifierSchema.safeParse('copy_123').success).toBe(false);
  expect(downloadCopyQuerySchema.safeParse({}).success).toBe(false);
  expect(downloadCopyQuerySchema.safeParse({ productId: 'product' }).success).toBe(false);
  expect(downloadCopyQuerySchema.safeParse({ orderId: 'order' }).success).toBe(true);
});

it('validates and decodes copy history cursors', () => {
  const createdAt = '2026-10-01T12:00:00.000Z';
  expect(downloadCopyQuerySchema.parse({ memberId: 'member', cursor: `${createdAt}~copy%7E1` }))
    .toMatchObject({ cursor: { createdAt, id: 'copy~1' } });
  for (const cursor of ['', 'invalid~id', `${createdAt}~`, `${createdAt}~id~extra`, `${createdAt}~%`]) {
    expect(downloadCopyQuerySchema.safeParse({ memberId: 'member', cursor }).success).toBe(false);
  }
});
