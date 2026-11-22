import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  changeProposalDownloadDeletions,
  changeProposalDownloadFiles,
  changeProposalDownloadUploads,
  changeProposals,
  productDownloadAssets,
  shopManagementKeyEvents,
  tenantAdmins,
  tenants,
} from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  SHOP_CATALOG_ROUTES,
  SHOP_DOWNLOAD_ROUTES,
  shopCatalogContracts,
  shopDownloadContracts,
} from '#core/contract/index.js';
import type { TenantSecretResolver } from '#core/server/index.js';
import { createObjectStorageFake, fakeStorageSecrets, type FakeObjectStorage } from '#core/server/testing/object-storage-fake.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48731';
const acmeHost = 'acme.localhost:48731';
const studioHost = 'studio.localhost:48731';
const password = 'shop-download-password-15';
const START = Date.parse('2026-11-15T10:00:00.000Z');
let minute = 0;
let now = new Date(START).toISOString();
const expiresAt = '2026-11-22T00:00:00.000Z';
const WRITE_SCOPES = ['shop:catalog:read', 'shop:catalog:write'];
const PDF = new TextEncoder().encode('%PDF-1.7\nworkbook body\n%%EOF\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const STORAGE_ORIGIN = 'https://storage.example.test/';
const routes = SHOP_DOWNLOAD_ROUTES;
const contracts = shopDownloadContracts;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let storage: FakeObjectStorage;
let ownerToken: string;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) => z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
}).parse(await response.json()).error;

const keyed = (secret: string | null, method: string, path: string, body?: unknown, host = acmeHost, extra: Record<string, string> = {}) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host,
    ...(secret === null ? {} : { 'x-api-key': secret }),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...extra,
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const sessionRequest = (method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createShopKey = async (scopes: string[], mode: 'direct' | 'propose', host = acmeHost, until = expiresAt) => {
  const response = await sessionRequest(API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
    name: `Files ${mode}`, scopes, expiresAt: until, mode,
  }, host);
  expect(response.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await response.json()).data;
};

const storageKeyOf = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1));

const startUpload = async (secret: string, file: { fileName: string; contentType: string; sizeBytes: number }, host = acmeHost) => {
  const response = await keyed(secret, 'POST', routes.uploadStagedDownload.path, file, host);
  expect(response.status).toBe(200);
  return envelope(contracts.uploadStagedDownload.output).parse(await response.json()).data.upload;
};

const stageUpload = async (secret: string, bytes: Uint8Array, fileName = 'workbook.pdf', contentType = 'application/pdf', host = acmeHost) => {
  const upload = await startUpload(secret, { fileName, contentType, sizeBytes: bytes.byteLength }, host);
  storage.objects.set(storageKeyOf(upload.url), { bytes, contentType });
  const completed = await keyed(secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id }, host);
  expect(completed.status).toBe(200);
  return envelope(contracts.completeStagedDownload.output).parse(await completed.json()).data.file;
};

const createProduct = async (secret: string, title: string, type: 'digital_download' | 'physical', host = acmeHost) => {
  const response = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title, type, priceCents: 1000 }, host);
  expect(response.status).toBe(200);
  return envelope(shopCatalogContracts.createProduct.output).parse(await response.json()).data.product.id;
};

const signUp = async (email: string, name: string): Promise<{ id: string; token: string }> => {
  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name, email, password }),
  });
  expect(signup.status).toBe(200);
  const id = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${id}'`);
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  return { id, token: z.object({ token: z.string() }).parse(await signin.json()).token };
};

const fileState = async () => JSON.stringify({
  assets: (await database.db.select().from(productDownloadAssets)).sort((left, right) => left.id.localeCompare(right.id)),
  staged: (await database.db.select().from(changeProposalDownloadFiles)).sort((left, right) => left.id.localeCompare(right.id)),
  uploads: (await database.db.select().from(changeProposalDownloadUploads)).sort((left, right) => left.id.localeCompare(right.id)),
  deletions: (await database.db.select().from(changeProposalDownloadDeletions)).sort((left, right) => left.objectKey.localeCompare(right.objectKey)),
  proposals: await database.db.select().from(changeProposals),
});

let direct: Awaited<ReturnType<typeof createShopKey>>;
let otherDirect: Awaited<ReturnType<typeof createShopKey>>;
let proposer: Awaited<ReturnType<typeof createShopKey>>;
let studioKey: Awaited<ReturnType<typeof createShopKey>>;
let digital: string;
let secondDigital: string;
let physical: string;
let studioDigital: string;
const ownerAsset = { id: 'owner-workbook', key: 'acme/product-downloads/owner/workbook.pdf' };
const studioAsset = { id: 'studio-workbook', key: 'studio/product-downloads/owner/workbook.pdf' };

