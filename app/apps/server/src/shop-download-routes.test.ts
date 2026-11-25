import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createChangeProposalTransaction } from '#adapters/db/change-proposal-transaction.js';
import { createTenantSecretRepository } from '#adapters/db/repositories.js';
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
  changeProposalApproveOutputSchema,
  changeProposalProposedOutputSchema,
  changeProposalShowOutputSchema,
  SHOP_CATALOG_ROUTES,
  SHOP_DOWNLOAD_ROUTES,
  SHOP_PROPOSAL_ROUTES,
  shopCatalogContracts,
  shopDownloadContracts,
  shopProposalContracts,
} from '#core/contract/index.js';
import { sweepKeyDownloadFiles, type TenantSecretResolver } from '#core/server/index.js';
import { createObjectStorageFake, fakeStorageSecrets, type FakeObjectStorage } from '#core/server/testing/object-storage-fake.js';

import { buildApp } from './app.js';
import { createDeps, type AppDeps } from './composition.js';
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
const LOCK_WAIT_MS = 100;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let appDeps: AppDeps;
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
  const created = createDeps(env, { db: database.db, clock: { nowIso: () => now }, changeProposalBounds: { lockWaitMs: LOCK_WAIT_MS } });
  storage = createObjectStorageFake();
  const withFakeStorage = (resolver: TenantSecretResolver): TenantSecretResolver => ({
    resolve: async (tenantId, key) => key === 's3.configuration' ? fakeStorageSecrets.resolve() : resolver.resolve(tenantId, key),
  });
  const secretCrypto = createSecretCrypto(env.SECRETS_MASTER_KEY);
  appDeps = {
    ...created,
    storage: storage.storage,
    secretResolver: withFakeStorage(created.secretResolver),
    changeProposalTransaction: createChangeProposalTransaction(database.db, created.logger, (connection) =>
      withFakeStorage(createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto)), { lockWaitMs: LOCK_WAIT_MS }),
  };
  app = buildApp(appDeps);
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

  it('records one key history row for each download write and none for the staged list', async () => {
    const historian = await createShopKey(WRITE_SCOPES, 'direct');
    const requests: Array<[string, string, string, unknown, string | null]> = [
      ['POST', routes.uploadStagedDownload.path, routes.uploadStagedDownload.path, { fileName: 'history.pdf', contentType: 'application/pdf', sizeBytes: 10 }, null],
      ['POST', routes.completeStagedDownload.path, routes.completeStagedDownload.path, { uploadId: 'unknown-upload' }, null],
      ['POST', routes.copyStagedDownload.path, routes.copyStagedDownload.path, { productId: digital, assetId: 'unknown-asset' }, digital],
      ['GET', routes.listStagedDownloads.path, routes.listStagedDownloads.path, undefined, null],
      ['DELETE', routes.discardStagedDownload.path, routes.discardStagedDownload.path.replace(':id', 'unknown-staged'), undefined, 'unknown-staged'],
      ['POST', routes.addProductDownload.path, routes.addProductDownload.path, { productId: digital, stagedFileId: 'unknown-staged' }, digital],
      ['POST', routes.replaceProductDownload.path, routes.replaceProductDownload.path, { productId: digital, replacesAssetId: ownerAsset.id, stagedFileId: 'unknown-staged' }, digital],
      ['POST', routes.removeProductDownload.path, routes.removeProductDownload.path, { productId: digital, assetId: 'unknown-asset' }, digital],
    ];
    expect(requests.map(([method, route]) => `${method} ${route}`).sort())
      .toEqual(Object.values(routes).filter((route) => route.scope === 'shop:catalog:write').map((route) => `${route.method} ${route.path}`).sort());
    const historyOf = async () => (await database.db.select().from(shopManagementKeyEvents)).filter((event) => event.apiKeyId === historian.apiKey.id);
    for (const [method, route, path, body, resourceId] of requests) {
      const before = await historyOf();
      await keyed(historian.secret, method, path, body);
      const added = (await historyOf()).filter((event) => !before.some((known) => known.id === event.id));
      expect(added.map((event) => [event.kind, event.method, event.route, event.resourceId]), `${method} ${route}`)
        .toEqual(method === 'GET' ? [] : [['request', method, route, resourceId]]);
    }
  });

  it('answers a start with 503 and Retry-After while the workspace staging lock is held, and reserves nothing', async () => {
    const waiting = await createShopKey(WRITE_SCOPES, 'direct');
    const response = await database.db.transaction(async (tx) => {
      await tx.execute("select pg_advisory_xact_lock(hashtextextended('key-download-files:acme', 0))");
      return keyed(waiting.secret, 'POST', routes.uploadStagedDownload.path, { fileName: 'busy.pdf', contentType: 'application/pdf', sizeBytes: 10 });
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await errorOf(response)).toMatchObject({ code: 'unavailable' });
    expect((await database.db.select().from(changeProposalDownloadUploads)).filter((row) => row.apiKeyId === waiting.apiKey.id)).toEqual([]);
    expect((await keyed(waiting.secret, 'POST', routes.uploadStagedDownload.path, { fileName: 'free.pdf', contentType: 'application/pdf', sizeBytes: 10 })).status).toBe(200);
  });

  it('answers 409 to a completion sent again after the file was attached, and after the sweep settled the upload', async () => {
    const finisher = await createShopKey(WRITE_SCOPES, 'direct');
    const upload = await startUpload(finisher.secret, { fileName: 'settled.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength });
    storage.objects.set(storageKeyOf(upload.url), { bytes: PDF, contentType: 'application/pdf' });
    const completed = await keyed(finisher.secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id });
    const staged = envelope(contracts.completeStagedDownload.output).parse(await completed.json()).data.file;
    expect((await keyed(finisher.secret, 'POST', routes.addProductDownload.path, { productId: secondDigital, stagedFileId: staged.id })).status).toBe(200);
    const afterAttach = await keyed(finisher.secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id });
    expect(afterAttach.status).toBe(409);
    expect((await errorOf(afterAttach)).message).toBe('This upload was completed and its file is no longer staged');
    const current = now;
    now = new Date(Date.parse(current) + 21 * 60_000).toISOString();
    try {
      const swept = await sweepKeyDownloadFiles({
        keyDownloadFiles: appDeps.keyDownloadFiles, storage: appDeps.storage, secretResolver: appDeps.secretResolver, clock: appDeps.clock, logger: { error: () => undefined },
      });
      expect(swept.ok).toBe(true);
      expect((await database.db.select().from(changeProposalDownloadUploads)).find((row) => row.id === upload.id)?.state).toBe('settled');
      const afterSweep = await keyed(finisher.secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id });
      expect(afterSweep.status).toBe(409);
      expect((await errorOf(afterSweep)).message).toBe('This upload can no longer be completed; start a new upload');
    } finally {
      now = current;
    }
    expect((await database.db.select().from(productDownloadAssets)).find((row) => row.id === staged.id)?.productId).toBe(secondDigital);
  });

  it('refuses the copy of a key with catalogue write and without catalogue read, and stages nothing', async () => {
    const writer = await createShopKey(['shop:catalog:write'], 'direct');
    const response = await keyed(writer.secret, 'POST', routes.copyStagedDownload.path, { productId: digital, assetId: ownerAsset.id });
    expect(response.status).toBe(403);
    expect((await database.db.select().from(changeProposalDownloadUploads)).filter((row) => row.apiKeyId === writer.apiKey.id)).toEqual([]);
  });

  it('refuses the discard of a staged file id longer than 200 characters before any lookup', async () => {
    const response = await keyed(direct.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', 'x'.repeat(201)));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toBe('Invalid staged file discard');
  });
});

