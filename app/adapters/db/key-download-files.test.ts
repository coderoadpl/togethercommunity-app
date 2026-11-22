import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import {
  KEY_DOWNLOAD_FILE_LIMITS,
  type Identity,
  type KeyDownloadContentType,
  type ShopManagementKey,
} from '#core/domain/index.js';
import {
  attachStagedProductDownload,
  beginKeyDownloadUpload,
  completeKeyDownloadUpload,
  copyKeyDownloadFile,
  discardKeyDownloadFile,
  listKeyDownloadFiles,
  removeProductDownloadFile,
  shopManagementKeyCapabilities,
  sweepKeyDownloadFiles,
  type Ctx,
  type StorageProvider,
} from '#core/server/index.js';
import { createObjectStorageFake } from '#core/server/testing/object-storage-fake.js';

import { createKeyDownloadAttachRepository, createKeyDownloadFileRepository } from './key-download-files.js';
import { createProductDownloadAssetRepository, createTenantSecretRepository } from './repositories.js';
import {
  changeProposalDownloadDeletions,
  changeProposalDownloadFiles,
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

const untilWaiting = async (observer: pg.Client, what: string): Promise<void> => {
  for (const deadline = Date.now() + 10_000; await lockWaiters(observer) < 1;) {
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
  for (const table of [changeProposalDownloadFiles, changeProposalDownloadUploads, changeProposalDownloadDeletions, stockEvents, productStock, productDownloadAssets, products, shopManagementKeys]) {
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

const owedRows = async () => (await database.db.select().from(changeProposalDownloadDeletions)).map((row) => row.objectKey).sort();

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
    expect(h.objects.calls.filter((call) => call.method === 'copyObject')).toHaveLength(1);
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

  it('refuses a file of another product, a pending file and a type keys cannot stage', async () => {
    const h = harness();
    await database.db.insert(productDownloadAssets).values([
      { id: 'pending', tenantId: TENANT, productId: PRODUCT, lineageId: 'pending', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, storageKey: 'k1', status: 'pending', createdAt: NOW },
      { id: 'page', tenantId: TENANT, productId: PRODUCT, lineageId: 'page', fileName: 'a.html', contentType: 'text/html', sizeBytes: 10, storageKey: 'k2', status: 'ready', createdAt: NOW },
    ]);
    expect(await copyKeyDownloadFile(keyCtx(), { productId: 'mug', assetId: 'page' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'pending' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await copyKeyDownloadFile(keyCtx(), { productId: PRODUCT, assetId: 'page' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
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

    h.clock.now = at(15);
    await sweepKeyDownloadFiles(h.deps);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual(copies);
    h.clock.now = at(21);
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

  it('owes the deletion when the owner deletes a key-attached file in the session and when a discard cannot delete', async () => {
    const h = harness();
    const attached = await h.stage();
    const discarded = await h.stage(new Uint8Array([...PDF, 7]));
    await attachStagedProductDownload(keyCtx(), { productId: PRODUCT, stagedFileId: attached.id }, h.deps);
    expect(await createProductDownloadAssetRepository(database.db).delete(TENANT, attached.id)).toBe(true);
    h.objects.failDeletes = () => true;
    expect(await discardKeyDownloadFile(keyCtx(), { id: discarded.id }, h.deps)).toEqual({ ok: true, value: { discarded: true } });
    expect(await stagedRows()).toEqual([]);
    expect(await owedRows()).toEqual([attached.id, discarded.id].map((id) => expect.stringContaining(`/${id}/`)));
    h.objects.failDeletes = () => false;
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);
    expect(h.objects.keysUnder(`${TENANT}/`)).toEqual([]);
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
    expect(await sweepKeyDownloadFiles(deps)).toMatchObject({ ok: true, value: { tenants: 1, removed: 1 } });
    expect(await owedRows()).toEqual([failing]);
    expect(neighbour).not.toBe(failing);
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
  it('lists staged objects, open upload objects and owed deletions of the workspace as pending', async () => {
    const h = harness();
    const staged = await h.stage();
    const { candidate } = await h.begin(PDF);
    const inventory = await createStorageReferenceRepository(database.db).readInventory(TENANT);
    expect(inventory.stagedDownloads.map((entry) => entry.storageKey)).toEqual(expect.arrayContaining([
      `${TENANT}/product-downloads/key-files/${KEY_ID}/${staged.id}/workbook.pdf`,
      candidate,
    ]));
    expect((await createStorageReferenceRepository(database.db).readInventory(NEIGHBOUR)).stagedDownloads).toEqual([]);
  });
});
