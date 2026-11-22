import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createChangeProposalTransaction } from '#adapters/db/change-proposal-transaction.js';
import { createTenantSecretRepository } from '#adapters/db/repositories.js';
import { changeProposalDownloadFiles, members, productDownloadAssets, tenantAdmins, tenants } from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  changeProposalApproveOutputSchema,
  changeProposalFileOutputSchema,
  changeProposalProposedOutputSchema,
  changeProposalShowOutputSchema,
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

const baseUrl = 'http://localhost:48732';
const acmeHost = 'acme.localhost:48732';
const studioHost = 'studio.localhost:48732';
const password = 'proposal-file-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const WRITE_SCOPES = ['shop:catalog:read', 'shop:catalog:write'];
const PDF = new TextEncoder().encode('%PDF-1.7\nproposed workbook\n%%EOF\n');
const routes = SHOP_DOWNLOAD_ROUTES;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let storage: FakeObjectStorage;
let ownerToken: string;
let adminToken: string;
let digital: string;
const ownerAsset = { id: 'owner-guide', key: 'acme/product-downloads/owner/guide.pdf' };

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });

const sessionRequest = (token: string, method: string, path: string, body?: unknown, host = acmeHost, extra: Record<string, string> = {}) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createShopKey = async (scopes: string[], mode: 'direct' | 'propose', host = acmeHost) => {
  const response = await sessionRequest(ownerToken, API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
    name: `Files ${mode}`, scopes, expiresAt, mode,
  }, host);
  expect(response.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await response.json()).data;
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

const withFakeStorage = (resolver: TenantSecretResolver): TenantSecretResolver => ({
  resolve: async (tenantId, key) => key === 's3.configuration' ? fakeStorageSecrets.resolve() : resolver.resolve(tenantId, key),
});

const storageKeyOf = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1));

const stage = async (secret: string, fileName: string, host = acmeHost) => {
  const started = await keyed(secret, 'POST', routes.uploadStagedDownload.path, { fileName, contentType: 'application/pdf', sizeBytes: PDF.byteLength }, host);
  expect(started.status).toBe(200);
  const upload = envelope(shopDownloadContracts.uploadStagedDownload.output).parse(await started.json()).data.upload;
  storage.objects.set(storageKeyOf(upload.url), { bytes: PDF, contentType: 'application/pdf' });
  const completed = await keyed(secret, 'POST', routes.completeStagedDownload.path, { uploadId: upload.id }, host);
  expect(completed.status).toBe(200);
  return envelope(shopDownloadContracts.completeStagedDownload.output).parse(await completed.json()).data.file;
};

const proposeAdd = async (secret: string, stagedFileId: string, productId = digital, host = acmeHost) => {
  const response = await keyed(secret, 'POST', routes.addProductDownload.path, { productId, stagedFileId }, host);
  expect(response.status).toBe(202);
  return envelope(changeProposalProposedOutputSchema).parse(await response.json()).data.proposal;
};

const linkPath = (proposalId: string, fileId: string): string =>
  API_PATHS.changeProposalFile.replace(':id', proposalId).replace(':fileId', fileId);

const stagedObjectKey = async (fileId: string): Promise<string> => {
  const row = (await database.db.select().from(changeProposalDownloadFiles)).find((candidate) => candidate.id === fileId);
  if (row === undefined) throw new Error(`No staged row ${fileId}`);
  return row.objectKey;
};