const insertOwnerAsset = async (tenantId: string, productId: string, asset: { id: string; key: string }) => {
  await database.db.insert(productDownloadAssets).values({
    id: asset.id, tenantId, productId, lineageId: asset.id, versionNumber: 1, versionNote: null, supersededAt: null, replacesAssetId: null,
    fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength, storageKey: asset.key, status: 'ready', createdAt: now, sha256: null,
  });
  storage.objects.set(asset.key, { bytes: PDF, contentType: 'application/pdf' });
};

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_download_routes_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const env = envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-download-routes-test-secret-at-least-32-characters',
  });
  const created = createDeps(env, { db: database.db, clock: { nowIso: () => now } });
  storage = createObjectStorageFake();
  const resolver: TenantSecretResolver = created.secretResolver;
  app = buildApp({
    ...created,
    storage: storage.storage,
    secretResolver: { resolve: async (tenantId, key) => key === 's3.configuration' ? fakeStorageSecrets.resolve() : resolver.resolve(tenantId, key) },
  });
  const owner = await signUp('shop-download-owner@example.test', 'Download Owner');
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: owner.id, role: 'owner' });
  }
  ownerToken = owner.token;
  direct = await createShopKey(WRITE_SCOPES, 'direct');
  otherDirect = await createShopKey(WRITE_SCOPES, 'direct');
  proposer = await createShopKey(WRITE_SCOPES, 'propose');
  studioKey = await createShopKey(WRITE_SCOPES, 'direct', studioHost);
  digital = await createProduct(direct.secret, 'Field guide', 'digital_download');
  secondDigital = await createProduct(direct.secret, 'Field guide, second edition', 'digital_download');
  physical = await createProduct(direct.secret, 'Printed guide', 'physical');
  studioDigital = await createProduct(studioKey.secret, 'Studio guide', 'digital_download', studioHost);
  await insertOwnerAsset('acme', digital, ownerAsset);
  await insertOwnerAsset('studio', studioDigital, studioAsset);
}, 120_000);

afterAll(async () => { await database?.close(); });

beforeEach(() => {
  minute += 1;
  now = new Date(START + minute * 60_000).toISOString();
});

