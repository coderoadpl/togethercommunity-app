import { describe, expect, it } from 'vitest';

import {
  PRODUCT_DOWNLOAD_MAX_BYTES,
  err,
  integrationUnavailable,
  ok,
  type Identity,
  type Product,
  type ProductDownloadAsset,
  type ProductGrant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  ProductDownloadAssetRepository,
  ProductGrantRepository,
  ProductRepository,
  StorageProvider,
} from '../ports.js';
import {
  PRODUCT_DOWNLOAD_TTL_SECONDS,
  beginProductDownloadUpload,
  completeProductDownloadUpload,
  deleteProductDownloadAsset,
  getProductDownload,
  type ProductDownloadDeps,
} from './product-downloads.js';

const NOW = '2026-08-03T12:00:00.000Z';

const identity = (staffRole: Identity['staffRole'], memberId: string | null): Identity => ({
  userId: staffRole === null ? 'member-user' : 'owner-user',
  email: staffRole === null ? 'buyer@example.test' : 'owner@example.test',
  name: staffRole === null ? 'Buyer' : 'Owner',
  emailVerified: true,
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole,
  memberId,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
});

const ownerCtx: Ctx = { identity: identity('owner', null) };
const memberCtx: Ctx = { identity: identity(null, 'member-1') };

