import { and, eq, ne, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import {
  err,
  integrationUnavailable,
  KEY_DOWNLOAD_FILE_LIMITS,
  keyDownloadCopyRefused,
  type Identity,
  type KeyDownloadContentType,
  type ShopManagementKey,
} from '#core/domain/index.js';
import {
  attachStagedProductDownload,
  beginKeyDownloadUpload,
  completeKeyDownloadUpload,
  copyKeyDownloadFile,
  deleteProductDownloadAsset,
  deleteProductDraft,
  discardKeyDownloadFile,
  listKeyDownloadFiles,
  removeProductDownloadFile,
  shopManagementKeyCapabilities,
  sweepKeyDownloadFiles,
  type Ctx,
  type KeyDownloadSweepCutoffs,
  type StorageProvider,
} from '#core/server/index.js';
import { createObjectStorageFake } from '#core/server/testing/object-storage-fake.js';

import { createKeyDownloadAttachRepository, createKeyDownloadFileRepository } from './key-download-files.js';
import { createProductDraftRepository } from './product-drafts.js';
import { createProductDownloadAssetRepository, createTenantSecretRepository } from './repositories.js';
import {
  changeProposalDownloadDeletions,
  changeProposalDownloadFiles,
  changeProposalDownloadUploadEvents,
  changeProposalDownloadUploads,
  productDownloadAssets,
  products,
  productStock,
  shopManagementKeys,
  stockEvents,
  tenants,
} from './schema.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createStorageReferenceRepository } from './storage-references.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-key-downloads';
const NEIGHBOUR = 't-key-downloads-neighbour';
const NOW = '2026-03-01T10:00:00.000Z';
const ISSUER = 'user-issuer';
const KEY_ID = 'key-files';
const OTHER_KEY_ID = 'key-files-second';
const NEIGHBOUR_KEY_ID = 'key-files-neighbour';
const PRODUCT = 'workbook';
const MIB = 1024 * 1024;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;

const key = (id: string, tenantId = TENANT): ShopManagementKey => ({
  id, tenantId, name: `Agent ${id}`, keyHash: `hash-${id}`, scopes: ['shop:catalog:read', 'shop:catalog:write'],
  mode: 'direct', issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z', revokedAt: null,
});

const identity = (tenantId: string): Identity => ({
  userId: ISSUER, email: 'issuer@example.test', name: 'Issuer', emailVerified: true, tenantAccess: 'staff',
  tenantId, tenantSlug: tenantId, tenantName: 'Files', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const keyCtx = (apiKeyId = KEY_ID, tenantId = TENANT): Ctx => ({
  identity: identity(tenantId),
  capabilities: shopManagementKeyCapabilities(key(apiKeyId, tenantId)),
  machineActor: { kind: 'shop_management_key', apiKeyId, mode: 'direct' },
});

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 9).toString('base64'));

const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 42]);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42, 42]);

const lockWaiters = async (observer: pg.Client): Promise<number> => (await observer.query<{ count: number }>(
  "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
)).rows[0]?.count ?? 0;

const untilWaiting = async (observer: pg.Client, what: string, waiters = 1): Promise<void> => {
  for (const deadline = Date.now() + 10_000; await lockWaiters(observer) < waiters;) {
    if (Date.now() > deadline) throw new Error(`${what} never waited`);
  }
};

const connected = async (): Promise<pg.Client> => {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  return client;
};

const gate = () => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
};

beforeAll(async () => {
  database = await createTestDatabase('together_key_download_files', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values([
    { id: TENANT, slug: 'files', name: 'Files', createdAt: NOW },
    { id: NEIGHBOUR, slug: 'files-neighbour', name: 'Neighbour', createdAt: NOW },
  ]);
  for (const tenantId of [TENANT, NEIGHBOUR]) {
    await createTenantSecretRepository(database.db).upsert(tenantId, {
      id: `storage-configuration-${tenantId}`, tenantId, key: 's3.configuration', maskedPreview: 'configured', updatedAt: NOW,
      ...secretCrypto.encrypt(JSON.stringify({
        provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'assets', accessKeyId: 'a', secretAccessKey: 's',
      })),
    });
  }
});

afterAll(async () => { await database?.close(); });

beforeEach(async () => {
  for (const table of [changeProposalDownloadFiles, changeProposalDownloadUploads, changeProposalDownloadDeletions, changeProposalDownloadUploadEvents, stockEvents, productStock, productDownloadAssets, products, shopManagementKeys]) {
    await database.db.delete(table);
  }
  for (const created of [key(KEY_ID), key(OTHER_KEY_ID), key(NEIGHBOUR_KEY_ID, NEIGHBOUR)]) {
    await createShopManagementKeyRepository(database.db).create(created.tenantId, created, {
      id: `key-event-${String(++sequence)}`, tenantId: created.tenantId, apiKeyId: created.id, kind: 'created', actorUserId: ISSUER,
      method: null, route: null, resourceId: null, at: created.createdAt,
    });
  }
  await database.db.insert(products).values([
    { id: PRODUCT, tenantId: TENANT, slug: PRODUCT, title: 'Workbook', type: 'digital_download', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW },
    { id: 'mug', tenantId: TENANT, slug: 'mug', title: 'Mug', type: 'physical', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW },
    { id: 'neighbour-book', tenantId: NEIGHBOUR, slug: 'neighbour-book', title: 'Book', type: 'digital_download', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW },
  ]);
});

const harness = (lockWaitMs?: number) => {
  const objects = createObjectStorageFake({ sha256: (bytes) => createContentHash().sha256(bytes) });
  const clock = { now: NOW };
  const logger = { error: vi.fn<(message: string) => void>() };
  let ids = 0;
  const bounds = lockWaitMs === undefined ? {} : { lockWaitMs };
  const deps = {
    keyDownloadFiles: createKeyDownloadFileRepository(database.db, bounds),
    keyDownloadAttach: createKeyDownloadAttachRepository(database.db),
    downloadAssets: createProductDownloadAssetRepository(database.db),
    storage: objects.storage,
    secretResolver: createTenantSecretResolver(createTenantSecretRepository(database.db), secretCrypto),
    ids: { nextId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
    clock: { nowIso: () => clock.now },
    logger,
  };
  const begin = async (bytes: Uint8Array, options: { ctx?: Ctx; contentType?: KeyDownloadContentType; fileName?: string } = {}) => {
    const started = await beginKeyDownloadUpload(options.ctx ?? keyCtx(), {
      fileName: options.fileName ?? 'workbook.pdf', contentType: options.contentType ?? 'application/pdf', sizeBytes: bytes.byteLength,
    }, deps);
    if (!started.ok) throw new Error(started.error.message);
    const candidate = decodeURIComponent(new URL(started.value.upload.url).pathname.slice(1));
    objects.objects.set(candidate, { bytes, contentType: 'text/html' });
    return { id: started.value.upload.id, candidate, started: started.value };
  };
  const stage = async (bytes: Uint8Array = PDF, ctx: Ctx = keyCtx()) => {
    const { id } = await begin(bytes, { ctx });
    const completed = await completeKeyDownloadUpload(ctx, { uploadId: id }, deps);
    if (!completed.ok) throw new Error(completed.error.message);
    return completed.value.file;
  };
  return { objects, clock, logger, deps, begin, stage };
};

const stagedRows = async () => (await database.db.select().from(changeProposalDownloadFiles)).map((row) => row.id).sort();

const recordStates = async () => (await database.db.select().from(changeProposalDownloadUploads)).map((row) => row.state).sort();

const owedRows = async () => (await database.db.select().from(changeProposalDownloadDeletions)).map((row) => row.objectKey)
  .filter((objectKey) => objectKey.includes('/product-downloads/key-files/')).sort();

const at = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

describe('staging a download file through an upload', () => {
  it('copies the upload to a private key-owned object, hashes it, deletes the candidate and attaches the staged object live', async () => {
    const h = harness();
    const { id, candidate, started } = await h.begin(PDF);
    expect(started.upload.headers).toEqual({ 'content-type': 'application/pdf', 'content-length': String(PDF.byteLength) });
    expect(h.objects.signedLengths.get(candidate)).toBe(PDF.byteLength);
    expect(candidate).toBe(`${TENANT}/product-downloads/key-uploads/${KEY_ID}/${id}`);

    const completed = await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
    if (!completed.ok) throw new Error(completed.error.message);
    const file = completed.value.file;
    expect(file).toMatchObject({ fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength, sha256: createContentHash().sha256(PDF), copiedFrom: null });
    const stagedKey = `${TENANT}/product-downloads/key-files/${KEY_ID}/${file.id}/workbook.pdf`;
    expect(h.objects.keysUnder(`${TENANT}/`)).toEqual([stagedKey]);
    expect(h.objects.objects.get(stagedKey)?.contentType).toBe('application/octet-stream');
    expect(await listKeyDownloadFiles(keyCtx(), h.deps)).toEqual({ ok: true, value: { files: [file] } });

    const attached = await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: file.id, versionNote: 'First' }, h.deps);
    expect(attached).toMatchObject({ ok: true, value: { id: file.id, storageKey: stagedKey, status: 'ready', versionNumber: 1, versionNote: 'First' } });
    const [row] = await database.db.select().from(productDownloadAssets).where(eq(productDownloadAssets.id, file.id));
    expect(row?.sha256).toBe(file.sha256);
    expect(await stagedRows()).toEqual([]);
    expect(h.objects.calls.filter((call) => call.method === 'putObject' || call.method === 'presignGet')).toEqual([]);
  });

  it('adds a staged file as the next version of a ready file and supersedes the previous latest version', async () => {
    const h = harness();
    const first = await h.stage();
    const second = await h.stage(new Uint8Array([...PDF, 1]));
    await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: first.id }, h.deps);
    const replaced = await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id, replacesAssetId: first.id }, h.deps);
    expect(replaced).toMatchObject({ ok: true, value: { id: second.id, lineageId: first.id, versionNumber: 2, supersededAt: null } });
    const [previous] = await database.db.select().from(productDownloadAssets).where(eq(productDownloadAssets.id, first.id));
    expect(previous?.supersededAt).toBe(NOW);
  });

  it('refuses a file whose first bytes are not its declared type and deletes the candidate and the staged copy', async () => {
    const h = harness();
    const { id } = await h.begin(PNG, { contentType: 'application/pdf' });
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation', details: { fieldErrors: { contentType: expect.any(Array) } } } });
    expect(h.objects.keysUnder(`${TENANT}/`)).toEqual([]);
    expect(h.objects.calls.filter((call) => call.method === 'delete')).toHaveLength(2);
    expect(await stagedRows()).toEqual([]);
    expect(await recordStates()).toEqual(['failed']);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('answers an upload never written and an expired upload without staging anything', async () => {
    const h = harness();
    const started = await beginKeyDownloadUpload(keyCtx(), { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 }, h.deps);
    if (!started.ok) throw new Error(started.error.message);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: started.value.upload.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    const late = await h.begin(PDF);
    h.clock.now = at(16);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: late.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.objects.calls.filter((call) => call.method === 'head' || call.method === 'copyObject').map((call) => call.method)).toEqual(['head']);
    expect(await stagedRows()).toEqual([]);
  });

  it('lets exactly one of two concurrent completions of one upload perform storage requests and write the staged object once', async () => {
    const h = harness();
    const { id } = await h.begin(PDF);
    const copying = gate();
    const release = gate();
    let copies = 0;
    h.objects.beforeCopy = async () => {
      copies += 1;
      if (copies > 1) return;
      copying.open();
      await release.opened;
    };
    const first = completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
    await copying.opened;
    const second = await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
    release.open();
    expect(second).toMatchObject({ ok: false, error: { code: 'conflict', message: expect.stringContaining('another request') } });
    const winner = await first;
    if (!winner.ok) throw new Error(winner.error.message);
    const retried = await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
    expect(retried).toEqual({ ok: true, value: { file: winner.value.file } });
    expect(h.objects.calls.filter((call) => call.method === 'copyObject' || call.method === 'digestObject').map((call) => call.method))
      .toEqual(['copyObject', 'digestObject']);
    expect(await stagedRows()).toEqual([winner.value.file.id]);
  });
});

