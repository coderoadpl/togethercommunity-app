import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { entityVersions, shopManagementKeyEvents, stockEvents, tenantAdmins, tenantApiKeys, tenants } from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeyCreateOutputSchema,
  apiKeysShopManagementEventsOutputSchema,
  apiKeysShopManagementPurgeOutputSchema,
  publicOfferOutputSchema,
  SHOP_CATALOG_ROUTES,
  shopCatalogContracts,
} from '#core/contract/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const email = 'shop-catalog-owner@example.test';
const password = 'shop-catalog-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let ownerId: string;
let ownerToken: string;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;

const ownerRequest = (method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host,
    authorization: `Bearer ${ownerToken}`,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createKey = async (input: Record<string, unknown>, host = acmeHost) => {
  const response = await ownerRequest(API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, input, host);
  expect(response.status).toBe(200);
  return envelope(apiKeyCreateOutputSchema).parse(await response.json()).data;
};

const createShopKey = (scopes: string[], host = acmeHost) =>
  createKey({ name: `Shop ${scopes.join(' ')}`, kind: 'shop_management', scopes, expiresAt }, host);

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host,
    'x-api-key': secret,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const productPath = (path: string, productId: string): string => path.replace(':productId', productId);

const readRoutes = (productId: string) => [
  ['GET', SHOP_CATALOG_ROUTES.listProducts.path],
  ['GET', productPath(SHOP_CATALOG_ROUTES.listProductPrices.path, productId)],
  ['GET', productPath(SHOP_CATALOG_ROUTES.getProductStock.path, productId)],
] as const;

const writeRoutes = (productId: string) => [
  [SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Refused', type: 'physical', priceCents: 100 }],
  [SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, title: 'Refused' }],
  [SHOP_CATALOG_ROUTES.publishProduct.path, { id: productId }],
  [SHOP_CATALOG_ROUTES.unpublishProduct.path, { id: productId }],
  [SHOP_CATALOG_ROUTES.deleteProductDraft.path, { productId }],
  [SHOP_CATALOG_ROUTES.createProductPrice.path, { productId, kind: 'one_time', amountCents: 100 }],
  [SHOP_CATALOG_ROUTES.deactivateProductPrice.path, { id: 'price' }],
  [SHOP_CATALOG_ROUTES.enableProductStock.path, { productId, onHand: 1, lowStockThreshold: null }],
  [SHOP_CATALOG_ROUTES.adjustProductStock.path, { productId, delta: 1, reason: 'delivery' }],
  [SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId, lowStockThreshold: 1 }],
] as const;

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_catalog_routes_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-catalog-routes-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp(deps);

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Shop Catalog Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
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

