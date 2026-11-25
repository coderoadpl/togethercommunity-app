import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createChangeProposalTransaction } from '#adapters/db/change-proposal-transaction.js';
import { createChangeProposalRepository } from '#adapters/db/change-proposals.js';
import { createTenantSecretRepository } from '#adapters/db/repositories.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  changeProposalEvents,
  changeProposals,
  courses,
  emailOutbox,
  entityVersions,
  productPrices,
  productDownloadAssets,
  products,
  productStock,
  salesLinks,
  shopManagementKeyEvents,
  shopManagementKeys,
  stockEvents,
  tenantAdmins,
  tenantApiKeys,
  tenants,
  tenantSecrets,
} from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  changeProposalApproveOutputSchema,
  changeProposalProposedOutputSchema,
  changeProposalReceiptOutputSchema,
  changeProposalRejectOutputSchema,
  changeProposalShowOutputSchema,
  changeProposalsListOutputSchema,
  SHOP_ASSETS_ROUTES,
  SHOP_CATALOG_ROUTES,
  SHOP_DOWNLOAD_ROUTES,
  SHOP_PROPOSAL_ROUTES,
  SHOP_SETTINGS_ROUTES,
  shopAssetsContracts,
  shopCatalogContracts,
  shopDownloadContracts,
  shopProposalContracts,
  shopSettingsContracts,
} from '#core/contract/index.js';
import { shopManagementKeyHash, type TenantSecretResolver } from '#core/server/index.js';
import { createObjectStorageFake, fakeStorageSecrets, type FakeObjectStorage } from '#core/server/testing/object-storage-fake.js';

import { collectPermissionInventory, KEY_MODE_ROUTES } from '../../../scripts/permission-inventory.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';
import { shopAssetsRoutes } from './shop-assets-routes.js';
import { shopCatalogRoutes } from './shop-catalog-routes.js';
import { shopDownloadRoutes } from './shop-download-routes.js';
import { shopIntegrationRoutes } from './shop-integration-routes.js';
import type { ShopMachineRoute } from './shop-machine-auth.js';
import { shopOrderRoutes } from './shop-order-routes.js';
import { shopProposalRoutes } from './shop-proposal-routes.js';
import { shopSettingsRoutes } from './shop-settings-routes.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const password = 'shop-propose-password-15';
const START = Date.parse('2026-11-15T10:00:00.000Z');
let minute = 0;
let now = new Date(START).toISOString();
const expiresAt = '2026-11-22T00:00:00.000Z';
const PROPOSE_SCOPES = ['shop:catalog:read', 'shop:catalog:write', 'shop:orders:read', 'shop:settings:read', 'shop:settings:write', 'shop:integrations:read'];
const ALL_SCOPES = [...PROPOSE_SCOPES, 'shop:fulfilment:write', 'shop:integrations:write'];

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let deps: ReturnType<typeof createDeps>;
let secretsMasterKey: string;
let ownerToken: string;
let ownerId: string;
let adminToken: string;
let imageStorage: FakeObjectStorage;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWMwTptJEmIY1ZA2GkrGwzVpAABIfDIQjwcm5wAAAABJRU5ErkJggg==', 'base64');

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;

const sessionRequest = (token: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host,
    authorization: `Bearer ${token}`,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost, extra: Record<string, string> = {}) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host,
    'x-api-key': secret,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...extra,
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createShopKey = async (scopes: string[], mode?: 'direct' | 'propose', host = acmeHost) => {
  const response = await sessionRequest(ownerToken, API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
    name: `Shop ${mode ?? 'default'} ${scopes.length}`, scopes, expiresAt, ...(mode === undefined ? {} : { mode }),
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

const liveState = async () => {
  const forWorkspace = <T extends { tenantId: string | null }>(rows: T[]) => rows.filter((row) => row.tenantId === 'acme');
  return JSON.stringify({
    tenants: (await database.db.select().from(tenants)).filter((row) => row.id === 'acme'),
    products: forWorkspace(await database.db.select().from(products)),
    prices: forWorkspace(await database.db.select().from(productPrices)),
    stock: forWorkspace(await database.db.select().from(productStock)),
    stockEvents: forWorkspace(await database.db.select().from(stockEvents)),
    versions: forWorkspace(await database.db.select().from(entityVersions)),
    outbox: forWorkspace(await database.db.select().from(emailOutbox)),
    salesLinks: forWorkspace(await database.db.select().from(salesLinks)),
    files: forWorkspace(await database.db.select().from(productDownloadAssets)),
    secrets: forWorkspace(await database.db.select().from(tenantSecrets)),
  });
};

const withFakeStorage = (resolver: TenantSecretResolver): TenantSecretResolver => ({
  resolve: async (tenantId, key) => key === 's3.configuration' ? fakeStorageSecrets.resolve() : resolver.resolve(tenantId, key),
});

const briefLockWaitApp = () => {
  const lockWait = { lockWaitMs: 300 };
  const secretCrypto = createSecretCrypto(secretsMasterKey);
  return buildApp({
    ...deps,
    changeProposals: createChangeProposalRepository(database.db, lockWait),
    changeProposalTransaction: createChangeProposalTransaction(database.db, deps.logger, (connection) =>
      withFakeStorage(createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto)), lockWait),
  });
};

const routeClass = (route: ShopMachineRoute): string => {
  const mode = route.proposeMode;
  if (mode === undefined) return 'read';
  if (mode.kind === 'proposal') return `proposal ${mode.operation}`;
  if (mode.kind === 'refuse') return `refuse ${mode.reason}`;
  return mode.kind;
};

const registeredShopRoutes = (): readonly ShopMachineRoute[] => [
  ...shopCatalogRoutes(deps), ...shopOrderRoutes(deps), ...shopSettingsRoutes(deps), ...shopAssetsRoutes(deps),
  ...shopDownloadRoutes(deps), ...shopIntegrationRoutes(deps), ...shopProposalRoutes(deps),
];

const concretePath = (path: string): string => path
  .replace(':productId', 'unknown-product')
  .replace(':orderId', 'unknown-order')
  .replace(':reference', 'unknown-reference')
  .replace(':key', 'ksef.token')
  .replace(':id', 'unknown-id');

interface Fixture {
  published: string;
  draft: string;
  publishedPrice: string;
  salesLink: string;
  digital: string;
}

const OWNER_FILE = { id: 'owner-workbook', key: 'acme/product-downloads/owner/workbook.pdf' };
const ACCESS_COURSE = 'course-propose-access';
const PDF = new TextEncoder().encode('%PDF-1.7\nworkbook\n%%EOF\n');

let fixture: Fixture;
let direct: Awaited<ReturnType<typeof createShopKey>>;
let proposer: Awaited<ReturnType<typeof createShopKey>>;

const proposalBodies = (): Record<string, unknown> => ({
  [SHOP_CATALOG_ROUTES.createProduct.path]: { title: 'Proposed handbook', type: 'physical', priceCents: 1500 },
  [SHOP_CATALOG_ROUTES.updateProduct.path]: { id: fixture.published, title: 'Proposed title' },
  [SHOP_CATALOG_ROUTES.publishProduct.path]: { id: fixture.draft },
  [SHOP_CATALOG_ROUTES.unpublishProduct.path]: { id: fixture.published },
  [SHOP_CATALOG_ROUTES.deleteProductDraft.path]: { productId: fixture.draft },
  [SHOP_CATALOG_ROUTES.setProductAccess.path]: { id: fixture.digital, accessItems: [{ level: 'course', courseId: ACCESS_COURSE }] },
  [SHOP_CATALOG_ROUTES.createProductPrice.path]: { productId: fixture.draft, kind: 'one_time', amountCents: 2500 },
  [SHOP_CATALOG_ROUTES.deactivateProductPrice.path]: { id: fixture.publishedPrice },
  [SHOP_CATALOG_ROUTES.enableProductStock.path]: { productId: fixture.draft, onHand: 4, lowStockThreshold: null },
  [SHOP_CATALOG_ROUTES.adjustProductStock.path]: { productId: fixture.published, delta: 5, reason: 'delivery' },
  [SHOP_CATALOG_ROUTES.setProductStockThreshold.path]: { productId: fixture.published, lowStockThreshold: 2 },
  [SHOP_ASSETS_ROUTES.createSalesLink.path]: { slug: 'proposed-link', title: 'Proposed link', heading: 'Proposed offer', productIds: [fixture.draft] },
  [SHOP_ASSETS_ROUTES.updateSalesLink.path]: { ...salesLinkFields(), id: fixture.salesLink, expectedRevision: 1, heading: 'Proposed heading' },
  [SHOP_SETTINGS_ROUTES.updateSettings.path]: { name: 'Proposed shop name' },
  [SHOP_DOWNLOAD_ROUTES.removeProductDownload.path]: { productId: fixture.digital, assetId: OWNER_FILE.id },
});

const storageKeyOf = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1));