describe('a direct-mode key on the download file routes', () => {
  it('stages an upload signed for its declared length, attaches it, replaces it with a new version and removes it live', async () => {
    const upload = await startUpload(direct.secret, { fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength });
    const candidate = storageKeyOf(upload.url);
    expect(candidate.startsWith(`acme/product-downloads/key-uploads/${direct.apiKey.id}/`)).toBe(true);
    expect(upload.headers).toEqual({ 'content-type': 'application/pdf', 'content-length': String(PDF.byteLength) });
    expect(storage.signedLengths.get(candidate)).toBe(PDF.byteLength);
    storage.objects.set(candidate, { bytes: PDF, contentType: 'application/pdf' });
    const completed = await keyed(direct.secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id });
    expect(completed.status).toBe(200);
    const staged = envelope(contracts.completeStagedDownload.output).parse(await completed.json()).data.file;
    expect(staged).toMatchObject({ fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength, copiedFrom: null });
    expect(staged.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.keysUnder(candidate)).toEqual([]);

    const again = await keyed(direct.secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id });
    expect(envelope(contracts.completeStagedDownload.output).parse(await again.json()).data.file.id).toBe(staged.id);

    const listed = await keyed(direct.secret, 'GET', routes.listStagedDownloads.path);
    expect(envelope(contracts.listStagedDownloads.output).parse(await listed.json()).data.files.map((file) => file.id)).toEqual([staged.id]);

    const added = await keyed(direct.secret, 'POST', routes.addProductDownload.path, { productId: digital, stagedFileId: staged.id });
    expect(added.status).toBe(200);
    const asset = envelope(contracts.addProductDownload.output).parse(await added.json()).data.asset;
    expect(asset).toMatchObject({ id: staged.id, productId: digital, versionNumber: 1, status: 'ready', supersededAt: null });
    expect(JSON.stringify(asset)).not.toContain('product-downloads/');

    const next = await stageUpload(direct.secret, PDF, 'workbook-2.pdf');
    const replaced = await keyed(direct.secret, 'POST', routes.replaceProductDownload.path, {
      productId: digital, replacesAssetId: staged.id, stagedFileId: next.id, versionNote: 'Second edition',
    });
    expect(replaced.status).toBe(200);
    expect(envelope(contracts.replaceProductDownload.output).parse(await replaced.json()).data.asset)
      .toMatchObject({ id: next.id, lineageId: staged.id, versionNumber: 2, versionNote: 'Second edition' });

    const files = await keyed(direct.secret, 'GET', routes.listProductDownloads.path.replace(':productId', digital));
    const assets = envelope(contracts.listProductDownloads.output).parse(await files.json()).data.assets;
    expect(assets.map((entry) => [entry.id, entry.versionNumber, entry.supersededAt === null])).toEqual(expect.arrayContaining([
      [staged.id, 1, false], [next.id, 2, true], [ownerAsset.id, 1, true],
    ]));

    const removed = await keyed(direct.secret, 'POST', routes.removeProductDownload.path, { productId: digital, assetId: next.id });
    expect(removed.status).toBe(200);
    expect(envelope(contracts.removeProductDownload.output).parse(await removed.json()).data).toEqual({ deleted: true });
    const rows = await database.db.select().from(productDownloadAssets);
    expect(rows.find((row) => row.id === next.id)).toBeUndefined();
    expect(rows.find((row) => row.id === staged.id)?.supersededAt).toBeNull();
    expect(storage.keysUnder(`acme/product-downloads/key-files/${direct.apiKey.id}/${next.id}/`)).toEqual([]);
    expect((await database.db.select().from(changeProposalDownloadDeletions)).filter((row) => row.objectKey.includes(next.id))).toEqual([]);
  });

  it('copies a ready file of another product on the server and shows the key its source, never a fingerprint', async () => {
    const response = await keyed(direct.secret, 'POST', routes.copyStagedDownload.path, { productId: digital, assetId: ownerAsset.id });
    expect(response.status).toBe(200);
    const copy = envelope(contracts.copyStagedDownload.output).parse(await response.json()).data.file;
    expect(copy).toMatchObject({ sha256: null, copiedFrom: { productId: digital, assetId: ownerAsset.id, versionNumber: 1 }, sizeBytes: PDF.byteLength });
    expect(storage.calls.filter((call) => call.method === 'copyObject').at(-1)?.key)
      .toMatch(new RegExp(`^acme/product-downloads/key-files/${direct.apiKey.id}/${copy.id}/`));
    const attached = await keyed(direct.secret, 'POST', routes.addProductDownload.path, { productId: secondDigital, stagedFileId: copy.id });
    expect(attached.status).toBe(200);
    expect(storage.objects.get(ownerAsset.key)?.bytes).toEqual(PDF);
  });

  it('discards a staged file and deletes its object', async () => {
    const staged = await stageUpload(direct.secret, PDF, 'discarded.pdf');
    const objects = storage.keysUnder(`acme/product-downloads/key-files/${direct.apiKey.id}/${staged.id}/`);
    expect(objects).toHaveLength(1);
    const discarded = await keyed(direct.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', staged.id));
    expect(discarded.status).toBe(200);
    expect(envelope(contracts.discardStagedDownload.output).parse(await discarded.json()).data).toEqual({ discarded: true });
    expect(storage.keysUnder(`acme/product-downloads/key-files/${direct.apiKey.id}/${staged.id}/`)).toEqual([]);
    expect((await keyed(direct.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', staged.id))).status).toBe(404);
  });

  it('refuses bytes that are not of the declared type and deletes the candidate and the staged copy', async () => {
    const upload = await startUpload(direct.secret, { fileName: 'fake.pdf', contentType: 'application/pdf', sizeBytes: PNG.byteLength });
    storage.objects.set(storageKeyOf(upload.url), { bytes: PNG, contentType: 'application/pdf' });
    const completed = await keyed(direct.secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id });
    expect(completed.status).toBe(400);
    expect((await errorOf(completed)).message).toContain('not of type application/pdf');
    expect(storage.keysUnder(storageKeyOf(upload.url))).toEqual([]);
    expect(storage.keysUnder(`acme/product-downloads/key-files/${direct.apiKey.id}/`).filter((key) => key.endsWith('/fake.pdf'))).toEqual([]);
    expect(storage.calls.filter((call) => call.method === 'copyObject' && call.key.endsWith('/fake.pdf'))).toHaveLength(1);
    const staged = await database.db.select().from(changeProposalDownloadFiles);
    expect(staged.filter((row) => row.fileName === 'fake.pdf')).toEqual([]);
  });

  it('refuses an attach to a product that is not a digital download and a file larger than the key limit', async () => {
    const staged = await stageUpload(direct.secret, PDF, 'physical.pdf');
    const refused = await keyed(direct.secret, 'POST', routes.addProductDownload.path, { productId: physical, stagedFileId: staged.id });
    expect(refused.status).toBe(400);
    const tooLarge = await keyed(direct.secret, 'POST', routes.uploadStagedDownload.path, { fileName: 'big.pdf', contentType: 'application/pdf', sizeBytes: 256 * 1024 * 1024 + 1 });
    expect(tooLarge.status).toBe(400);
    const unknownType = await keyed(direct.secret, 'POST', routes.uploadStagedDownload.path, { fileName: 'notes.txt', contentType: 'text/plain', sizeBytes: 10 });
    expect(unknownType.status).toBe(400);
    const strict = await keyed(direct.secret, 'POST', routes.addProductDownload.path, { productId: digital, stagedFileId: staged.id, replacesAssetId: ownerAsset.id });
    expect(strict.status).toBe(400);
    expect((await keyed(direct.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', staged.id))).status).toBe(200);
  });

  it('answers the start limit as a 409 conflict naming the cap', async () => {
    const counter = await createShopKey(WRITE_SCOPES, 'direct');
    for (let started = 0; started < 20; started += 1) {
      const response = await keyed(counter.secret, 'POST', routes.uploadStagedDownload.path, { fileName: `file-${String(started)}.pdf`, contentType: 'application/pdf', sizeBytes: 10 });
      if (response.status !== 200) throw new Error(`start ${String(started)} answered ${String(response.status)}`);
    }
    const refused = await keyed(counter.secret, 'POST', routes.uploadStagedDownload.path, { fileName: 'one-more.pdf', contentType: 'application/pdf', sizeBytes: 10 });
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toMatchObject({ code: 'conflict', details: { changeProposalCap: 'key_file_uploads' } });
  });

  it('records every download write in the key history', async () => {
    const before = (await database.db.select().from(shopManagementKeyEvents)).filter((event) => event.apiKeyId === direct.apiKey.id && event.route === routes.copyStagedDownload.path).length;
    await keyed(direct.secret, 'POST', routes.copyStagedDownload.path, { productId: digital, assetId: 'unknown-asset' });
    const after = (await database.db.select().from(shopManagementKeyEvents)).filter((event) => event.apiKeyId === direct.apiKey.id && event.route === routes.copyStagedDownload.path);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.resourceId).toBe(digital);
  });
});

describe('a propose-mode key on the download file routes', () => {
  it('is refused on every write and on the staged list before its handler, and stages, attaches or presigns nothing', async () => {
    const stagedByOther = await stageUpload(direct.secret, PDF, 'other.pdf');
    const before = await fileState();
    const presigns = storage.calls.filter((call) => call.method === 'presignPut').length;
    const requests: Array<[string, string, unknown]> = [
      ['POST', routes.uploadStagedDownload.path, { fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength }],
      ['POST', routes.completeStagedDownload.path, { uploadId: 'unknown-upload' }],
      ['POST', routes.copyStagedDownload.path, { productId: digital, assetId: ownerAsset.id }],
      ['GET', routes.listStagedDownloads.path, undefined],
      ['DELETE', routes.discardStagedDownload.path.replace(':id', stagedByOther.id), undefined],
      ['POST', routes.addProductDownload.path, { productId: digital, stagedFileId: stagedByOther.id }],
      ['POST', routes.replaceProductDownload.path, { productId: digital, replacesAssetId: ownerAsset.id, stagedFileId: stagedByOther.id }],
      ['POST', routes.removeProductDownload.path, { productId: digital, assetId: ownerAsset.id }],
    ];
    for (const [method, path, body] of requests) {
      const response = await keyed(proposer.secret, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect((await errorOf(response)).message, `${method} ${path}`)
        .toBe('A propose-mode shop management key cannot call this route (not-in-release): product download files are not available to a propose-mode key yet');
    }
    expect(await fileState()).toBe(before);
    expect(storage.calls.filter((call) => call.method === 'presignPut')).toHaveLength(presigns);
    expect(storage.keysUnder(`acme/product-downloads/key-uploads/${proposer.apiKey.id}/`)).toEqual([]);
  });

  it('still reads the file list of a product', async () => {
    const response = await keyed(proposer.secret, 'GET', routes.listProductDownloads.path.replace(':productId', digital));
    expect(response.status).toBe(200);
    expect(envelope(contracts.listProductDownloads.output).parse(await response.json()).data.assets.map((asset) => asset.id)).toContain(ownerAsset.id);
  });
});

describe('the download file routes across keys and workspaces', () => {
  it('never lets another key of the workspace complete, list, attach or discard a key\'s upload or staged file', async () => {
    const upload = await startUpload(direct.secret, { fileName: 'private.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength });
    storage.objects.set(storageKeyOf(upload.url), { bytes: PDF, contentType: 'application/pdf' });
    expect((await keyed(otherDirect.secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id })).status).toBe(404);
    const completed = await keyed(direct.secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id });
    const staged = envelope(contracts.completeStagedDownload.output).parse(await completed.json()).data.file;
    const listed = await keyed(otherDirect.secret, 'GET', routes.listStagedDownloads.path);
    expect(envelope(contracts.listStagedDownloads.output).parse(await listed.json()).data.files.map((file) => file.id)).not.toContain(staged.id);
    expect((await keyed(otherDirect.secret, 'POST', routes.addProductDownload.path, { productId: digital, stagedFileId: staged.id })).status).toBe(404);
    expect((await keyed(otherDirect.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', staged.id))).status).toBe(404);
    expect((await database.db.select().from(changeProposalDownloadFiles)).map((row) => row.id)).toContain(staged.id);
    expect((await keyed(direct.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', staged.id))).status).toBe(200);
  });

  it('keeps a key of another workspace away from this workspace\'s products, files and staged files', async () => {
    const staged = await stageUpload(direct.secret, PDF, 'acme-only.pdf');
    const copied = await keyed(studioKey.secret, 'POST', routes.copyStagedDownload.path, { productId: digital, assetId: ownerAsset.id }, studioHost);
    expect(copied.status).toBe(404);
    expect((await keyed(studioKey.secret, 'POST', routes.addProductDownload.path, { productId: studioDigital, stagedFileId: staged.id }, studioHost)).status).toBe(404);
    expect((await keyed(studioKey.secret, 'GET', routes.listProductDownloads.path.replace(':productId', digital), undefined, studioHost)).status).toBe(404);
    expect((await keyed(studioKey.secret, 'POST', routes.removeProductDownload.path, { productId: digital, assetId: ownerAsset.id }, studioHost)).status).toBe(404);
    expect((await keyed(direct.secret, 'POST', routes.copyStagedDownload.path, { productId: studioDigital, assetId: studioAsset.id })).status).toBe(404);
    expect((await keyed(direct.secret, 'GET', routes.listStagedDownloads.path, undefined, studioHost)).status).toBe(401);
    expect((await database.db.select().from(productDownloadAssets)).find((row) => row.id === ownerAsset.id)).toBeDefined();
    expect((await keyed(direct.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', staged.id))).status).toBe(200);
  });

  it('refuses a session, a request without a key, a revoked key and an expired key', async () => {
    const path = routes.uploadStagedDownload.path;
    const body = { fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength };
    expect((await sessionRequest('POST', path, body)).status).toBe(401);
    expect((await sessionRequest('GET', routes.listProductDownloads.path.replace(':productId', digital))).status).toBe(401);
    expect((await keyed(null, 'POST', path, body)).status).toBe(401);
    const revoked = await createShopKey(WRITE_SCOPES, 'direct');
    const revoke = await sessionRequest(API_ROUTES.apiKeysShopManagementRevoke.method, API_PATHS.apiKeysShopManagementRevoke.replace(':id', revoked.apiKey.id));
    expect(revoke.status).toBe(200);
    expect((await keyed(revoked.secret, 'POST', path, body)).status).toBe(401);
    const expiring = await createShopKey(WRITE_SCOPES, 'direct', acmeHost, new Date(Date.parse(now) + 60 * 60_000).toISOString());
    expect((await keyed(expiring.secret, 'GET', routes.listStagedDownloads.path)).status).toBe(200);
    const current = now;
    now = new Date(Date.parse(current) + 2 * 60 * 60_000).toISOString();
    try {
      expect((await keyed(expiring.secret, 'POST', path, body)).status).toBe(401);
      expect((await keyed(expiring.secret, 'GET', routes.listStagedDownloads.path)).status).toBe(401);
    } finally {
      now = current;
    }
    const uploads = (await database.db.select().from(changeProposalDownloadUploads)).filter((row) => row.apiKeyId === revoked.apiKey.id || row.apiKeyId === expiring.apiKey.id);
    expect(uploads).toEqual([]);
  });

  it('never gives a key a signed read of any stored object', async () => {
    expect(storage.calls.filter((call) => call.method === 'presignGet')).toEqual([]);
    const listed = await keyed(direct.secret, 'GET', routes.listProductDownloads.path.replace(':productId', digital));
    const text = await listed.text();
    expect(text).not.toContain(STORAGE_ORIGIN);
    expect(text).not.toContain('product-downloads/');
  });
});
