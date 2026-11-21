import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createChangeProposalTransaction } from '#adapters/db/change-proposal-transaction.js';
import { createTenantSecretRepository } from '#adapters/db/repositories.js';
import { changeProposalImages, products, tenantAdmins, tenantApiKeys, tenants } from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  changeProposalApproveOutputSchema,
  changeProposalGroupOutputSchema,
  changeProposalProposedOutputSchema,
  changeProposalShowOutputSchema,
  SHOP_ASSETS_ROUTES,
  SHOP_CATALOG_ROUTES,
  SHOP_PROPOSAL_ROUTES,
  SHOP_SETTINGS_ROUTES,
  shopAssetsContracts,
  shopCatalogContracts,
  shopProposalContracts,
} from '#core/contract/index.js';
import type { TenantSecretResolver } from '#core/server/index.js';
import { createObjectStorageFake, fakeStorageSecrets, type FakeObjectStorage } from '#core/server/testing/object-storage-fake.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const password = 'proposal-image-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWMwTptJEmIY1ZA2GkrGwzVpAABIfDIQjwcm5wAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PROPOSE_SCOPES = ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'];

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let deps: ReturnType<typeof createDeps>;
let storage: FakeObjectStorage;
let ownerToken: string;
let adminToken: string;
let productId: string;
let studioProductId: string;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const sessionRequest = (token: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost, extra: Record<string, string> = {}) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createShopKey = async (scopes: string[], mode: 'direct' | 'propose', host = acmeHost) => {
  const response = await sessionRequest(ownerToken, API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
    name: `Images ${mode} ${scopes.join(' ')}`, scopes, expiresAt, mode,
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

type ImageFamily = 'cover' | 'branding';

const IMAGE_ROUTES = {
  cover: { upload: SHOP_ASSETS_ROUTES.productCoverUpload.path, complete: SHOP_ASSETS_ROUTES.productCoverComplete.path },
  branding: { upload: SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, complete: SHOP_SETTINGS_ROUTES.brandingAssetComplete.path },
} as const;

interface UploadFile {
  kind: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

const coverFile = (bytes: Uint8Array = PNG): UploadFile => ({ kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', bytes });

const beginUpload = (secret: string, family: ImageFamily, file: UploadFile, host = acmeHost) => keyed(secret, 'POST', IMAGE_ROUTES[family].upload, {
  kind: file.kind, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.byteLength,
}, host);

const uploadAndComplete = async (secret: string, family: ImageFamily, file: UploadFile, host = acmeHost) => {
  const started = await beginUpload(secret, family, file, host);
  expect(started.status).toBe(200);
  const begun = envelope(shopAssetsContracts.productCoverUpload.output).parse(await started.json()).data;
  storage.objects.set(begun.key, { bytes: new Uint8Array(file.bytes), contentType: file.contentType });
  const completed = await keyed(secret, 'POST', IMAGE_ROUTES[family].complete, { key: begun.key }, host);
  return { begun, completed };
};

const quarantinedUrl = async (secret: string, family: ImageFamily, file: UploadFile, host = acmeHost): Promise<string> => {
  const { completed } = await uploadAndComplete(secret, family, file, host);
  expect(completed.status).toBe(200);
  return envelope(shopAssetsContracts.productCoverComplete.output).parse(await completed.json()).data.url;
};

const propose = async (secret: string, path: string, body: unknown, extra: Record<string, string> = {}) => {
  const response = await keyed(secret, 'POST', path, body, acmeHost, extra);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(202);
  return envelope(changeProposalProposedOutputSchema).parse(await response.json()).data.proposal;
};

const previewPath = (proposalId: string, digest: string): string =>
  API_PATHS.changeProposalImage.replace(':id', proposalId).replace(':digest', digest);

const digestOf = (path: string): string => {
  const digest = /\/([0-9a-f]{64})\.[a-z]+$/.exec(path)?.[1];
  if (digest === undefined) throw new Error(`No digest in ${path}`);
  return digest;
};

const publicKeys = (tenantId = 'acme'): string[] => storage.keysUnder(`image-assets/${tenantId}/`);
const quarantineKeys = (tenantId = 'acme'): string[] => storage.keysUnder(`image-asset-quarantine/${tenantId}/`);
const imageRows = async (apiKeyId: string) => (await database.db.select().from(changeProposalImages)).filter((row) => row.apiKeyId === apiKeyId);

const coverOf = async (id: string) => (await database.db.select().from(products)).find((row) => row.id === id)?.coverUrl ?? null;

beforeAll(async () => {
  database = await createTestDatabase(
    'together_change_proposal_image_routes_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const env = envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'proposal-image-routes-test-secret-at-least-32-characters',
  });
  deps = createDeps(env, { db: database.db, clock: { nowIso: () => now } });
  const secretCrypto = createSecretCrypto(env.SECRETS_MASTER_KEY);
  storage = createObjectStorageFake();
  app = buildApp({
    ...deps,
    storage: storage.storage,
    secretResolver: withFakeStorage(deps.secretResolver),
    changeProposalTransaction: createChangeProposalTransaction(database.db, deps.logger, (connection) =>
      withFakeStorage(createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto))),
  });

  const owner = await signUp('proposal-image-owner@example.test', 'Image Owner');
  const admin = await signUp('proposal-image-admin@example.test', 'Image Admin');
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: owner.id, role: 'owner' });
  }
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme-admin', tenantId: 'acme', userId: admin.id, role: 'admin' });
  ownerToken = owner.token;
  adminToken = admin.token;
  const createProduct = async (host: string) => {
    const direct = await createShopKey(['shop:catalog:read', 'shop:catalog:write'], 'direct', host);
    const response = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Printed handbook', type: 'physical', priceCents: 1000 }, host);
    expect(response.status).toBe(200);
    return envelope(shopCatalogContracts.createProduct.output).parse(await response.json()).data.product.id;
  };
  productId = await createProduct(acmeHost);
  studioProductId = await createProduct(studioHost);
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('the image upload routes for every kind of caller', () => {
  it('quarantines the upload of a propose-mode key and answers the future public address without writing a public object', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const before = publicKeys();
    for (const [family, file] of [
      ['cover', coverFile()],
      ['branding', { kind: 'logo', fileName: 'logo.svg', contentType: 'image/svg+xml', bytes: SVG }],
    ] as const) {
      const { begun, completed } = await uploadAndComplete(key.secret, family, file);
      expect(begun).toMatchObject({ servePath: null, quarantined: true });
      expect(begun.key.startsWith('image-asset-candidates/acme/')).toBe(true);
      expect(new URL(begun.upload.url).pathname).toBe(`/${begun.key}`);
      expect(completed.status).toBe(200);
      const answer = envelope(shopAssetsContracts.productCoverComplete.output).parse(await completed.json()).data;
      const extension = file.fileName.split('.').at(-1) ?? '';
      expect(answer).toEqual({ url: `/api/public/assets/${file.kind}/${sha256(file.bytes)}.${extension}`, quarantined: true });
      expect(storage.objects.has(begun.key)).toBe(false);
      expect(quarantineKeys()).toContain(`image-asset-quarantine/acme/${key.apiKey.id}/${file.kind}/${sha256(file.bytes)}.${extension}`);
    }
    expect(publicKeys()).toEqual(before);
    expect((await imageRows(key.apiKey.id)).map((row) => row.kind).toSorted()).toEqual(['logo', 'product-cover']);
  });

  it('answers the same address for the same bytes again and keeps one record of them', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const first = await quarantinedUrl(key.secret, 'cover', coverFile());
    const second = await quarantinedUrl(key.secret, 'cover', coverFile());
    expect(second).toBe(first);
    expect(await imageRows(key.apiKey.id)).toHaveLength(1);
  });

  it('deletes an invalid upload of a propose-mode key with the validation error of the live route and records nothing', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const { begun, completed } = await uploadAndComplete(key.secret, 'cover', coverFile(new Uint8Array([1, 2, 3, 4])));
    expect(completed.status).toBe(400);
    expect(await errorOf(completed)).toEqual({ code: 'validation', message: 'Uploaded image does not match its declared format or size' });
    expect(storage.objects.has(begun.key)).toBe(false);
    expect(await imageRows(key.apiKey.id)).toHaveLength(0);
    expect(quarantineKeys().some((path) => path.includes(key.apiKey.id))).toBe(false);
  });

  it('refuses a propose-mode key without the write scope of the image family, and on the other family', async () => {
    const readOnly = await createShopKey(['shop:catalog:read', 'shop:settings:read'], 'propose');
    const catalogOnly = await createShopKey(['shop:catalog:read', 'shop:catalog:write'], 'propose');
    const settingsOnly = await createShopKey(['shop:settings:read', 'shop:settings:write'], 'propose');
    for (const [secret, family, scope] of [
      [readOnly.secret, 'cover', 'shop:catalog:write'],
      [readOnly.secret, 'branding', 'shop:settings:write'],
      [catalogOnly.secret, 'branding', 'shop:settings:write'],
      [settingsOnly.secret, 'cover', 'shop:catalog:write'],
    ] as const) {
      for (const path of [IMAGE_ROUTES[family].upload, IMAGE_ROUTES[family].complete]) {
        const response = await keyed(secret, 'POST', path, path.endsWith('upload')
          ? { kind: family === 'cover' ? 'product-cover' : 'logo', fileName: 'a.png', contentType: 'image/png', sizeBytes: PNG.byteLength }
          : { key: 'image-asset-candidates/acme/logo/00000000-0000-4000-8000-000000000000.png' });
        expect(response.status, `${scope} ${path}`).toBe(403);
        expect(await errorOf(response)).toEqual({ code: 'forbidden', message: `${scope} is not permitted` });
      }
    }
    expect((await uploadAndComplete(catalogOnly.secret, 'cover', coverFile())).completed.status).toBe(200);
    expect((await uploadAndComplete(settingsOnly.secret, 'branding', { kind: 'favicon', fileName: 'f.png', contentType: 'image/png', bytes: PNG })).completed.status).toBe(200);
  });

  it('keeps the live upload for a direct-mode key: the completed image is public under a random name', async () => {
    const direct = await createShopKey(['shop:catalog:read', 'shop:catalog:write'], 'direct');
    const { begun, completed } = await uploadAndComplete(direct.secret, 'cover', coverFile());
    expect(begun.servePath).toMatch(/^\/api\/public\/assets\/product-cover\/[0-9a-f-]{36}\.png$/);
    expect(begun).not.toHaveProperty('quarantined');
    expect(completed.status).toBe(200);
    const answer = envelope(shopAssetsContracts.productCoverComplete.output).parse(await completed.json()).data;
    expect(answer).toEqual({ url: begun.servePath });
    expect(publicKeys()).toContain(`image-assets/acme/product-cover/${answer.url.split('/').at(-1) ?? ''}`);
  });

  it('refuses a legacy key and every session on the shop image routes', async () => {
    const legacySecret = 'legacy-proposal-image-secret';
    await database.db.insert(tenantApiKeys).values({
      id: 'legacy-proposal-image', tenantId: 'acme', name: 'Legacy', keyHash: deps.apiKeyCrypto.hash(legacySecret),
      scopes: null, createdAt: now, expiresAt: null, revokedAt: null,
    });
    for (const path of [...Object.values(IMAGE_ROUTES).flatMap((family) => [family.upload, family.complete])]) {
      expect((await keyed(legacySecret, 'POST', path, {})).status, path).toBe(401);
      for (const token of [ownerToken, adminToken]) {
        expect((await sessionRequest(token, 'POST', path, {})).status, path).toBe(401);
      }
    }
  });
});

