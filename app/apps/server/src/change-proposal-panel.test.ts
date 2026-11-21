import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { changeProposals, notifications, tenantAdmins, tenants } from '#adapters/db/schema.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  changeProposalApproveOutputSchema,
  changeProposalProposedOutputSchema,
  changeProposalRejectOutputSchema,
  changeProposalsListOutputSchema,
  changeProposalSummaryOutputSchema,
  notificationsListOutputSchema,
  SHOP_ASSETS_ROUTES,
  SHOP_CATALOG_ROUTES,
  SHOP_PROPOSAL_ROUTES,
  shopCatalogContracts,
} from '#core/contract/index.js';
import { appError } from '#core/domain/index.js';
import { failingSalesLinkSaves } from '#core/server/testing/change-proposal-fakes.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const password = 'change-proposal-panel-15';
const START = Date.parse('2026-11-15T10:00:00.000Z');
let minute = 0;
let now = new Date(START).toISOString();
const expiresAt = '2026-11-30T00:00:00.000Z';
const PROPOSE_SCOPES = ['shop:catalog:read', 'shop:catalog:write'];

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;
let ownerToken: string;
let ownerId: string;
let adminToken: string;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });

const sessionRequest = (token: string, method: string, path: string, body?: unknown, host = acmeHost, target = app) => target.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const keyed = (secret: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host: acmeHost, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

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

const createShopKey = async (mode: 'direct' | 'propose', token = ownerToken) => {
  const response = await sessionRequest(token, API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
    name: `Panel ${mode} ${String(minute)}`, scopes: PROPOSE_SCOPES, expiresAt, mode,
  });
  expect(response.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await response.json()).data;
};

const propose = async (secret: string, path: string, body: unknown, extra: Record<string, string> = {}) => {
  const response = await keyed(secret, 'POST', path, body, extra);
  const text = await response.text();
  expect(response.status, text).toBe(202);
  expect(text).not.toContain('targetLabel');
  expect(text).not.toContain('issuer');
  return envelope(changeProposalProposedOutputSchema).parse(JSON.parse(text)).data.proposal;
};

const summary = async (token = ownerToken, host = acmeHost) => {
  const response = await sessionRequest(token, 'GET', API_PATHS.changeProposalSummary, undefined, host);
  return { status: response.status, body: response.status === 200 ? envelope(changeProposalSummaryOutputSchema).parse(await response.json()).data : null };
};

const ownerCards = async () => {
  const response = await sessionRequest(ownerToken, 'GET', `${API_PATHS.changeProposals}?limit=100`);
  expect(response.status).toBe(200);
  return envelope(changeProposalsListOutputSchema).parse(await response.json()).data.proposals;
};

let live: string;
let liveLink: string;
let issuerEmail: string;

beforeAll(async () => {
  database = await createTestDatabase(
    'together_change_proposal_panel_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'change-proposal-panel-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp({ ...deps, dispatchEmail: () => undefined });

  issuerEmail = 'panel-owner@example.test';
  const owner = await signUp(issuerEmail, 'Panel Owner');
  const admin = await signUp('panel-admin@example.test', 'Panel Admin');
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: owner.id, role: 'owner' });
  }
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme-admin', tenantId: 'acme', userId: admin.id, role: 'admin' });
  ownerToken = owner.token;
  ownerId = owner.id;
  adminToken = admin.token;

  const direct = await createShopKey('direct');
  const created = await keyed(direct.secret, 'POST', SHOP_CATALOG_ROUTES.createProduct.path, { title: 'Panel handbook', type: 'physical', priceCents: 1000 });
  expect(created.status).toBe(200);
  live = envelope(shopCatalogContracts.createProduct.output).parse(await created.json()).data.product.id;
  const linked = await keyed(direct.secret, 'POST', SHOP_ASSETS_ROUTES.createSalesLink.path, { slug: 'panel-offer', title: 'Panel offer', heading: 'Panel offer', productIds: [live] });
  expect(linked.status, await linked.clone().text()).toBe(201);
  liveLink = z.object({ ok: z.literal(true), data: z.object({ salesLink: z.object({ id: z.string() }) }) }).parse(await linked.json()).data.salesLink.id;
}, 120_000);

afterAll(async () => { await database?.close(); });

beforeEach(() => {
  minute += 1;
  now = new Date(START + minute * 60_000).toISOString();
});

describe('the owner panel summary', () => {
  it('counts the pending proposals and groups of the workspace for the owner only', async () => {
    const proposer = await createShopKey('propose');
    const before = await summary();
    expect(before.status).toBe(200);
    const pendingBefore = before.body?.pending ?? -1;
    const groupsBefore = before.body?.pendingGroups ?? -1;
    expect(await summary(ownerToken, studioHost)).toEqual({ status: 200, body: { pending: 0, pendingGroups: 0, hasProposals: false } });

    await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Summary title' });
    const groupResponse = await keyed(proposer.secret, 'POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title: 'Summary group' });
    const groupId = z.object({ data: z.object({ group: z.object({ id: z.string() }) }) }).parse(await groupResponse.json()).data.group.id;
    await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, title: 'Grouped title' }, { 'x-proposal-group': groupId });
    await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Grouped' }, { 'x-proposal-group': groupId });

    expect(await summary()).toEqual({ status: 200, body: { pending: pendingBefore + 3, pendingGroups: groupsBefore + 1, hasProposals: true } });
    expect(await summary(ownerToken, studioHost)).toEqual({ status: 200, body: { pending: 0, pendingGroups: 0, hasProposals: false } });
    expect((await summary(adminToken)).status).toBe(403);
    const keyedSummary = await keyed(proposer.secret, 'GET', API_PATHS.changeProposalSummary);
    expect(keyedSummary.status).toBe(401);
    expect(await keyedSummary.json()).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Authentication required' } });
  });
});