describe('staging and attaching across keys and workspaces', () => {
  it('never reaches another key\'s or another workspace\'s upload, staged file, product or file', async () => {
    const h = harness();
    const own = await h.stage();
    const other = await h.stage(PDF, keyCtx(OTHER_KEY_ID));
    const { id: otherUpload } = await h.begin(PDF, { ctx: keyCtx(OTHER_KEY_ID) });
    const neighbourCtx = keyCtx(NEIGHBOUR_KEY_ID, NEIGHBOUR);

    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: otherUpload }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await completeKeyDownloadUpload(neighbourCtx, { uploadId: otherUpload }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await listKeyDownloadFiles(keyCtx(), h.deps)).toEqual({ ok: true, value: { files: [own] } });
    expect(await listKeyDownloadFiles(neighbourCtx, h.deps)).toEqual({ ok: true, value: { files: [] } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: other.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await attachStagedProductDownload(neighbourCtx, { productId: 'neighbour-book', stagedFileId: own.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: 'neighbour-book', stagedFileId: own.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: 'mug', stagedFileId: own.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await discardKeyDownloadFile(keyCtx(), { id: other.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await discardKeyDownloadFile(neighbourCtx, { id: own.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect((await stagedRows()).sort()).toEqual([own.id, other.id].sort());

    await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: own.id }, h.deps);
    expect(await copyKeyDownloadFile(neighbourCtx, { productId: PRODUCT, assetId: own.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await removeProductDownloadFile(neighbourCtx, { productId: PRODUCT, assetId: own.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await database.db.select({ id: productDownloadAssets.id }).from(productDownloadAssets)).toEqual([{ id: own.id }]);
  });

  it('refuses staging to a session and to a key without catalogue write, and attaching without a staging key', async () => {
    const h = harness();
    const session: Ctx = { identity: identity(TENANT) };
    const reader: Ctx = { ...keyCtx(), capabilities: shopManagementKeyCapabilities({ scopes: ['shop:catalog:read'], mode: 'direct' }) };
    const upload = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 } as const;
    expect(await beginKeyDownloadUpload(session, upload, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await beginKeyDownloadUpload(reader, upload, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await listKeyDownloadFiles(session, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const staged = await h.stage();
    expect(await attachStagedProductDownload(session, { productId: PRODUCT, stagedFileId: staged.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await attachStagedProductDownload(session, { productId: PRODUCT, stagedFileId: staged.id }, { ...h.deps, stagedByKeyId: OTHER_KEY_ID }))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await attachStagedProductDownload(session, { productId: PRODUCT, stagedFileId: staged.id }, { ...h.deps, stagedByKeyId: KEY_ID }))
      .toMatchObject({ ok: true, value: { id: staged.id } });
  });

  it('refuses an attach once the product holds the file limit', async () => {
    const h = harness();
    const staged = await h.stage();
    await database.db.insert(productDownloadAssets).values(Array.from({ length: KEY_DOWNLOAD_FILE_LIMITS.filesPerProduct }, (_unused, index) => ({
      id: `asset-${String(index)}`, tenantId: TENANT, productId: PRODUCT, lineageId: `asset-${String(index)}`, fileName: 'a.pdf',
      contentType: 'application/pdf', sizeBytes: 10, storageKey: `${TENANT}/product-downloads/${PRODUCT}/asset-${String(index)}/a.pdf`, status: 'ready' as const, createdAt: NOW,
    })));
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: staged.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'product_files' } } });
    expect(await stagedRows()).toEqual([staged.id]);
  });
});

describe('copying a product file on the server', () => {
  it('stages a copy of a ready file with its source and never tells the key a fingerprint of the original', async () => {
    const h = harness();
    const original = `${TENANT}/product-downloads/${PRODUCT}/asset-owner/guide.pdf`;
    h.objects.objects.set(original, { bytes: PDF, contentType: 'application/pdf' });
    await database.db.insert(productDownloadAssets).values({
      id: 'asset-owner', tenantId: TENANT, productId: PRODUCT, lineageId: 'asset-owner', versionNumber: 3, fileName: 'guide.pdf',
      contentType: 'application/pdf', sizeBytes: PDF.byteLength, storageKey: original, status: 'ready', createdAt: NOW,
    });
    const copied = await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'asset-owner' }, h.deps);
    if (!copied.ok) throw new Error(copied.error.message);
    expect(copied.value.file).toMatchObject({ fileName: 'guide.pdf', sha256: null, copiedFrom: { productId: PRODUCT, assetId: 'asset-owner', versionNumber: 3 } });
    expect(JSON.stringify(copied.value)).not.toContain(createContentHash().sha256(PDF));
    expect(JSON.stringify(await listKeyDownloadFiles(keyCtx(), h.deps))).not.toContain(createContentHash().sha256(PDF));
    const [row] = await database.db.select().from(changeProposalDownloadFiles);
    expect(row?.sha256).toBe(createContentHash().sha256(PDF));
    expect(h.objects.objects.get(original)?.bytes).toEqual(PDF);
    expect(await recordStates()).toEqual(['settled']);
  });

  it('stages a copy of an audio-only MP4 named .mp4 with its audio type, and refuses a video named .m4a', async () => {
    const h = harness();
    const audio = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0]);
    const book = `${TENANT}/product-downloads/${PRODUCT}/asset-book/audiobook.mp4`;
    h.objects.objects.set(book, { bytes: audio, contentType: 'audio/mp4' });
    await database.db.insert(productDownloadAssets).values([
      { id: 'asset-book', tenantId: TENANT, productId: PRODUCT, lineageId: 'asset-book', fileName: 'audiobook.mp4', contentType: 'audio/mp4', sizeBytes: audio.byteLength, storageKey: book, status: 'ready', createdAt: NOW },
      { id: 'asset-film', tenantId: TENANT, productId: PRODUCT, lineageId: 'asset-film', fileName: 'film.m4a', contentType: 'video/mp4', sizeBytes: 10, storageKey: 'k5', status: 'ready', createdAt: NOW },
    ]);
    const copied = await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'asset-book' }, h.deps);
    expect(copied).toMatchObject({ ok: true, value: { file: { fileName: 'audiobook.mp4', contentType: 'audio/mp4' } } });
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'asset-film' }, h.deps)).toEqual({ ok: false, error: keyDownloadCopyRefused() });
  });

  it('refuses a file of another product, a pending file and a type keys cannot stage', async () => {
    const h = harness();
    await database.db.insert(productDownloadAssets).values([
      { id: 'pending', tenantId: TENANT, productId: PRODUCT, lineageId: 'pending', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, storageKey: 'k1', status: 'pending', createdAt: NOW },
      { id: 'page', tenantId: TENANT, productId: PRODUCT, lineageId: 'page', fileName: 'a.html', contentType: 'text/html', sizeBytes: 10, storageKey: 'k2', status: 'ready', createdAt: NOW },
    ]);
    expect(await copyKeyDownloadFile(keyCtx(), { productId: 'mug', assetId: 'page' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'pending' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'page' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    await database.db.insert(productDownloadAssets).values([
      { id: 'renamed', tenantId: TENANT, productId: PRODUCT, lineageId: 'renamed', fileName: 'guide.html', contentType: 'application/pdf', sizeBytes: 10, storageKey: 'k3', status: 'ready', createdAt: NOW },
      { id: 'unnamed', tenantId: TENANT, productId: PRODUCT, lineageId: 'unnamed', fileName: 'guide', contentType: 'application/pdf', sizeBytes: 10, storageKey: 'k4', status: 'ready', createdAt: NOW },
    ]);
    for (const assetId of ['renamed', 'unnamed']) {
      expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId }, h.deps)).toEqual({ ok: false, error: keyDownloadCopyRefused() });
    }
    expect(await recordStates()).toEqual([]);
  });

  it('leaves a copy interrupted after CopyObject to the sweep, which deletes the copy and settles its record', async () => {
    const h = harness();
    const original = `${TENANT}/product-downloads/${PRODUCT}/asset-owner/guide.pdf`;
    h.objects.objects.set(original, { bytes: PDF, contentType: 'application/pdf' });
    await database.db.insert(productDownloadAssets).values({
      id: 'asset-owner', tenantId: TENANT, productId: PRODUCT, lineageId: 'asset-owner', fileName: 'guide.pdf',
      contentType: 'application/pdf', sizeBytes: PDF.byteLength, storageKey: original, status: 'ready', createdAt: NOW,
    });
    const interrupted: StorageProvider = { ...h.objects.storage, digestObject: () => Promise.reject(new Error('the function was stopped')) };
    await expect(copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'asset-owner' }, { ...h.deps, storage: interrupted })).rejects.toThrow('stopped');
    const copies = h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`);
    expect(copies).toHaveLength(1);
    expect(await recordStates()).toEqual(['completing']);

    h.clock.now = at(29);
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual(copies);
    h.clock.now = at(31);
    expect(await sweepKeyDownloadFiles(h.deps)).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
    expect(await recordStates()).toEqual(['settled']);
    expect(h.objects.objects.get(original)?.bytes).toEqual(PDF);
  });
});

describe('removing staged objects durably', () => {
  it('owes the deletion of a removed key-attached file in its transaction and lets the sweep retry a failed storage delete', async () => {
    const h = harness();
    const staged = await h.stage();
    await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: staged.id }, h.deps);
    const objectKey = `${TENANT}/product-downloads/key-files/${KEY_ID}/${staged.id}/workbook.pdf`;
    h.objects.failDeletes = (target) => target === objectKey;
    expect(await removeProductDownloadFile(keyCtx(), { productId: PRODUCT, assetId: staged.id }, h.deps)).toEqual({ ok: true, value: { deleted: true } });
    expect(await database.db.select().from(productDownloadAssets)).toEqual([]);
    expect(await owedRows()).toEqual([objectKey]);
    expect(h.objects.keysUnder(objectKey)).toEqual([objectKey]);

    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([objectKey]);
    h.objects.failDeletes = () => false;
    expect(await sweepKeyDownloadFiles(h.deps)).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(await owedRows()).toEqual([]);
    expect(h.objects.keysUnder(objectKey)).toEqual([]);
  });

  it('owes the deletion when the owner deletes a key-attached file in the session or deletes its draft product, and when a discard cannot delete', async () => {
    const h = harness();
    const session: Ctx = { identity: identity(TENANT) };
    await database.db.insert(products).values({
      id: 'draft', tenantId: TENANT, slug: 'draft', title: 'Draft', type: 'digital_download', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW, everPublished: false,
    });
    const attached = await h.stage();
    const drafted = await h.stage(new Uint8Array([...PDF, 6]));
    const discarded = await h.stage(new Uint8Array([...PDF, 7]));
    await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: attached.id }, h.deps);
    await attachStagedProductDownload(keyCtx(), { productId: 'draft', stagedFileId: drafted.id }, h.deps);
    h.objects.failDeletes = () => true;
    expect(await deleteProductDownloadAsset(session, PRODUCT, attached.id, h.deps)).toEqual({ ok: true, value: { deleted: true } });
    expect(await deleteProductDraft(session, { productId: 'draft' }, { ...h.deps, productDrafts: createProductDraftRepository(database.db) }))
      .toEqual({ ok: true, value: { deleted: true } });
    expect(await discardKeyDownloadFile(keyCtx(), { id: discarded.id }, h.deps)).toEqual({ ok: true, value: { discarded: true } });
    expect(await stagedRows()).toEqual([]);
    expect(await database.db.select().from(productDownloadAssets)).toEqual([]);
    expect(await owedRows()).toEqual([attached.id, drafted.id, discarded.id].map((id) => expect.stringContaining(`/${id}/`)));
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toHaveLength(3);
    h.objects.failDeletes = () => false;
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);
    expect(h.objects.keysUnder(`${TENANT}/`)).toEqual([]);
  });

  it('owes the deletion of a swept staged file in a commit before its delete is sent, so a deletion that fails after the delete leaves no file to attach or propose', async () => {
    const h = harness();
    const staged = await h.stage();
    await database.db.update(changeProposalDownloadFiles).set({ createdAt: '2026-02-20T10:00:00.000Z' });
    const objectKey = `${TENANT}/product-downloads/key-files/${KEY_ID}/${staged.id}/workbook.pdf`;
    const observer = await connected();
    const seenAtDelete: Array<{ owed: string[]; staged: string[] }> = [];
    const failing: StorageProvider = {
      ...h.objects.storage,
      delete: async (input) => {
        const owed = await observer.query<{ object_key: string }>('select object_key from change_proposal_download_deletions');
        const rows = await observer.query<{ id: string }>('select id from change_proposal_download_files');
        seenAtDelete.push({ owed: owed.rows.map((row) => row.object_key), staged: rows.rows.map((row) => row.id) });
        await h.objects.storage.delete(input);
        throw new Error('Connection terminated unexpectedly');
      },
    };
    try {
      expect(await sweepKeyDownloadFiles({ ...h.deps, storage: failing })).toMatchObject({ ok: true, value: { removed: 0 } });
    } finally {
      await observer.end();
    }
    expect(seenAtDelete).toEqual([{ owed: [objectKey], staged: [] }]);
    expect(h.objects.keysUnder(objectKey)).toEqual([]);
    expect(await stagedRows()).toEqual([]);
    expect(await owedRows()).toEqual([objectKey]);
    expect(await h.deps.keyDownloadFiles.proposable(TENANT, KEY_ID, [staged.id], NOW)).toBe(false);
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: staged.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await database.db.select().from(productDownloadAssets)).toEqual([]);
    expect(await sweepKeyDownloadFiles(h.deps)).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(await owedRows()).toEqual([]);
  });

  it.each(['commit', 'rollback'] as const)('never deletes a staged object an uncommitted attach takes over, and sweeps it when the attach ends in %s', async (outcome) => {
    const h = harness();
    const staged = await h.stage();
    await database.db.update(changeProposalDownloadFiles).set({ createdAt: '2026-02-20T10:00:00.000Z' });
    const objectKey = `${TENANT}/product-downloads/key-files/${KEY_ID}/${staged.id}/workbook.pdf`;
    const observer = await connected();
    const attaching = gate();
    const finish = gate();
    try {
      const attach = database.db.transaction(async (tx) => {
        const attached = await createKeyDownloadAttachRepository(tx).attach(TENANT, {
          productId: PRODUCT, stagedFileId: staged.id, apiKeyId: KEY_ID, replacesAssetId: undefined, versionNote: null, now: NOW,
        });
        expect(attached.kind).toBe('attached');
        attaching.open();
        await finish.opened;
        if (outcome === 'rollback') tx.rollback();
      }).catch(() => undefined);
      await attaching.opened;
      const sweep = sweepKeyDownloadFiles(h.deps);
      await untilWaiting(observer, 'the sweep');
      expect(h.objects.keysUnder(objectKey)).toEqual([objectKey]);
      finish.open();
      await attach;
      await sweep;
    } finally {
      await observer.end();
    }
    const assets = await database.db.select({ id: productDownloadAssets.id }).from(productDownloadAssets);
    if (outcome === 'commit') {
      expect(assets).toEqual([{ id: staged.id }]);
      expect(h.objects.keysUnder(objectKey)).toEqual([objectKey]);
    } else {
      expect(assets).toEqual([]);
      expect(h.objects.keysUnder(objectKey)).toEqual([]);
    }
    expect(await stagedRows()).toEqual([]);
  });
});

describe('the staging budget', () => {
  const fill = async (bytes: number, apiKeyId = 'key-filler') => {
    const rows = [];
    for (let left = bytes, index = 0; left > 0; index += 1) {
      const size = Math.min(left, KEY_DOWNLOAD_FILE_LIMITS.maxBytes);
      left -= size;
      const id = `filler-${apiKeyId}-${String(index)}`;
      rows.push({ tenantId: TENANT, id, apiKeyId, fileName: 'f.pdf', contentType: 'application/pdf' as const, sizeBytes: size,
        sha256: 'f'.repeat(64), objectKey: `${TENANT}/product-downloads/key-files/${apiKeyId}/${id}/f.pdf`, createdAt: NOW });
    }
    await database.db.insert(changeProposalDownloadFiles).values(rows);
  };

  it('makes a second key starting at the workspace limit wait for the first key\'s reservation and count it', async () => {
    const h = harness();
    await fill(KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerWorkspace - 300 * MIB);
    const upload = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 * MIB } as const;
    const first = await connected();
    const observer = await connected();
    try {
      await first.query('begin');
      await first.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`key-download-files:${TENANT}`]);
      await first.query(`insert into change_proposal_download_uploads (tenant_id, id, api_key_id, kind, state, file_id, file_name, content_type,
        declared_bytes, candidate_key, staged_key, created_at) values ($1, 'first-upload', $2, 'upload', 'started', 'first-file', 'a.pdf',
        'application/pdf', $3, $4, $5, $6)`, [TENANT, KEY_ID, 100 * MIB, `${TENANT}/product-downloads/key-uploads/${KEY_ID}/first-upload`,
        `${TENANT}/product-downloads/key-files/${KEY_ID}/first-file/a.pdf`, NOW]);
      const second = beginKeyDownloadUpload(keyCtx(OTHER_KEY_ID), upload, h.deps);
      await untilWaiting(observer, 'the second reservation');
      await first.query('commit');
      expect(await second).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'workspace_staged_bytes' } } });
    } finally {
      await first.end();
      await observer.end();
    }
    expect(await beginKeyDownloadUpload(keyCtx(NEIGHBOUR_KEY_ID, NEIGHBOUR), upload, h.deps)).toMatchObject({ ok: true });
    await database.db.delete(changeProposalDownloadUploads);
    expect(await beginKeyDownloadUpload(keyCtx(OTHER_KEY_ID), upload, h.deps)).toMatchObject({ ok: true });
  });

  it('counts abandoned uploads and objects whose deletion keeps failing until their deletion is confirmed', async () => {
    const h = harness();
    const upload = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: KEY_DOWNLOAD_FILE_LIMITS.maxBytes } as const;
    for (let index = 0; index < 4; index += 1) expect(await beginKeyDownloadUpload(keyCtx(), upload, h.deps)).toMatchObject({ ok: true });
    expect(await beginKeyDownloadUpload(keyCtx(), upload, h.deps))
      .toMatchObject({ ok: false, error: { details: { changeProposalCap: 'key_staged_bytes' } } });
    for (const record of await database.db.select().from(changeProposalDownloadUploads)) {
      if (record.candidateKey !== null) h.objects.objects.set(record.candidateKey, { bytes: PDF, contentType: 'application/pdf' });
    }
    h.objects.failDeletes = () => true;
    h.clock.now = at(21);
    await sweepKeyDownloadFiles(h.deps);
    expect(await beginKeyDownloadUpload(keyCtx(), upload, h.deps))
      .toMatchObject({ ok: false, error: { details: { changeProposalCap: 'key_staged_bytes' } } });
    h.objects.failDeletes = () => false;
    await sweepKeyDownloadFiles(h.deps);
    expect(await recordStates()).toEqual(['settled', 'settled', 'settled', 'settled']);
    expect(h.objects.keysUnder(`${TENANT}/`)).toEqual([]);
    expect(await beginKeyDownloadUpload(keyCtx(), upload, h.deps)).toMatchObject({ ok: true });
  });

  it('owes the upload object of a settled upload a second delete a day after the upload started, so a PUT that finishes after the sweep does not stay', async () => {
    const h = harness();
    const { id, candidate } = await h.begin(PDF);
    h.objects.objects.delete(candidate);
    h.clock.now = at(21);
    await sweepKeyDownloadFiles(h.deps);
    expect(await recordStates()).toEqual(['settled']);
    expect(await database.db.select().from(changeProposalDownloadDeletions)).toEqual([expect.objectContaining({
      objectKey: candidate, apiKeyId: KEY_ID, sizeBytes: PDF.byteLength, notBefore: '2026-03-02T10:00:00.000Z',
    })]);
    h.objects.objects.set(candidate, { bytes: PDF, contentType: 'application/pdf' });
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps)).toMatchObject({ ok: true });
    await database.db.delete(changeProposalDownloadUploads).where(ne(changeProposalDownloadUploads.id, id));
    h.clock.now = '2026-03-02T09:59:00.000Z';
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(candidate)).toEqual([candidate]);
    h.clock.now = '2026-03-02T10:00:00.000Z';
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(candidate)).toEqual([]);
    expect(await database.db.select().from(changeProposalDownloadDeletions)).toEqual([]);
  });

  it('keeps counting the bytes started in 24 hours after the records were cleaned, and frees them only after the day', async () => {
    const h = harness();
    const daily = KEY_DOWNLOAD_FILE_LIMITS.declaredBytesPerKeyDaily;
    const records = Array.from({ length: Math.ceil(daily / KEY_DOWNLOAD_FILE_LIMITS.maxBytes) }, (_unused, index) => ({
      tenantId: TENANT, id: `settled-${String(index)}`, apiKeyId: KEY_ID, kind: 'upload' as const, state: 'settled' as const,
      fileId: `settled-file-${String(index)}`, fileName: 'a.pdf', contentType: 'application/pdf' as const,
      declaredBytes: KEY_DOWNLOAD_FILE_LIMITS.maxBytes, createdAt: '2026-03-01T08:00:00.000Z',
    }));
    await database.db.insert(changeProposalDownloadUploads).values(records);
    const upload = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 } as const;
    expect(await beginKeyDownloadUpload(keyCtx(), upload, h.deps))
      .toMatchObject({ ok: false, error: { details: { changeProposalCap: 'key_file_bytes_daily' } } });
    h.clock.now = at(120);
    await sweepKeyDownloadFiles(h.deps);
    expect(await database.db.select().from(changeProposalDownloadUploads)).toHaveLength(records.length);
    expect(await beginKeyDownloadUpload(keyCtx(), upload, h.deps))
      .toMatchObject({ ok: false, error: { details: { changeProposalCap: 'key_file_bytes_daily' } } });
    h.clock.now = '2026-03-02T08:01:00.000Z';
    await sweepKeyDownloadFiles(h.deps);
    expect(await database.db.select().from(changeProposalDownloadUploads)).toEqual([]);
    expect(await beginKeyDownloadUpload(keyCtx(), upload, h.deps)).toMatchObject({ ok: true });
  });

  it('refuses a key starting more uploads and copies than the window allows', async () => {
    const h = harness();
    const upload = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 } as const;
    for (let index = 0; index < KEY_DOWNLOAD_FILE_LIMITS.startsPerKey; index += 1) {
      const started = await beginKeyDownloadUpload(keyCtx(), upload, h.deps);
      if (!started.ok) throw new Error(started.error.message);
      await database.db.update(changeProposalDownloadUploads).set({ state: 'settled', candidateKey: null, stagedKey: null })
        .where(eq(changeProposalDownloadUploads.id, started.value.upload.id));
    }
    expect(await beginKeyDownloadUpload(keyCtx(), upload, h.deps))
      .toMatchObject({ ok: false, error: { details: { changeProposalCap: 'key_file_uploads' } } });
  });
});

describe('the lock order of a live file write', () => {
  it('waits for a concurrent stock adjustment that holds the stock row and has not written its event yet, then attaches without a deadlock', async () => {
    const h = harness();
    const staged = await h.stage();
    await database.db.insert(productStock).values({ tenantId: TENANT, productId: PRODUCT, onHand: 4, reserved: 0, lowStockThreshold: null, updatedAt: NOW });
    const live = await connected();
    const observer = await connected();
    try {
      await live.query('begin');
      await live.query('select on_hand from product_stock where tenant_id = $1 and product_id = $2 for update', [TENANT, PRODUCT]);
      await live.query('update product_stock set on_hand = on_hand + 1 where tenant_id = $1 and product_id = $2', [TENANT, PRODUCT]);
      const attach = attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: staged.id }, h.deps);
      await untilWaiting(observer, 'the attach');
      await live.query(
        "insert into stock_events (tenant_id, product_id, type, quantity, reference, occurred_at) values ($1, $2, 'adjusted', 1, '{}'::jsonb, $3)",
        [TENANT, PRODUCT, NOW],
      );
      await live.query('commit');
      expect(await attach).toMatchObject({ ok: true, value: { id: staged.id } });
    } finally {
      await live.end();
      await observer.end();
    }
    const [stock] = await database.db.select({ onHand: productStock.onHand }).from(productStock).where(and(eq(productStock.tenantId, TENANT), eq(productStock.productId, PRODUCT)));
    expect(stock?.onHand).toBe(5);
  }, 30_000);
});

describe('the order of the staged file sweep', () => {
  const owe = async (tenantId: string, name: string, createdAt: string) => {
    const objectKey = `${tenantId}/product-downloads/key-files/${KEY_ID}/${name}/f.pdf`;
    await database.db.insert(changeProposalDownloadDeletions).values({ tenantId, objectKey, apiKeyId: KEY_ID, sizeBytes: 10, createdAt });
    return objectKey;
  };

  it('moves a row whose deletion fails behind the later rows of its workspace', async () => {
    const h = harness();
    const failing = await owe(TENANT, 'failing', '2026-03-01T09:00:00.000Z');
    const later = await owe(TENANT, 'later', '2026-03-01T09:30:00.000Z');
    h.objects.failDeletes = (target) => target === failing;
    const deps = { ...h.deps, batch: { tenants: 1, rows: 1 } };
    expect(await sweepKeyDownloadFiles(deps)).toMatchObject({ ok: true, value: { removed: 0 } });
    expect(await sweepKeyDownloadFiles(deps)).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(await owedRows()).toEqual([failing]);
    expect(later).not.toBe(failing);
  });

  it('moves a workspace whose deletions fail behind the other workspaces', async () => {
    const h = harness();
    const failing = await owe(TENANT, 'failing', '2026-03-01T09:00:00.000Z');
    const neighbour = await owe(NEIGHBOUR, 'neighbour', '2026-03-01T09:30:00.000Z');
    h.objects.failDeletes = (target) => target === failing;
    const deps = { ...h.deps, batch: { tenants: 1, rows: 1 } };
    await sweepKeyDownloadFiles(deps);
    expect(await sweepKeyDownloadFiles(deps)).toMatchObject({ ok: true, value: { tenants: 1, removed: 1, failed: 0 } });
    expect(await owedRows()).toEqual([failing]);
    expect(neighbour).not.toBe(failing);
  });

  it('counts a workspace whose sweep rejected as a failure, logs it and still sweeps the other workspaces', async () => {
    const h = harness();
    await owe(TENANT, 'unreachable', '2026-03-01T09:00:00.000Z');
    await owe(NEIGHBOUR, 'neighbour', '2026-03-01T09:30:00.000Z');
    const files = h.deps.keyDownloadFiles;
    const keyDownloadFiles = {
      ...files,
      purgeSettled: (tenantId: string, cutoffs: KeyDownloadSweepCutoffs, limit: number, lockWaitMs?: number) =>
        tenantId === TENANT ? Promise.reject(new Error('connection reset')) : files.purgeSettled(tenantId, cutoffs, limit, lockWaitMs),
    };
    expect(await sweepKeyDownloadFiles({ ...h.deps, keyDownloadFiles })).toEqual({ ok: true, value: { tenants: 2, removed: 1, failed: 1 } });
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining(`staged download file sweep failed tenant=${TENANT}`));
    expect(await owedRows()).toEqual([`${TENANT}/product-downloads/key-files/${KEY_ID}/unreachable/f.pdf`]);
  });

  it('sweeps staged files of a revoked key and staged files past their age, and keeps younger ones of active keys', async () => {
    const h = harness();
    const young = await h.stage();
    const old = await h.stage(new Uint8Array([...PDF, 2]));
    const revoked = await h.stage(new Uint8Array([...PDF, 3]), keyCtx(OTHER_KEY_ID));
    await database.db.update(changeProposalDownloadFiles).set({ createdAt: '2026-02-21T10:00:00.000Z' }).where(eq(changeProposalDownloadFiles.id, old.id));
    await database.db.update(shopManagementKeys).set({ revokedAt: NOW }).where(eq(shopManagementKeys.id, OTHER_KEY_ID));
    h.clock.now = at(30);
    await sweepKeyDownloadFiles(h.deps);
    expect(await stagedRows()).toEqual([young.id]);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([`${TENANT}/product-downloads/key-files/${KEY_ID}/${young.id}/workbook.pdf`]);
    expect(revoked.id).not.toBe(young.id);
  });
});

describe('the storage orphan inventory', () => {
  it('lists every object a row of the workspace owns: staged files, the upload object and destination of an open record, and owed deletions', async () => {
    const h = harness();
    const staged = await h.stage();
    const owed = await h.stage(new Uint8Array([...PDF, 4]));
    h.objects.failDeletes = () => true;
    await discardKeyDownloadFile(keyCtx(), { id: owed.id }, h.deps);
    h.objects.failDeletes = () => false;
    const { id: uploadId, candidate } = await h.begin(PDF);
    const [open] = await database.db.select().from(changeProposalDownloadUploads).where(eq(changeProposalDownloadUploads.id, uploadId));
    const records = await database.db.select().from(changeProposalDownloadUploads);
    const listed = (await createStorageReferenceRepository(database.db).readInventory(TENANT)).stagedDownloads.map((entry) => entry.storageKey);
    const stagedKey = `${TENANT}/product-downloads/key-files/${KEY_ID}/${staged.id}/workbook.pdf`;
    const owedKey = `${TENANT}/product-downloads/key-files/${KEY_ID}/${owed.id}/workbook.pdf`;
    expect(open?.stagedKey).toEqual(expect.stringContaining('/product-downloads/key-files/'));
    expect(listed).toEqual(expect.arrayContaining([stagedKey, owedKey, candidate, open?.stagedKey]));
    expect([...listed].sort()).toEqual([
      stagedKey, owedKey, ...records.flatMap((row) => [row.candidateKey, row.stagedKey].filter((key): key is string => key !== null)),
    ].sort());
    expect(await owedRows()).toEqual([owedKey]);
    expect((await createStorageReferenceRepository(database.db).readInventory(NEIGHBOUR)).stagedDownloads).toEqual([]);
  });
});

const ownedAsset = (id: string, sizeBytes: number, objectKey: string) => ({
  id, tenantId: TENANT, productId: PRODUCT, lineageId: id, fileName: 'guide.pdf', contentType: 'application/pdf',
  sizeBytes, storageKey: objectKey, status: 'ready' as const, createdAt: NOW,
});

const stagedFillers = async (count: number, sizeBytes: number, apiKeyId = KEY_ID) => {
  const rows = Array.from({ length: count }, (_unused, index) => {
    const id = `filler-${apiKeyId}-${String(index)}`;
    return { tenantId: TENANT, id, apiKeyId, fileName: 'f.pdf', contentType: 'application/pdf' as const, sizeBytes,
      sha256: 'f'.repeat(64), objectKey: `${TENANT}/product-downloads/key-files/${apiKeyId}/${id}/f.pdf`, createdAt: NOW };
  });
  if (rows.length > 0) await database.db.insert(changeProposalDownloadFiles).values(rows);
  return rows;
};

const small = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 } as const;

describe('the staging budget across ownership changes', () => {
  it('counts an object exactly once while a completion moves it from its record to a staged row during a reservation', async () => {
    await stagedFillers(KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerKey / KEY_DOWNLOAD_FILE_LIMITS.maxBytes - 2, KEY_DOWNLOAD_FILE_LIMITS.maxBytes);
    const files = createKeyDownloadFileRepository(database.db);
    const record = {
      tenantId: TENANT, id: 'copy-in-flight', apiKeyId: KEY_ID, kind: 'copy' as const, state: 'completing' as const, fileId: 'file-in-flight',
      fileName: 'guide.pdf', contentType: 'application/pdf' as const, declaredBytes: KEY_DOWNLOAD_FILE_LIMITS.maxBytes, candidateKey: null,
      stagedKey: `${TENANT}/product-downloads/key-files/${KEY_ID}/file-in-flight/guide.pdf`,
      copiedFrom: { productId: PRODUCT, assetId: 'asset-owner', versionNumber: 1 }, attemptId: 'attempt-in-flight', attemptAt: NOW, createdAt: NOW, completedAt: null,
    };
    expect(await files.reserve(TENANT, record, NOW)).toMatchObject({ kind: 'reserved' });
    const blocker = await connected();
    const observer = await connected();
    try {
      await blocker.query('begin');
      await blocker.query('lock table change_proposal_download_deletions in access exclusive mode');
      const reservation = files.reserve(TENANT, { ...record, id: 'ninth-copy', fileId: 'ninth-file', stagedKey: `${TENANT}/product-downloads/key-files/${KEY_ID}/ninth-file/guide.pdf`, attemptId: 'attempt-ninth' }, NOW);
      await untilWaiting(observer, 'the reservation');
      expect(await files.finishCompletion(TENANT, record.id, record.attemptId, {
        tenantId: TENANT, id: record.fileId, apiKeyId: KEY_ID, fileName: record.fileName, contentType: record.contentType,
        sizeBytes: record.declaredBytes, sha256: 'a'.repeat(64), objectKey: record.stagedKey, copiedFrom: record.copiedFrom, proposalId: null, createdAt: NOW,
      }, NOW)).toMatchObject({ kind: 'stored' });
      await blocker.query('commit');
      expect(await reservation).toMatchObject({ kind: 'reserved' });
    } finally {
      await blocker.end();
      await observer.end();
    }
    expect(await stagedRows()).toHaveLength(KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerKey / KEY_DOWNLOAD_FILE_LIMITS.maxBytes - 1);
    expect(await files.reserve(TENANT, { ...record, id: 'tenth-copy', fileId: 'tenth-file', stagedKey: `${TENANT}/product-downloads/key-files/${KEY_ID}/tenth-file/guide.pdf`, attemptId: 'attempt-tenth' }, NOW))
      .toEqual({ kind: 'cap_exceeded', cap: 'key_staged_bytes' });
  });

  it('counts owed deletions and failed records that still own an object against the file count until storage confirms their deletion', async () => {
    const h = harness();
    const staged = [];
    for (let index = 0; index < KEY_DOWNLOAD_FILE_LIMITS.stagedFilesPerKey - 1; index += 1) staged.push(await h.stage(new Uint8Array([...PDF, index])));
    h.objects.failDeletes = () => true;
    for (const file of staged) await discardKeyDownloadFile(keyCtx(), { id: file.id }, h.deps);
    const { id } = await h.begin(PNG);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    const [failed] = await database.db.select().from(changeProposalDownloadUploads).where(eq(changeProposalDownloadUploads.id, id));
    expect(failed).toMatchObject({ state: 'failed', stagedKey: expect.stringContaining('/key-files/') });
    expect(await owedRows()).toHaveLength(staged.length);
    h.clock.now = at(16);
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_staged_files' } } });
    h.objects.failDeletes = () => false;
    h.clock.now = at(21);
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps)).toMatchObject({ ok: true });
  });

  it('never refuses the removal of attached files, counts what their failed deletes owe against the key that staged them, and frees it once storage confirms', async () => {
    const h = harness();
    const fillers = await stagedFillers(9, KEY_DOWNLOAD_FILE_LIMITS.maxBytes);
    for (const filler of fillers) {
      expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: filler.id }, h.deps)).toMatchObject({ ok: true });
    }
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps)).toMatchObject({ ok: true });
    await database.db.delete(changeProposalDownloadUploads);
    h.objects.failDeletes = () => true;
    const session: Ctx = { identity: identity(TENANT) };
    for (const [index, filler] of fillers.entries()) {
      const ctx = index % 2 === 0 ? keyCtx() : session;
      expect(await removeProductDownloadFile(ctx, { productId: PRODUCT, assetId: filler.id }, h.deps)).toEqual({ ok: true, value: { deleted: true } });
    }
    const owed = await database.db.select().from(changeProposalDownloadDeletions);
    expect(owed.map((row) => row.apiKeyId)).toEqual(fillers.map(() => KEY_ID));
    expect(owed.reduce((sum, row) => sum + row.sizeBytes, 0)).toBeGreaterThan(KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerKey);
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_staged_bytes' } } });
    expect(await beginKeyDownloadUpload(keyCtx(OTHER_KEY_ID), small, h.deps)).toMatchObject({ ok: true });
    h.objects.failDeletes = () => false;
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps)).toMatchObject({ ok: true });
  });
});

describe('copies whose outcome the storage leaves unknown', () => {
  it('keeps a destination that appears after the failed attempt returned owned and counted until the sweep deletes it', async () => {
    const h = harness();
    const original = `${TENANT}/product-downloads/${PRODUCT}/asset-owner/guide.pdf`;
    h.objects.objects.set(original, { bytes: PDF, contentType: 'application/pdf' });
    await database.db.insert(productDownloadAssets).values(ownedAsset('asset-owner', PDF.byteLength, original));
    await stagedFillers(KEY_DOWNLOAD_FILE_LIMITS.stagedFilesPerKey - 1, 10);
    let land: () => void = () => undefined;
    const late: StorageProvider = {
      ...h.objects.storage,
      copyObject: async (input) => {
        land = () => { h.objects.objects.set(input.key, { bytes: PDF, contentType: 'application/octet-stream' }); };
        return err(integrationUnavailable('Could not copy the storage object: the storage request deadline passed'));
      },
    };
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'asset-owner' }, { ...h.deps, storage: late }))
      .toEqual({ ok: false, error: keyDownloadCopyRefused() });
    land();
    const [record] = await database.db.select().from(changeProposalDownloadUploads);
    expect(record).toMatchObject({ state: 'interrupted', stagedKey: expect.stringContaining('/key-files/') });
    expect(h.objects.keysUnder(record?.stagedKey ?? '-')).toHaveLength(1);
    expect(h.objects.calls.filter((call) => call.method === 'delete')).toEqual([]);
    h.clock.now = at(16);
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps))
      .toMatchObject({ ok: false, error: { details: { changeProposalCap: 'key_staged_files' } } });
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(record?.stagedKey ?? '-')).toHaveLength(1);
    h.clock.now = at(29);
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(record?.stagedKey ?? '-')).toHaveLength(1);
    h.clock.now = at(31);
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
    expect(await recordStates()).toEqual(['settled']);
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps)).toMatchObject({ ok: true });
  });

  it('keeps the record of an unconfirmed copy until 30 minutes after its attempt, so a copy the storage finishes after 20 minutes is still deleted', async () => {
    const h = harness();
    const original = `${TENANT}/product-downloads/${PRODUCT}/asset-owner/guide.pdf`;
    h.objects.objects.set(original, { bytes: PDF, contentType: 'application/pdf' });
    await database.db.insert(productDownloadAssets).values(ownedAsset('asset-owner', PDF.byteLength, original));
    let land: () => void = () => undefined;
    const late: StorageProvider = {
      ...h.objects.storage,
      copyObject: async (input) => {
        land = () => { h.objects.objects.set(input.key, { bytes: PDF, contentType: 'application/octet-stream' }); };
        return err(integrationUnavailable('Could not copy the storage object: the storage request deadline passed'));
      },
    };
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'asset-owner' }, { ...h.deps, storage: late }))
      .toEqual({ ok: false, error: keyDownloadCopyRefused() });
    h.clock.now = at(21);
    await sweepKeyDownloadFiles(h.deps);
    expect(await recordStates()).toEqual(['interrupted']);
    h.clock.now = at(25);
    land();
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toHaveLength(1);
    h.clock.now = at(29);
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toHaveLength(1);
    h.clock.now = at(31);
    expect(await sweepKeyDownloadFiles(h.deps)).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
    expect(await recordStates()).toEqual(['settled']);
  });

  it('answers one key-safe refusal whatever the stored bytes of a source with the same metadata are, and logs one cause line per source', async () => {
    const h = harness();
    const sources = {
      missing: { bytes: null, cause: 'head of record' },
      larger: { bytes: new Uint8Array([...PDF, 1, 2]), cause: 'size_mismatch' },
      smaller: { bytes: PDF.slice(0, 6), cause: 'size_mismatch' },
      mismatched: { bytes: PNG.slice(0, PDF.byteLength), cause: 'type_mismatch' },
    };
    const answers = [];
    for (const [name, { bytes, cause }] of Object.entries(sources)) {
      const objectKey = `${TENANT}/product-downloads/${PRODUCT}/${name}/guide.pdf`;
      if (bytes !== null) h.objects.objects.set(objectKey, { bytes, contentType: 'application/pdf' });
      await database.db.insert(productDownloadAssets).values(ownedAsset(name, PDF.byteLength, objectKey));
      h.logger.error.mockClear();
      answers.push(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: name }, h.deps));
      expect(h.logger.error.mock.calls.map(([message]) => message)).toEqual([expect.stringContaining(cause)]);
    }
    for (const answer of answers) expect(answer).toStrictEqual({ ok: false, error: keyDownloadCopyRefused() });
    expect(keyDownloadCopyRefused()).toStrictEqual({ code: 'validation', message: 'This file cannot be copied by a key; nothing was staged' });
    expect(await stagedRows()).toEqual([]);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
  });

  it('refuses a source whose size differs from its product file row before any copy is sent', async () => {
    const h = harness();
    const objectKey = `${TENANT}/product-downloads/${PRODUCT}/grown/guide.pdf`;
    h.objects.objects.set(objectKey, { bytes: new Uint8Array([...PDF, ...new Uint8Array(4 * MIB)]), contentType: 'application/pdf' });
    await database.db.insert(productDownloadAssets).values(ownedAsset('grown', PDF.byteLength, objectKey));
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'grown' }, h.deps)).toStrictEqual({ ok: false, error: keyDownloadCopyRefused() });
    expect(h.objects.calls.filter((call) => call.method === 'copyObject')).toEqual([]);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
    expect(await recordStates()).toEqual(['failed']);
  });

  it('copies only the source version whose size it checked, so a source replaced after the check is never staged', async () => {
    const h = harness();
    const objectKey = `${TENANT}/product-downloads/${PRODUCT}/replaced/guide.pdf`;
    h.objects.objects.set(objectKey, { bytes: PDF, contentType: 'application/pdf' });
    await database.db.insert(productDownloadAssets).values(ownedAsset('replaced', PDF.byteLength, objectKey));
    const storage: StorageProvider = {
      ...h.objects.storage,
      head: async (input) => {
        const answered = await h.objects.storage.head(input);
        h.objects.objects.set(objectKey, { bytes: new Uint8Array([...PDF.slice(0, -1), 7]), contentType: 'application/pdf' });
        return answered;
      },
    };
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'replaced' }, { ...h.deps, storage })).toStrictEqual({ ok: false, error: keyDownloadCopyRefused() });
    expect(await stagedRows()).toEqual([]);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
  });
});

describe('a completion that cannot finish', () => {
  it('answers the busy error when the record lock is held past the wait, and never deletes the destination of a busy completion', async () => {
    const h = harness(200);
    const { id } = await h.begin(PDF);
    const holder = await connected();
    try {
      await holder.query('begin');
      await holder.query('select id from change_proposal_download_uploads where id = $1 for update', [id]);
      expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps))
        .toMatchObject({ ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: 1 } } });
      await holder.query('rollback');
      const copying = gate();
      const locked = gate();
      h.objects.beforeCopy = async () => {
        copying.open();
        await locked.opened;
      };
      const completion = completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
      await copying.opened;
      await holder.query('begin');
      await holder.query('select id from change_proposal_download_uploads where id = $1 for update', [id]);
      locked.open();
      expect(await completion).toMatchObject({ ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: 1 } } });
      await holder.query('rollback');
    } finally {
      await holder.end();
    }
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toHaveLength(1);
    expect(h.objects.calls.filter((call) => call.method === 'delete')).toEqual([]);
    expect(await recordStates()).toEqual(['completing']);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('leaves an upload whose digest the storage did not answer completable by a new completion once the attempt\'s lease ended', async () => {
    const h = harness();
    const { id, candidate } = await h.begin(PDF);
    h.objects.failReads = (target) => target.includes('/product-downloads/key-files/');
    const first = await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
    expect(first).toMatchObject({ ok: false, error: { code: 'unavailable', message: expect.stringContaining(`after ${at(10)}`), details: { retryAfterSeconds: 600 } } });
    expect(await recordStates()).toEqual(['interrupted']);
    expect(h.objects.keysUnder(candidate)).toEqual([candidate]);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toHaveLength(1);
    h.objects.failReads = () => false;
    h.clock.now = at(5);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps)).toMatchObject({ ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: 300 } } });
    h.clock.now = at(10);
    const second = await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.value.file).toMatchObject({ sizeBytes: PDF.byteLength, sha256: createContentHash().sha256(PDF) });
    expect(await stagedRows()).toEqual([second.value.file.id]);
    expect(await recordStates()).toEqual(['completed']);
  });

  it('tells the key to start a new upload when the lease of the failed attempt ends after the upload expires', async () => {
    const h = harness();
    const { id } = await h.begin(PDF);
    h.clock.now = at(6);
    h.objects.failReads = (target) => target.includes('/product-downloads/key-files/');
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'integration_unavailable', message: expect.stringContaining('Start a new upload') } });
    h.objects.failReads = () => false;
    h.clock.now = at(16);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', message: expect.stringContaining('start a new upload') } });
    h.clock.now = at(36);
    await sweepKeyDownloadFiles(h.deps);
    expect(await recordStates()).toEqual(['interrupted']);
    h.clock.now = at(37);
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(`${TENANT}/`)).toEqual([]);
    expect(await recordStates()).toEqual(['settled']);
  });

  it('never deletes the objects of a completion inside its lease, and leaves its staged file once it finished', async () => {
    const h = harness();
    const { id } = await h.begin(PDF);
    h.clock.now = at(14);
    const copying = gate();
    const release = gate();
    h.objects.beforeCopy = async () => {
      copying.open();
      await release.opened;
    };
    const completion = completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
    await copying.opened;
    h.clock.now = at(21);
    expect(await sweepKeyDownloadFiles(h.deps)).toMatchObject({ ok: true, value: { removed: 0 } });
    expect(h.objects.calls.filter((call) => call.method === 'delete')).toEqual([]);
    release.open();
    const finished = await completion;
    if (!finished.ok) throw new Error(finished.error.message);
    h.clock.now = at(30);
    await sweepKeyDownloadFiles(h.deps);
    expect(await recordStates()).toEqual(['settled']);
    expect(await stagedRows()).toEqual([finished.value.file.id]);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([`${TENANT}/product-downloads/key-files/${KEY_ID}/${finished.value.file.id}/workbook.pdf`]);
  });

  it('keeps the staged bytes when the upload URL is written again after completion', async () => {
    const h = harness();
    const { id, candidate } = await h.begin(PDF);
    const completed = await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps);
    if (!completed.ok) throw new Error(completed.error.message);
    h.objects.objects.set(candidate, { bytes: new Uint8Array([...PDF].reverse()), contentType: 'application/pdf' });
    const attached = await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: completed.value.file.id }, h.deps);
    if (!attached.ok) throw new Error(attached.error.message);
    const read = await h.objects.storage.getObject({ url: `https://storage.example.test/${attached.value.storageKey}`, accessKeyId: 'a', secretAccessKey: 's' }, { maxBytes: 1024 });
    if (!read.ok) throw new Error(read.error.message);
    expect(createContentHash().sha256(read.value)).toBe(completed.value.file.sha256);
    const [row] = await database.db.select({ sha256: productDownloadAssets.sha256 }).from(productDownloadAssets).where(eq(productDownloadAssets.id, attached.value.id));
    expect(row?.sha256).toBe(createContentHash().sha256(PDF));
  });
});