const product: Product = {
  id: 'download-1',
  tenantId: 'tenant-1',
  type: 'digital_download',
  slug: 'creator-workbook',
  title: 'Creator workbook',
  description: '',
  coverUrl: null,
  priceCents: 4900,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const grant: ProductGrant = {
  id: 'grant-1',
  tenantId: 'tenant-1',
  memberId: 'member-1',
  productId: product.id,
  source: 'stripe',
  startsAt: '2026-08-01T00:00:00.000Z',
  expiresAt: null,
  legacyId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const storedAsset = (overrides: Partial<ProductDownloadAsset> = {}): ProductDownloadAsset => ({
  id: 'asset-1',
  tenantId: 'tenant-1',
  productId: product.id,
  fileName: 'workbook.pdf',
  contentType: 'application/pdf',
  sizeBytes: 4096,
  storageKey: 'product-downloads/download-1/asset-1/workbook.pdf',
  status: 'ready',
  createdAt: NOW,
  ...overrides,
});

const assetRepository = (): ProductDownloadAssetRepository & { rows: ProductDownloadAsset[] } => {
  const rows: ProductDownloadAsset[] = [];
  return {
    rows,
    create: async (tenantId, asset) => {
      rows.push({ ...asset, tenantId });
    },
    findById: async (tenantId, assetId) =>
      rows.find((asset) => asset.tenantId === tenantId && asset.id === assetId) ?? null,
    listByProduct: async (tenantId, productId) =>
      rows.filter((asset) => asset.tenantId === tenantId && asset.productId === productId),
    listReadyByProduct: async (tenantId, productId) =>
      rows.filter((asset) =>
        asset.tenantId === tenantId && asset.productId === productId && asset.status === 'ready'),
    markReady: async (tenantId, assetId, sizeBytes) => {
      const index = rows.findIndex((asset) => asset.tenantId === tenantId && asset.id === assetId);
      const current = rows[index];
      if (current === undefined) return null;
      const ready: ProductDownloadAsset = { ...current, status: 'ready', sizeBytes };
      rows[index] = ready;
      return ready;
    },
    delete: async (tenantId, assetId) => {
      const index = rows.findIndex((asset) => asset.tenantId === tenantId && asset.id === assetId);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
};

const products: ProductRepository = {
  listByTenant: async () => [product],
  listPublishedByTenant: async () => [product],
  findById: async (tenantId, productId) =>
    tenantId === product.tenantId && productId === product.id ? product : null,
  create: async () => 'created',
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
};

const grants = (active: boolean): ProductGrantRepository => ({
  findById: async () => null,
  findGrant: async () => null,
  createGrant: async () => true,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async (_tenantId, memberId) => active && memberId === grant.memberId ? [grant] : [],
  listGrantedProducts: async () => active ? [product] : [],
});

const storageConfiguration = JSON.stringify({
  provider: 'minio',
  endpoint: 'https://storage.example.test',
  region: 'eu-central-1',
  bucket: 'creator-files',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
});

const testDeps = (activeGrant = true, actualSizeBytes = 4096) => {
  const downloadAssets = assetRepository();
  const signed: Array<{ method: 'GET' | 'PUT'; url: string; expiresInSeconds: number }> = [];
  const removed: string[] = [];
  const warnings: string[] = [];
  const storage: StorageProvider = {
    objectUrl: (configuration, key) => new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
    probe: async () => ok({ code: 'storage.available', message: 'ok' }),
    presignPut: (input) => {
      signed.push({ method: 'PUT', url: input.url, expiresInSeconds: input.expiresInSeconds });
      return ok(`${input.url}?signed=put`);
    },
    presignGet: (input) => {
      signed.push({ method: 'GET', url: input.url, expiresInSeconds: input.expiresInSeconds });
      return ok(`${input.url}&signed=get`);
    },
    delete: async (input) => {
      removed.push(input.url);
      return ok({ deleted: true });
    },
    head: async () => ok({ sizeBytes: actualSizeBytes }),
    healthcheck: async () => ok({ healthy: true }),
    test: async () => ok({ code: 'storage.available', message: 'ok' }),
  };
  const deps: ProductDownloadDeps = {
    downloadAssets,
    products,
    grants: grants(activeGrant),
    storage,
    secretResolver: { resolve: async () => ok(storageConfiguration) },
    ids: { nextId: () => 'asset-1' },
    clock: { nowIso: () => NOW },
    logger: { error: (message) => warnings.push(message) },
  };
  return { deps, downloadAssets, removed, signed, warnings };
};

describe('product downloads', () => {
  it('uploads a creator file directly and marks it ready after storage verification', async () => {
    const { deps, downloadAssets, signed } = testDeps();
    const started = await beginProductDownloadUpload(ownerCtx, product.id, {
      fileName: 'Workbook 2026.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4000,
    }, deps);

    expect(started).toMatchObject({
      ok: true,
      value: { asset: { id: 'asset-1', status: 'pending' } },
    });
    const completed = await completeProductDownloadUpload(ownerCtx, product.id, 'asset-1', deps);
    expect(completed).toMatchObject({ ok: true, value: { status: 'ready', sizeBytes: 4096 } });
    expect(downloadAssets.rows).toHaveLength(1);
    expect(signed[0]).toMatchObject({ method: 'PUT' });
  });

  it('issues an expiring signed URL for a purchased download', async () => {
    const { deps, downloadAssets, signed } = testDeps();
    downloadAssets.rows.push(storedAsset());

    const result = await getProductDownload(memberCtx, product.id, 'asset-1', deps);

    expect(result).toMatchObject({ ok: true });
    expect(signed).toEqual([expect.objectContaining({
      method: 'GET',
      expiresInSeconds: PRODUCT_DOWNLOAD_TTL_SECONDS,
    })]);
    expect(signed[0]?.url).toContain('response-content-disposition=attachment');
    expect(signed[0]?.url).toContain('workbook.pdf');
  });

  it('returns forbidden before signing for an unentitled member', async () => {
    const { deps, downloadAssets, signed } = testDeps(false);
    downloadAssets.rows.push(storedAsset());

    const result = await getProductDownload(memberCtx, product.id, 'asset-1', deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(signed).toEqual([]);
  });

  it('returns not found when an entitled member requests an asset from another product', async () => {
    const { deps, downloadAssets, signed } = testDeps();
    downloadAssets.rows.push(storedAsset({ productId: 'download-2' }));

    const result = await getProductDownload(memberCtx, product.id, 'asset-1', deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(signed).toEqual([]);
  });

  it('returns not found when an entitled member requests a pending asset', async () => {
    const { deps, downloadAssets, signed } = testDeps();
    downloadAssets.rows.push(storedAsset({ status: 'pending' }));

    const result = await getProductDownload(memberCtx, product.id, 'asset-1', deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(signed).toEqual([]);
  });

  it('deletes an invalid uploaded object before returning validation', async () => {
    const { deps, downloadAssets, removed } = testDeps(true, PRODUCT_DOWNLOAD_MAX_BYTES + 1);
    const started = await beginProductDownloadUpload(ownerCtx, product.id, {
      fileName: 'oversized.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);

    const result = await completeProductDownloadUpload(ownerCtx, product.id, 'asset-1', deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(removed).toEqual([
      'https://storage.example.test/creator-files/product-downloads/download-1/asset-1/oversized.pdf',
    ]);
    expect(downloadAssets.rows[0]?.status).toBe('pending');
  });

  it('detaches the row before storage cleanup and reports cleanup failure as a warning', async () => {
    const { deps, downloadAssets, warnings } = testDeps();
    const sequence: string[] = [];
    downloadAssets.rows.push(storedAsset());
    const deleteRow = downloadAssets.delete;
    downloadAssets.delete = async (tenantId, assetId) => {
      sequence.push('row');
      return deleteRow(tenantId, assetId);
    };
    deps.storage = {
      ...deps.storage,
      delete: async () => {
        sequence.push('storage');
        return err(integrationUnavailable('Storage unavailable'));
      },
    };

    const result = await deleteProductDownloadAsset(ownerCtx, product.id, 'asset-1', deps);

    expect(result).toEqual({ ok: true, value: { deleted: true } });
    expect(sequence).toEqual(['row', 'storage']);
    expect(downloadAssets.rows).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('Storage unavailable')]);
  });

  it('rejects creator-route writes from an ordinary member', async () => {
    const { deps, downloadAssets } = testDeps();

    await expect(beginProductDownloadUpload(memberCtx, product.id, {
      fileName: 'member.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    }, deps)).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    downloadAssets.rows.push(storedAsset());
    await expect(
      deleteProductDownloadAsset(memberCtx, product.id, 'asset-1', deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(downloadAssets.rows).toHaveLength(1);
  });
});
