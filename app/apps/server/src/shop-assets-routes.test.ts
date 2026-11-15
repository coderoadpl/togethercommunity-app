import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { tenantAdmins, tenants } from '#adapters/db/schema.js';
import {
  API_ROUTES,
  apiKeyCreateOutputSchema,
  SHOP_ASSETS_ROUTES,
  shopAssetsContracts,
  SHOP_CATALOG_ROUTES,
  shopCatalogContracts,
} from '#core/contract/index.js';
import { err, notFound, ok, IMAGE_ASSET_MAX_BYTES } from '#core/domain/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const email = 'shop-assets-owner@example.test';
const password = 'shop-assets-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const READ = 'shop:catalog:read';
const WRITE = 'shop:catalog:write';
const storageSecret = JSON.stringify({
  provider: 'minio', endpoint: 'https://storage.example.test', region: 'us-east-1',
  bucket: 'private-assets', accessKeyId: 'key', secretAccessKey: 'secret',
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWMwTptJEmIY1ZA2GkrGwzVpAABIfDIQjwcm5wAAAABJRU5ErkJggg==', 'base64');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let ownerToken: string;
const objects = new Map<string, Uint8Array>();

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;
const ownerRequest = (method: string, path: string, body: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createShopKey = async (scopes: string[], host = acmeHost) => {
  const response = await ownerRequest(API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, {
    name: `Shop ${scopes.join(' ')}`, kind: 'shop_management', scopes, expiresAt,
  }, host);
  expect(response.status).toBe(200);
  return envelope(apiKeyCreateOutputSchema).parse(await response.json()).data.secret;
};

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const unsignedUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
};

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_settings_routes_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-assets-routes-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp({
    ...deps,
    secretResolver: {
      resolve: async (tenantId, key) => key === 's3.configuration' ? ok(storageSecret) : deps.secretResolver.resolve(tenantId, key),
    },
    storage: {
      ...deps.storage,
      head: async ({ url }) => ok({ sizeBytes: objects.get(url)?.byteLength ?? 0 }),
      getObject: async ({ url }) => {
        const bytes = objects.get(url);
        return bytes === undefined ? err(notFound('missing')) : ok(new Uint8Array(bytes));
      },
      putObject: async ({ url, body }) => {
        objects.set(url, new Uint8Array(body));
        return ok(undefined);
      },
      delete: async ({ url }) => {
        objects.delete(url);
        return ok({ deleted: true as const });
      },
    },
  });

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Shop Assets Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  const ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: ownerId, role: 'owner' });
  }
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

const linkPath = (id: string) => SHOP_ASSETS_ROUTES.getSalesLink.path.replace(':id', id);
let productNumber = 0;
const createProduct = async (secret: string, host = acmeHost) => {
  const response = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, {
    title: `Printed handbook ${String(++productNumber)}`, type: 'physical', priceCents: 4900,
  }, host);
  expect(response.status).toBe(200);
  return envelope(shopCatalogContracts.createProduct.output).parse(await response.json()).data.product;
};
const linkFields = (productId: string) => ({ slug: 'handbook-bundle', title: 'Handbook bundle', heading: 'Printed handbook', productIds: [productId] });
const beginCover = async (secret: string, host = acmeHost) => {
  const response = await keyed(secret, 'POST', SHOP_ASSETS_ROUTES.productCoverUpload.path, {
    kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: png.byteLength,
  }, host);
  expect(response.status).toBe(200);
  return envelope(shopAssetsContracts.productCoverUpload.output).parse(await response.json()).data;
};
const allRoutes = Object.values(SHOP_ASSETS_ROUTES);