describe('an attach retried after a lost answer', () => {
  it('answers the file the applied attach made, and still refuses a file of another key or product', async () => {
    const h = harness();
    const staged = await h.stage();
    const first = await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: staged.id }, h.deps);
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: staged.id }, h.deps)).toEqual(first);
    expect(await attachStagedProductDownload(keyCtx(OTHER_KEY_ID), { productId: PRODUCT, stagedFileId: staged.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    await database.db.insert(products).values({ id: 'other', tenantId: TENANT, slug: 'other', title: 'Other', type: 'digital_download', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW });
    expect(await attachStagedProductDownload(keyCtx(), { productId: 'other', stagedFileId: staged.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await database.db.select({ id: productDownloadAssets.id }).from(productDownloadAssets)).toEqual([{ id: staged.id }]);
  });
});

describe('a replacement retried after its target was removed', () => {
  it('answers the applied replacement to an exact retry, and a conflict to a retry that names another target', async () => {
    const h = harness();
    const first = await h.stage();
    const second = await h.stage(new Uint8Array([...PDF, 1]));
    const third = await h.stage(new Uint8Array([...PDF, 2]));
    await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: first.id }, h.deps);
    await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: third.id }, h.deps);
    const replaced = await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id, replacesAssetId: first.id }, h.deps);
    expect(replaced).toMatchObject({ ok: true, value: { lineageId: first.id, versionNumber: 2 } });
    expect(await removeProductDownloadFile(keyCtx(), { productId: PRODUCT, assetId: first.id }, h.deps)).toEqual({ ok: true, value: { deleted: true } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id, replacesAssetId: first.id }, h.deps)).toEqual(replaced);
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id, replacesAssetId: 'never-there' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id, replacesAssetId: third.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});

