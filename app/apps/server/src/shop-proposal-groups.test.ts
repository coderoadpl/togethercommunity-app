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
  stockEvents,
  tenantAdmins,
  tenantApiKeys,
  tenants,
} from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  changeProposalGroupOutputSchema,
  changeProposalGroupReceiptOutputSchema,
  changeProposalProposedOutputSchema,
  changeProposalReceiptOutputSchema,
  changeProposalsListOutputSchema,
  SHOP_ASSETS_ROUTES,
  SHOP_CATALOG_ROUTES,
  SHOP_PROPOSAL_ROUTES,
  shopCatalogContracts,
  shopProposalContracts,
} from '#core/contract/index.js';
import { changeProposalReference } from '#core/domain/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const password = 'shop-proposal-groups-15';
const START = Date.parse('2026-11-15T10:00:00.000Z');
let minute = 0;
let now = new Date(START).toISOString();
const expiresAt = '2026-11-22T00:00:00.000Z';
const PROPOSE_SCOPES = ['shop:catalog:read', 'shop:catalog:write'];

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let quickApp: ReturnType<typeof buildApp>;
let deps: ReturnType<typeof createDeps>;
let ownerToken: string;
let ownerId: string;
let adminToken: string;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const failure = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), details: z.record(z.unknown()).optional() }) }).parse(await response.json()).error;

const sessionRequest = (token: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const keyed = (secret: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createShopKey = async (scopes: string[], mode: 'direct' | 'propose', host = acmeHost) => {
  const response = await sessionRequest(ownerToken, API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
    name: `Group ${mode} ${String(minute)}`, scopes, expiresAt, mode,
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
    products: forWorkspace(await database.db.select().from(products)),
    prices: forWorkspace(await database.db.select().from(productPrices)),
    stock: forWorkspace(await database.db.select().from(productStock)),
    stockEvents: forWorkspace(await database.db.select().from(stockEvents)),
    versions: forWorkspace(await database.db.select().from(entityVersions)),
    outbox: forWorkspace(await database.db.select().from(emailOutbox)),
    salesLinks: forWorkspace(await database.db.select().from(salesLinks)),
  });
};

const proposalCount = async () => (await database.db.select().from(changeProposals)).length;

let live: string;
let direct: Awaited<ReturnType<typeof createShopKey>>;
let proposer: Awaited<ReturnType<typeof createShopKey>>;
let other: Awaited<ReturnType<typeof createShopKey>>;
const legacySecret = 'legacy-group-secret';

const groupPath = (template: string, id: string): string => template.replace(':id', id);

const createGroup = async (secret = proposer.secret, title = 'Spring launch', host = acmeHost) => {
  const response = await keyed(secret, 'POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title }, {}, host);
  expect(response.status).toBe(201);
  return envelope(changeProposalGroupReceiptOutputSchema).parse(await response.json()).data.group;
};

const join = (groupId: string, path: string, body: unknown, secret = proposer.secret) =>
  keyed(secret, 'POST', path, body, { 'x-proposal-group': groupId });

const joined = async (groupId: string, path: string, body: unknown) => {
  const response = await join(groupId, path, body);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(202);
  return envelope(changeProposalProposedOutputSchema).parse(await response.json()).data;
};

const ownerGroup = async (id: string) => {
  const response = await sessionRequest(ownerToken, 'GET', groupPath(API_PATHS.changeProposalGroup, id));
  expect(response.status).toBe(200);
  return envelope(changeProposalGroupOutputSchema).parse(await response.json()).data.group;
};

const approveGroup = (id: string, itemIds: string[], token = ownerToken, host = acmeHost) =>
  sessionRequest(token, 'POST', groupPath(API_PATHS.changeProposalGroupApprove, id), { itemIds }, host);

const liveTitle = async () => (await database.db.select().from(products)).find((row) => row.id === live)?.title;

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_proposal_groups_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-proposal-groups-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp({ ...deps, dispatchEmail: () => undefined });
  const quickDeps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-proposal-groups-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now }, changeProposalBounds: { lockWaitMs: 100, dryRunStatementMs: 2_000, approvalStatementMs: 2_000 } });
  quickApp = buildApp({ ...quickDeps, dispatchEmail: () => undefined });

  const owner = await signUp('shop-groups-owner@example.test', 'Groups Owner');
  const admin = await signUp('shop-groups-admin@example.test', 'Groups Admin');
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: owner.id, role: 'owner' });
  }
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme-admin', tenantId: 'acme', userId: admin.id, role: 'admin' });
  ownerToken = owner.token;
  ownerId = owner.id;
  adminToken = admin.token;
  await database.db.insert(tenantApiKeys).values({
    id: 'legacy-group', tenantId: 'acme', name: 'Legacy', keyHash: deps.apiKeyCrypto.hash(legacySecret),
    scopes: null, createdAt: now, expiresAt: null, revokedAt: null,
  });

  direct = await createShopKey([...PROPOSE_SCOPES], 'direct');
  proposer = await createShopKey(PROPOSE_SCOPES, 'propose');
  other = await createShopKey(PROPOSE_SCOPES, 'propose');
  const created = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Live handbook', type: 'physical', priceCents: 1000 });
  expect(created.status).toBe(200);
  live = envelope(shopCatalogContracts.createProduct.output).parse(await created.json()).data.product.id;
  expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProductPrice.path, { productId: live, kind: 'one_time', amountCents: 1000 })).status).toBe(200);
  expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.enableProductStock.path, { productId: live, onHand: 10, lowStockThreshold: null })).status).toBe(200);
}, 120_000);