describe('attaching a quarantined image', () => {
  it('accepts only the key\'s own quarantined image of the field\'s kind, and refuses anything else at submit with the live wording', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const other = await createShopKey(PROPOSE_SCOPES, 'propose');
    const studio = await createShopKey(PROPOSE_SCOPES, 'propose', studioHost);
    const own = await quarantinedUrl(key.secret, 'cover', coverFile());
    const othersCover = await quarantinedUrl(other.secret, 'cover', coverFile(Buffer.concat([PNG, Buffer.from([0])])));
    const logo = await quarantinedUrl(key.secret, 'branding', { kind: 'logo', fileName: 'l.png', contentType: 'image/png', bytes: Buffer.concat([PNG, Buffer.from([1])]) });
    const studioCover = await quarantinedUrl(studio.secret, 'cover', coverFile(Buffer.concat([PNG, Buffer.from([2])])), studioHost);
    for (const [coverUrl, label] of [
      ['https://images.example.test/cover.png', 'a foreign address'],
      [othersCover, 'another key\'s image'],
      [logo.replace('/logo/', '/product-cover/'), 'an image of another kind'],
      [studioCover, 'another workspace\'s image'],
    ] as const) {
      const response = await keyed(key.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, coverUrl });
      expect(response.status, label).toBe(400);
      expect(JSON.stringify(await response.json()), label).toContain('Must be empty, unchanged, an existing product-cover image of this workspace, or an image this key uploaded for approval');
    }
    const settings = await keyed(key.secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { faviconUrl: logo });
    expect(settings.status).toBe(400);
    const proposal = await propose(key.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, coverUrl: own });
    const shown = await sessionRequest(ownerToken, 'GET', API_PATHS.changeProposal.replace(':id', proposal.id));
    expect(envelope(changeProposalShowOutputSchema).parse(await shown.json()).data.proposal.effect['coverUrl']).toEqual({ before: null, after: own });
    expect(await coverOf(productId)).toBeNull();
    expect(studioProductId).not.toBe(productId);
  });
});