describe('the history of upload and copy records', () => {
  it('leaves neither the state change nor its event when the event of a change cannot be written', async () => {
    const h = harness();
    const files = createKeyDownloadFileRepository(database.db);
    const { id } = await h.begin(PDF);
    const claimed = await files.claimCompletion(TENANT, KEY_ID, id, 'attempt-atomic', NOW, () => 'unused-file');
    expect(claimed.kind).toBe('claimed');
    await expect(files.interruptAttempt(TENANT, id, 'attempt-atomic', 'Not a reason', NOW)).rejects.toThrow();
    expect(await recordStates()).toEqual(['completing']);
    expect((await files.listRecordEvents(TENANT, id)).map((event) => event.kind)).toEqual(['started', 'claimed']);
  });

  it('appends one event per state change in the transaction that made it, and purges events after 30 days', async () => {
    const h = harness();
    const files = createKeyDownloadFileRepository(database.db);
    const done = await h.begin(PDF);
    await completeKeyDownloadUpload(keyCtx(), { uploadId: done.id }, h.deps);
    const refused = await h.begin(PNG);
    await completeKeyDownloadUpload(keyCtx(), { uploadId: refused.id }, h.deps);
    const kinds = async (recordId: string) => (await files.listRecordEvents(TENANT, recordId)).map((event) => [event.kind, event.reason]);
    expect(await kinds(done.id)).toEqual([['started', 'upload'], ['claimed', null], ['completed', null]]);
    expect(await kinds(refused.id)).toEqual([['started', 'upload'], ['claimed', null], ['failed', 'type_mismatch']]);
    const [claimed] = (await files.listRecordEvents(TENANT, done.id)).filter((event) => event.kind === 'claimed');
    expect(claimed).toMatchObject({ tenantId: TENANT, apiKeyId: KEY_ID, attemptId: expect.any(String), at: NOW });
    expect(await files.listRecordEvents(NEIGHBOUR, done.id)).toEqual([]);
    h.clock.now = at(21);
    await sweepKeyDownloadFiles(h.deps);
    expect((await kinds(done.id)).at(-1)).toEqual(['settled', 'swept']);
    h.clock.now = '2026-03-02T10:30:00.000Z';
    await sweepKeyDownloadFiles(h.deps);
    expect(await recordStates()).toEqual([]);
    expect((await kinds(done.id)).at(-1)).toEqual(['purged', 'retention']);
    h.clock.now = '2026-03-31T12:00:00.000Z';
    await sweepKeyDownloadFiles(h.deps);
    expect(await kinds(done.id)).toEqual([['purged', 'retention']]);
    h.clock.now = '2026-04-02T10:00:00.000Z';
    await sweepKeyDownloadFiles(h.deps);
    expect(await database.db.select().from(changeProposalDownloadUploadEvents)).toEqual([]);
  });

  it('purges at most one batch of settled records and of expired events of a workspace per run, and the rest on later runs', async () => {
    const h = harness();
    const old = '2026-02-20T10:00:00.000Z';
    await database.db.insert(changeProposalDownloadUploads).values([1, 2, 3].map((index) => ({
      tenantId: TENANT, id: `settled-${String(index)}`, apiKeyId: KEY_ID, kind: 'upload' as const, state: 'settled' as const,
      fileId: `settled-file-${String(index)}`, fileName: 'a.pdf', contentType: 'application/pdf' as const, declaredBytes: 10, createdAt: '2026-02-27T10:00:00.000Z',
    })));
    await database.db.insert(changeProposalDownloadUploadEvents).values([1, 2, 3].map((index) => ({
      tenantId: TENANT, recordId: `gone-${String(index)}`, apiKeyId: KEY_ID, kind: 'purged' as const, reason: 'retention', at: '2026-01-01T10:00:00.000Z',
    })));
    const deps = { ...h.deps, batch: { tenants: 1, rows: 2 } };
    const expiredEvents = async () => (await database.db.select().from(changeProposalDownloadUploadEvents)).filter((event) => event.at < old).length;
    await sweepKeyDownloadFiles(deps);
    expect(await database.db.select().from(changeProposalDownloadUploads)).toHaveLength(1);
    expect(await expiredEvents()).toBe(1);
    await sweepKeyDownloadFiles(deps);
    expect(await database.db.select().from(changeProposalDownloadUploads)).toEqual([]);
    expect(await expiredEvents()).toBe(0);
    expect((await database.db.select().from(changeProposalDownloadUploadEvents)).filter((event) => event.kind === 'purged' && event.at === NOW)).toHaveLength(3);
  });

  it('records the interruption of a copy whose storage answer is unknown with the attempt that made it', async () => {
    const h = harness();
    const original = `${TENANT}/product-downloads/${PRODUCT}/asset-owner/guide.pdf`;
    h.objects.objects.set(original, { bytes: PDF, contentType: 'application/pdf' });
    await database.db.insert(productDownloadAssets).values(ownedAsset('asset-owner', PDF.byteLength, original));
    h.objects.failCopies = () => true;
    await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'asset-owner' }, h.deps);
    const [record] = await database.db.select().from(changeProposalDownloadUploads);
    const events = await createKeyDownloadFileRepository(database.db).listRecordEvents(TENANT, record?.id ?? '-');
    expect(events.map((event) => [event.kind, event.reason, event.attemptId])).toEqual([
      ['started', 'copy', record?.attemptId], ['interrupted', 'copy_unconfirmed', record?.attemptId],
    ]);
  });
});