describe('shop asset routes with shop management keys', () => {
  it('uploads, completes, attaches and publicly serves a product cover through fake storage', async () => {
    const secret = await createShopKey([WRITE]);
    const product = await createProduct(secret);
    const candidate = await beginCover(secret);
    objects.set(unsignedUrl(candidate.upload.url), png);
    const response = await keyed(secret, 'POST', SHOP_ASSETS_ROUTES.productCoverComplete.path, { key: candidate.key });
    expect(response.status).toBe(200);
    const { url } = envelope(shopAssetsContracts.productCoverComplete.output).parse(await response.json()).data;
    expect(url).toBe(candidate.servePath);
    expect(objects.has(unsignedUrl(candidate.upload.url))).toBe(false);
    const attached = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: product.id, coverUrl: url });
    expect(attached.status).toBe(200);
    expect(envelope(shopCatalogContracts.updateProduct.output).parse(await attached.json()).data.product.coverUrl).toBe(url);
    const served = await app.request(`${baseUrl}${url}`, { headers: { host: acmeHost, origin: 'https://store.example.test' } });
    expect(served.status).toBe(302);
    const location = z.string().url().parse(served.headers.get('location'));
    expect(new URL(location).pathname).toContain('/image-assets/acme/product-cover/');
    expect(objects.get(unsignedUrl(location))).toEqual(new Uint8Array(png));
  });

  it('rejects an unknown field in cover upload and sales-link bodies before any write', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const product = await createProduct(secret);
    const stored = objects.size;
    for (const [path, body] of [
      [SHOP_ASSETS_ROUTES.productCoverUpload.path, { kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: png.byteLength, width: 800 }],
      [SHOP_ASSETS_ROUTES.productCoverComplete.path, { key: 'image-asset-candidates/acme/product-cover/1.png', productId: product.id }],
      [SHOP_ASSETS_ROUTES.createSalesLink.path, { ...linkFields(product.id), slug: 'strict-bundle', subtitle: 'Typo of heading' }],
    ] as const) {
      const response = await keyed(secret, 'POST', path, body);
      expect(response.status, path).toBe(400);
      expect((await errorOf(response)).code).toBe('validation');
    }
    expect(objects.size).toBe(stored);
    const links = await keyed(secret, 'GET', SHOP_ASSETS_ROUTES.listSalesLinks.path);
    expect(JSON.stringify(await links.json())).not.toContain('strict-bundle');
  });

  it('rejects another workspace key and foreign candidate without publishing or deleting it', async () => {
    const secret = await createShopKey([WRITE]);
    const studioSecret = await createShopKey([WRITE], studioHost);
    const candidate = await beginCover(studioSecret, studioHost);
    const target = unsignedUrl(candidate.upload.url);
    objects.set(target, png);
    expect((await keyed(studioSecret, 'POST', SHOP_ASSETS_ROUTES.productCoverComplete.path, { key: candidate.key })).status).toBe(401);
    const response = await keyed(secret, 'POST', SHOP_ASSETS_ROUTES.productCoverComplete.path, { key: candidate.key });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe('not_found');
    expect(objects.get(target)).toBe(png);
  });

  it.each([
    ['signature', new Uint8Array([1, 2, 3, 4])],
    ['empty', new Uint8Array()],
    ['oversized', new Uint8Array(IMAGE_ASSET_MAX_BYTES + 1)],
  ])('rejects %s bytes on completion and removes the candidate', async (_label, bytes) => {
    const secret = await createShopKey([WRITE]);
    const candidate = await beginCover(secret);
    const target = unsignedUrl(candidate.upload.url);
    objects.set(target, bytes);
    const response = await keyed(secret, 'POST', SHOP_ASSETS_ROUTES.productCoverComplete.path, { key: candidate.key });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('validation');
    expect(objects.has(target)).toBe(false);
    expect(objects.has(target.replace('image-asset-candidates/', 'image-assets/'))).toBe(false);
  });

  it('lists, reads, creates, revises and deletes sales links, preserving revision conflicts', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const product = await createProduct(secret);
    const fields = linkFields(product.id);
    const created = await keyed(secret, 'POST', SHOP_ASSETS_ROUTES.createSalesLink.path, fields);
    expect(created.status).toBe(201);
    const { salesLink } = envelope(shopAssetsContracts.createSalesLink.output).parse(await created.json()).data;
    const path = linkPath(salesLink.id);
    const readSecret = await createShopKey([READ]);
    const listed = await keyed(readSecret, 'GET', SHOP_ASSETS_ROUTES.listSalesLinks.path);
    expect(listed.status).toBe(200);
    expect(envelope(shopAssetsContracts.listSalesLinks.output).parse(await listed.json()).data.salesLinks.map((link) => link.id)).toContain(salesLink.id);
    const shown = await keyed(readSecret, 'GET', path);
    expect(shown.status).toBe(200);
    expect(envelope(shopAssetsContracts.getSalesLink.output).parse(await shown.json()).data.salesLink.revision).toBe(1);
    const input = { ...fields, id: salesLink.id, expectedRevision: 1, heading: 'Second edition' };
    const updated = await keyed(secret, 'POST', path, input);
    expect(updated.status).toBe(200);
    expect(envelope(shopAssetsContracts.updateSalesLink.output).parse(await updated.json()).data.salesLink).toMatchObject({ revision: 2, heading: 'Second edition' });
    const stale = await keyed(secret, 'POST', path, input);
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).code).toBe('conflict');
    const mismatched = await keyed(secret, 'POST', path, { ...input, id: 'another-link', expectedRevision: 2 });
    expect(mismatched.status).toBe(400);
    expect((await errorOf(mismatched)).code).toBe('validation');
    const deleted = await keyed(secret, 'DELETE', path);
    expect(deleted.status).toBe(200);
    expect(envelope(shopAssetsContracts.deleteSalesLink.output).parse(await deleted.json()).data).toEqual({ deleted: true });
    expect((await keyed(secret, 'GET', path)).status).toBe(404);
  });

  it('treats foreign sales-link ids as not found on reads, updates and deletes', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const studioSecret = await createShopKey([READ, WRITE], studioHost);
    const product = await createProduct(studioSecret, studioHost);
    const fields = linkFields(product.id);
    const created = await keyed(studioSecret, 'POST', SHOP_ASSETS_ROUTES.createSalesLink.path, fields, studioHost);
    expect(created.status).toBe(201);
    const { salesLink } = envelope(shopAssetsContracts.createSalesLink.output).parse(await created.json()).data;
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await keyed(secret, method, linkPath(salesLink.id), method === 'POST' ? { ...fields, id: salesLink.id, expectedRevision: 1 } : undefined);
      expect(response.status, method).toBe(404);
      expect((await errorOf(response)).code).toBe('not_found');
    }
    const untouched = await keyed(studioSecret, 'GET', linkPath(salesLink.id), undefined, studioHost);
    expect(envelope(shopAssetsContracts.getSalesLink.output).parse(await untouched.json()).data.salesLink.revision).toBe(1);
  });

  it('refuses every mutation by a read-only key', async () => {
    const secret = await createShopKey([READ]);
    for (const route of allRoutes.filter((route) => route.method !== 'GET')) {
      const response = await keyed(secret, route.method, route.path.replace(':id', 'link'), {});
      expect(response.status, route.path).toBe(403);
      expect(await errorOf(response)).toEqual({ code: 'forbidden', message: 'shop:catalog:write is not permitted' });
    }
  });

  it('refuses every route for orders-only and legacy keys', async () => {
    const ordersSecret = await createShopKey(['shop:orders:read']);
    const legacy = await ownerRequest(API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, { name: 'Legacy', scopes: ['import:content'], expiresAt });
    expect(legacy.status).toBe(200);
    const legacySecret = envelope(apiKeyCreateOutputSchema).parse(await legacy.json()).data.secret;
    for (const [secret, status, code] of [[ordersSecret, 403, 'forbidden'], [legacySecret, 401, 'unauthorized']] as const) {
      for (const route of allRoutes) {
        const response = await keyed(secret, route.method, route.path.replace(':id', 'link'), route.method === 'GET' ? undefined : {});
        expect(response.status, `${route.method} ${route.path}`).toBe(status);
        expect((await errorOf(response)).code).toBe(code);
      }
    }
  });
});