const stageFile = async (secret: string, fileName: string): Promise<string> => {
  const started = await keyed(secret, 'POST', SHOP_DOWNLOAD_ROUTES.uploadStagedDownload.path, { fileName, contentType: 'application/pdf', sizeBytes: PDF.byteLength });
  expect(started.status, fileName).toBe(200);
  const upload = envelope(shopDownloadContracts.uploadStagedDownload.output).parse(await started.json()).data.upload;
  imageStorage.objects.set(storageKeyOf(upload.url), { bytes: PDF, contentType: 'application/pdf' });
  const completed = await keyed(secret, 'POST', SHOP_DOWNLOAD_ROUTES.completeStagedDownload.path, { uploadId: upload.id });
  expect(completed.status, fileName).toBe(200);
  return envelope(shopDownloadContracts.completeStagedDownload.output).parse(await completed.json()).data.file.id;
};

const bodyFor = async (secret: string, path: string, bodies: Record<string, unknown>): Promise<unknown> => {
  if (path === SHOP_DOWNLOAD_ROUTES.addProductDownload.path) return { productId: fixture.digital, stagedFileId: await stageFile(secret, 'added.pdf') };
  if (path === SHOP_DOWNLOAD_ROUTES.replaceProductDownload.path) {
    return { productId: fixture.digital, replacesAssetId: OWNER_FILE.id, stagedFileId: await stageFile(secret, 'replacing.pdf') };
  }
  return bodies[path] ?? {};
};

const STAGING_ROUTES: ReadonlySet<string> = new Set([
  SHOP_DOWNLOAD_ROUTES.uploadStagedDownload.path, SHOP_DOWNLOAD_ROUTES.completeStagedDownload.path,
  SHOP_DOWNLOAD_ROUTES.copyStagedDownload.path, SHOP_DOWNLOAD_ROUTES.discardStagedDownload.path,
]);