describe('the owner panel summary of a workspace whose proposals are all decided', () => {
  it('says the workspace has proposals while it counts none pending', async () => {
    const proposer = await createShopKey('propose');
    const proposal = await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Decided elsewhere' });
    const [row] = (await database.db.select().from(changeProposals)).filter((entry) => entry.id === proposal.id);
    if (row === undefined) throw new Error('The proposed row is missing');
    expect((await summary(ownerToken, studioHost)).body).toMatchObject({ hasProposals: false });

    await database.db.insert(changeProposals).values({
      ...row, id: `${row.id}-studio`, tenantId: 'studio', groupId: null, groupPosition: null,
      status: 'rejected', decidedAt: now, decidedByUserId: ownerId,
    });

    expect(await summary(ownerToken, studioHost)).toEqual({ status: 200, body: { pending: 0, pendingGroups: 0, hasProposals: true } });
  });
});

describe('an anonymous caller on the owner session routes', () => {
  it('is refused with 401 on every owner route, a real proposal and group included', async () => {
    const proposer = await createShopKey('propose');
    const proposal = await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Anonymous target' });
    const groupResponse = await keyed(proposer.secret, 'POST', SHOP_PROPOSAL_ROUTES.createGroup.path, { title: 'Anonymous group' });
    const groupId = z.object({ data: z.object({ group: z.object({ id: z.string() }) }) }).parse(await groupResponse.json()).data.group.id;
    const routes = [
      ['GET', API_PATHS.changeProposals, undefined],
      ['GET', API_PATHS.changeProposalSummary, undefined],
      ['GET', API_PATHS.changeProposalGroup.replace(':id', groupId), undefined],
      ['POST', API_PATHS.changeProposalApprove.replace(':id', proposal.id), {}],
      ['POST', API_PATHS.changeProposalReject.replace(':id', proposal.id), {}],
    ] as const;

    for (const [method, path, body] of routes) {
      const response = await app.request(`${baseUrl}${path}`, {
        method,
        headers: { host: acmeHost, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Authentication required' } });
    }
    expect((await ownerCards()).find((card) => card.id === proposal.id)?.status).toBe('pending');
  });
});

describe('the owner panel history filter', () => {
  it('pages through decided proposals only and says whether more pages exist', async () => {
    const proposer = await createShopKey('propose');
    const pending = await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Still pending' });
    const first = await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Rejected one' });
    const second = await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Rejected two' });
    for (const id of [first.id, second.id]) {
      expect((await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', id), {})).status).toBe(200);
    }
    const page = async (query: string) => {
      const response = await sessionRequest(ownerToken, 'GET', `${API_PATHS.changeProposals}?${query}`);
      expect(response.status).toBe(200);
      return envelope(changeProposalsListOutputSchema).parse(await response.json()).data;
    };

    const all = await page('status=decided&limit=100');
    expect(all.proposals.map((card) => card.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(all.proposals.map((card) => card.id)).not.toContain(pending.id);
    expect(all.proposals.every((card) => card.status !== 'pending')).toBe(true);
    expect(all.hasMore).toBe(false);
    const one = await page('status=decided&limit=1');
    expect(one).toMatchObject({ hasMore: true, nextCursor: one.proposals[0]?.id });
    expect((await sessionRequest(ownerToken, 'GET', `${API_PATHS.changeProposals}?status=undecided`)).status).toBe(400);
  });
});

describe('the owner panel cards', () => {
  it('carries the live label, the issuer state and the deciding account on every card in one request', async () => {
    const proposer = await createShopKey('propose');
    const renamed = await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Card description' });
    const linkChange = await propose(proposer.secret, SHOP_ASSETS_ROUTES.updateSalesLink.path.replace(':id', liveLink), {
      id: liveLink, expectedRevision: 1, slug: 'panel-offer', title: 'Panel offer', heading: 'Panel offer, extended', productIds: [live],
    });
    const rejected = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalReject.replace(':id', linkChange.id), { note: 'Not this one' });
    expect(rejected.status).toBe(200);
    expect(envelope(changeProposalRejectOutputSchema).parse(await rejected.json()).data.proposal)
      .toMatchObject({ status: 'rejected', decidedByUserId: ownerId, decidedByEmail: issuerEmail, targetLabel: 'Panel offer' });

    const cards = Object.fromEntries((await ownerCards()).map((card) => [card.id, card]));

    expect(cards[renamed.id]).toMatchObject({
      operation: 'product.update', target: { kind: 'product', id: live }, targetLabel: 'Panel handbook',
      effect: { description: { before: '', after: 'Card description' } },
      proposedBy: { keyId: proposer.apiKey.id, keyName: proposer.apiKey.name, keyState: 'active', issuerUserId: ownerId, issuerEmail, issuerIsVerifiedOwner: true },
      decidedByEmail: null, groupId: null, groupTitle: null, groupPosition: null,
    });
    expect(cards[linkChange.id]).toMatchObject({ status: 'rejected', decisionNote: 'Not this one', decidedByEmail: issuerEmail });

    const receipt = await keyed(proposer.secret, 'GET', SHOP_PROPOSAL_ROUTES.getProposal.path.replace(':id', renamed.id));
    const text = await receipt.text();
    for (const hidden of ['targetLabel', 'issuer', issuerEmail, 'Panel handbook']) expect(text).not.toContain(hidden);
  });

  it('shows the issuer as no longer a verified owner once the issuing account lost ownership', async () => {
    const proposer = await createShopKey('propose');
    const proposal = await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Before the demotion' });
    const second = await signUp('panel-second-owner@example.test', 'Second owner');
    await database.db.insert(tenantAdmins).values({ id: 'grant-acme-second', tenantId: 'acme', userId: second.id, role: 'owner' });
    await database.db.execute(`update tenant_admins set role = 'admin' where id = 'grant-acme'`);
    try {
      const response = await sessionRequest(second.token, 'GET', `${API_PATHS.changeProposals}?limit=100`);
      expect(response.status).toBe(200);
      const card = envelope(changeProposalsListOutputSchema).parse(await response.json()).data.proposals.find((entry) => entry.id === proposal.id);
      expect(card?.proposedBy).toMatchObject({ issuerUserId: ownerId, issuerEmail, issuerIsVerifiedOwner: false, keyState: 'active' });
    } finally {
      await database.db.execute(`update tenant_admins set role = 'owner' where id = 'grant-acme'`);
      await database.db.execute(`delete from tenant_admins where id = 'grant-acme-second'`);
    }
  });
});

describe('the owner bell for change proposals', () => {
  it('rings once per key while unread and again after it was read', async () => {
    await database.db.delete(notifications);
    const proposer = await createShopKey('propose');
    await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Bell one' });
    await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Bell two' });

    const bell = async () => {
      const response = await sessionRequest(ownerToken, 'GET', API_PATHS.notifications);
      expect(response.status).toBe(200);
      return envelope(notificationsListOutputSchema).parse(await response.json()).data.notifications
        .filter((entry) => entry.kind === 'change-proposal' && entry.payload.changeProposal?.keyName === proposer.apiKey.name);
    };
    const rung = await bell();
    expect(rung).toHaveLength(1);
    expect(rung[0]).toMatchObject({
      readAt: null,
      payload: { authorDisplay: null, contextKind: 'tenant', changeProposal: { keyName: proposer.apiKey.name, groupId: null, groupTitle: null } },
    });

    const read = await sessionRequest(ownerToken, 'POST', API_PATHS.notificationRead, { id: rung[0]?.id });
    expect(read.status).toBe(200);
    await propose(proposer.secret, SHOP_CATALOG_ROUTES.updateProduct.path, { id: live, description: 'Bell three' });
    const rearmed = await bell();
    expect(rearmed.map((entry) => entry.readAt)).toEqual([null]);
    expect(rearmed[0]?.id).not.toBe(rung[0]?.id);

    const lateRead = await sessionRequest(ownerToken, 'POST', API_PATHS.notificationRead, { id: rung[0]?.id });
    expect(lateRead.status).toBe(400);
    expect((await bell()).map((entry) => [entry.id, entry.readAt])).toEqual([[rearmed[0]?.id, null]]);
  });
});

describe('an approval meeting a transient error of the live use-case', () => {
  it('answers that error, applies nothing and leaves the proposal pending', async () => {
    const proposer = await createShopKey('propose');
    const proposal = await propose(proposer.secret, SHOP_ASSETS_ROUTES.updateSalesLink.path.replace(':id', liveLink), {
      id: liveLink, expectedRevision: 1, slug: 'panel-offer', title: 'Panel offer', heading: 'Panel offer, transient', productIds: [live],
    });
    const failing = buildApp({
      ...deps,
      changeProposalTransaction: failingSalesLinkSaves(deps.changeProposalTransaction, appError('unavailable', 'The database is busy')),
      dispatchEmail: () => undefined,
    });

    const response = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalApprove.replace(':id', proposal.id), {}, acmeHost, failing);

    expect(response.status).toBe(503);
    const [row] = (await database.db.select().from(changeProposals)).filter((entry) => entry.id === proposal.id);
    expect(row).toMatchObject({ status: 'pending', decidedAt: null, failureCode: null });
    const approved = await sessionRequest(ownerToken, 'POST', API_PATHS.changeProposalApprove.replace(':id', proposal.id), {});
    expect(envelope(changeProposalApproveOutputSchema).parse(await approved.json()).data.proposal).toMatchObject({ status: 'applied', decidedByEmail: issuerEmail });
  });
});
