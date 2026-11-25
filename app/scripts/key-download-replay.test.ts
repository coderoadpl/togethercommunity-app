import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import {
  changeProposalDownloadDeletions,
  changeProposalDownloadFiles,
  changeProposalDownloadUploads,
  productDownloadAssets,
  tenantAdmins,
  tenants,
} from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createShopManagementClient, isProposedChange, type ShopManagementClient } from '#core/client/index.js';
import { API_ROUTES, apiKeysShopManagementCreateOutputSchema, type ChangeProposalProposedOutput } from '#core/contract/index.js';
import type { AppError, Result } from '#core/domain/index.js';
import type { TenantSecretResolver } from '#core/server/index.js';
import { createObjectStorageFake, fakeStorageSecrets, type FakeObjectStorage } from '#core/server/testing/object-storage-fake.js';

import { buildApp } from '../apps/server/src/app.js';
import { createDeps } from '../apps/server/src/composition.js';
import { envSchema } from '../apps/server/src/env.js';

const baseUrl = 'http://localhost:48732';
const workspaceHost = 'acme.localhost:48732';
const email = 'key-download-replay-owner@example.test';
const password = 'key-download-replay-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const STORAGE_ORIGIN = 'https://storage.example.test';
const FIRST = new TextEncoder().encode('%PDF-1.7\nfirst edition\n%%EOF\n');
const SECOND = new TextEncoder().encode('%PDF-1.7\nsecond edition, revised\n%%EOF\n');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let ownerToken: string;
let storage: FakeObjectStorage;
const storagePuts: string[] = [];

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });

const unwrapped = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

const created = (result: Result<ChangeProposalProposedOutput | ({ outcome: 'applied' } & { product: { id: string } }), AppError>): string => {
  const value = unwrapped(result);
  if (isProposedChange(value)) throw new Error('Expected a live change, got a proposal');
  return value.product.id;
};

const attachedAsset = <A extends { asset: unknown }>(result: Result<ChangeProposalProposedOutput | ({ outcome: 'applied' } & A), AppError>): A['asset'] => {
  const value = unwrapped(result);
  if (isProposedChange(value)) throw new Error('Expected a live change, got a proposal');
  return value.asset;
};

const storageKeyOf = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1));

const bytesOf = async (body: unknown): Promise<Uint8Array | null> => {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return null;
};

const workspaceFetch: typeof fetch = async (input, init) => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (target.startsWith(`${STORAGE_ORIGIN}/`) && init?.method === 'PUT') {
    const key = storageKeyOf(target);
    const bytes = await bytesOf(init.body);
    const headers = new Headers(init.headers);
    if (bytes === null || storage.signedLengths.get(key) !== bytes.byteLength || headers.get('content-length') !== String(bytes.byteLength)) {
      return new Response(null, { status: 403 });
    }
    storagePuts.push(key);
    storage.objects.set(key, { bytes, contentType: headers.get('content-type') ?? '' });
    return new Response(null, { status: 200 });
  }
  const headers = new Headers(init?.headers);
  headers.set('host', workspaceHost);
  return app.request(target, { ...init, headers });
};

const ownerRequest = (method: string, path: string, body?: unknown) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host: workspaceHost, authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const fileRows = async () => ({
  assets: (await database.db.select().from(productDownloadAssets))
    .filter((row) => row.tenantId === 'acme')
    .map((row) => ({ id: row.id, productId: row.productId, lineageId: row.lineageId, versionNumber: row.versionNumber, latest: row.supersededAt === null, storageKey: row.storageKey, sha256: row.sha256, status: row.status }))
    .sort((left, right) => left.id.localeCompare(right.id)),
  staged: (await database.db.select().from(changeProposalDownloadFiles)).map((row) => row.id).sort(),
  uploads: (await database.db.select().from(changeProposalDownloadUploads)).map((row) => ({ id: row.id, kind: row.kind, state: row.state })),
  deletions: (await database.db.select().from(changeProposalDownloadDeletions)).map((row) => row.objectKey),
});