const stagingRoute = async (secret: string, route: ShopMachineRoute, extra: Record<string, string> = {}): Promise<number> => {
  if (route.path === SHOP_DOWNLOAD_ROUTES.uploadStagedDownload.path) {
    return (await keyed(secret, 'POST', route.path, { fileName: 'started.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength }, acmeHost, extra)).status;
  }
  if (route.path === SHOP_DOWNLOAD_ROUTES.completeStagedDownload.path) {
    const started = await keyed(secret, 'POST', SHOP_DOWNLOAD_ROUTES.uploadStagedDownload.path, { fileName: 'completed.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength });
    const upload = envelope(shopDownloadContracts.uploadStagedDownload.output).parse(await started.json()).data.upload;
    imageStorage.objects.set(storageKeyOf(upload.url), { bytes: PDF, contentType: 'application/pdf' });
    return (await keyed(secret, 'POST', route.path, { uploadId: upload.id }, acmeHost, extra)).status;
  }
  if (route.path === SHOP_DOWNLOAD_ROUTES.copyStagedDownload.path) {
    return (await keyed(secret, 'POST', route.path, { productId: fixture.digital, assetId: OWNER_FILE.id }, acmeHost, extra)).status;
  }
  const id = await stageFile(secret, 'discarded.pdf');
  return (await keyed(secret, 'DELETE', route.path.replace(':id', id), undefined, acmeHost, extra)).status;
};

const directRoute = (secret: string, route: ShopMachineRoute, candidate: { key: string | null }, extra: Record<string, string> = {}): Promise<number> =>
  STAGING_ROUTES.has(route.path) ? stagingRoute(secret, route, extra) : imageUploadRoute(secret, route, candidate, extra);

const IMAGE_UPLOAD_BODIES: Record<string, unknown> = {
  [SHOP_ASSETS_ROUTES.productCoverUpload.path]: { kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: PNG.byteLength },
  [SHOP_SETTINGS_ROUTES.brandingAssetUpload.path]: { kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: PNG.byteLength },
};

const imageUploadKey = z.object({ ok: z.literal(true), data: z.object({ key: z.string(), quarantined: z.literal(true) }) });

const imageUploadRoute = async (secret: string, route: ShopMachineRoute, candidate: { key: string | null }, extra: Record<string, string> = {}): Promise<number> => {
  const upload = IMAGE_UPLOAD_BODIES[route.path];
  if (upload !== undefined) {
    const response = await keyed(secret, route.method, route.path, upload, acmeHost, extra);
    if (response.status !== 200) return response.status;
    const { key } = imageUploadKey.parse(await response.json()).data;
    imageStorage.objects.set(key, { bytes: new Uint8Array(PNG), contentType: 'image/png' });
    candidate.key = key;
    return response.status;
  }
  const response = await keyed(secret, route.method, route.path, { key: candidate.key }, acmeHost, extra);
  if (response.status === 200) {
    const answer = z.object({ ok: z.literal(true), data: z.object({ url: z.string(), quarantined: z.literal(true) }) }).parse(await response.json()).data;
    expect(answer.url).toMatch(/^\/api\/public\/assets\/(product-cover|logo)\/[0-9a-f]{64}\.png$/);
  }
  return response.status;
};

const salesLinkFields = () => ({ slug: 'spring', title: 'Spring', heading: 'Spring offer', productIds: [fixture.published] });

const salesLinkPath = (path: string): string => path.startsWith(SHOP_ASSETS_ROUTES.listSalesLinks.path)
  ? path.replace(':id', fixture.salesLink)
  : concretePath(path);

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_propose_mode_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const env = envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-propose-mode-test-secret-at-least-32-characters',
  });
  secretsMasterKey = env.SECRETS_MASTER_KEY;
  const created = createDeps(env, { db: database.db, clock: { nowIso: () => now } });
  imageStorage = createObjectStorageFake();
  deps = {
    ...created,
    storage: imageStorage.storage,
    secretResolver: withFakeStorage(created.secretResolver),
    changeProposalTransaction: createChangeProposalTransaction(database.db, created.logger, (connection) =>
      withFakeStorage(createTenantSecretResolver(createTenantSecretRepository(connection), createSecretCrypto(secretsMasterKey)))),
  };
  app = buildApp(deps);

  const owner = await signUp('shop-propose-owner@example.test', 'Propose Owner');
  const admin = await signUp('shop-propose-admin@example.test', 'Propose Admin');
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: owner.id, role: 'owner' });
  }
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme-admin', tenantId: 'acme', userId: admin.id, role: 'admin' });
  ownerToken = owner.token;
  ownerId = owner.id;
  adminToken = admin.token;

  direct = await createShopKey(ALL_SCOPES, 'direct');
  proposer = await createShopKey(PROPOSE_SCOPES, 'propose');
  const create = async (title: string) => {
    const response = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title, type: 'physical', priceCents: 1000 });
    expect(response.status).toBe(200);
    return envelope(shopCatalogContracts.createProduct.output).parse(await response.json()).data.product.id;
  };
  const published = await create('Live handbook');
  const draft = await create('Draft handbook');
  const priced = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProductPrice.path, { productId: published, kind: 'one_time', amountCents: 1000 });
  const publishedPrice = envelope(shopCatalogContracts.createProductPrice.output).parse(await priced.json()).data.price.id;
  expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProductPrice.path, { productId: draft, kind: 'one_time', amountCents: 900 })).status).toBe(200);
  expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.enableProductStock.path, { productId: published, onHand: 10, lowStockThreshold: null })).status).toBe(200);
  expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.publishProduct.path, { id: published })).status).toBe(200);
  const linked = await keyed(direct.secret, 'POST', SHOP_ASSETS_ROUTES.createSalesLink.path, { slug: 'spring', title: 'Spring', heading: 'Spring offer', productIds: [published] });
  expect(linked.status).toBe(201);
  const salesLink = envelope(shopAssetsContracts.createSalesLink.output).parse(await linked.json()).data.salesLink.id;
  const digitalCreated = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Workbook', type: 'digital_download', priceCents: 900 });
  expect(digitalCreated.status).toBe(200);
  const digital = envelope(shopCatalogContracts.createProduct.output).parse(await digitalCreated.json()).data.product.id;
  await database.db.insert(courses).values({ id: ACCESS_COURSE, tenantId: 'acme', name: 'Field course', description: '', createdAt: now });
  await database.db.insert(productDownloadAssets).values({
    id: OWNER_FILE.id, tenantId: 'acme', productId: digital, lineageId: OWNER_FILE.id, versionNumber: 1, versionNote: null, supersededAt: null, replacesAssetId: null,
    fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength, storageKey: OWNER_FILE.key, status: 'ready', createdAt: now, sha256: null,
  });
  imageStorage.objects.set(OWNER_FILE.key, { bytes: PDF, contentType: 'application/pdf' });
  fixture = { published, draft, publishedPrice, salesLink, digital };
}, 120_000);

afterAll(async () => { await database?.close(); });

beforeEach(() => {
  minute += 1;
  now = new Date(START + minute * 60_000).toISOString();
});