describe('the time budget of the staged file sweep', () => {
  it('stops between rows and between workspaces once storage deletes used its budget, and gives each delete only what is left', async () => {
    const h = harness();
    for (const tenantId of [TENANT, NEIGHBOUR]) {
      await database.db.insert(changeProposalDownloadDeletions).values(Array.from({ length: 5 }, (_unused, index) => ({
        tenantId, objectKey: `${tenantId}/product-downloads/key-files/${KEY_ID}/owed-${String(index)}/f.pdf`, apiKeyId: KEY_ID, sizeBytes: 10, createdAt: NOW,
      })));
    }
    const deadlines: number[] = [];
    const slow: StorageProvider = {
      ...h.objects.storage,
      delete: async (input) => {
        deadlines.push(input.deadlineMs ?? 0);
        h.clock.now = new Date(Date.parse(h.clock.now) + 4_000).toISOString();
        return err(integrationUnavailable('Could not reach S3.: the storage request deadline passed'));
      },
    };
    expect(await sweepKeyDownloadFiles({ ...h.deps, storage: slow })).toEqual({ ok: true, value: { tenants: 1, removed: 0, failed: 0 } });
    expect(deadlines).toEqual([10_000, 6_000, 2_000]);
    expect(await sweepKeyDownloadFiles({ ...h.deps, storage: slow, deadlineAt: Date.parse(h.clock.now) + 5_000 })).toMatchObject({ ok: true });
    expect(deadlines.slice(3)).toEqual([5_000]);
    expect(await owedRows()).toHaveLength(10);
  });
});

