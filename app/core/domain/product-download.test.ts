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