describe('shop route classification', () => {
  it('pins the propose-mode class of every registered shop route', () => {
    expect(Object.fromEntries(registeredShopRoutes().map((route) => [`${route.method} ${route.path}`, routeClass(route)]))).toEqual({
      'GET /api/m2m/shop/products': 'read',
      'POST /api/m2m/shop/products': 'proposal product.create',
      'POST /api/m2m/shop/products/update': 'proposal product.update',
      'POST /api/m2m/shop/products/publish': 'proposal product.publish',
      'POST /api/m2m/shop/products/unpublish': 'proposal product.unpublish',
      'POST /api/m2m/shop/products/delete': 'proposal product.delete-draft',
      'POST /api/m2m/shop/products/access': 'proposal product.set-access',
      'GET /api/m2m/shop/products/:productId/prices': 'read',
      'POST /api/m2m/shop/products/prices': 'proposal price.create',
      'POST /api/m2m/shop/products/prices/deactivate': 'proposal price.deactivate',
      'GET /api/m2m/shop/products/:productId/stock': 'read',
      'POST /api/m2m/shop/products/stock/enable': 'proposal stock.enable',
      'POST /api/m2m/shop/products/stock/adjust': 'proposal stock.adjust',
      'POST /api/m2m/shop/products/stock/threshold': 'proposal stock.set-threshold',
      'GET /api/m2m/shop/orders': 'read',
      'GET /api/m2m/shop/orders/export': 'read',
      'GET /api/m2m/shop/orders/packing-list': 'read',
      'GET /api/m2m/shop/orders/verify/:reference': 'read',
      'GET /api/m2m/shop/orders/:orderId': 'read',
      'POST /api/m2m/shop/orders/:orderId/ship': 'refuse side-effect',
      'POST /api/m2m/shop/orders/:orderId/lines/:productId/issue': 'refuse side-effect',
      'GET /api/m2m/shop/orders/:orderId/shipx': 'read',
      'POST /api/m2m/shop/orders/:orderId/shipx': 'refuse side-effect',
      'POST /api/m2m/shop/orders/:orderId/shipx/refresh': 'refuse side-effect',
      'POST /api/m2m/shop/orders/:orderId/shipx/discard': 'refuse side-effect',
      'POST /api/m2m/shop/orders/:orderId/shipx/label': 'refuse side-effect',
      'GET /api/m2m/shop/settings': 'read',
      'POST /api/m2m/shop/settings': 'proposal settings.update',
      'POST /api/m2m/shop/image-assets/branding/upload': 'direct',
      'POST /api/m2m/shop/image-assets/branding/complete': 'direct',
      'POST /api/m2m/shop/image-assets/product-cover/upload': 'direct',
      'POST /api/m2m/shop/image-assets/product-cover/complete': 'direct',
      'POST /api/m2m/shop/image-assets/product-image/upload': 'refuse not-in-release',
      'POST /api/m2m/shop/image-assets/product-image/complete': 'refuse not-in-release',
      'GET /api/m2m/shop/sales-links': 'read',
      'GET /api/m2m/shop/sales-links/:id': 'read',
      'POST /api/m2m/shop/sales-links': 'proposal sales-link.create',
      'POST /api/m2m/shop/sales-links/:id': 'proposal sales-link.update',
      'DELETE /api/m2m/shop/sales-links/:id': 'proposal sales-link.delete',
      'POST /api/m2m/shop/downloads/upload': 'direct',
      'POST /api/m2m/shop/downloads/complete': 'direct',
      'POST /api/m2m/shop/downloads/copy': 'direct',
      'GET /api/m2m/shop/downloads/staged': 'read',
      'DELETE /api/m2m/shop/downloads/staged/:id': 'direct',
      'GET /api/m2m/shop/products/:productId/downloads': 'read',
      'POST /api/m2m/shop/products/downloads': 'proposal download.add',
      'POST /api/m2m/shop/products/downloads/replace': 'proposal download.replace',
      'POST /api/m2m/shop/products/downloads/remove': 'proposal download.remove',
      'GET /api/m2m/shop/integrations/secrets': 'read',
      'POST /api/m2m/shop/integrations/secrets': 'refuse secret',
      'DELETE /api/m2m/shop/integrations/secrets/:key': 'refuse secret',
      'POST /api/m2m/shop/integrations/stripe/configure': 'refuse secret',
      'POST /api/m2m/shop/integrations/stripe/probe': 'refuse secret',
      'POST /api/m2m/shop/integrations/storage/configure': 'refuse secret',
      'GET /api/m2m/shop/integrations/shipx': 'read',
      'POST /api/m2m/shop/integrations/shipx/configure': 'refuse secret',
      'GET /api/m2m/shop/proposals': 'proposal-management',
      'GET /api/m2m/shop/proposals/:id': 'proposal-management',
      'POST /api/m2m/shop/proposals/:id/withdraw': 'proposal-management',
      'POST /api/m2m/shop/proposals/groups': 'proposal-management',
      'GET /api/m2m/shop/proposals/groups/:id': 'proposal-management',
      'POST /api/m2m/shop/proposals/groups/:id/withdraw': 'proposal-management',
    });
  });

  it('lists one permission row per key mode for every route whose handler both modes reach and for the access and product file proposal routes', () => {
    const classes = new Map(registeredShopRoutes().map((route) => [`${route.method} ${route.path}`, routeClass(route)]));
    const keyModeRoutes = Object.keys(KEY_MODE_ROUTES);
    expect([...classes].filter(([, kind]) => kind === 'direct').map(([label]) => label).filter((label) => !keyModeRoutes.includes(label))).toEqual([]);
    expect(Object.fromEntries(keyModeRoutes.map((label) => [label, classes.get(label)]))).toEqual({
      'POST /api/m2m/shop/downloads/upload': 'direct',
      'POST /api/m2m/shop/downloads/complete': 'direct',
      'POST /api/m2m/shop/downloads/copy': 'direct',
      'GET /api/m2m/shop/downloads/staged': 'read',
      'DELETE /api/m2m/shop/downloads/staged/:id': 'direct',
      'POST /api/m2m/shop/image-assets/product-cover/upload': 'direct',
      'POST /api/m2m/shop/image-assets/product-cover/complete': 'direct',
      'POST /api/m2m/shop/image-assets/branding/upload': 'direct',
      'POST /api/m2m/shop/image-assets/branding/complete': 'direct',
      'POST /api/m2m/shop/products/access': 'proposal product.set-access',
      'POST /api/m2m/shop/products/downloads': 'proposal download.add',
      'POST /api/m2m/shop/products/downloads/replace': 'proposal download.replace',
      'POST /api/m2m/shop/products/downloads/remove': 'proposal download.remove',
    });
    const routeRows = collectPermissionInventory().routes;
    const rows = new Map(routeRows.map((row) => [row.subject, row]));
    expect(routeRows.filter((row) => row.modes !== undefined).map((row) => row.subject).sort()).toEqual([...keyModeRoutes].sort());
    for (const label of keyModeRoutes) {
      const modes = rows.get(label)?.modes;
      expect([modes?.direct !== undefined, modes?.propose !== undefined], label).toEqual([true, true]);
      const operation = classes.get(label)?.replace(/^proposal /u, '');
      if (operation !== undefined && operation !== classes.get(label)) {
        expect(modes?.propose.evidence, label).toContain(`stores a ${operation} proposal`);
      }
    }
  });

  it('registers exactly the classified routes under the shop prefix', () => {
    expect(app.routes.filter((route) => route.path.startsWith('/api/m2m/shop/')).map((route) => `${route.method} ${route.path}`))
      .toEqual(registeredShopRoutes().map((route) => `${route.method} ${route.path}`));
  });
});