afterAll(async () => { await database?.close(); });

beforeEach(() => {
  minute += 1;
  now = new Date(START + minute * 60_000).toISOString();
});

describe('the key-side group routes', () => {
  it('creates, reads and withdraws a group of the propose-mode key only', async () => {
    const group = await createGroup();
    expect(group).toMatchObject({ title: 'Spring launch', status: 'open', items: [] });
    const item = await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Grouped title' });
    expect(item.proposal).toMatchObject({ groupId: group.id, status: 'pending', operation: 'product.update' });
    expect(item.group).toMatchObject({ id: group.id, items: [{ id: item.proposal.id }] });

    const shown = await keyed(proposer.secret, 'GET', groupPath(SHOP_PROPOSAL_ROUTES.getGroup.path, group.id));
    const text = await shown.text();
    expect(envelope(shopProposalContracts.getGroup.output).parse(JSON.parse(text)).data.group.items.map((entry) => entry.id)).toEqual([item.proposal.id]);
    expect(text).not.toContain('effect');
    expect(text).not.toContain('Live handbook');

    const listed = envelope(shopProposalContracts.listProposals.output).parse(await (await keyed(proposer.secret, 'GET', `${SHOP_PROPOSAL_ROUTES.listProposals.path}?groupId=${group.id}`)).json()).data;
    expect(listed.proposals.map((entry) => entry.id)).toEqual([item.proposal.id]);

    const withdrawn = await keyed(proposer.secret, 'POST', groupPath(SHOP_PROPOSAL_ROUTES.withdrawGroup.path, group.id), {});
    expect(withdrawn.status).toBe(200);
    expect(envelope(changeProposalGroupReceiptOutputSchema).parse(await withdrawn.json()).data.group).toMatchObject({ status: 'withdrawn', items: [{ status: 'withdrawn' }] });
    expect((await keyed(proposer.secret, 'POST', groupPath(SHOP_PROPOSAL_ROUTES.withdrawGroup.path, group.id), {})).status).toBe(409);
    expect((await join(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Late item' })).status).toBe(409);
    expect(await liveTitle()).toBe('Live handbook');
  });

  it('answers another key\'s and another workspace\'s group exactly like an unknown id', async () => {
    const group = await createGroup();
    const studioKey = await createShopKey(PROPOSE_SCOPES, 'propose', studioHost);
    const studioGroup = await createGroup(studioKey.secret, 'Studio group', studioHost);
    const before = await proposalCount();
    const unknown = await keyed(other.secret, 'GET', groupPath(SHOP_PROPOSAL_ROUTES.getGroup.path, 'unknown-group'));
    expect(unknown.status).toBe(404);
    const unknownError = await failure(unknown);
    for (const [secret, id] of [[other.secret, group.id], [proposer.secret, studioGroup.id]] as const) {
      const read = await keyed(secret, 'GET', groupPath(SHOP_PROPOSAL_ROUTES.getGroup.path, id));
      expect(read.status).toBe(404);
      expect((await failure(read)).message).toBe(unknownError.message.replace('unknown-group', id));
      expect((await keyed(secret, 'POST', groupPath(SHOP_PROPOSAL_ROUTES.withdrawGroup.path, id), {})).status).toBe(404);
      expect((await join(id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Foreign item' }, secret)).status).toBe(404);
    }
    expect(await proposalCount()).toBe(before);
  });

  it('refuses a direct-mode key and a legacy key on the group routes and ignores the group header for a direct-mode key', async () => {
    const group = await createGroup();
    for (const [method, path, body] of [
      ['POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title: 'Direct group' }],
      ['GET', groupPath(SHOP_PROPOSAL_ROUTES.getGroup.path, group.id), undefined],
      ['POST', groupPath(SHOP_PROPOSAL_ROUTES.withdrawGroup.path, group.id), {}],
    ] as const) {
      const directResponse = await keyed(direct.secret, method, path, body);
      expect(directResponse.status, `${method} ${path}`).toBe(403);
      expect((await failure(directResponse)).message).toBe('Only a propose-mode shop management key manages change proposals');
      expect([401, 403], `legacy ${method} ${path}`).toContain((await keyed(legacySecret, method, path, body)).status);
    }
    const proposalsBefore = await proposalCount();
    const applied = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: 9 }, { 'x-proposal-group': group.id });
    expect(applied.status).toBe(200);
    expect((await database.db.select().from(productStock)).find((row) => row.productId === live)?.lowStockThreshold).toBe(9);
    expect(await proposalCount()).toBe(proposalsBefore);
    expect((await ownerGroup(group.id)).items).toEqual([]);
    expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: null })).status).toBe(200);
  });

  it('refuses a malformed group header and an empty title, and stores nothing', async () => {
    const before = await proposalCount();
    for (const header of ['', 'not a group', '$proposal:x', 'a'.repeat(201)]) {
      const response = await join(header, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Header title' });
      expect(response.status, JSON.stringify(header)).toBe(400);
    }
    expect((await keyed(proposer.secret, 'POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title: '  ' })).status).toBe(400);
    expect((await keyed(proposer.secret, 'POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title: 'Group', colour: 'red' })).status).toBe(400);
    expect(await proposalCount()).toBe(before);
  });

  it('refuses to withdraw, approve or reject a grouped item on its own', async () => {
    const group = await createGroup();
    const { proposal } = await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Lonely item' });
    for (const response of [
      await keyed(proposer.secret, 'POST', groupPath(SHOP_PROPOSAL_ROUTES.withdrawProposal.path, proposal.id), {}),
      await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalApprove.replace(':id', proposal.id), {}),
      await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), {}),
    ]) {
      expect(response.status).toBe(409);
      expect((await failure(response)).details).toMatchObject({ changeProposalGroupId: group.id });
    }
    expect(await liveTitle()).toBe('Live handbook');
    expect((await ownerGroup(group.id)).items.map((item) => item.status)).toEqual(['pending']);
  });
});

describe('references and the group dry run over HTTP', () => {
  beforeAll(async () => { proposer = await createShopKey(PROPOSE_SCOPES, 'propose'); });

  it('previews a price and a publication against the product the group creates', async () => {
    const group = await createGroup();
    const before = await liveState();
    const created = await joined(group.id, SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Grouped mug', type: 'physical', priceCents: 2500 });
    const reference = changeProposalReference(created.proposal.id);
    const publishAlone = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.publishProduct.path, { id: reference });
    expect(publishAlone.status).toBe(404);
    const earlyPublish = await join(group.id, SHOP_CATALOG_ROUTES.publishProduct.path, { id: reference });
    expect(earlyPublish.status).toBe(400);
    await joined(group.id, SHOP_CATALOG_ROUTES.createProductPrice.path, { productId: reference, kind: 'one_time', amountCents: 2500 });
    const published = await joined(group.id, SHOP_CATALOG_ROUTES.publishProduct.path, { id: reference });
    expect(published.group?.items.map((item) => item.operation)).toEqual(['product.create', 'price.create', 'product.publish']);
    expect(await liveState()).toBe(before);
    const shown = await ownerGroup(group.id);
    expect(shown.items[2]?.effect).toEqual({ published: { before: false, after: true } });
    expect(shown.items[1]?.effect).toMatchObject({ activePrices: { before: [], after: [expect.objectContaining({ amountCents: 2500 })] } });
  });

  it.each([
    ['an unknown proposal', (_created: string, foreign: string) => changeProposalReference(`${foreign}-missing`)],
    ['another group\'s item', (_created: string, foreign: string) => changeProposalReference(foreign)],
    ['a live product id', () => changeProposalReference(live)],
    ['a malformed reference', () => '$proposal:'],
  ])('refuses a reference to %s with 400 and stores nothing', async (_label, referenceOf) => {
    const foreignGroup = await createGroup(proposer.secret, 'Foreign group');
    const foreign = await joined(foreignGroup.id, SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Foreign mug', type: 'physical', priceCents: 100 });
    const group = await createGroup();
    const created = await joined(group.id, SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Own mug', type: 'physical', priceCents: 100 });
    const before = await proposalCount();
    const response = await join(group.id, SHOP_CATALOG_ROUTES.createProductPrice.path, {
      productId: referenceOf(created.proposal.id, foreign.proposal.id), kind: 'one_time', amountCents: 100,
    });
    expect(response.status).toBe(400);
    expect(await proposalCount()).toBe(before);
  });

  it('refuses a reference of the wrong kind and a reference outside an id position', async () => {
    const group = await createGroup();
    const created = await joined(group.id, SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Kind mug', type: 'physical', priceCents: 100 });
    const before = await proposalCount();
    expect((await join(group.id, SHOP_CATALOG_ROUTES.deactivateProductPrice.path, { id: changeProposalReference(created.proposal.id) })).status).toBe(400);
    expect((await join(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: changeProposalReference(created.proposal.id) })).status).toBe(400);
    expect(await proposalCount()).toBe(before);
  });

  it('answers 409 at submit when an earlier item no longer applies, and stores nothing', async () => {
    const group = await createGroup();
    const first = await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Moved title' });
    expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Owner title' })).status).toBe(200);
    const before = await proposalCount();
    const response = await join(group.id, SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: 3 });
    expect(response.status).toBe(409);
    expect((await failure(response)).details).toMatchObject({ changeProposalGroupItem: first.proposal.id });
    expect(await proposalCount()).toBe(before);
    expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Live handbook' })).status).toBe(200);
  });
});

describe('the owner group routes', () => {
  beforeAll(async () => { proposer = await createShopKey(PROPOSE_SCOPES, 'propose'); });

  const pendingGroup = async (title = 'Owner title proposal') => {
    const group = await createGroup();
    const item = await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title });
    return { group, item: item.proposal };
  };

  it('refuses an admin, every kind of key, an unverified owner and another workspace, and leaves the group pending', async () => {
    const { group, item } = await pendingGroup('Guarded group title');
    const before = await liveState();
    const routes = [
      ['GET', groupPath(API_PATHS.changeProposalGroup, group.id), undefined],
      ['POST', groupPath(API_PATHS.changeProposalGroupApprove, group.id), { itemIds: [item.id] }],
      ['POST', groupPath(API_PATHS.changeProposalGroupReject, group.id), {}],
    ] as const;
    for (const [method, path, body] of routes) {
      expect((await sessionRequest(adminToken, method, path, body)).status, `admin ${method} ${path}`).toBe(403);
      for (const secret of [direct.secret, proposer.secret, legacySecret]) {
        expect([401, 403], `key ${method} ${path}`).toContain((await keyed(secret, method, path, body)).status);
      }
      expect((await sessionRequest(ownerToken, method, path, body, studioHost)).status, `studio ${method} ${path}`).toBe(404);
    }
    await database.db.execute(`update "user" set email_verified = false where id = '${ownerId}'`);
    try {
      for (const [method, path, body] of routes) expect((await sessionRequest(ownerToken, method, path, body)).status, `unverified ${method} ${path}`).toBe(403);
    } finally {
      await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
    }
    expect(await liveState()).toBe(before);
    const events = (await database.db.select().from(changeProposalEvents)).filter((event) => event.proposalId === item.id);
    expect(events.map((event) => event.kind)).toEqual(['proposed']);
    expect((await sessionRequest(ownerToken, 'POST', groupPath(API_PATHS.changeProposalGroupApprove, group.id), {})).status).toBe(400);
    expect((await sessionRequest(ownerToken, 'POST', groupPath(API_PATHS.changeProposalGroupReject, group.id), {})).status).toBe(200);
  });

  it('lists the items of a group with their group and reads the group with every effect', async () => {
    const group = await createGroup(proposer.secret, 'Listed group');
    const first = await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Listed title' });
    const second = await joined(group.id, SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: 4 });
    const listed = await sessionRequest(ownerToken, 'GET', `${API_PATHS.changeProposals}?groupId=${group.id}`);
    expect(listed.status).toBe(200);
    expect(envelope(changeProposalsListOutputSchema).parse(await listed.json()).data.proposals
      .map((entry) => [entry.id, entry.groupId, entry.groupTitle, entry.groupPosition]).toSorted((left, right) => Number(left[3]) - Number(right[3])))
      .toEqual([[first.proposal.id, group.id, 'Listed group', 1], [second.proposal.id, group.id, 'Listed group', 2]]);
    const shown = await ownerGroup(group.id);
    expect(shown).toMatchObject({ id: group.id, title: 'Listed group', status: 'open', proposedBy: { keyId: proposer.apiKey.id, keyState: 'active' } });
    expect(shown.items.map((entry) => entry.id)).toEqual([first.proposal.id, second.proposal.id]);
    expect(shown.items[0]?.effect).toEqual({ title: { before: 'Live handbook', after: 'Listed title' } });
    expect(shown.items[0]?.events.map((event) => event.kind)).toEqual(['proposed']);
    expect((await sessionRequest(ownerToken, 'GET', `${API_PATHS.changeProposals}?groupId=not%20a%20group`)).status).toBe(400);
  });

  it('refuses an approval of items other than the ones the group now holds and applies nothing', async () => {
    const group = await createGroup();
    const first = await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Shown title' });
    const shownIds = (await ownerGroup(group.id)).items.map((item) => item.id);
    const second = await joined(group.id, SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: 6 });
    const before = await liveState();
    for (const itemIds of [shownIds, [second.proposal.id, first.proposal.id], [first.proposal.id, second.proposal.id, first.proposal.id]]) {
      const response = await approveGroup(group.id, itemIds);
      expect(response.status, JSON.stringify(itemIds)).toBe(409);
      expect((await failure(response)).details).toMatchObject({ changeProposalGroupItemIds: [first.proposal.id, second.proposal.id] });
    }
    expect(await liveState()).toBe(before);
    expect((await ownerGroup(group.id)).status).toBe('open');
    const rejected = await sessionRequest(ownerToken, 'POST', groupPath(API_PATHS.changeProposalGroupReject, group.id), { note: 'Not this one' });
    expect(rejected.status).toBe(200);
  });

  it('approves the group as one unit, tells the key, and answers a repeated approve with 409 and the stored statuses', async () => {
    const group = await createGroup();
    const first = await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Applied group title' });
    const second = await joined(group.id, SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: null });
    const itemIds = [first.proposal.id, second.proposal.id];
    const response = await approveGroup(group.id, itemIds);
    expect(response.status).toBe(200);
    const decided = envelope(changeProposalGroupOutputSchema).parse(await response.json()).data.group;
    expect(decided.status).toBe('applied');
    expect(decided.items.map((item) => [item.status, item.appliedResourceId])).toEqual([['applied', live], ['applied', live]]);
    expect(await liveTitle()).toBe('Applied group title');

    const again = await approveGroup(group.id, itemIds);
    expect(again.status).toBe(409);
    expect((await failure(again)).details).toMatchObject({
      changeProposalGroupStatus: 'applied',
      changeProposalStatuses: [{ id: first.proposal.id, status: 'applied' }, { id: second.proposal.id, status: 'applied' }],
    });
    const receipt = await keyed(proposer.secret, 'GET', groupPath(SHOP_PROPOSAL_ROUTES.getGroup.path, group.id));
    const text = await receipt.text();
    expect(envelope(changeProposalGroupReceiptOutputSchema).parse(JSON.parse(text)).data.group).toMatchObject({ status: 'applied' });
    expect(text).not.toContain(ownerId);
    expect(text).not.toContain('effect');
    expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Live handbook' })).status).toBe(200);
  });

  it('rejects every item with one note, and the key sees the note on each item', async () => {
    const group = await createGroup();
    await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Rejected group title' });
    await joined(group.id, SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: 7 });
    const before = await liveState();
    const rejected = await sessionRequest(ownerToken, 'POST', groupPath(API_PATHS.changeProposalGroupReject, group.id), { note: 'Not this season' });
    expect(rejected.status).toBe(200);
    expect(envelope(changeProposalGroupOutputSchema).parse(await rejected.json()).data.group.items.map((item) => [item.status, item.decisionNote]))
      .toEqual([['rejected', 'Not this season'], ['rejected', 'Not this season']]);
    expect(await liveState()).toBe(before);
    expect((await sessionRequest(ownerToken, 'POST', groupPath(API_PATHS.changeProposalGroupReject, group.id), {})).status).toBe(409);
    const item = (await ownerGroup(group.id)).items[0];
    if (item === undefined) throw new Error('item missing');
    const receipt = envelope(changeProposalReceiptOutputSchema).parse(await (await keyed(proposer.secret, 'GET', groupPath(SHOP_PROPOSAL_ROUTES.getProposal.path, item.id))).json()).data.proposal;
    expect(receipt).toMatchObject({ status: 'rejected', decisionNote: 'Not this season', groupId: group.id });
  });

  it('answers 503 with a retry-after while a target row stays locked, and leaves the group pending', async () => {
    const group = await createGroup();
    const item = await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Locked group title' });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
    const holder = database.db.transaction(async (tx) => {
      await tx.execute(`select id from products where tenant_id = 'acme' and id = '${live}' for update`);
      locked();
      await held;
    });
    await lockTaken;
    try {
      const before = await liveState();
      const approval = await approveGroup(group.id, [item.proposal.id]);
      expect(approval.status).toBe(503);
      expect(approval.headers.get('retry-after')).toBe('5');
      const joinedWhileLocked = await join(group.id, SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: 2 });
      expect(joinedWhileLocked.status).toBe(503);
      expect(joinedWhileLocked.headers.get('retry-after')).toBe('5');
      expect(await liveState()).toBe(before);
    } finally {
      release();
      await holder;
    }
    expect((await ownerGroup(group.id)).status).toBe('open');
    const approved = await approveGroup(group.id, [item.proposal.id]);
    expect(envelope(changeProposalGroupOutputSchema).parse(await approved.json()).data.group.status).toBe('applied');
    expect((await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Live handbook' })).status).toBe(200);
  }, 30_000);
});

const salesLinkPath = (template: string, id: string): string => template.replace(':id', encodeURIComponent(id));

describe('sales links and prices referenced inside a group over HTTP', () => {
  beforeAll(async () => { proposer = await createShopKey(PROPOSE_SCOPES, 'propose'); });

  const linkFields = (slug: string) => ({ slug, title: 'Grouped offer', heading: 'Grouped offer', productIds: [live] });

  it('updates a sales link the group creates through the percent-encoded reference path, then applies both', async () => {
    const group = await createGroup();
    const created = await joined(group.id, SHOP_ASSETS_ROUTES.createSalesLink.path, linkFields('grouped-offer-update'));
    const reference = changeProposalReference(created.proposal.id);
    const path = salesLinkPath(SHOP_ASSETS_ROUTES.updateSalesLink.path, reference);
    expect(path).toContain(`%24proposal%3A${created.proposal.id}`);
    const updated = await joined(group.id, path, { ...linkFields('grouped-offer-update'), id: reference, title: 'Renamed offer', expectedRevision: 1 });
    expect(updated.proposal).toMatchObject({ operation: 'sales-link.update', target: { kind: 'sales-link', id: reference } });
    expect((await database.db.select().from(salesLinks)).filter((row) => row.slug === 'grouped-offer-update')).toEqual([]);

    const shown = await ownerGroup(group.id);
    const response = await approveGroup(group.id, shown.items.map((item) => item.id));
    expect(response.status).toBe(200);
    expect(envelope(changeProposalGroupOutputSchema).parse(await response.json()).data.group.status).toBe('applied');
    const [link] = (await database.db.select().from(salesLinks)).filter((row) => row.slug === 'grouped-offer-update');
    expect(link).toMatchObject({ title: 'Renamed offer', revision: 2, deletedAt: null });
  });

  it('deletes a sales link the group creates through its reference', async () => {
    const group = await createGroup();
    const created = await joined(group.id, SHOP_ASSETS_ROUTES.createSalesLink.path, linkFields('grouped-offer-delete'));
    const deleted = await keyed(proposer.secret, 'DELETE', salesLinkPath(SHOP_ASSETS_ROUTES.deleteSalesLink.path, changeProposalReference(created.proposal.id)), undefined, { 'x-proposal-group': group.id });
    expect(deleted.status).toBe(202);

    const response = await approveGroup(group.id, (await ownerGroup(group.id)).items.map((item) => item.id));
    expect(envelope(changeProposalGroupOutputSchema).parse(await response.json()).data.group.status).toBe('applied');
    const rows = (await database.db.select().from(salesLinks)).filter((row) => row.slug === 'grouped-offer-delete');
    expect(rows.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it('deactivates a price the group creates through its reference', async () => {
    const group = await createGroup();
    const created = await joined(group.id, SHOP_CATALOG_ROUTES.createProductPrice.path, { productId: live, kind: 'one_time', amountCents: 4200 });
    await joined(group.id, SHOP_CATALOG_ROUTES.deactivateProductPrice.path, { id: changeProposalReference(created.proposal.id) });

    const response = await approveGroup(group.id, (await ownerGroup(group.id)).items.map((item) => item.id));
    const decided = envelope(changeProposalGroupOutputSchema).parse(await response.json()).data.group;
    expect(decided.status).toBe('applied');
    const priceId = decided.items[0]?.appliedResourceId;
    expect((await database.db.select().from(productPrices)).find((row) => row.id === priceId)).toMatchObject({ amountCents: 4200, active: false });
  });
});

describe('busy answers of the proposal decision routes', () => {
  beforeAll(async () => { proposer = await createShopKey(PROPOSE_SCOPES, 'propose'); });

  const quickKeyed = (secret: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => quickApp.request(`${baseUrl}${path}`, {
    method,
    headers: { host: acmeHost, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const quickSession = (method: string, path: string, body: unknown) => quickApp.request(`${baseUrl}${path}`, {
    method,
    headers: { host: acmeHost, authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const whileLocked = async (statement: string, work: () => Response | Promise<Response>): Promise<Response> => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
    const holder = database.db.transaction(async (tx) => {
      await tx.execute(statement);
      locked();
      await held;
    });
    await lockTaken;
    try {
      return await work();
    } finally {
      release();
      await holder;
    }
  };

  const expectBusy = (response: Response) => {
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
  };

  it('answers 503 with a retry-after on a join, a group withdrawal and a group rejection while the group row stays locked', async () => {
    const group = await createGroup();
    await joined(group.id, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Busy group title' });
    const lockGroup = `select id from change_proposal_groups where tenant_id = 'acme' and id = '${group.id}' for update`;

    expectBusy(await whileLocked(lockGroup, () => quickKeyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.setProductStockThreshold.path, { productId: live, lowStockThreshold: 3 }, { 'x-proposal-group': group.id })));
    expectBusy(await whileLocked(lockGroup, () => quickKeyed(proposer.secret, 'POST', groupPath(SHOP_PROPOSAL_ROUTES.withdrawGroup.path, group.id), {})));
    expectBusy(await whileLocked(lockGroup, () => quickSession('POST', groupPath(API_PATHS.changeProposalGroupReject, group.id), {})));
    const shown = await ownerGroup(group.id);
    expect(shown.status).toBe('open');
    expect(shown.items.map((item) => item.status)).toEqual(['pending']);
    expect((await sessionRequest(ownerToken, 'POST', groupPath(API_PATHS.changeProposalGroupReject, group.id), {})).status).toBe(200);
  }, 30_000);

  it('answers 503 with a retry-after on a single rejection and withdrawal while the proposal row stays locked', async () => {
    const response = await keyed(proposer.secret, 'POST', SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Busy single title' });
    expect(response.status).toBe(202);
    const { proposal } = envelope(changeProposalProposedOutputSchema).parse(await response.json()).data;
    const lockProposal = `select id from change_proposals where tenant_id = 'acme' and id = '${proposal.id}' for update`;

    expectBusy(await whileLocked(lockProposal, () => quickSession('POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), {})));
    expectBusy(await whileLocked(lockProposal, () => quickKeyed(proposer.secret, 'POST', groupPath(SHOP_PROPOSAL_ROUTES.withdrawProposal.path, proposal.id), {})));
    const events = (await database.db.select().from(changeProposalEvents)).filter((event) => event.proposalId === proposal.id);
    expect(events.map((event) => event.kind)).toEqual(['proposed']);
    expect((await keyed(proposer.secret, 'POST', groupPath(SHOP_PROPOSAL_ROUTES.withdrawProposal.path, proposal.id), {})).status).toBe(200);
  }, 30_000);
});