describe('the database statements of the staged file sweep', () => {
  const settled = {
    tenantId: TENANT, id: 'settled-old', apiKeyId: KEY_ID, kind: 'upload' as const, state: 'settled' as const,
    fileId: 'settled-old-file', fileName: 'a.pdf', contentType: 'application/pdf' as const, declaredBytes: 10, createdAt: '2026-02-27T10:00:00.000Z',
  };

  it('end the discovery of workspaces once a lock it waits on outlives the run budget', async () => {
    const h = harness();
    await database.db.insert(changeProposalDownloadUploads).values(settled);
    const holder = await connected();
    try {
      await holder.query('begin');
      await holder.query('lock table change_proposal_download_deletions in access exclusive mode');
      const started = Date.now();
      const released = new Promise((resolve) => { setTimeout(resolve, 5_000); }).then(() => holder.query('rollback'));
      const outcome = await sweepKeyDownloadFiles({ ...h.deps, budgetMs: 2_000 });
      const elapsed = Date.now() - started;
      await released;
      expect({ outcome, quick: elapsed < 4_000 }).toEqual({ outcome: { ok: true, value: { tenants: 0, removed: 0, failed: 0 } }, quick: true });
    } finally {
      await holder.end();
    }
  }, 15_000);

  it('end a retention purge that runs longer than the run budget, not only one that waits on a lock', async () => {
    const h = harness();
    await database.db.insert(changeProposalDownloadUploads).values(settled);
    await database.db.execute(sql`create or replace function slow_download_purge() returns trigger language plpgsql as $$
      begin perform pg_sleep(5); return old; end $$`);
    await database.db.execute(sql`create trigger slow_download_purge before delete on change_proposal_download_uploads for each row execute function slow_download_purge()`);
    try {
      const started = Date.now();
      const outcome = await sweepKeyDownloadFiles({ ...h.deps, budgetMs: 2_000 });
      expect({ outcome, quick: Date.now() - started < 4_000 }).toEqual({ outcome: { ok: true, value: { tenants: 1, removed: 0, failed: 0 } }, quick: true });
    } finally {
      await database.db.execute(sql`drop trigger slow_download_purge on change_proposal_download_uploads`);
      await database.db.execute(sql`drop function slow_download_purge()`);
    }
    expect(await database.db.select({ id: changeProposalDownloadUploads.id }).from(changeProposalDownloadUploads)).toEqual([{ id: 'settled-old' }]);
  }, 15_000);
});