describe('a propose-mode key on every registered shop route', () => {
  it('never reaches a live write: proposals answer 202, refusals 403, reads still read, uploads stay private', async () => {
    const bodies = proposalBodies();
    const before = await liveState();
    const publicBefore = imageStorage.keysUnder('image-assets/');
    const candidate: { key: string | null } = { key: null };
    const outcomes: string[] = [];
    for (const route of registeredShopRoutes()) {
      const label = `${route.method} ${route.path}`;
      const mode = route.proposeMode;
      if (mode?.kind === 'proposal-management') continue;
      minute += 1;
      now = new Date(START + minute * 60_000).toISOString();
      if (mode?.kind === 'direct') {
        expect(await directRoute(proposer.secret, route, candidate), label).toBe(200);
        outcomes.push(`${label} quarantined`);
        continue;
      }
      const body = route.method === 'GET' || route.method === 'DELETE' ? undefined : await bodyFor(proposer.secret, route.path, bodies);
      const response = await keyed(proposer.secret, route.method, salesLinkPath(route.path), body);
      if (mode === undefined) {
        expect([401, 403], label).not.toContain(response.status);
        outcomes.push(`${label} read`);
        continue;
      }
      if (mode.kind === 'proposal') {
        expect(response.status, label).toBe(202);
        const receipt = envelope(changeProposalProposedOutputSchema).parse(await response.json()).data;
        expect(receipt.proposal, label).toMatchObject({ operation: mode.operation, status: 'pending' });
        outcomes.push(`${label} proposed`);
        continue;
      }
      expect(response.status, label).toBe(403);
      outcomes.push(`${label} refused`);
    }
    expect(await liveState()).toBe(before);
    expect(imageStorage.keysUnder('image-assets/')).toEqual(publicBefore);
    expect(imageStorage.keysUnder('image-asset-quarantine/acme/').length).toBeGreaterThan(0);
    expect(imageStorage.keysUnder('acme/product-downloads/').filter((key) => !key.includes(`/${proposer.apiKey.id}/`))).toEqual([OWNER_FILE.key]);
    expect(outcomes.filter((outcome) => outcome.endsWith('proposed'))).toHaveLength(18);
    expect(outcomes.filter((outcome) => outcome.endsWith('quarantined'))).toHaveLength(8);
    expect(outcomes.filter((outcome) => outcome.endsWith('refused'))).toHaveLength(14);
    const stored = (await database.db.select().from(changeProposals)).filter((row) => row.proposedByKeyId === proposer.apiKey.id);
    expect(stored).toHaveLength(18);
  });

  it('never reaches a live write with the group header either: every proposal joins its group, refusals stay 403, reads still read', async () => {
    const bodies = proposalBodies();
    const grouper = await createShopKey(PROPOSE_SCOPES, 'propose');
    const before = await liveState();
    const publicBefore = imageStorage.keysUnder('image-assets/');
    const candidate: { key: string | null } = { key: null };
    const proposed: string[] = [];
    for (const route of registeredShopRoutes()) {
      const label = `${route.method} ${route.path}`;
      const mode = route.proposeMode;
      if (mode?.kind === 'proposal-management') continue;
      minute += 1;
      now = new Date(START + minute * 60_000).toISOString();
      const created = await keyed(grouper.secret, 'POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title: label });
      expect(created.status, label).toBe(201);
      const group = envelope(shopProposalContracts.createGroup.output).parse(await created.json()).data.group;
      const body = route.method === 'GET' || route.method === 'DELETE' || mode?.kind === 'direct' ? undefined : await bodyFor(grouper.secret, route.path, bodies);
      const response = mode?.kind === 'direct'
        ? null
        : await keyed(grouper.secret, route.method, salesLinkPath(route.path), body, acmeHost, { 'x-proposal-group': group.id });
      if (response === null) {
        expect(await directRoute(grouper.secret, route, candidate, { 'x-proposal-group': group.id }), label).toBe(200);
      } else if (mode === undefined) {
        expect([401, 403], label).not.toContain(response.status);
      } else if (mode.kind === 'proposal') {
        expect(response.status, label).toBe(202);
        const receipt = envelope(changeProposalProposedOutputSchema).parse(await response.json()).data;
        expect(receipt.proposal, label).toMatchObject({ operation: mode.operation, status: 'pending', groupId: group.id });
        expect(receipt.group?.items.map((item) => item.id), label).toEqual([receipt.proposal.id]);
        proposed.push(label);
      } else {
        expect(response.status, label).toBe(403);
      }
      const withdrawn = await keyed(grouper.secret, 'POST', SHOP_PROPOSAL_ROUTES.withdrawGroup.path.replace(':id', group.id), {});
      expect(withdrawn.status, label).toBe(200);
    }
    expect(await liveState()).toBe(before);
    expect(imageStorage.keysUnder('image-assets/')).toEqual(publicBefore);
    expect(proposed).toHaveLength(18);
    const stored = (await database.db.select().from(changeProposals)).filter((row) => row.proposedByKeyId === grouper.apiKey.id);
    expect(stored).toHaveLength(18);
    expect(stored.every((row) => row.groupId !== null && row.groupPosition === 1)).toBe(true);
  });

  it('records an image upload of a propose-mode key in the key history like every other write', async () => {
    const path = SHOP_ASSETS_ROUTES.productCoverUpload.path;
    const response = await keyed(proposer.secret, 'POST', path, IMAGE_UPLOAD_BODIES[path]);
    expect(response.status).toBe(200);
    const requests = (await database.db.select().from(shopManagementKeyEvents))
      .filter((event) => event.apiKeyId === proposer.apiKey.id && event.kind === 'request' && event.route === path);
    expect(requests.length).toBeGreaterThan(0);
  });

  it('returns the same validation error as the live route and stores nothing for an invalid proposal', async () => {
    const count = async () => (await database.db.select().from(changeProposals)).length;
    const before = await count();
    const invalid = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, misspelt: true });
    expect(invalid.status).toBe(400);
    expect((await errorOf(invalid)).code).toBe('validation');
    const missing = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.publishProduct.path, { id: 'unknown-product' });
    expect(missing.status).toBe(404);
    expect(await count()).toBe(before);
  });

  it('gives the key a receipt without the effect or any live value', async () => {
    const response = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, description: 'Proposed description' });
    expect(response.status).toBe(202);
    const text = await response.text();
    expect(text).not.toContain('Live handbook');
    expect(text).not.toContain('effect');
  });

  it.each([
    [['shop:catalog:write'], 'shop:catalog:write on a propose-mode key needs shop:catalog:read as well'],
    [['shop:catalog:read', 'shop:settings:write'], 'shop:settings:write on a propose-mode key needs shop:settings:read as well'],
  ])('refuses to issue a propose-mode key with %j', async (scopes, message) => {
    const response = await sessionRequest(ownerToken, API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
      name: 'Blind proposer', scopes, expiresAt, mode: 'propose',
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(message);
  });
});

describe('a direct-mode key on every registered shop route', () => {
  it('runs the live handler on proposal and refusal routes, ignores the group header and is refused on the proposal-management routes', async () => {
    for (const route of registeredShopRoutes()) {
      const label = `${route.method} ${route.path}`;
      const mode = route.proposeMode;
      if (mode === undefined) continue;
      const response = await keyed(direct.secret, route.method, concretePath(route.path), route.method === 'GET' || route.method === 'DELETE' ? undefined : {}, acmeHost, { 'x-proposal-group': 'ignored-group' });
      const error = response.status >= 400 ? await errorOf(response) : null;
      if (mode.kind === 'proposal-management') {
        expect(response.status, label).toBe(403);
        expect(error?.message, label).toBe('Only a propose-mode shop management key manages change proposals');
        continue;
      }
      expect(response.status, label).not.toBe(202);
      expect(error?.message ?? '', label).not.toContain('propose-mode');
    }
  });

  it('is refused what a product grants, which it holds no capability to change, and changes nothing', async () => {
    const before = await liveState();
    const response = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.setProductAccess.path, { id: fixture.digital, accessItems: [{ level: 'course', courseId: ACCESS_COURSE }] });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('forbidden');
    expect(await liveState()).toBe(before);
  });

  it('applies a catalogue write live and answers it with the resource, not a receipt', async () => {
    const response = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: fixture.published, lowStockThreshold: 1 });
    expect(response.status).toBe(200);
    expect(envelope(shopCatalogContracts.setProductStockThreshold.output).parse(await response.json()).data.stock).toMatchObject({ lowStockThreshold: 1 });
  });
});