beforeAll(async () => {
  database = await createTestDatabase(
    'together_key_download_replay_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const env = envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'key-download-replay-test-secret-at-least-32-characters',
  });
  const deps = createDeps(env, { db: database.db, clock: { nowIso: () => now } });
  const withFakeStorage = (resolver: TenantSecretResolver): TenantSecretResolver => ({
    resolve: async (tenantId, key) => key === 's3.configuration' ? fakeStorageSecrets.resolve() : resolver.resolve(tenantId, key),
  });
  storage = createObjectStorageFake();
  app = buildApp({ ...deps, dispatchEmail: () => undefined, storage: storage.storage, secretResolver: withFakeStorage(deps.secretResolver) });
  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Download Replay Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  const ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  await database.db.insert(tenants).values({ id: 'acme', slug: 'acme', name: 'Acme', createdAt: now });
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme', tenantId: 'acme', userId: ownerId, role: 'owner' });
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('download file replay with a direct-mode key', () => {
  it('uploads, attaches, lists, replaces, removes and copies files live, and the stored rows and objects follow each step', async () => {
    const issued = await ownerRequest(API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
      name: 'Download agent', scopes: ['shop:catalog:read', 'shop:catalog:write'], expiresAt, mode: 'direct',
    });
    expect(issued.status).toBe(200);
    const key = envelope(apiKeysShopManagementCreateOutputSchema).parse(await issued.json()).data;
    const agent: ShopManagementClient = createShopManagementClient({ baseUrl, apiKey: key.secret, fetchImpl: workspaceFetch });
    const keyFiles = `acme/product-downloads/key-files/${key.apiKey.id}/`;

    const guide = created(await agent.createProduct({ title: 'Field guide', type: 'digital_download', priceCents: 4900, currency: 'PLN' }));
    const sequel = created(await agent.createProduct({ title: 'Field guide, workbook', type: 'digital_download', priceCents: 2900, currency: 'PLN' }));
    expect(unwrapped(await agent.listProductDownloads(guide)).assets).toEqual([]);

    const first = unwrapped(await agent.stageProductDownload({ fileName: 'field-guide.pdf', contentType: 'application/pdf', sizeBytes: FIRST.byteLength, body: new Blob([FIRST]) })).file;
    expect(storagePuts).toHaveLength(1);
    expect(storagePuts[0]?.startsWith(`acme/product-downloads/key-uploads/${key.apiKey.id}/`)).toBe(true);
    expect(storage.keysUnder('acme/product-downloads/key-uploads/')).toEqual([]);
    expect(storage.keysUnder(keyFiles)).toEqual([`${keyFiles}${first.id}/field-guide.pdf`]);
    expect(await fileRows()).toMatchObject({ assets: [], staged: [first.id], uploads: [{ kind: 'upload', state: 'completed' }], deletions: [] });
    expect(unwrapped(await agent.listStagedDownloads()).files.map((file) => file.id)).toEqual([first.id]);

    const attached = attachedAsset(await agent.addProductDownload({ productId: guide, stagedFileId: first.id }));
    expect(attached).toMatchObject({ id: first.id, productId: guide, versionNumber: 1, status: 'ready' });
    expect((await fileRows()).assets).toEqual([
      { id: first.id, productId: guide, lineageId: first.id, versionNumber: 1, latest: true, storageKey: `${keyFiles}${first.id}/field-guide.pdf`, sha256: first.sha256, status: 'ready' },
    ]);
    expect((await fileRows()).staged).toEqual([]);
    expect(unwrapped(await agent.listStagedDownloads()).files).toEqual([]);
    expect(unwrapped(await agent.listProductDownloads(guide)).assets.map((asset) => [asset.id, asset.versionNumber, asset.supersededAt])).toEqual([[first.id, 1, null]]);

    const second = unwrapped(await agent.stageProductDownload({ fileName: 'field-guide.pdf', contentType: 'application/pdf', sizeBytes: SECOND.byteLength, body: new Blob([SECOND]) })).file;
    const replaced = attachedAsset(await agent.replaceProductDownload({ productId: guide, replacesAssetId: first.id, stagedFileId: second.id, versionNote: 'Revised' }));
    expect(replaced).toMatchObject({ id: second.id, lineageId: first.id, versionNumber: 2, versionNote: 'Revised', supersededAt: null });
    const afterReplace = await fileRows();
    expect(afterReplace.assets.map((asset) => [asset.id, asset.versionNumber, asset.latest])).toEqual(
      [[first.id, 1, false], [second.id, 2, true]].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );
    expect(storage.objects.get(`${keyFiles}${second.id}/field-guide.pdf`)?.bytes).toEqual(SECOND);

    unwrapped(await agent.removeProductDownload({ productId: guide, assetId: second.id }));
    const afterRemove = await fileRows();
    expect(afterRemove.assets.map((asset) => [asset.id, asset.versionNumber, asset.latest])).toEqual([[first.id, 1, true]]);
    expect(afterRemove.deletions).toEqual([]);
    expect(storage.keysUnder(`${keyFiles}${second.id}/`)).toEqual([]);
    expect(unwrapped(await agent.listProductDownloads(guide)).assets.map((asset) => asset.id)).toEqual([first.id]);

    const copy = unwrapped(await agent.copyProductDownload({ productId: guide, assetId: first.id })).file;
    expect(copy).toMatchObject({ sha256: null, copiedFrom: { productId: guide, assetId: first.id, versionNumber: 1 }, sizeBytes: FIRST.byteLength });
    expect(storage.objects.get(`${keyFiles}${copy.id}/field-guide.pdf`)?.bytes).toEqual(FIRST);
    const copied = attachedAsset(await agent.addProductDownload({ productId: sequel, stagedFileId: copy.id }));
    expect(copied).toMatchObject({ id: copy.id, productId: sequel, versionNumber: 1 });
    const finalRows = await fileRows();
    expect(finalRows.assets.map((asset) => [asset.productId, asset.id, asset.storageKey])).toEqual(
      [[guide, first.id, `${keyFiles}${first.id}/field-guide.pdf`], [sequel, copy.id, `${keyFiles}${copy.id}/field-guide.pdf`]]
        .sort((left, right) => String(left[1]).localeCompare(String(right[1]))),
    );
    expect(finalRows.assets.find((asset) => asset.id === copy.id)?.sha256).toBe(first.sha256);
    expect(finalRows.staged).toEqual([]);
    expect(finalRows.uploads.map((upload) => upload.kind).sort()).toEqual(['copy', 'upload', 'upload']);
    expect(unwrapped(await agent.listProductDownloads(sequel)).assets.map((asset) => asset.id)).toEqual([copy.id]);
    expect(storage.objects.get(`${keyFiles}${first.id}/field-guide.pdf`)?.bytes).toEqual(FIRST);
    expect(storage.calls.filter((call) => call.method === 'presignGet')).toEqual([]);
  });
});
