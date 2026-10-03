import { describe, expect, it } from 'vitest';

import {
  PRODUCT_DOWNLOAD_MAX_BYTES,
  err,
  integrationUnavailable,
  ok,
  type Identity,
  type DownloadCopy,
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
  tenantAccess: staffRole === null ? 'member' : 'staff',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole,
  memberId,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
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
  visibility: 'listed',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const grant: ProductGrant = {
  mode: 'live',
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
  lineageId: 'asset-1',
  versionNumber: 1,
  versionNote: null,
  supersededAt: null,
  replacesAssetId: null,
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
    markReady: async (tenantId, assetId, sizeBytes, version) => {
      const index = rows.findIndex((asset) => asset.tenantId === tenantId && asset.id === assetId);
      const current = rows[index];
      if (current === undefined) return null;
      const target = rows.find((row) => row.id === version.replacesAssetId && row.tenantId === tenantId);
      const history = rows.filter((row) => row.tenantId === tenantId && row.lineageId === target?.lineageId);
      for (const row of history) if (row.supersededAt === null) row.supersededAt = version.now;
      const ready: ProductDownloadAsset = {
        ...current, status: 'ready', sizeBytes, versionNote: version.versionNote,
        lineageId: target?.lineageId ?? current.id,
        versionNumber: target ? Math.max(...history.map((row) => row.versionNumber)) + 1 : 1,
      };
      rows[index] = ready;
      return ready;
    },
    delete: async (tenantId, assetId) => {
      const index = rows.findIndex((asset) => asset.tenantId === tenantId && asset.id === assetId);
      if (index < 0) return false;
      const [deleted] = rows.splice(index, 1);
      if (deleted?.status === 'ready' && deleted.supersededAt === null) {
        const latest = rows.filter((row) => row.tenantId === tenantId && row.lineageId === deleted.lineageId && row.status === 'ready')
          .sort((a, b) => b.versionNumber - a.versionNumber)[0];
        if (latest) latest.supersededAt = null;
      }
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
    getObject: async () => ok(new Uint8Array()),
    objectUrl: (configuration, key) => new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
    probe: async () => ok({ code: 'storage.available', message: 'ok' }),
    probeCors: async (_configuration, origins) => origins.map((origin) => ({ origin, status: 'ok' })),
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
  const copies: DownloadCopy[] = [];
  const deps: ProductDownloadDeps = {
    downloadCopies: { create: async (_tenantId, copy) => { copies.push(copy); return true; }, list: async () => copies },
    downloadCopyOrders: { findLatestPaidOrderId: async () => null },
    downloadPersonaliser: { personalise: async () => err(integrationUnavailable('Unsupported test file')) },
    downloadCopyCrypto: { identifier: () => 'copy_AAAAAAAAAAAAAAAAAAAAAAAAAA', hash: () => 'a'.repeat(64) },
    personalisationMaxBytes: 20 * 1024 * 1024,
    personalisationSlots: { acquire: () => () => undefined },
    downloadAssets,
    products,
    grants: grants(activeGrant),
    storage,
    secretResolver: { resolve: async () => ok(storageConfiguration) },
    ids: { nextId: () => 'asset-1' },
    clock: { nowIso: () => NOW },
    logger: { error: (message) => warnings.push(message) },
  };
  return { deps, downloadAssets, removed, signed, warnings, copies };
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


describe('file version use cases', () => {
  it('joins the lineage on completion without deleting older storage objects', async () => {
    const { deps, downloadAssets, removed } = testDeps();
    deps.ids = { nextId: () => 'asset-2' };
    downloadAssets.rows.push(storedAsset());
    await beginProductDownloadUpload(ownerCtx, product.id, {
      fileName: 'errata.pdf', contentType: 'application/pdf', sizeBytes: 100, replacesAssetId: 'asset-1',
    }, deps);
    expect(downloadAssets.rows[0]?.supersededAt).toBeNull();
    const result = await completeProductDownloadUpload(ownerCtx, product.id, 'asset-2', deps, { versionNote: '  Fixed diagram  ' });
    expect(result).toMatchObject({ ok: true, value: { lineageId: 'asset-1', versionNumber: 2, versionNote: 'Fixed diagram' } });
    expect(downloadAssets.rows[0]?.supersededAt).toBe(NOW);
    expect(removed).toEqual([]);
    await deleteProductDownloadAsset(ownerCtx, product.id, 'asset-2', deps);
    expect(downloadAssets.rows[0]?.supersededAt).toBeNull();
    expect(removed).toEqual(['https://storage.example.test/creator-files/product-downloads/download-1/asset-2/errata.pdf']);
  });

  it.each([
    { override: { productId: 'other-product' }, code: 'not_found' },
    { override: { tenantId: 'other-tenant' }, code: 'not_found' },
    { override: { status: 'pending' as const }, code: 'validation' },
  ])('rejects invalid replacements at begin and completion: $code $override', async ({ override, code }) => {
    const { deps, downloadAssets } = testDeps();
    downloadAssets.rows.push(storedAsset(override), storedAsset({ id: 'pending', lineageId: 'pending', status: 'pending' }));
    const input = { fileName: 'new.pdf', contentType: 'application/pdf', sizeBytes: 100, replacesAssetId: 'asset-1' };
    expect(await beginProductDownloadUpload(ownerCtx, product.id, input, deps)).toMatchObject({ ok: false, error: { code } });
    expect(await completeProductDownloadUpload(ownerCtx, product.id, 'pending', deps, input)).toMatchObject({ ok: false, error: { code } });
  });

  it('allows old versions only with active member access and preserves the TTL', async () => {
    const { deps, downloadAssets, signed } = testDeps();
    downloadAssets.rows.push(storedAsset({ supersededAt: NOW }));
    expect(await getProductDownload(memberCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: true });
    expect(signed[0]?.expiresInSeconds).toBe(PRODUCT_DOWNLOAD_TTL_SECONDS);
    deps.grants = grants(false);
    expect(await getProductDownload(memberCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await getProductDownload(ownerCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(signed).toHaveLength(1);
  });
});

describe('issued download copies', () => {
  it('records the exact member, paid order, asset lineage and output hash before returning bytes', async () => {
    const { deps, downloadAssets, copies, signed } = testDeps();
    downloadAssets.rows.push(storedAsset({ lineageId: 'first-edition', versionNumber: 3 }));
    deps.downloadCopyOrders.findLatestPaidOrderId = async (tenantId, memberId, productId) => {
      expect([tenantId, memberId, productId]).toEqual(['tenant-1', 'member-1', product.id]);
      return 'paid-order';
    };
    deps.downloadPersonaliser.personalise = async (input) => {
      expect(input.copyIdentifier).toBe('copy_AAAAAAAAAAAAAAAAAAAAAAAAAA');
      return ok({ bytes: new Uint8Array([1, 2, 3]), contentType: input.contentType });
    };
    expect(await getProductDownload(memberCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: true, value: { kind: 'file', fileName: 'workbook.pdf' } });
    expect(copies).toEqual([expect.objectContaining({
      tenantId: 'tenant-1', memberId: 'member-1', productId: product.id, orderId: 'paid-order',
      assetId: 'asset-1', lineageId: 'first-edition', versionNumber: 3, personalised: true,
      bytes: 3, contentHash: 'a'.repeat(64), createdAt: NOW,
    })]);
    expect(signed).toEqual([]);
  });

  it.each([
    { contentType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 + 1 },
    { contentType: 'image/png', sizeBytes: 100 },
  ])('decides fallback before reading $contentType of $sizeBytes bytes', async (override) => {
    const { deps, downloadAssets, copies } = testDeps();
    downloadAssets.rows.push(storedAsset(override));
    deps.storage.getObject = async () => { throw new Error('Must not fetch'); };
    expect(await getProductDownload(memberCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: true, value: { kind: 'redirect' } });
    expect(copies).toMatchObject([{ personalised: false, orderId: null, contentHash: null, bytes: null }]);
  });

  it('falls back without reading when no injected slot is available', async () => {
    const { deps, downloadAssets, copies } = testDeps();
    downloadAssets.rows.push(storedAsset());
    deps.personalisationSlots.acquire = () => null;
    deps.storage.getObject = async () => { throw new Error('Saturated request must not fetch'); };
    expect(await getProductDownload(memberCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: true, value: { kind: 'redirect' } });
    expect(copies).toMatchObject([{ personalised: false, contentHash: null, bytes: null }]);
  });

  it.each(['success', 'storage rejection', 'registry rejection'])('releases the injected slot after %s', async (outcome) => {
    const { deps, downloadAssets } = testDeps();
    downloadAssets.rows.push(storedAsset());
    let released = 0;
    deps.personalisationSlots.acquire = () => () => { released++; };
    if (outcome === 'storage rejection') deps.storage.getObject = async () => { throw new Error(outcome); };
    if (outcome === 'registry rejection') deps.downloadCopies.create = async () => { throw new Error(outcome); };
    const result = getProductDownload(memberCtx, product.id, 'asset-1', deps);
    if (outcome === 'success') expect(await result).toMatchObject({ ok: true });
    else await expect(result).rejects.toThrow(outcome);
    expect(released).toBe(1);
  });

  it('records unpersonalised fallback on adapter failure and stops if the registry write fails', async () => {
    const { deps, downloadAssets, copies } = testDeps();
    downloadAssets.rows.push(storedAsset());
    expect(await getProductDownload(memberCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: true, value: { kind: 'redirect' } });
    expect(copies[0]?.personalised).toBe(false);
    deps.downloadCopies.create = async () => { throw new Error('Database unavailable'); };
    await expect(getProductDownload(memberCtx, product.id, 'asset-1', deps)).rejects.toThrow('Database unavailable');
  });

  it('records storage-size failure as fallback and denies an erased member without a response', async () => {
    const { deps, downloadAssets, copies } = testDeps();
    downloadAssets.rows.push(storedAsset());
    deps.storage.getObject = async () => err(integrationUnavailable('Object too large'));
    expect(await getProductDownload(memberCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: true, value: { kind: 'redirect' } });
    expect(copies[0]?.personalised).toBe(false);
    deps.downloadCopies.create = async () => false;
    expect(await getProductDownload(memberCtx, product.id, 'asset-1', deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('does not read bytes or issue copies to expired grants or non-members', async () => {
    const { deps, downloadAssets, copies } = testDeps(false);
    downloadAssets.rows.push(storedAsset());
    deps.storage.getObject = async () => { throw new Error('Must not fetch'); };
    for (const ctx of [memberCtx, ownerCtx]) expect(await getProductDownload(ctx, product.id, 'asset-1', deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(copies).toEqual([]);
  });
});