describe('shop catalog routes with a shop management key', () => {
  it('creates, prices, stocks and publishes a physical product that the public offer then lists', async () => {
    const { secret } = await createShopKey(['shop:catalog:read', 'shop:catalog:write']);

    const created = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, {
      title: 'Printed handbook', type: 'physical', priceCents: 4900, currency: 'PLN', slug: 'printed-handbook',
    });
    expect(created.status).toBe(200);
    const { product } = envelope(shopCatalogContracts.createProduct.output).parse(await created.json()).data;
    expect(product).toMatchObject({ type: 'physical', published: false, tenantId: 'acme' });

    const updated = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: product.id, description: 'Second edition' });
    expect(updated.status).toBe(200);
    const versions = (await database.db.select().from(entityVersions))
      .filter((version) => version.tenantId === 'acme' && version.entityId === product.id);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((version) => version.createdBy === ownerId)).toBe(true);

    const priced = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProductPrice.path, {
      productId: product.id, kind: 'one_time', amountCents: 4900, currency: 'PLN',
    });
    expect(priced.status).toBe(200);
    const { price } = envelope(shopCatalogContracts.createProductPrice.output).parse(await priced.json()).data;
    expect(price).toMatchObject({ productId: product.id, kind: 'one_time', active: true });

    const stocked = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.enableProductStock.path, {
      productId: product.id, onHand: 20, lowStockThreshold: 5,
    });
    expect(stocked.status).toBe(200);
    const adjusted = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.adjustProductStock.path, {
      productId: product.id, delta: -2, reason: 'damaged',
    });
    expect(adjusted.status).toBe(200);
    expect(envelope(shopCatalogContracts.adjustProductStock.output).parse(await adjusted.json()).data.stock).toMatchObject({ onHand: 18 });
    const threshold = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.setProductStockThreshold.path, {
      productId: product.id, lowStockThreshold: 3,
    });
    expect(threshold.status).toBe(200);
    const events = (await database.db.select().from(stockEvents))
      .filter((event) => event.tenantId === 'acme' && event.productId === product.id);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((event) => event.actorUserId === ownerId)).toBe(true);

    const published = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.publishProduct.path, { id: product.id });
    expect(published.status).toBe(200);
    expect(envelope(shopCatalogContracts.publishProduct.output).parse(await published.json()).data.product.published).toBe(true);

    const listed = await keyed(secret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path);
    expect(listed.status).toBe(200);
    const catalog = envelope(shopCatalogContracts.listProducts.output).parse(await listed.json()).data;
    expect(catalog.products.map((entry) => entry.id)).toContain(product.id);
    expect(catalog.stock.find((entry) => entry.productId === product.id)).toMatchObject({ onHand: 18, lowStockThreshold: 3 });

    const prices = await keyed(secret, 'GET', productPath(SHOP_CATALOG_ROUTES.listProductPrices.path, product.id));
    expect(envelope(shopCatalogContracts.listProductPrices.output).parse(await prices.json()).data.prices.map((entry) => entry.id)).toEqual([price.id]);
    const stock = await keyed(secret, 'GET', productPath(SHOP_CATALOG_ROUTES.getProductStock.path, product.id));
    expect(envelope(shopCatalogContracts.getProductStock.output).parse(await stock.json()).data.stock).toMatchObject({ onHand: 18 });

    const offer = await app.request(`${baseUrl}${API_PATHS.publicOffer}`, { headers: { host: acmeHost } });
    expect(offer.status).toBe(200);
    const offered = envelope(publicOfferOutputSchema).parse(await offer.json()).data.products.find((entry) => entry.id === product.id);
    expect(offered).toMatchObject({ title: 'Printed handbook', type: 'physical', prices: [expect.objectContaining({ id: price.id })] });
  });

  it('unpublishes, deactivates a price and deletes only a never-published draft', async () => {
    const { secret } = await createShopKey(['shop:catalog:write']);
    const created = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Short run', type: 'physical', priceCents: 1000 });
    const { product } = envelope(shopCatalogContracts.createProduct.output).parse(await created.json()).data;
    const priced = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProductPrice.path, { productId: product.id, kind: 'one_time', amountCents: 1000 });
    const { price } = envelope(shopCatalogContracts.createProductPrice.output).parse(await priced.json()).data;
    expect((await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.publishProduct.path, { id: product.id })).status).toBe(200);

    const published = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.deleteProductDraft.path, { productId: product.id });
    expect(published.status).toBe(400);
    expect(await errorOf(published)).toEqual({ code: 'validation', message: 'This product has been published and cannot be deleted' });
    expect((await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.unpublishProduct.path, { id: product.id })).status).toBe(200);
    const deactivated = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.deactivateProductPrice.path, { id: price.id });
    expect(deactivated.status).toBe(200);
    expect(envelope(shopCatalogContracts.deactivateProductPrice.output).parse(await deactivated.json()).data.price.active).toBe(false);
    expect((await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.deleteProductDraft.path, { productId: product.id })).status).toBe(400);

    const draft = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Never sold', type: 'physical', priceCents: 1000 });
    const draftId = envelope(shopCatalogContracts.createProduct.output).parse(await draft.json()).data.product.id;
    const deleted = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.deleteProductDraft.path, { productId: draftId });
    expect(deleted.status).toBe(200);
    expect(envelope(shopCatalogContracts.deleteProductDraft.output).parse(await deleted.json()).data).toEqual({ deleted: true });
  });

  it('refuses every write with a read-only key and still serves its reads', async () => {
    const { secret } = await createShopKey(['shop:catalog:read']);
    for (const [path, body] of writeRoutes('any-product')) {
      const response = await keyed(secret, 'POST', path, body);
      expect(response.status, path).toBe(403);
      expect(await errorOf(response), path).toEqual({ code: 'forbidden', message: 'shop:catalog:write is not permitted' });
    }
    expect(writeRoutes('any-product')).toHaveLength(10);
    expect((await keyed(secret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path)).status).toBe(200);
  });

  it('refuses reads and writes with a key that carries only another shop scope', async () => {
    const { secret } = await createShopKey(['shop:orders:read']);
    for (const [method, path] of readRoutes('any-product')) {
      const response = await keyed(secret, method, path);
      expect(response.status, path).toBe(403);
      expect(await errorOf(response), path).toEqual({ code: 'forbidden', message: 'shop:catalog:read is not permitted' });
    }
    expect((await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Refused', priceCents: 1 })).status).toBe(403);
  });

  it('refuses a legacy import key and a legacy unscoped key as invalid', async () => {
    const { secret: importSecret } = await createKey({ name: 'Importer', scopes: ['import:content'], expiresAt });
    const unscopedSecret = 'legacy-unscoped-shop-catalog-secret';
    const deps = createDeps(envSchema.parse({
      NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
      APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
      BETTER_AUTH_SECRET: 'shop-catalog-routes-test-secret-at-least-32-characters',
    }), { db: database.db });
    await database.db.insert(tenantApiKeys).values({
      id: 'legacy-unscoped', tenantId: 'acme', name: 'Legacy', keyHash: deps.apiKeyCrypto.hash(unscopedSecret),
      kind: 'legacy', scopes: null, issuedByUserId: null, createdAt: now, expiresAt: null, revokedAt: null,
    });
    for (const secret of [importSecret, unscopedSecret]) {
      for (const [method, path, body] of [
        ['GET', SHOP_CATALOG_ROUTES.listProducts.path, undefined],
        ['POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Refused', priceCents: 1 }],
      ] as const) {
        const response = await keyed(secret, method, path, body);
        expect(response.status, path).toBe(401);
        expect(await errorOf(response)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
      }
    }
  });

  it('refuses a key on another workspace host and treats foreign product and price ids as not found', async () => {
    const { secret } = await createShopKey(['shop:catalog:read', 'shop:catalog:write']);
    const wrongHost = await keyed(secret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path, undefined, studioHost);
    expect(wrongHost.status).toBe(401);
    expect(await errorOf(wrongHost)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });

    const { secret: studioSecret } = await createShopKey(['shop:catalog:read', 'shop:catalog:write'], studioHost);
    const created = await keyed(studioSecret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Studio print', type: 'physical', priceCents: 500 }, studioHost);
    const { product: foreign } = envelope(shopCatalogContracts.createProduct.output).parse(await created.json()).data;
    const priced = await keyed(studioSecret, 'POST', SHOP_CATALOG_ROUTES.createProductPrice.path, { productId: foreign.id, kind: 'one_time', amountCents: 500 }, studioHost);
    const { price: foreignPrice } = envelope(shopCatalogContracts.createProductPrice.output).parse(await priced.json()).data;

    for (const [path, body] of [
      ...writeRoutes(foreign.id).filter(([path]) => path !== SHOP_CATALOG_ROUTES.createProduct.path && path !== SHOP_CATALOG_ROUTES.deactivateProductPrice.path),
      [SHOP_CATALOG_ROUTES.deactivateProductPrice.path, { id: foreignPrice.id }],
    ] as const) {
      const response = await keyed(secret, 'POST', path, body);
      expect(response.status, path).toBe(404);
      expect((await errorOf(response)).code, path).toBe('not_found');
    }
    for (const [method, path] of readRoutes(foreign.id).slice(1)) {
      const response = await keyed(secret, method, path);
      expect(response.status, path).toBe(404);
    }
    const listed = await keyed(secret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path);
    expect(envelope(shopCatalogContracts.listProducts.output).parse(await listed.json()).data.products.map((entry) => entry.id)).not.toContain(foreign.id);

    const studioProducts = await keyed(studioSecret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path, undefined, studioHost);
    const untouched = envelope(shopCatalogContracts.listProducts.output).parse(await studioProducts.json()).data.products.find((entry) => entry.id === foreign.id);
    expect(untouched).toMatchObject({ title: 'Studio print', published: false });
  });

  it('rejects unknown body fields at the top level and in nested objects and persists nothing', async () => {
    const { secret } = await createShopKey(['shop:catalog:read', 'shop:catalog:write']);
    const created = await keyed(secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Strict body', type: 'physical', priceCents: 700 });
    const { product } = envelope(shopCatalogContracts.createProduct.output).parse(await created.json()).data;
    const compliance = {
      manufacturerName: 'Acme Print', manufacturerAddress: 'Main Street 1', manufacturerEmail: 'print@example.test', modelIdentifier: 'HB-1',
    };

    for (const [path, body] of [
      [SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Typo product', type: 'physical', priceCents: 700, pricecents: 700 }],
      [SHOP_CATALOG_ROUTES.updateProduct.path, { id: product.id, title: 'Renamed', descripton: 'typo' }],
      [SHOP_CATALOG_ROUTES.updateProduct.path, { id: product.id, compliance: { ...compliance, manufacturerPhone: '000' } }],
      [SHOP_CATALOG_ROUTES.publishProduct.path, { id: product.id, force: true }],
      [SHOP_CATALOG_ROUTES.createProductPrice.path, { productId: product.id, kind: 'one_time', amountCents: 700, curency: 'PLN' }],
      [SHOP_CATALOG_ROUTES.deleteProductDraft.path, { productId: product.id, cascade: true }],
    ] as const) {
      const response = await keyed(secret, 'POST', path, body);
      expect(response.status, path).toBe(400);
      expect((await errorOf(response)).code, path).toBe('validation');
    }

    const listed = envelope(shopCatalogContracts.listProducts.output)
      .parse(await (await keyed(secret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path)).json()).data.products;
    expect(listed.map((entry) => entry.title)).not.toContain('Typo product');
    expect(listed.find((entry) => entry.id === product.id)).toMatchObject({ title: 'Strict body', description: '', published: false, compliance: null });
    const prices = await keyed(secret, 'GET', productPath(SHOP_CATALOG_ROUTES.listProductPrices.path, product.id));
    expect(envelope(shopCatalogContracts.listProductPrices.output).parse(await prices.json()).data.prices).toEqual([]);
  });

  it('keeps the session product route tolerant of unknown fields', async () => {
    const response = await ownerRequest(API_ROUTES.productsCreate.method, API_ROUTES.productsCreate.path, {
      title: 'Session product', type: 'physical', priceCents: 300, pricecents: 300,
    });
    expect(response.status).toBe(200);
  });

  it('blocks the very next call once the owner revokes the key', async () => {
    const { apiKey, secret } = await createShopKey(['shop:catalog:read']);
    expect((await keyed(secret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path)).status).toBe(200);
    const revoked = await ownerRequest(API_ROUTES.apiKeyRevoke.method, API_PATHS.apiKeyRevoke.replace(':id', apiKey.id));
    expect(revoked.status).toBe(200);
    const refused = await keyed(secret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path);
    expect(refused.status).toBe(401);
    expect(await errorOf(refused)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
  });
});

describe('shop management key history of keyed requests', () => {
  const requestRows = async (apiKeyId: string) => (await database.db.select().from(shopManagementKeyEvents))
    .filter((event) => event.apiKeyId === apiKeyId && event.kind === 'request')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((event) => ({
      actorUserId: event.actorUserId, method: event.method, route: event.route,
      resourceId: event.resourceId, status: event.status, outcome: event.outcome,
    }));
  let writer: Awaited<ReturnType<typeof createShopKey>>;
  let reader: Awaited<ReturnType<typeof createShopKey>>;
  let productId: string;

  beforeAll(async () => {
    writer = await createShopKey(['shop:catalog:read', 'shop:catalog:write']);
    reader = await createShopKey(['shop:catalog:read']);
    const created = await keyed(writer.secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, {
      title: 'History handbook', type: 'physical', priceCents: 4900, currency: 'PLN',
    });
    expect(created.status).toBe(200);
    productId = envelope(shopCatalogContracts.createProduct.output).parse(await created.json()).data.product.id;
  });

  it('writes exactly one row per keyed mutation, succeeded, refused or invalid, with the key, issuer, route, resource and outcome', async () => {
    const updated = await keyed(writer.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, description: 'Second edition' });
    expect(updated.status).toBe(200);
    const invalid = await keyed(writer.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, misspelt: true });
    expect(invalid.status).toBe(400);
    const refused = await keyed(reader.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId, title: 'Refused' });
    expect(refused.status).toBe(403);

    const row = (status: number, outcome: string, resourceId: string | null, route: string = SHOP_CATALOG_ROUTES.updateProduct.path) =>
      ({ actorUserId: ownerId, method: 'POST', route, resourceId, status, outcome });
    expect(await requestRows(writer.apiKey.id)).toEqual(expect.arrayContaining([
      row(200, 'succeeded', null, SHOP_CATALOG_ROUTES.createProduct.path),
      row(200, 'succeeded', productId),
      row(400, 'refused', productId),
    ]));
    expect(await requestRows(writer.apiKey.id)).toHaveLength(3);
    expect(await requestRows(reader.apiKey.id)).toEqual([row(403, 'refused', productId)]);
  });

  it('writes no row for a keyed read', async () => {
    const before = await requestRows(reader.apiKey.id);
    expect((await keyed(reader.secret, 'GET', SHOP_CATALOG_ROUTES.listProducts.path)).status).toBe(200);
    expect((await keyed(reader.secret, 'GET', productPath(SHOP_CATALOG_ROUTES.listProductPrices.path, productId))).status).toBe(200);
    expect(await requestRows(reader.apiKey.id)).toEqual(before);
  });

  it('writes no row when the presented secret matches no key', async () => {
    const before = (await database.db.select().from(shopManagementKeyEvents)).length;
    expect((await keyed('never-issued-secret', 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: productId })).status).toBe(401);
    expect(await database.db.select().from(shopManagementKeyEvents)).toHaveLength(before);
  });

  it('lists the history to the owner page by page, per key, and only for the selected workspace', async () => {
    const listed = await ownerRequest('GET', `${API_PATHS.apiKeysShopManagementEvents}?keyId=${writer.apiKey.id}&limit=2`);
    expect(listed.status).toBe(200);
    const page = envelope(apiKeysShopManagementEventsOutputSchema).parse(await listed.json()).data;
    expect(page.events).toHaveLength(2);
    expect(page.nextCursor).toBe(page.events[1]?.id);
    const rest = await ownerRequest('GET', `${API_PATHS.apiKeysShopManagementEvents}?keyId=${writer.apiKey.id}&cursor=${page.nextCursor ?? ''}`);
    const remaining = envelope(apiKeysShopManagementEventsOutputSchema).parse(await rest.json()).data;
    expect(remaining.nextCursor).toBeNull();
    const all = [...page.events, ...remaining.events];
    expect(all.every((event) => event.apiKeyId === writer.apiKey.id && event.tenantId === 'acme')).toBe(true);
    expect(all.map((event) => `${event.kind} ${String(event.status)}`).sort())
      .toEqual(['created null', 'request 200', 'request 200', 'request 400']);

    const otherWorkspace = await ownerRequest('GET', API_PATHS.apiKeysShopManagementEvents, undefined, studioHost);
    expect(otherWorkspace.status).toBe(200);
    expect(envelope(apiKeysShopManagementEventsOutputSchema).parse(await otherWorkspace.json()).data.events
      .some((event) => event.apiKeyId === writer.apiKey.id || event.tenantId === 'acme')).toBe(false);
  });

  it('refuses the history to a shop management key', async () => {
    expect((await keyed(writer.secret, 'GET', API_PATHS.apiKeysShopManagementEvents)).status).toBe(401);
  });

  it('keeps the request rows after the keys are purged', async () => {
    const before = await requestRows(writer.apiKey.id);
    const purged = await ownerRequest(API_ROUTES.apiKeysShopManagementPurge.method, API_ROUTES.apiKeysShopManagementPurge.path);
    expect(envelope(apiKeysShopManagementPurgeOutputSchema).parse(await purged.json()).data.purged).toBeGreaterThan(0);
    expect(await requestRows(writer.apiKey.id)).toEqual(before);
    const listed = await ownerRequest('GET', `${API_PATHS.apiKeysShopManagementEvents}?keyId=${writer.apiKey.id}`);
    expect(envelope(apiKeysShopManagementEventsOutputSchema).parse(await listed.json()).data.events.map((event) => event.kind))
      .toContain('purged');
  });
});