describe('a propose-mode key on a release that predates propose mode', () => {
  const previousReleaseHash = (secret: string): string => createHash('sha256').update(secret).digest('hex');
  const previousReleaseLookup = async (secret: string) =>
    (await database.db.select().from(shopManagementKeys))
      .filter((row) => row.tenantId === 'acme' && row.keyHash === previousReleaseHash(secret))
      .map((row) => row.id);

  const plantKey = async (id: string, secret: string, mode: 'direct' | 'propose', keyHash: string) => {
    await database.db.insert(shopManagementKeys).values({
      id, tenantId: 'acme', name: id, keyHash, scopes: ['shop:catalog:read', 'shop:catalog:write'], mode,
      issuedByUserId: ownerId, createdAt: now, expiresAt, revokedAt: null,
    });
    return secret;
  };

  it('is never found by the previous release\'s plain-hash lookup, while a direct-mode key is', async () => {
    expect(await previousReleaseLookup(proposer.secret)).toEqual([]);
    expect(await previousReleaseLookup(direct.secret)).toEqual([direct.apiKey.id]);
  });

  it.each([
    ['a propose-mode row stored under the plain hash', 'planted-propose-plain', 'propose', previousReleaseHash],
    ['a direct-mode row stored under the propose-mode hash', 'planted-direct-propose', 'direct',
      (secret: string) => shopManagementKeyHash(deps.apiKeyCrypto, secret, 'propose')],
  ] as const)('refuses %s with 401 and changes nothing', async (_label, id, mode, hashOf) => {
    const secret = await plantKey(id, `${id}-secret`, mode, hashOf(`${id}-secret`));
    const before = await liveState();
    const proposalsBefore = (await database.db.select().from(changeProposals)).length;
    for (const [method, path, body] of [
      ['GET', SHOP_CATALOG_ROUTES.listProducts.path, undefined],
      ['POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, title: 'Planted title' }],
    ] as const) {
      const response = await keyed(secret, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await errorOf(response)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
    }
    expect(await liveState()).toBe(before);
    expect((await database.db.select().from(changeProposals)).length).toBe(proposalsBefore);
  });
});

describe('the key-side proposal routes', () => {
  it('lists, shows and withdraws only the key\'s own proposals', async () => {
    const other = await createShopKey(['shop:catalog:read', 'shop:catalog:write'], 'propose');
    const created = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.adjustProductStock.path, { productId: fixture.published, delta: -1, reason: 'damaged' });
    const { proposal } = envelope(changeProposalProposedOutputSchema).parse(await created.json()).data;

    const listed = envelope(shopProposalContracts.listProposals.output).parse(await (await keyed(proposer.secret, 'GET', `${SHOP_PROPOSAL_ROUTES.listProposals.path}?status=pending&limit=100`)).json()).data;
    expect(listed.proposals.map((entry) => entry.id)).toContain(proposal.id);
    const othersList = envelope(shopProposalContracts.listProposals.output).parse(await (await keyed(other.secret, 'GET', SHOP_PROPOSAL_ROUTES.listProposals.path)).json()).data;
    expect(othersList.proposals.map((entry) => entry.id)).not.toContain(proposal.id);

    const path = (template: string) => template.replace(':id', proposal.id);
    expect((await keyed(other.secret, 'GET', path(SHOP_PROPOSAL_ROUTES.getProposal.path))).status).toBe(404);
    expect((await keyed(other.secret, 'POST', path(SHOP_PROPOSAL_ROUTES.withdrawProposal.path), {})).status).toBe(404);
    const shown = await keyed(proposer.secret, 'GET', path(SHOP_PROPOSAL_ROUTES.getProposal.path));
    expect(envelope(changeProposalReceiptOutputSchema).parse(await shown.json()).data.proposal).toMatchObject({ id: proposal.id, status: 'pending' });

    const withdrawn = await keyed(proposer.secret, 'POST', path(SHOP_PROPOSAL_ROUTES.withdrawProposal.path), {});
    expect(withdrawn.status).toBe(200);
    expect(envelope(changeProposalReceiptOutputSchema).parse(await withdrawn.json()).data.proposal.status).toBe('withdrawn');
    const again = await keyed(proposer.secret, 'POST', path(SHOP_PROPOSAL_ROUTES.withdrawProposal.path), {});
    expect(again.status).toBe(409);
  });

  it('refuses an unknown list query field', async () => {
    expect((await keyed(proposer.secret, 'GET', `${SHOP_PROPOSAL_ROUTES.listProposals.path}?colour=red`)).status).toBe(400);
  });
});

describe('the owner session proposal routes', () => {
  const proposeTitle = async (title: string) => {
    const response = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, title });
    expect(response.status).toBe(202);
    return envelope(changeProposalProposedOutputSchema).parse(await response.json()).data.proposal;
  };

  it('lets the owner list, read the full effect and reject, and the key then sees the decision note', async () => {
    const proposal = await proposeTitle('Owner reviewed title');
    const listed = await sessionRequest(ownerToken, 'GET', `${API_PATHS.changeProposals}?status=pending&limit=100`);
    expect(listed.status).toBe(200);
    expect(envelope(changeProposalsListOutputSchema).parse(await listed.json()).data.proposals.map((entry) => entry.id)).toContain(proposal.id);

    const shown = await sessionRequest(ownerToken, 'GET', API_PATHS.changeProposal.replace(':id', proposal.id));
    const detail = envelope(changeProposalShowOutputSchema).parse(await shown.json()).data.proposal;
    expect(detail.effect).toMatchObject({ title: { before: 'Live handbook', after: 'Owner reviewed title' } });
    expect(detail.proposedBy).toMatchObject({ keyId: proposer.apiKey.id, keyState: 'active' });
    expect(detail.events.map((event) => event.kind)).toEqual(['proposed']);

    const rejected = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), { note: 'Keep the current title' });
    expect(rejected.status).toBe(200);
    expect(envelope(changeProposalRejectOutputSchema).parse(await rejected.json()).data.proposal).toMatchObject({ status: 'rejected', decisionNote: 'Keep the current title' });
    const again = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), {});
    expect(again.status).toBe(409);

    const receipt = await keyed(proposer.secret, 'GET', SHOP_PROPOSAL_ROUTES.getProposal.path.replace(':id', proposal.id));
    expect(envelope(changeProposalReceiptOutputSchema).parse(await receipt.json()).data.proposal).toMatchObject({ status: 'rejected', decisionNote: 'Keep the current title' });
    const titles = (await database.db.select().from(products)).filter((row) => row.id === fixture.published).map((row) => row.title);
    expect(titles).toEqual(['Live handbook']);
  });

  it('hides another workspace\'s proposals from the owner session of this workspace', async () => {
    const proposal = await proposeTitle('Cross workspace title');
    expect((await sessionRequest(ownerToken, 'GET', API_PATHS.changeProposal.replace(':id', proposal.id), undefined, studioHost)).status).toBe(404);
    expect((await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), {}, studioHost)).status).toBe(404);
  });

  it('refuses an admin session, a direct-mode key, a propose-mode key and a legacy key', async () => {
    const proposal = await proposeTitle('Refused deciders title');
    const legacySecret = 'legacy-propose-mode-secret';
    await database.db.insert(tenantApiKeys).values({
      id: 'legacy-propose-mode', tenantId: 'acme', name: 'Legacy', keyHash: deps.apiKeyCrypto.hash(legacySecret),
      scopes: null, createdAt: now, expiresAt: null, revokedAt: null,
    });
    const showPath = API_PATHS.changeProposal.replace(':id', proposal.id);
    const rejectPath = API_PATHS.changeProposalReject.replace(':id', proposal.id);
    for (const [method, path, body] of [['GET', API_PATHS.changeProposals, undefined], ['GET', showPath, undefined], ['POST', rejectPath, {}]] as const) {
      const admin = await sessionRequest(adminToken, method, path, body);
      expect(admin.status, `admin ${method} ${path}`).toBe(403);
      for (const secret of [direct.secret, proposer.secret, legacySecret]) {
        const response = await keyed(secret, method, path, body);
        expect([401, 403], `key ${method} ${path}`).toContain(response.status);
      }
    }
    const events = (await database.db.select().from(changeProposalEvents)).filter((event) => event.proposalId === proposal.id);
    expect(events.map((event) => event.kind)).toEqual(['proposed']);
  });
});