const late = (h: ReturnType<typeof harness>) => {
  const pending: Array<() => void> = [];
  let failNext = true;
  const storage: StorageProvider = {
    ...h.objects.storage,
    copyObject: async (input) => {
      if (!failNext) return h.objects.storage.copyObject(input);
      failNext = false;
      const source = h.objects.objects.get(input.sourceKey);
      pending.push(() => { if (source !== undefined) h.objects.objects.set(input.key, { bytes: source.bytes.slice(), contentType: 'application/octet-stream' }); });
      return err(integrationUnavailable('Could not copy the storage object: the storage request deadline passed'));
    },
  };
  return { storage, land: () => { for (const write of pending.splice(0)) write(); } };
};

describe('a completion that takes over an interrupted upload', () => {
  it('writes a destination of its own, so a late copy of the earlier attempt changes neither the staged bytes nor their hash, and the sweep deletes that copy after its not-before time', async () => {
    const h = harness();
    await stagedFillers(KEY_DOWNLOAD_FILE_LIMITS.stagedFilesPerKey - 2, 10);
    const { id, candidate } = await h.begin(PDF);
    const copy = late(h);
    const deps = { ...h.deps, storage: copy.storage };
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, deps)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    const [first] = await database.db.select().from(changeProposalDownloadUploads).where(eq(changeProposalDownloadUploads.id, id));
    const superseded = first?.stagedKey ?? '-';
    const second = new Uint8Array([...PDF.slice(0, 8), 9, 9]);
    h.objects.objects.set(candidate, { bytes: second, contentType: 'application/pdf' });
    h.clock.now = at(10);
    const completed = await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, deps);
    if (!completed.ok) throw new Error(completed.error.message);
    const staged = `${TENANT}/product-downloads/key-files/${KEY_ID}/${completed.value.file.id}/workbook.pdf`;
    expect(staged).not.toBe(superseded);
    copy.land();

    expect(h.objects.objects.get(superseded)?.bytes).toEqual(PDF);
    expect(h.objects.objects.get(staged)?.bytes).toEqual(second);
    expect(completed.value.file.sha256).toBe(createContentHash().sha256(second));
    const attached = await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: completed.value.file.id }, h.deps);
    expect(attached).toMatchObject({ ok: true, value: { id: completed.value.file.id, storageKey: staged } });
    const [asset] = await database.db.select({ sha256: productDownloadAssets.sha256 }).from(productDownloadAssets).where(eq(productDownloadAssets.id, completed.value.file.id));
    expect(asset?.sha256).toBe(createContentHash().sha256(second));
    const owed = await database.db.select().from(changeProposalDownloadDeletions);
    expect(owed).toEqual([expect.objectContaining({ objectKey: superseded, apiKeyId: KEY_ID, sizeBytes: PDF.byteLength, notBefore: at(30) })]);
    await sizeFiller('after-takeover', 10);

    h.clock.now = at(29);
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([superseded]);
    expect(h.objects.keysUnder(superseded)).toEqual([superseded]);
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps))
      .toMatchObject({ ok: false, error: { details: { changeProposalCap: 'key_staged_files' } } });
    h.clock.now = at(30);
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);
    expect(h.objects.keysUnder(superseded)).toEqual([]);
    expect(h.objects.objects.get(staged)?.bytes).toEqual(second);
    expect(await beginKeyDownloadUpload(keyCtx(), small, h.deps)).toMatchObject({ ok: true });
  });

  const interruptedAtTen = async (h: ReturnType<typeof harness>) => {
    const { id } = await h.begin(PDF);
    await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, { ...h.deps, storage: late(h).storage });
    h.clock.now = at(10);
    return id;
  };

  const sizeFiller = async (id: string, sizeBytes: number, apiKeyId = KEY_ID) => {
    await database.db.insert(changeProposalDownloadFiles).values({
      tenantId: TENANT, id, apiKeyId, fileName: 'f.pdf', contentType: 'application/pdf', sizeBytes,
      sha256: 'f'.repeat(64), objectKey: `${TENANT}/product-downloads/key-files/${apiKeyId}/${id}/f.pdf`, createdAt: NOW,
    });
  };

  it('refuses a takeover that would pass the key\'s file limit, changes nothing, and takes it over once a file was discarded', async () => {
    const h = harness();
    const fillers = await stagedFillers(KEY_DOWNLOAD_FILE_LIMITS.stagedFilesPerKey - 1, 10);
    const id = await interruptedAtTen(h);
    const copies = h.objects.calls.filter((call) => call.method === 'copyObject').length;
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_staged_files' } } });
    expect(h.objects.calls.filter((call) => call.method === 'copyObject')).toHaveLength(copies);
    expect(await owedRows()).toEqual([]);
    expect(await recordStates()).toEqual(['interrupted']);
    await discardKeyDownloadFile(keyCtx(), { id: fillers[0]?.id ?? '-' }, h.deps);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps)).toMatchObject({ ok: true });
    expect(await owedRows()).toHaveLength(1);
  });

  it('takes an interrupted upload over at exactly the key\'s byte limit and refuses it one byte past', async () => {
    const h = harness();
    const fullFillers = KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerKey / KEY_DOWNLOAD_FILE_LIMITS.maxBytes - 1;
    await stagedFillers(fullFillers, KEY_DOWNLOAD_FILE_LIMITS.maxBytes);
    await sizeFiller('gap', KEY_DOWNLOAD_FILE_LIMITS.maxBytes - 3 * PDF.byteLength + 1);
    const id = await interruptedAtTen(h);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_staged_bytes' } } });
    expect(await owedRows()).toEqual([]);
    await database.db.update(changeProposalDownloadFiles).set({ sizeBytes: KEY_DOWNLOAD_FILE_LIMITS.maxBytes - 3 * PDF.byteLength })
      .where(eq(changeProposalDownloadFiles.id, 'gap'));
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps)).toMatchObject({ ok: true });
  });

  it('refuses a takeover one byte past the workspace\'s byte limit', async () => {
    const h = harness();
    const fullFillers = KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerWorkspace / KEY_DOWNLOAD_FILE_LIMITS.maxBytes - 1;
    await stagedFillers(fullFillers, KEY_DOWNLOAD_FILE_LIMITS.maxBytes, OTHER_KEY_ID);
    await sizeFiller('gap', KEY_DOWNLOAD_FILE_LIMITS.maxBytes - 3 * PDF.byteLength + 1, OTHER_KEY_ID);
    const id = await interruptedAtTen(h);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'workspace_staged_bytes' } } });
    expect(await owedRows()).toEqual([]);
  });

  it('deletes the superseded destination after its not-before time also when no copy ever landed there', async () => {
    const h = harness();
    const { id } = await h.begin(PDF);
    const copy = late(h);
    await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, { ...h.deps, storage: copy.storage });
    h.clock.now = at(10);
    expect(await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps)).toMatchObject({ ok: true });
    const [superseded] = await owedRows();
    expect(superseded).toEqual(expect.stringContaining('/key-files/'));
    h.clock.now = at(30);
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);
    expect(h.objects.calls.filter((call) => call.method === 'delete' && call.key === superseded)).toHaveLength(1);
  });

  it('lets exactly one of two takeovers that wait for the record at once claim it; the other answers the conflict or, once that one finished, its file', async () => {
    const h = harness();
    const { id } = await h.begin(PDF);
    const copy = late(h);
    await completeKeyDownloadUpload(keyCtx(), { uploadId: id }, { ...h.deps, storage: copy.storage });
    h.clock.now = at(10);
    const holder = await connected();
    const observer = await connected();
    let outcomes;
    try {
      await holder.query('begin');
      await holder.query('select id from change_proposal_download_uploads where id = $1 for update', [id]);
      const takeovers = Promise.all([
        completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps),
        completeKeyDownloadUpload(keyCtx(), { uploadId: id }, h.deps),
      ]);
      await untilWaiting(observer, 'both takeovers', 2);
      await holder.query('commit');
      outcomes = await takeovers;
    } finally {
      await holder.end();
      await observer.end();
    }
    const files = outcomes.flatMap((outcome) => outcome.ok ? [outcome.value.file] : []);
    expect(files.length).toBeGreaterThanOrEqual(1);
    for (const file of files) expect(file).toEqual(files[0]);
    for (const outcome of outcomes) {
      if (!outcome.ok) expect(outcome.error).toMatchObject({ code: 'conflict', message: expect.stringContaining('another request') });
    }
    expect(await owedRows()).toHaveLength(1);
    expect(await stagedRows()).toHaveLength(1);
    expect(h.objects.calls.filter((call) => call.method === 'copyObject')).toHaveLength(1);
    const events = await createKeyDownloadFileRepository(database.db).listRecordEvents(TENANT, id);
    expect(events.filter((event) => event.kind === 'claimed').map((event) => event.reason)).toEqual([null, 'reclaimed']);
  });
});