describe('a propose-mode key on the download file routes', () => {
  it('stages, lists, copies and discards its own private files, and no product gains a file', async () => {
    const assetsBefore = JSON.stringify((await database.db.select().from(productDownloadAssets)).sort((left, right) => left.id.localeCompare(right.id)));
    const staged = await stageUpload(proposer.secret, PDF, 'proposed.pdf');
    expect(staged).toMatchObject({ fileName: 'proposed.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength, copiedFrom: null });
    expect(storage.keysUnder(`acme/product-downloads/key-files/${proposer.apiKey.id}/${staged.id}/`)).toHaveLength(1);
    const copied = await keyed(proposer.secret, 'POST', routes.copyStagedDownload.path, { productId: digital, assetId: ownerAsset.id });
    expect(copied.status).toBe(200);
    const copy = envelope(contracts.copyStagedDownload.output).parse(await copied.json()).data.file;
    expect(copy).toMatchObject({ sha256: null, copiedFrom: { productId: digital, assetId: ownerAsset.id, versionNumber: 1 } });
    const listed = await keyed(proposer.secret, 'GET', routes.listStagedDownloads.path);
    expect(envelope(contracts.listStagedDownloads.output).parse(await listed.json()).data.files.map((file) => file.id).sort()).toEqual([staged.id, copy.id].sort());
    for (const id of [staged.id, copy.id]) {
      expect((await keyed(proposer.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', id))).status).toBe(200);
    }
    expect(storage.keysUnder(`acme/product-downloads/key-files/${proposer.apiKey.id}/`)).toEqual([]);
    expect(JSON.stringify((await database.db.select().from(productDownloadAssets)).sort((left, right) => left.id.localeCompare(right.id)))).toBe(assetsBefore);
    expect(storage.calls.filter((call) => call.method === 'presignGet')).toEqual([]);
  });

  it('proposes an attach, a replacement and a removal instead of applying them, holds each staged file, and an approval after the key discarded its file changes nothing', async () => {
    const added = await stageUpload(proposer.secret, PDF, 'added.pdf');
    const replacing = await stageUpload(proposer.secret, PDF, 'replacing.pdf');
    const assetsBefore = JSON.stringify((await database.db.select().from(productDownloadAssets)).sort((left, right) => left.id.localeCompare(right.id)));
    const objectsBefore = storage.keysUnder('acme/product-downloads/');
    const receipts = [];
    for (const [path, body, operation] of [
      [routes.addProductDownload.path, { productId: digital, stagedFileId: added.id, versionNote: 'Workbook' }, 'download.add'],
      [routes.replaceProductDownload.path, { productId: digital, replacesAssetId: ownerAsset.id, stagedFileId: replacing.id }, 'download.replace'],
      [routes.removeProductDownload.path, { productId: digital, assetId: ownerAsset.id }, 'download.remove'],
    ] as const) {
      const response = await keyed(proposer.secret, 'POST', path, body);
      expect(response.status, path).toBe(202);
      const text = await response.text();
      expect(text, path).not.toContain('product-downloads/');
      const receipt = envelope(changeProposalProposedOutputSchema).parse(JSON.parse(text)).data.proposal;
      expect(receipt, path).toMatchObject({ operation, status: 'pending', target: { kind: 'product', id: digital } });
      receipts.push(receipt);
    }
    expect(JSON.stringify((await database.db.select().from(productDownloadAssets)).sort((left, right) => left.id.localeCompare(right.id)))).toBe(assetsBefore);
    expect(storage.keysUnder('acme/product-downloads/')).toEqual(objectsBefore);
    const held = (await database.db.select().from(changeProposalDownloadFiles)).filter((row) => row.apiKeyId === proposer.apiKey.id);
    expect(Object.fromEntries(held.map((row) => [row.id, row.proposalId]))).toEqual({ [added.id]: receipts[0]?.id, [replacing.id]: receipts[1]?.id });
    expect((await keyed(proposer.secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', added.id))).status).toBe(200);
    const [addReceipt, ...others] = receipts;
    if (addReceipt === undefined) throw new Error('missing receipt');
    const approved = await sessionRequest(API_ROUTES.changeProposalApprove.method, API_PATHS.changeProposalApprove.replace(':id', addReceipt.id), {});
    expect(approved.status).toBe(200);
    expect(envelope(changeProposalApproveOutputSchema).parse(await approved.json()).data.proposal).toMatchObject({ status: 'stale', appliedResourceId: null });
    const shown = envelope(changeProposalShowOutputSchema).parse(await (await sessionRequest('GET', API_PATHS.changeProposal.replace(':id', addReceipt.id))).json()).data.proposal;
    expect(shown.events.map((event) => event.note).find((note) => note?.startsWith('file_unavailable: ') === true)).toBe(`file_unavailable: The proposed file ${added.id} is no longer available, so the proposal cannot be applied; nothing was changed`);
    expect(JSON.stringify((await database.db.select().from(productDownloadAssets)).sort((left, right) => left.id.localeCompare(right.id)))).toBe(assetsBefore);
    for (const receipt of others) {
      expect((await keyed(proposer.secret, 'POST', SHOP_PROPOSAL_ROUTES.withdrawProposal.path.replace(':id', receipt.id), {})).status).toBe(200);
    }
    expect((await database.db.select().from(changeProposalDownloadFiles)).filter((row) => row.apiKeyId === proposer.apiKey.id)).toEqual([]);
  });

  it('refuses to propose a file of another key, a file another pending proposal holds and an unknown file, naming the staged file and storing nothing', async () => {
    const otherProposer = await createShopKey(WRITE_SCOPES, 'propose');
    const own = await stageUpload(proposer.secret, PDF, 'own.pdf');
    const others = await stageUpload(otherProposer.secret, PDF, 'others.pdf');
    const byDirect = await stageUpload(direct.secret, PDF, 'direct.pdf');
    const first = await keyed(proposer.secret, 'POST', routes.addProductDownload.path, { productId: digital, stagedFileId: own.id });
    expect(first.status).toBe(202);
    const proposalsBefore = (await database.db.select().from(changeProposals)).length;
    for (const [stagedFileId, label] of [[others.id, 'another propose-mode key'], [byDirect.id, 'a direct-mode key'], [own.id, 'held'], ['unknown-staged', 'unknown']] as const) {
      const response = await keyed(proposer.secret, 'POST', routes.addProductDownload.path, { productId: secondDigital, stagedFileId });
      expect(response.status, label).toBe(400);
      expect(JSON.stringify(await response.json()), label).toContain('"stagedFileId":["Must be a file this key staged that no other pending proposal attaches"]');
    }
    expect((await database.db.select().from(changeProposals)).length).toBe(proposalsBefore);
    const receipt = envelope(changeProposalProposedOutputSchema).parse(await first.json()).data.proposal;
    expect((await keyed(proposer.secret, 'POST', SHOP_PROPOSAL_ROUTES.withdrawProposal.path.replace(':id', receipt.id), {})).status).toBe(200);
    for (const [secret, id] of [[otherProposer.secret, others.id], [direct.secret, byDirect.id]] as const) {
      expect((await keyed(secret, 'DELETE', routes.discardStagedDownload.path.replace(':id', id))).status).toBe(200);
    }
  });

  it('adds a file proposal to a group, where it may name a product an earlier item creates', async () => {
    const created = await keyed(proposer.secret, 'POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title: 'New workbook' });
    expect(created.status).toBe(201);
    const group = envelope(shopProposalContracts.createGroup.output).parse(await created.json()).data.group;
    const product = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Workbook', type: 'digital_download', priceCents: 1000 }, acmeHost, { 'x-proposal-group': group.id });
    expect(product.status).toBe(202);
    const productProposal = envelope(changeProposalProposedOutputSchema).parse(await product.json()).data.proposal;
    const staged = await stageUpload(proposer.secret, PDF, 'grouped.pdf');
    const attach = await keyed(proposer.secret, 'POST', routes.addProductDownload.path, { productId: `$proposal:${productProposal.id}`, stagedFileId: staged.id }, acmeHost, { 'x-proposal-group': group.id });
    expect(attach.status).toBe(202);
    const receipt = envelope(changeProposalProposedOutputSchema).parse(await attach.json()).data;
    expect(receipt.proposal).toMatchObject({ operation: 'download.add', groupId: group.id, target: { kind: 'product', id: `$proposal:${productProposal.id}` } });
    expect(receipt.group?.items.map((item) => item.operation)).toEqual(['product.create', 'download.add']);
    expect((await keyed(proposer.secret, 'POST', SHOP_PROPOSAL_ROUTES.withdrawGroup.path.replace(':id', group.id), {})).status).toBe(200);
    expect((await database.db.select().from(changeProposalDownloadFiles)).find((row) => row.id === staged.id)).toBeUndefined();
  });

  it('refuses staging to a propose-mode key without catalogue write', async () => {
    const settingsOnly = await createShopKey(['shop:settings:read', 'shop:settings:write'], 'propose');
    const response = await keyed(settingsOnly.secret, 'POST', routes.uploadStagedDownload.path, { fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength });
    expect(response.status).toBe(403);
    expect((await database.db.select().from(changeProposalDownloadUploads)).filter((row) => row.apiKeyId === settingsOnly.apiKey.id)).toEqual([]);
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

  const everyRoute = (): Array<[string, string, unknown]> => [
    ['POST', routes.uploadStagedDownload.path, { fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength }],
    ['POST', routes.completeStagedDownload.path, { uploadId: 'unknown-upload' }],
    ['POST', routes.copyStagedDownload.path, { productId: digital, assetId: ownerAsset.id }],
    ['GET', routes.listStagedDownloads.path, undefined],
    ['DELETE', routes.discardStagedDownload.path.replace(':id', 'unknown-staged'), undefined],
    ['GET', routes.listProductDownloads.path.replace(':productId', digital), undefined],
    ['POST', routes.addProductDownload.path, { productId: digital, stagedFileId: 'unknown-staged' }],
    ['POST', routes.replaceProductDownload.path, { productId: digital, replacesAssetId: ownerAsset.id, stagedFileId: 'unknown-staged' }],
    ['POST', routes.removeProductDownload.path, { productId: digital, assetId: 'unknown-asset' }],
  ];

  it('refuses a session, a request without a key, a revoked key and an expired key on every download file route', async () => {
    expect(everyRoute()).toHaveLength(Object.keys(routes).length);
    const revoked = await createShopKey(WRITE_SCOPES, 'direct');
    const revoke = await sessionRequest(API_ROUTES.apiKeysShopManagementRevoke.method, API_PATHS.apiKeysShopManagementRevoke.replace(':id', revoked.apiKey.id));
    expect(revoke.status).toBe(200);
    const expiring = await createShopKey(WRITE_SCOPES, 'direct', acmeHost, new Date(Date.parse(now) + 60 * 60_000).toISOString());
    expect((await keyed(expiring.secret, 'GET', routes.listStagedDownloads.path)).status).toBe(200);
    const before = await fileState();
    for (const [method, path, body] of everyRoute()) {
      expect((await sessionRequest(method, path, body)).status, `session ${method} ${path}`).toBe(401);
      expect((await keyed(null, method, path, body)).status, `no key ${method} ${path}`).toBe(401);
      expect((await keyed(revoked.secret, method, path, body)).status, `revoked ${method} ${path}`).toBe(401);
    }
    const current = now;
    now = new Date(Date.parse(current) + 2 * 60 * 60_000).toISOString();
    try {
      for (const [method, path, body] of everyRoute()) {
        expect((await keyed(expiring.secret, method, path, body)).status, `expired ${method} ${path}`).toBe(401);
      }
    } finally {
      now = current;
    }
    expect(await fileState()).toBe(before);
    const history = (await database.db.select().from(shopManagementKeyEvents))
      .filter((event) => event.kind === 'request' && (event.apiKeyId === revoked.apiKey.id || event.apiKeyId === expiring.apiKey.id));
    expect(history).toEqual([]);
  });

  it('never gives a key a signed read of any stored object', async () => {
    expect(storage.calls.filter((call) => call.method === 'presignGet')).toEqual([]);
    const listed = await keyed(direct.secret, 'GET', routes.listProductDownloads.path.replace(':productId', digital));
    const text = await listed.text();
    expect(text).not.toContain(STORAGE_ORIGIN);
    expect(text).not.toContain('product-downloads/');
  });
});