describe('the owner preview of a proposed image', () => {
  it('serves the quarantined bytes to the verified owner only, for an image the pending proposal attaches', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const url = await quarantinedUrl(key.secret, 'cover', coverFile(Buffer.concat([PNG, Buffer.from([3])])));
    const unrelated = await quarantinedUrl(key.secret, 'cover', coverFile(Buffer.concat([PNG, Buffer.from([4])])));
    const proposal = await propose(key.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, coverUrl: url });
    const other = await propose(key.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, title: 'Another title' });
    const path = previewPath(proposal.id, digestOf(url));

    const served = await sessionRequest(ownerToken, 'GET', path);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('content-disposition')).toBe(`inline; filename="${digestOf(url)}.png"`);
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array(Buffer.concat([PNG, Buffer.from([3])])));

    expect((await sessionRequest(adminToken, 'GET', path)).status).toBe(403);
    for (const secret of [key.secret, (await createShopKey(['shop:catalog:read'], 'direct')).secret]) {
      expect([401, 403]).toContain((await keyed(secret, 'GET', path)).status);
    }
    expect((await sessionRequest(ownerToken, 'GET', path, undefined, studioHost)).status).toBe(404);
    expect((await sessionRequest(ownerToken, 'GET', previewPath(proposal.id, digestOf(unrelated)))).status).toBe(404);
    expect((await sessionRequest(ownerToken, 'GET', previewPath(other.id, digestOf(url)))).status).toBe(404);
    expect((await sessionRequest(ownerToken, 'GET', previewPath(proposal.id, 'not-a-digest'))).status).toBe(400);

    expect((await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), {})).status).toBe(200);
    expect((await sessionRequest(ownerToken, 'GET', path)).status).toBe(404);
  });

  it('serves an SVG only as an attachment', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const url = await quarantinedUrl(key.secret, 'branding', { kind: 'logo', fileName: 'logo.svg', contentType: 'image/svg+xml', bytes: SVG });
    const proposal = await propose(key.secret, SHOP_SETTINGS_ROUTES.updateSettings.path, { logoUrl: url });
    const served = await sessionRequest(ownerToken, 'GET', previewPath(proposal.id, digestOf(url)));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/svg+xml');
    expect(served.headers.get('content-disposition')).toBe(`attachment; filename="${digestOf(url)}.svg"`);
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), {})).status).toBe(200);
  });
});