describe('an attach retried after it applied', () => {
  it('answers the applied file only to a retry that asks for what was applied, and a conflict to any other', async () => {
    const h = harness();
    const first = await h.stage();
    const second = await h.stage(new Uint8Array([...PDF, 1]));
    const added = await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: first.id, versionNote: 'First' }, h.deps);
    expect(added).toMatchObject({ ok: true });
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: first.id, versionNote: 'First' }, h.deps)).toEqual(added);
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: first.id, versionNote: 'Other' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: first.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });

    const replaced = await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id, replacesAssetId: first.id }, h.deps);
    expect(replaced).toMatchObject({ ok: true, value: { lineageId: first.id, versionNumber: 2 } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id, replacesAssetId: first.id }, h.deps)).toEqual(replaced);
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: first.id, replacesAssetId: second.id, versionNote: 'First' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: second.id, replacesAssetId: second.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    const rows = await database.db.select({ id: productDownloadAssets.id, supersededAt: productDownloadAssets.supersededAt }).from(productDownloadAssets);
    expect(rows.sort((left, right) => left.id < right.id ? -1 : 1)).toEqual([{ id: first.id, supersededAt: NOW }, { id: second.id, supersededAt: null }]);
  });
});

describe('the lock waits of the staged file sweep', () => {
  it('gives each row lock wait and each delete, endpoint lookup included, only what is left, and starts a two-object record only when both deletes fit', async () => {
    const h = harness();
    const owe = (name: string, createdAt: string) => ({
      tenantId: TENANT, objectKey: `${TENANT}/product-downloads/key-files/${KEY_ID}/${name}/f.pdf`, apiKeyId: KEY_ID, sizeBytes: 10, createdAt,
    });
    await database.db.insert(changeProposalDownloadDeletions).values([
      owe('first', '2026-03-01T09:00:00.000Z'), owe('second', '2026-03-01T09:01:00.000Z'), owe('third', '2026-03-01T09:40:00.000Z'), owe('fourth', '2026-03-01T09:41:00.000Z'),
    ]);
    await database.db.insert(changeProposalDownloadUploads).values({
      tenantId: TENANT, id: 'two-objects', apiKeyId: KEY_ID, kind: 'upload', state: 'started', fileId: 'two-objects-file', fileName: 'a.pdf',
      contentType: 'application/pdf', declaredBytes: 10, candidateKey: `${TENANT}/product-downloads/key-uploads/${KEY_ID}/two-objects`,
      stagedKey: `${TENANT}/product-downloads/key-files/${KEY_ID}/two-objects-file/a.pdf`, createdAt: '2026-03-01T09:30:00.000Z',
    });
    const spend = (ms: number) => { h.clock.now = new Date(Date.parse(h.clock.now) + ms).toISOString(); };
    const waits: Array<[string, number | undefined]> = [];
    const deadlines: number[] = [];
    const files = h.deps.keyDownloadFiles;
    const keyDownloadFiles: typeof files = {
      ...files,
      finishDeletion: (tenantId, objectKey, now, remove, wait) => {
        waits.push(['deletion', wait]);
        spend(Math.min(wait ?? 0, 1_000));
        return files.finishDeletion(tenantId, objectKey, now, remove, wait);
      },
      releaseRecord: (tenantId, uploadId, selection, remove, wait) => {
        waits.push(['record', wait]);
        spend(Math.min(wait ?? 0, 1_000));
        return files.releaseRecord(tenantId, uploadId, selection, remove, wait);
      },
    };
    const lookupAndDelete: StorageProvider = {
      ...h.objects.storage,
      delete: async (input) => {
        const deadline = input.deadlineMs ?? Number.POSITIVE_INFINITY;
        deadlines.push(deadline);
        spend(Math.min(deadline, 3_000));
        return deadline < 3_000 ? err(integrationUnavailable('Could not reach S3.: the storage request deadline passed')) : h.objects.storage.delete(input);
      },
    };
    const started = Date.parse(h.clock.now);
    expect(await sweepKeyDownloadFiles({ ...h.deps, keyDownloadFiles, storage: lookupAndDelete })).toMatchObject({ ok: true, value: { removed: 2 } });
    expect(waits).toEqual([['deletion', 9_000], ['deletion', 5_000], ['deletion', 1_000]]);
    expect(deadlines).toEqual([9_000, 5_000, 1_000]);
    expect(Date.parse(h.clock.now) - started).toBeLessThanOrEqual(KEY_DOWNLOAD_FILE_LIMITS.sweepBudgetMs);

    waits.length = 0;
    deadlines.length = 0;
    const hanging: StorageProvider = {
      ...h.objects.storage,
      delete: async (input) => {
        deadlines.push(input.deadlineMs ?? 0);
        spend(input.deadlineMs ?? 0);
        return err(integrationUnavailable('Could not reach S3.: the storage request deadline passed'));
      },
    };
    const restarted = Date.parse(h.clock.now);
    await sweepKeyDownloadFiles({ ...h.deps, keyDownloadFiles, storage: hanging });
    expect(waits[0]).toEqual(['record', 8_000]);
    expect(deadlines.slice(0, 2)).toEqual([8_000, 1_000]);
    expect(Date.parse(h.clock.now) - restarted).toBeLessThanOrEqual(KEY_DOWNLOAD_FILE_LIMITS.sweepBudgetMs);
  });

  it('gives up a row whose lock another transaction holds once the lock wait the sweep passes ran out, below a long own bound', async () => {
    const files = createKeyDownloadFileRepository(database.db, { lockWaitMs: 60_000 });
    const objectKey = `${TENANT}/product-downloads/key-files/${KEY_ID}/held/f.pdf`;
    await database.db.insert(changeProposalDownloadDeletions).values({ tenantId: TENANT, objectKey, apiKeyId: KEY_ID, sizeBytes: 10, createdAt: NOW });
    const holder = await connected();
    try {
      await holder.query('begin');
      await holder.query('select object_key from change_proposal_download_deletions where object_key = $1 for update', [objectKey]);
      const remove = vi.fn(async () => true);
      expect(await files.finishDeletion(TENANT, objectKey, NOW, remove, 50)).toBe('busy');
      expect(remove).not.toHaveBeenCalled();
      await holder.query('rollback');
    } finally {
      await holder.end();
    }
    expect(await owedRows()).toEqual([objectKey]);
  }, 15_000);
});