describe('the owner approval route', () => {
  const propose = async (path: string, body: unknown) => {
    const response = await keyed(proposer.secret, 'POST', path, body);
    expect(response.status).toBe(202);
    return envelope(changeProposalProposedOutputSchema).parse(await response.json()).data.proposal;
  };
  const approvePath = (id: string) => API_PATHS.changeProposalApprove.replace(':id', id);
  const approve = (id: string, token = ownerToken, host = acmeHost) => sessionRequest(token, 'POST', approvePath(id), {}, host);
  const approved = async (id: string) => {
    const response = await approve(id);
    expect(response.status).toBe(200);
    return envelope(changeProposalApproveOutputSchema).parse(await response.json()).data.proposal;
  };
  const productTitle = async () => (await database.db.select().from(products)).find((row) => row.id === fixture.published)?.title;
  const onHand = async () => (await database.db.select().from(productStock)).find((row) => row.productId === fixture.published)?.onHand;
  const eventKinds = async (id: string) => (await database.db.select().from(changeProposalEvents))
    .filter((event) => event.proposalId === id)
    .toSorted((left, right) => left.sequence - right.sequence)
    .map((event) => event.kind);

  it('refuses an admin, every kind of key, an unverified owner and another workspace, and leaves the proposal pending', async () => {
    const proposal = await propose(SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, title: 'Guarded title' });
    const legacySecret = 'legacy-approve-secret';
    await database.db.insert(tenantApiKeys).values({
      id: 'legacy-approve', tenantId: 'acme', name: 'Legacy approve', keyHash: deps.apiKeyCrypto.hash(legacySecret),
      scopes: null, createdAt: now, expiresAt: null, revokedAt: null,
    });
    const before = await liveState();
    expect((await approve(proposal.id, adminToken)).status).toBe(403);
    for (const secret of [direct.secret, proposer.secret, legacySecret]) {
      expect([401, 403]).toContain((await keyed(secret, 'POST', approvePath(proposal.id), {})).status);
    }
    expect((await approve(proposal.id, ownerToken, studioHost)).status).toBe(404);
    expect((await sessionRequest(ownerToken, 'POST', approvePath(proposal.id), { note: 'unexpected' })).status).toBe(400);
    await database.db.execute(`update "user" set email_verified = false where id = '${ownerId}'`);
    try {
      expect((await approve(proposal.id)).status).toBe(403);
    } finally {
      await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
    }
    expect(await liveState()).toBe(before);
    expect(await eventKinds(proposal.id)).toEqual(['proposed']);
    expect(await productTitle()).toBe('Live handbook');
    expect((await approved(proposal.id)).status).toBe('applied');
    expect(await productTitle()).toBe('Guarded title');
  });

  it('applies the stored change once, tells the key, and answers a repeated approve with 409 and the stored status', async () => {
    const proposal = await propose(SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, title: 'Approved title' });
    const view = await approved(proposal.id);
    expect(view).toMatchObject({ status: 'applied', appliedResourceId: fixture.published, failureCode: null, decidedAt: now });
    expect(await productTitle()).toBe('Approved title');
    expect(await eventKinds(proposal.id)).toEqual(['proposed', 'applied']);

    const again = await approve(proposal.id);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'applied' } } });
    expect(await eventKinds(proposal.id)).toEqual(['proposed', 'applied']);

    const receipt = await keyed(proposer.secret, 'GET', SHOP_PROPOSAL_ROUTES.getProposal.path.replace(':id', proposal.id));
    const text = await receipt.text();
    expect(envelope(changeProposalReceiptOutputSchema).parse(JSON.parse(text)).data.proposal).toMatchObject({ status: 'applied', appliedResourceId: fixture.published });
    expect(text).not.toContain('effect');
    expect(text).not.toContain(ownerId);
    const listed = envelope(shopProposalContracts.listProposals.output).parse(await (await keyed(proposer.secret, 'GET', SHOP_PROPOSAL_ROUTES.listProposals.path)).json()).data;
    expect(listed.proposals.find((entry) => entry.id === proposal.id)).toMatchObject({ appliedResourceId: fixture.published });
  });

  it('marks a proposal stale when a live writer changed a field it touches, and applies nothing', async () => {
    const proposal = await propose(SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, title: 'Late title' });
    expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, title: 'Owner typed title' })).status).toBe(200);
    const before = await liveState();
    const view = await approved(proposal.id);
    expect(view).toMatchObject({ status: 'stale', appliedResourceId: null, failureCode: null });
    expect(await liveState()).toBe(before);
    expect(await productTitle()).toBe('Owner typed title');
    expect(await eventKinds(proposal.id)).toEqual(['proposed', 'stale']);
    expect((await approve(proposal.id)).status).toBe(409);
  });

  it('marks a proposal failed with the domain error when the stored command is refused at approval, and applies nothing', async () => {
    const stock = await onHand();
    if (stock === undefined) throw new Error('stock missing');
    const proposal = await propose(SHOP_CATALOG_ROUTES.adjustProductStock.path, { productId: fixture.published, delta: -stock, reason: 'sold at a fair' });
    expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.adjustProductStock.path, { productId: fixture.published, delta: -1, reason: 'damaged' })).status).toBe(200);
    const before = await liveState();
    const view = await approved(proposal.id);
    expect(view.status).toBe('failed');
    expect(view.failureCode).not.toBeNull();
    expect(view.failureMessage).not.toBeNull();
    expect(await liveState()).toBe(before);
    expect(await onHand()).toBe(stock - 1);
    expect(await eventKinds(proposal.id)).toEqual(['proposed', 'apply_failed']);
    const receipt = await keyed(proposer.secret, 'GET', SHOP_PROPOSAL_ROUTES.getProposal.path.replace(':id', proposal.id));
    expect(envelope(changeProposalReceiptOutputSchema).parse(await receipt.json()).data.proposal).toMatchObject({ status: 'failed', failureCode: view.failureCode });
  });

  it('answers 503 with a retry-after on the keyed route and on approve while a target row stays locked, and changes nothing', async () => {
    const proposal = await propose(SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, title: 'Locked out title' });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
    const holder = database.db.transaction(async (tx) => {
      await tx.execute(`select id from products where tenant_id = 'acme' and id = '${fixture.published}' for update`);
      locked();
      await held;
    });
    await lockTaken;
    const regularApp = app;
    try {
      const before = await liveState();
      const proposalsBefore = (await database.db.select().from(changeProposals)).length;

      app = briefLockWaitApp();
      const submitted = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: fixture.published, title: 'Another title' });
      const approval = await approve(proposal.id);

      for (const response of [submitted, approval]) {
        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('5');
        expect(await errorOf(response)).toMatchObject({ code: 'unavailable' });
      }
      expect((await database.db.select().from(changeProposals)).length).toBe(proposalsBefore);
      expect(await liveState()).toBe(before);
      expect(await eventKinds(proposal.id)).toEqual(['proposed']);
    } finally {
      app = regularApp;
      release();
      await holder;
    }
    expect((await approved(proposal.id)).status).toBe('applied');
  }, 30_000);

  it('proposes what a product grants, shows the owner the course title, and applies the stored list only on approval', async () => {
    const accessOf = async () => (await database.db.select().from(products)).find((row) => row.id === fixture.digital)?.accessItems;
    const before = await accessOf();
    const accessItems = [{ level: 'course', courseId: ACCESS_COURSE }];
    const proposal = await propose(SHOP_CATALOG_ROUTES.setProductAccess.path, { id: fixture.digital, accessItems });
    expect(proposal).toMatchObject({ operation: 'product.set-access', input: { id: fixture.digital, accessItems } });
    expect(await accessOf()).toEqual(before);
    const shown = await sessionRequest(ownerToken, 'GET', API_PATHS.changeProposal.replace(':id', proposal.id));
    const view = envelope(changeProposalShowOutputSchema).parse(await shown.json()).data.proposal;
    expect(view.effect).toEqual({ accessItems: { before, after: accessItems } });
    expect(view.accessLabels).toEqual({ courses: [{ id: ACCESS_COURSE, title: 'Field course' }], modules: [], lessons: [] });
    const receipt = await (await keyed(proposer.secret, 'GET', SHOP_PROPOSAL_ROUTES.getProposal.path.replace(':id', proposal.id))).text();
    expect(receipt).not.toContain('Field course');
    expect((await approved(proposal.id)).status).toBe('applied');
    expect(await accessOf()).toEqual(accessItems);
  });

  it.each([
    ['checkoutReturnOrigins', ['https://shop.example.test']],
    ['defaultHomeSpaceId', 'space-1'],
  ] as const)('refuses a settings proposal carrying %s, which a key may not write, and stores nothing', async (field, value) => {
    const proposalsBefore = (await database.db.select().from(changeProposals)).length;
    const response = await keyed(proposer.secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { name: 'Sneaky name', [field]: value });
    expect(response.status).toBe(400);
    expect((await database.db.select().from(changeProposals)).length).toBe(proposalsBefore);
    expect((await database.db.select().from(tenants)).find((row) => row.id === 'acme')?.name).not.toBe('Sneaky name');
  });

  it('applies the newly proposable sales-link and settings operations exactly as shown', async () => {
    const shownEffect = async (id: string) => {
      const shown = await sessionRequest(ownerToken, 'GET', API_PATHS.changeProposal.replace(':id', id));
      expect(shown.status).toBe(200);
      return Object.entries(envelope(changeProposalShowOutputSchema).parse(await shown.json()).data.proposal.effect);
    };
    const afterValues = (effect: Awaited<ReturnType<typeof shownEffect>>) =>
      effect.flatMap(([field, change]) => 'after' in change ? [[field, change.after] as const] : []);
    const liveSalesLink = async () => {
      const response = await keyed(proposer.secret, 'GET', SHOP_ASSETS_ROUTES.getSalesLink.path.replace(':id', fixture.salesLink));
      return response.status === 404 ? null : envelope(shopAssetsContracts.getSalesLink.output).parse(await response.json()).data.salesLink;
    };
    const liveSettings = async () =>
      envelope(shopSettingsContracts.getSettings.output).parse(await (await keyed(proposer.secret, 'GET', SHOP_SETTINGS_ROUTES.getSettings.path)).json()).data.settings;

    const heading = await propose(SHOP_ASSETS_ROUTES.updateSalesLink.path.replace(':id', fixture.salesLink), {
      ...salesLinkFields(), id: fixture.salesLink, expectedRevision: 1, heading: 'Approved heading',
    });
    const settings = await propose(SHOP_SETTINGS_ROUTES.updateSettings.path, { name: 'Approved shop name' });
    const headingEffect = afterValues(await shownEffect(heading.id));
    const settingsEffect = afterValues(await shownEffect(settings.id));
    expect(headingEffect).toContainEqual(['heading', 'Approved heading']);
    expect(settingsEffect).toEqual([['name', 'Approved shop name']]);

    expect((await approved(heading.id)).status).toBe('applied');
    expect((await approved(settings.id)).status).toBe('applied');
    const link = await liveSalesLink();
    const shop = await liveSettings();
    for (const [field, after] of headingEffect) expect(Reflect.get(link ?? {}, field) ?? null, field).toEqual(after);
    for (const [field, after] of settingsEffect) expect(Reflect.get(shop, field) ?? null, field).toEqual(after);

    const removal = await keyed(proposer.secret, 'DELETE', SHOP_ASSETS_ROUTES.deleteSalesLink.path.replace(':id', fixture.salesLink));
    expect(removal.status).toBe(202);
    const removalProposal = envelope(changeProposalProposedOutputSchema).parse(await removal.json()).data.proposal;
    expect(removalProposal.input).toEqual({ id: fixture.salesLink });
    const removalEffect = afterValues(await shownEffect(removalProposal.id));
    expect(removalEffect).toContainEqual(['exists', false]);
    expect((await approved(removalProposal.id)).status).toBe('applied');
    expect(await liveSalesLink()).toBeNull();
    for (const [field, after] of removalEffect) expect(after, field).toEqual(field === 'exists' ? false : null);
    expect((await database.db.select().from(salesLinks)).find((row) => row.id === fixture.salesLink)?.deletedAt).not.toBeNull();
  });
});