describe('the whole image flow', () => {
  it('publishes the approved cover under its digest, so the public route points at the very bytes, and removes the quarantined copy', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const bytes = Buffer.concat([PNG, Buffer.from([5])]);
    const url = await quarantinedUrl(key.secret, 'cover', coverFile(bytes));
    const publicKey = `image-assets/acme/product-cover/${sha256(bytes)}.png`;
    const proposal = await propose(key.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, coverUrl: url });
    expect(storage.objects.has(publicKey)).toBe(false);
    expect((await sessionRequest(ownerToken, 'GET', previewPath(proposal.id, digestOf(url)))).status).toBe(200);

    const approved = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalApprove.replace(':id', proposal.id), {});
    expect(approved.status).toBe(200);
    expect(envelope(changeProposalApproveOutputSchema).parse(await approved.json()).data.proposal.status).toBe('applied');
    expect(await coverOf(productId)).toBe(url);
    expect(storage.objects.get(publicKey)?.bytes).toEqual(new Uint8Array(bytes));
    expect(quarantineKeys().some((path) => path.includes(key.apiKey.id))).toBe(false);
    expect(await imageRows(key.apiKey.id)).toHaveLength(0);

    const served = await app.request(`${baseUrl}${url}`, { headers: { host: acmeHost } });
    expect(served.status).toBe(302);
    expect(new URL(z.string().url().parse(served.headers.get('location'))).pathname).toBe(`/${publicKey}`);
  });

  it('publishes a branding image attached inside a group only when the group is approved', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const bytes = Buffer.concat([PNG, Buffer.from([6])]);
    const url = await quarantinedUrl(key.secret, 'branding', { kind: 'share-image', fileName: 'share.png', contentType: 'image/png', bytes });
    const created = await keyed(key.secret, 'POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title: 'New share image' });
    expect(created.status).toBe(201);
    const group = envelope(shopProposalContracts.createGroup.output).parse(await created.json()).data.group;
    const item = await propose(key.secret, SHOP_SETTINGS_ROUTES.updateSettings.path, { ogImageUrl: url }, { 'x-proposal-group': group.id });
    const publicKey = `image-assets/acme/share-image/${sha256(bytes)}.png`;
    expect((await sessionRequest(ownerToken, 'GET', previewPath(item.id, digestOf(url)))).status).toBe(200);
    expect(storage.objects.has(publicKey)).toBe(false);
    const approved = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalGroupApprove.replace(':id', group.id), { itemIds: [item.id] });
    expect(approved.status).toBe(200);
    expect(envelope(changeProposalGroupOutputSchema).parse(await approved.json()).data.group.items.map((entry) => entry.status)).toEqual(['applied']);
    expect(storage.objects.get(publicKey)?.bytes).toEqual(new Uint8Array(bytes));
    expect((await database.db.select().from(tenants)).find((row) => row.id === 'acme')?.ogImageUrl).toBe(url);
  });

  it('leaves nothing public and removes the quarantined copy when the owner rejects', async () => {
    const key = await createShopKey(PROPOSE_SCOPES, 'propose');
    const bytes = Buffer.concat([PNG, Buffer.from([7])]);
    const url = await quarantinedUrl(key.secret, 'cover', coverFile(bytes));
    const proposal = await propose(key.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, coverUrl: url });
    const rejected = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), { note: 'Not this one' });
    expect(rejected.status).toBe(200);
    expect(storage.objects.has(`image-assets/acme/product-cover/${sha256(bytes)}.png`)).toBe(false);
    expect(quarantineKeys().some((path) => path.includes(key.apiKey.id))).toBe(false);
    expect(await imageRows(key.apiKey.id)).toHaveLength(0);
    const served = await app.request(`${baseUrl}${url}`, { headers: { host: acmeHost } });
    const location = served.headers.get('location');
    expect(location === null || !storage.objects.has(new URL(location).pathname.slice(1))).toBe(true);
    expect(await coverOf(productId)).not.toBe(url);
  });
});
