import { describe, expect, it, vi } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type StorageListedObject,
  type StorageReferenceInventory,
} from '#core/domain/index.js';

import { createMemoryStorageList } from '../testing/storage-list.js';
import { reportStorageOrphans } from './storage-orphan-report.js';

const NOW = '2026-11-10T12:00:00.000Z';
const OLD = '2026-11-08T12:00:00.000Z';
const imageId = '00000000-0000-4000-8000-000000000001';
const currentCover = `image-assets/tenant-a/course-cover/${imageId}.png`;
const historyCover = `image-assets/tenant-a/product-cover/${imageId}.png`;
const branding = `image-assets/tenant-a/logo/${imageId}.png`;
const pendingKey = 'tenant-a/lesson-attachments/shared/pending/file.pdf';
const earlierDownload = 'tenant-a/product-downloads/shared/version-1/file.pdf';
const legacyKey = 'lesson-attachments/shared/attachment-1/file.pdf';
const unknownLegacy = 'lesson-attachments/shared/other/file.pdf';
const candidate = 'tenant-a/product-downloads/deleted/asset/file.pdf';
const unconfirmedImage = `image-asset-candidates/tenant-a/logo/${imageId}.svg`;
const recentImageCandidate = `image-asset-candidates/tenant-a/favicon/${imageId}.ico`;
const foreignImageCandidate = `image-asset-candidates/tenant-b/logo/${imageId}.svg`;
const recent = 'image-assets/tenant-a/logo/recent.png';
const foreign = 'image-assets/tenant-b/logo/foreign.png';

const fixture = () => {
  const inventory: StorageReferenceInventory = {
    lessonIds: ['shared'],
    productIds: ['shared'],
    attachments: [{ storageKey: pendingKey, status: 'pending' }, { storageKey: legacyKey, status: 'ready' }],
    downloads: [{ storageKey: earlierDownload, status: 'ready', supersededAt: OLD }],
    currentDocuments: [{ imageUrl: `/api/public/assets/course-cover/${imageId}.png` }],
    historyDocuments: [{ coverUrl: `/api/public/assets/product-cover/${imageId}.png` }],
  };
  const objects: StorageListedObject[] = [currentCover, historyCover, branding, pendingKey, earlierDownload,
    legacyKey, unknownLegacy, candidate, foreign, unconfirmedImage, foreignImageCandidate].map((key) => ({ key, sizeBytes: 123, lastModified: OLD }));
  objects.push({ key: recent, sizeBytes: 4, lastModified: NOW },
    { key: recentImageCandidate, sizeBytes: 4, lastModified: NOW });
  const forbiddenWrite = vi.fn((): never => { throw new Error('Report must not write'); });
  const references = { readInventory: vi.fn(async () => inventory), create: forbiddenWrite, update: forbiddenWrite, delete: forbiddenWrite };
  const storage = { list: vi.fn(createMemoryStorageList(objects, 1)), delete: forbiddenWrite };
  return {
    deps: {
      references,
      storage,
      secretResolver: { resolve: async () => ok(JSON.stringify({
        provider: 'minio', endpoint: 'https://storage.example.test', bucket: 'shared', region: 'test',
        accessKeyId: 'test', secretAccessKey: 'test',
      })) },
      clock: { nowIso: () => NOW },
    },
    inventory,
    objects,
    forbiddenWrite,
  };
};

