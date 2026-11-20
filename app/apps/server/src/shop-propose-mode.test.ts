import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  changeProposalEvents,
  changeProposals,
  emailOutbox,
  entityVersions,
  productPrices,
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
  changeProposalProposedOutputSchema,
  changeProposalReceiptOutputSchema,
  changeProposalRejectOutputSchema,
  changeProposalShowOutputSchema,
  changeProposalsListOutputSchema,
  SHOP_CATALOG_ROUTES,
  SHOP_PROPOSAL_ROUTES,
  shopCatalogContracts,
  shopProposalContracts,
} from '#core/contract/index.js';
import { shopManagementKeyHash } from '#core/server/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';
import { shopAssetsRoutes } from './shop-assets-routes.js';
import { shopCatalogRoutes } from './shop-catalog-routes.js';
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
let ownerToken: string;
let ownerId: string;
let adminToken: string;

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

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host,
    'x-api-key': secret,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
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
    secrets: forWorkspace(await database.db.select().from(tenantSecrets)),
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
  ...shopIntegrationRoutes(deps), ...shopProposalRoutes(deps),
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
}

let fixture: Fixture;
let direct: Awaited<ReturnType<typeof createShopKey>>;
let proposer: Awaited<ReturnType<typeof createShopKey>>;

const proposalBodies = (): Record<string, unknown> => ({
  [SHOP_CATALOG_ROUTES.createProduct.path]: { title: 'Proposed handbook', type: 'physical', priceCents: 1500 },
  [SHOP_CATALOG_ROUTES.updateProduct.path]: { id: fixture.published, title: 'Proposed title' },
  [SHOP_CATALOG_ROUTES.publishProduct.path]: { id: fixture.draft },
  [SHOP_CATALOG_ROUTES.unpublishProduct.path]: { id: fixture.published },
  [SHOP_CATALOG_ROUTES.deleteProductDraft.path]: { productId: fixture.draft },
  [SHOP_CATALOG_ROUTES.createProductPrice.path]: { productId: fixture.draft, kind: 'one_time', amountCents: 2500 },
  [SHOP_CATALOG_ROUTES.deactivateProductPrice.path]: { id: fixture.publishedPrice },
  [SHOP_CATALOG_ROUTES.enableProductStock.path]: { productId: fixture.draft, onHand: 4, lowStockThreshold: null },
  [SHOP_CATALOG_ROUTES.adjustProductStock.path]: { productId: fixture.published, delta: 5, reason: 'delivery' },
  [SHOP_CATALOG_ROUTES.setProductStockThreshold.path]: { productId: fixture.published, lowStockThreshold: 2 },
});

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_propose_mode_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-propose-mode-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
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
  fixture = { published, draft, publishedPrice };
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
      'POST /api/m2m/shop/settings': 'refuse not-in-release',
      'POST /api/m2m/shop/image-assets/branding/upload': 'refuse not-in-release',
      'POST /api/m2m/shop/image-assets/branding/complete': 'refuse not-in-release',
      'POST /api/m2m/shop/image-assets/product-cover/upload': 'refuse not-in-release',
      'POST /api/m2m/shop/image-assets/product-cover/complete': 'refuse not-in-release',
      'GET /api/m2m/shop/sales-links': 'read',
      'GET /api/m2m/shop/sales-links/:id': 'read',
      'POST /api/m2m/shop/sales-links': 'refuse not-in-release',
      'POST /api/m2m/shop/sales-links/:id': 'refuse not-in-release',
      'DELETE /api/m2m/shop/sales-links/:id': 'refuse not-in-release',
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
    });
  });

  it('registers exactly the classified routes under the shop prefix', () => {
    expect(app.routes.filter((route) => route.path.startsWith('/api/m2m/shop/')).map((route) => `${route.method} ${route.path}`))
      .toEqual(registeredShopRoutes().map((route) => `${route.method} ${route.path}`));
  });
});

describe('a propose-mode key on every registered shop route', () => {
  it('never reaches a live write: proposals answer 202, refusals 403, reads still read', async () => {
    const bodies = proposalBodies();
    const before = await liveState();
    const outcomes: string[] = [];
    for (const route of registeredShopRoutes()) {
      const label = `${route.method} ${route.path}`;
      const mode = route.proposeMode;
      if (mode?.kind === 'proposal-management') continue;
      const body = route.method === 'GET' || route.method === 'DELETE' ? undefined : bodies[route.path] ?? {};
      const response = await keyed(proposer.secret, route.method, concretePath(route.path), body);
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
    expect(outcomes.filter((outcome) => outcome.endsWith('proposed'))).toHaveLength(10);
    expect(outcomes.filter((outcome) => outcome.endsWith('refused'))).toHaveLength(20);
    const stored = (await database.db.select().from(changeProposals)).filter((row) => row.proposedByKeyId === proposer.apiKey.id);
    expect(stored).toHaveLength(10);
  });

  it('answers a refused write with the refusal reason and records the request in the key history', async () => {
    const response = await keyed(proposer.secret, 'POST', '/api/m2m/shop/settings', { supportUrl: null });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toEqual({ code: 'forbidden', message: 'A propose-mode shop management key cannot call this route (not-in-release)' });
    const requests = (await database.db.select().from(shopManagementKeyEvents))
      .filter((event) => event.apiKeyId === proposer.apiKey.id && event.kind === 'request' && event.route === '/api/m2m/shop/settings');
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
  it('runs the live handler on proposal and refusal routes and is refused on the proposal-management routes', async () => {
    for (const route of registeredShopRoutes()) {
      const label = `${route.method} ${route.path}`;
      const mode = route.proposeMode;
      if (mode === undefined) continue;
      const response = await keyed(direct.secret, route.method, concretePath(route.path), route.method === 'GET' || route.method === 'DELETE' ? undefined : {});
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