beforeAll(async () => {
  database = await createTestDatabase(
    'together_change_proposal_file_routes_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const env = envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'proposal-file-routes-test-secret-at-least-32-characters',
  });
  const deps = createDeps(env, { db: database.db, clock: { nowIso: () => now } });
  const secretCrypto = createSecretCrypto(env.SECRETS_MASTER_KEY);
  storage = createObjectStorageFake();
  app = buildApp({
    ...deps,
    storage: storage.storage,
    secretResolver: withFakeStorage(deps.secretResolver),
    changeProposalTransaction: createChangeProposalTransaction(database.db, deps.logger, (connection) =>
      withFakeStorage(createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto))),
  });
  const owner = await signUp('proposal-file-owner@example.test', 'File Owner');
  const admin = await signUp('proposal-file-admin@example.test', 'File Admin');
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: owner.id, role: 'owner' });
  }
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme-admin', tenantId: 'acme', userId: admin.id, role: 'admin' });
  ownerToken = owner.token;
  adminToken = admin.token;
  const direct = await createShopKey(WRITE_SCOPES, 'direct');
  const created = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Field guide', type: 'digital_download', priceCents: 1000 });
  expect(created.status).toBe(200);
  digital = envelope(shopCatalogContracts.createProduct.output).parse(await created.json()).data.product.id;
  await database.db.insert(productDownloadAssets).values({
    id: ownerAsset.id, tenantId: 'acme', productId: digital, lineageId: ownerAsset.id, versionNumber: 1, versionNote: null, supersededAt: null, replacesAssetId: null,
    fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength, storageKey: ownerAsset.key, status: 'ready', createdAt: now, sha256: null,
  });
  storage.objects.set(ownerAsset.key, { bytes: PDF, contentType: 'application/pdf' });
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('the owner link to a proposed file', () => {
  it('answers the verified owner a 60-second signed download that forces an opaque attachment, uncached and without a referrer', async () => {
    const key = await createShopKey(WRITE_SCOPES, 'propose');
    const staged = await stage(key.secret, 'Workbook "draft" 2.pdf');
    const proposal = await proposeAdd(key.secret, staged.id);
    const response = await sessionRequest(ownerToken, 'GET', linkPath(proposal.id, staged.id));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const { download } = envelope(changeProposalFileOutputSchema).parse(await response.json()).data;
    expect(download).toMatchObject({ fileName: 'Workbook "draft" 2.pdf', sizeBytes: PDF.byteLength, expiresAt: '2026-11-15T10:01:00.000Z' });
    const signed = new URL(download.url);
    expect(decodeURIComponent(signed.pathname.slice(1))).toBe(await stagedObjectKey(staged.id));
    expect(signed.searchParams.get('response-content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('Workbook "draft" 2.pdf')}`);
    expect(signed.searchParams.get('response-content-type')).toBe('application/octet-stream');
    expect(signed.searchParams.get('response-cache-control')).toBe('no-store');
    expect(storage.calls.filter((call) => call.method === 'presignGet').map((call) => call.key)).toEqual([await stagedObjectKey(staged.id)]);
  });

  it('refuses an admin, an unverified owner, an owner viewing as a member, every key and a request without a session', async () => {
    const key = await createShopKey(WRITE_SCOPES, 'propose');
    const staged = await stage(key.secret, 'refused.pdf');
    const proposal = await proposeAdd(key.secret, staged.id);
    const path = linkPath(proposal.id, staged.id);
    const presigns = storage.calls.filter((call) => call.method === 'presignGet').length;
    expect((await sessionRequest(adminToken, 'GET', path)).status).toBe(403);
    const unverified = await signUp('proposal-file-unverified@example.test', 'Unverified Owner');
    await database.db.insert(tenantAdmins).values({ id: 'grant-acme-unverified', tenantId: 'acme', userId: unverified.id, role: 'owner' });
    await database.db.execute(`update "user" set email_verified = false where id = '${unverified.id}'`);
    expect([401, 403]).toContain((await sessionRequest(unverified.token, 'GET', path)).status);
    await database.db.insert(members).values({ id: 'member-acme-files', tenantId: 'acme', userId: 'member-user', email: 'member@example.test', createdAt: now });
    const started = await sessionRequest(ownerToken, 'POST', API_PATHS.impersonationStart, { memberId: 'member-acme-files', reason: 'checking the member view' });
    expect(started.status).toBe(200);
    const memberView = /^([^;]+)/.exec(started.headers.get('set-cookie') ?? '')?.[1];
    if (memberView === undefined) throw new Error('missing member view cookie');
    expect([401, 403]).toContain((await sessionRequest(ownerToken, 'GET', path, undefined, acmeHost, { cookie: memberView })).status);
    await sessionRequest(ownerToken, 'POST', API_PATHS.impersonationStop, undefined, acmeHost, { cookie: memberView });
    for (const secret of [key.secret, (await createShopKey(WRITE_SCOPES, 'direct')).secret]) {
      expect([401, 403]).toContain((await keyed(secret, 'GET', path)).status);
    }
    expect((await app.request(`${baseUrl}${path}`, { headers: { host: acmeHost } })).status).toBe(401);
    expect(storage.calls.filter((call) => call.method === 'presignGet')).toHaveLength(presigns);
    expect((await sessionRequest(ownerToken, 'GET', path)).status).toBe(200);
  });

  it('answers 404 for another workspace, a file the proposal does not attach, a decided proposal and a file gone from the storage', async () => {
    const key = await createShopKey(WRITE_SCOPES, 'propose');
    const staged = await stage(key.secret, 'gone.pdf');
    const unrelated = await stage(key.secret, 'unrelated.pdf');
    const proposal = await proposeAdd(key.secret, staged.id);
    const removal = await keyed(key.secret, 'POST', routes.removeProductDownload.path, { productId: digital, assetId: ownerAsset.id });
    const removalProposal = envelope(changeProposalProposedOutputSchema).parse(await removal.json()).data.proposal;
    expect((await sessionRequest(ownerToken, 'GET', linkPath(proposal.id, staged.id), undefined, studioHost)).status).toBe(404);
    expect((await sessionRequest(ownerToken, 'GET', linkPath(proposal.id, unrelated.id))).status).toBe(404);
    expect((await sessionRequest(ownerToken, 'GET', linkPath(removalProposal.id, ownerAsset.id))).status).toBe(404);
    expect((await sessionRequest(ownerToken, 'GET', linkPath(proposal.id, 'x'.repeat(201)))).status).toBe(400);
    storage.objects.delete(await stagedObjectKey(staged.id));
    const gone = await sessionRequest(ownerToken, 'GET', linkPath(proposal.id, staged.id));
    expect(gone.status).toBe(404);
    expect(gone.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', removalProposal.id), {})).status).toBe(200);
    expect((await sessionRequest(ownerToken, 'GET', linkPath(removalProposal.id, ownerAsset.id))).status).toBe(404);
    const approved = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalApprove.replace(':id', proposal.id), {});
    expect(envelope(changeProposalApproveOutputSchema).parse(await approved.json()).data.proposal.status).toBe('stale');
    expect((await sessionRequest(ownerToken, 'GET', linkPath(proposal.id, staged.id))).status).toBe(404);
    expect((await database.db.select().from(productDownloadAssets)).find((row) => row.id === staged.id)).toBeUndefined();
  });

  it('shows the owner which file a proposal holds and where a copy comes from, and nothing for a proposal without a file', async () => {
    const key = await createShopKey(WRITE_SCOPES, 'propose');
    const copied = await keyed(key.secret, 'POST', routes.copyStagedDownload.path, { productId: digital, assetId: ownerAsset.id });
    expect(copied.status).toBe(200);
    const copy = envelope(shopDownloadContracts.copyStagedDownload.output).parse(await copied.json()).data.file;
    const proposal = await proposeAdd(key.secret, copy.id);
    const shown = await sessionRequest(ownerToken, 'GET', API_PATHS.changeProposal.replace(':id', proposal.id));
    const view = envelope(changeProposalShowOutputSchema).parse(await shown.json()).data.proposal;
    expect(view.proposedFiles).toEqual([{ id: copy.id, available: true, copiedFrom: { productId: digital, productTitle: 'Field guide', versionNumber: 1 } }]);
    const after = view.effect['files'];
    expect(JSON.stringify(after)).toContain(copy.id);
    const rename = await keyed(key.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: digital, title: 'Field guide, renamed' });
    const renameProposal = envelope(changeProposalProposedOutputSchema).parse(await rename.json()).data.proposal;
    const plain = envelope(changeProposalShowOutputSchema).parse(await (await sessionRequest(ownerToken, 'GET', API_PATHS.changeProposal.replace(':id', renameProposal.id))).json()).data.proposal;
    expect(plain).not.toHaveProperty('proposedFiles');
  });
});