describe('reportStorageOrphans', () => {
  it('paginates only tenant namespaces, retains historical covers and downloads, and never writes', async () => {
    const { deps, forbiddenWrite } = fixture();
    const result = await reportStorageOrphans({ tenantId: 'tenant-a' }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.complete).toBe(true);
    expect(result.value.graceHours).toBe(24);
    expect(result.value.pagesScanned).toBeGreaterThan(5);
    expect(Object.fromEntries(result.value.objects.map((object) => [object.key, object.classification]))).toEqual({
      [currentCover]: 'referenced',
      [historyCover]: 'referenced-by-history',
      [branding]: 'unreferenced-candidate',
      [pendingKey]: 'pending',
      [earlierDownload]: 'referenced-by-history',
      [legacyKey]: 'referenced',
      [unknownLegacy]: 'unknown-owner',
      [candidate]: 'unreferenced-candidate',
      [unconfirmedImage]: 'unreferenced-candidate',
      [recentImageCandidate]: 'within-grace-period',
      [recent]: 'within-grace-period',
    });
    expect(result.value.summary).toEqual({
      referenced: 2, 'referenced-by-history': 2, pending: 1, 'unreferenced-candidate': 3,
      'unknown-owner': 1, 'within-grace-period': 2,
    });
    expect(deps.references.readInventory).toHaveBeenCalledWith('tenant-a');
    expect(new Set(deps.storage.list.mock.calls.map(([input]) => input.prefix))).toEqual(new Set([
      'image-assets/tenant-a/', 'image-asset-candidates/tenant-a/', 'tenant-a/lesson-attachments/', 'tenant-a/product-downloads/',
      'lesson-attachments/shared/', 'product-downloads/shared/',
    ]));
    expect(forbiddenWrite).not.toHaveBeenCalled();
  });

  it('does not attribute legacy sibling objects to a tenant sharing the same resource id', async () => {
    const { deps } = fixture();
    const result = await reportStorageOrphans({ tenantId: 'tenant-b' }, {
      ...deps,
      references: { readInventory: async () => ({
        lessonIds: ['shared'], productIds: [], attachments: [], downloads: [], currentDocuments: [], historyDocuments: [],
      }) },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: legacyKey, classification: 'unknown-owner' }),
      expect.objectContaining({ key: unknownLegacy, classification: 'unknown-owner' }),
    ]));
    expect(result.value.objects.some((object) => object.key.startsWith('tenant-a/') || object.key.startsWith('image-assets/tenant-a/'))).toBe(false);
  });

  it('keeps pending rows pending regardless of age and applies the configurable grace period', async () => {
    const { deps } = fixture();
    const result = await reportStorageOrphans({ tenantId: 'tenant-a', graceHours: 72 }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.objects.find((object) => object.key === pendingKey)?.classification).toBe('pending');
    expect(result.value.objects.find((object) => object.key === candidate)?.classification).toBe('within-grace-period');
  });

  it('marks partial reports incomplete when the page budget is exhausted', async () => {
    const { deps } = fixture();
    const result = await reportStorageOrphans({ tenantId: 'tenant-a', maxPages: 1 }, deps);
    expect(result).toMatchObject({ ok: true, value: { complete: false, pagesScanned: 1 } });
    expect(deps.storage.list).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid requests before touching repositories or storage', async () => {
    const { deps } = fixture();
    for (const input of [{ tenantId: '../tenant-b' }, { tenantId: 'tenant-a', graceHours: -1 }, { tenantId: 'tenant-a', maxPages: 0 }]) {
      expect(await reportStorageOrphans(input, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(deps.references.readInventory).not.toHaveBeenCalled();
    expect(deps.storage.list).not.toHaveBeenCalled();
  });

  it('fails closed on out-of-scope objects or repeated continuation tokens', async () => {
    const { deps } = fixture();
    deps.storage.list.mockImplementation(async () => ok({ objects: [{ key: foreign, sizeBytes: 1, lastModified: OLD }], continuationToken: null }));
    expect(await reportStorageOrphans({ tenantId: 'tenant-a' }, deps)).toMatchObject({ ok: false });
    deps.storage.list.mockImplementation(async () => ok({ objects: [], continuationToken: 'repeated' }));
    expect(await reportStorageOrphans({ tenantId: 'tenant-a' }, deps)).toMatchObject({ ok: false });
  });

  it('propagates expected list errors and unexpected repository rejections', async () => {
    const { deps } = fixture();
    const failure = err(integrationUnavailable('Listing unavailable'));
    deps.storage.list.mockResolvedValue(failure);
    expect(await reportStorageOrphans({ tenantId: 'tenant-a' }, deps)).toEqual(failure);
    deps.references.readInventory.mockRejectedValue(new Error('Database unavailable'));
    await expect(reportStorageOrphans({ tenantId: 'tenant-a' }, deps)).rejects.toThrow('Database unavailable');
  });

  it('finds image references nested inside current and historical rich content', async () => {
    const { deps, inventory } = fixture();
    inventory.currentDocuments.push({ contents: [{ html: `<img src="/api/public/assets/logo/${imageId}.png">` }] });
    const result = await reportStorageOrphans({ tenantId: 'tenant-a' }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.objects.find((object) => object.key === branding)?.classification).toBe('referenced');
  });
});
