import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { emailOutbox, entityVersions, productPrices, products, productStock, stockEvents, tenantAdmins, tenants } from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createShopManagementClient, isProposedChange, type ShopManagementClient } from '#core/client/index.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  changeProposalApproveOutputSchema,
  changeProposalRejectOutputSchema,
  changeProposalShowOutputSchema,
  type ChangeProposalProposedOutput,
} from '#core/contract/index.js';
import type { AppError, ChangeProposalEffect, ChangeProposalKeyReceipt, Result } from '#core/domain/index.js';

import { buildApp } from '../apps/server/src/app.js';
import { createDeps } from '../apps/server/src/composition.js';
import { envSchema } from '../apps/server/src/env.js';

const baseUrl = 'http://localhost:48730';
const workspaceHost = 'acme.localhost:48730';
const email = 'change-proposal-replay-owner@example.test';
const password = 'change-proposal-replay-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let ownerToken: string;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });

const proposed = <A extends object>(result: Result<ChangeProposalProposedOutput | ({ outcome: 'applied' } & A), AppError>): ChangeProposalKeyReceipt => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  if (!isProposedChange(result.value)) throw new Error('Expected a proposal, got a live change');
  return result.value.proposal;
};

const workspaceFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('host', workspaceHost);
  return app.request(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, { ...init, headers });
};

const ownerRequest = (method: string, path: string, body?: unknown) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host: workspaceHost, authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const shownEffect = async (id: string): Promise<ChangeProposalEffect> => {
  const response = await ownerRequest('GET', API_PATHS.changeProposal.replace(':id', id));
  expect(response.status).toBe(200);
  const { proposal } = envelope(changeProposalShowOutputSchema).parse(await response.json()).data;
  expect(proposal.status).toBe('pending');
  return proposal.effect;
};

const approve = async (id: string) => {
  const response = await ownerRequest('POST', API_PATHS.changeProposalApprove.replace(':id', id), {});
  expect(response.status).toBe(200);
  return envelope(changeProposalApproveOutputSchema).parse(await response.json()).data.proposal;
};

const liveState = async () => {
  const ofWorkspace = <T extends { tenantId: string | null }>(rows: T[]) => rows.filter((row) => row.tenantId === 'acme');
  return JSON.stringify({
    products: ofWorkspace(await database.db.select().from(products)),
    prices: ofWorkspace(await database.db.select().from(productPrices)),
    stock: ofWorkspace(await database.db.select().from(productStock)),
    stockEvents: ofWorkspace(await database.db.select().from(stockEvents)),
    versions: ofWorkspace(await database.db.select().from(entityVersions)),
    outbox: ofWorkspace(await database.db.select().from(emailOutbox)),
  });
};

const afterValue = (effect: ChangeProposalEffect, field: string): unknown => {
  const change = effect[field];
  if (change === undefined || 'delta' in change) throw new Error(`No before/after for ${field}`);
  return change.after;
};

beforeAll(async () => {
  database = await createTestDatabase(
    'together_change_proposal_replay_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'change-proposal-replay-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp({ ...deps, dispatchEmail: () => undefined });

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Proposal Replay Owner', email, password }),
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

describe('change proposal replay on a clean workspace', () => {
  it('a propose-mode key proposes a product, a price and stock changes; live state moves only on each approval and exactly as shown', async () => {
    const issued = await ownerRequest(API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
      name: 'Catalogue agent', scopes: ['shop:catalog:read', 'shop:catalog:write'], expiresAt, mode: 'propose',
    });
    expect(issued.status).toBe(200);
    const key = envelope(apiKeysShopManagementCreateOutputSchema).parse(await issued.json()).data;
    const agent: ShopManagementClient = createShopManagementClient({ baseUrl, apiKey: key.secret, fetchImpl: workspaceFetch });

    const empty = await liveState();
    const productProposal = proposed(await agent.createProduct({ title: 'Printed handbook', slug: 'printed-handbook', type: 'physical', priceCents: 4900, currency: 'PLN' }));
    expect(productProposal).toMatchObject({ operation: 'product.create', status: 'pending', target: { kind: 'product', id: null } });
    expect(await liveState()).toBe(empty);
    const productEffect = await shownEffect(productProposal.id);
    expect(productEffect['exists']).toEqual({ before: false, after: true });
    const appliedProduct = await approve(productProposal.id);
    expect(appliedProduct.status).toBe('applied');
    const productId = appliedProduct.appliedResourceId;
    if (productId === null) throw new Error('The applied product has no id');
    const live = unwrappedProduct(await agent.listProducts(), productId);
    for (const field of ['title', 'slug', 'type', 'priceCents', 'currency', 'published'] as const) {
      expect(live[field], field).toEqual(afterValue(productEffect, field));
    }

    const beforePrice = await liveState();
    const priceProposal = proposed(await agent.createProductPrice({ productId, kind: 'one_time', amountCents: 4900, currency: 'PLN' }));
    expect(priceProposal.target).toEqual({ kind: 'product', id: productId });
    expect(await liveState()).toBe(beforePrice);
    const priceEffect = await shownEffect(priceProposal.id);
    expect((await approve(priceProposal.id)).status).toBe('applied');
    const prices = (await database.db.select().from(productPrices)).filter((row) => row.productId === productId && row.active);
    expect(prices.map(({ kind, interval, amountCents, currency }) => ({ kind, interval, amountCents, currency }))).toEqual(afterValue(priceEffect, 'activePrices'));

    const beforeTracking = await liveState();
    const trackingProposal = proposed(await agent.enableProductStock({ productId, onHand: 10, lowStockThreshold: null }));
    expect(await liveState()).toBe(beforeTracking);
    expect(await shownEffect(trackingProposal.id)).toEqual({
      tracked: { before: false, after: true },
      onHand: { before: null, after: 10 },
    });
    expect((await approve(trackingProposal.id)).status).toBe('applied');
    const onHand = async () => (await database.db.select().from(productStock)).find((row) => row.productId === productId)?.onHand;
    expect(await onHand()).toBe(10);

    const beforeAdjust = await liveState();
    const adjustProposal = proposed(await agent.adjustProductStock({ productId, delta: 5, reason: 'delivery' }));
    expect(await liveState()).toBe(beforeAdjust);
    expect(await shownEffect(adjustProposal.id)).toEqual({ onHand: { delta: 5 } });
    expect((await approve(adjustProposal.id)).status).toBe('applied');
    expect(await onHand()).toBe(15);

    const beforeRejected = await liveState();
    const rename = proposed(await agent.updateProduct({ id: productId, title: 'Rejected title' }));
    const rejected = await ownerRequest('POST', API_PATHS.changeProposalReject.replace(':id', rename.id), { note: 'Keep the title' });
    expect(rejected.status).toBe(200);
    expect(envelope(changeProposalRejectOutputSchema).parse(await rejected.json()).data.proposal.status).toBe('rejected');
    expect(await liveState()).toBe(beforeRejected);
    expect((await ownerRequest('POST', API_PATHS.changeProposalApprove.replace(':id', rename.id), {})).status).toBe(409);
    expect(await liveState()).toBe(beforeRejected);

    const receipts = await agent.listProposals({ limit: 100 });
    if (!receipts.ok) throw new Error(receipts.error.message);
    expect(receipts.value.proposals.map((receipt) => `${receipt.operation} ${receipt.status}`).toSorted()).toEqual([
      'price.create applied',
      'product.create applied',
      'product.update rejected',
      'stock.adjust applied',
      'stock.enable applied',
    ]);
  });
});

const unwrappedProduct = (
  result: Awaited<ReturnType<ShopManagementClient['listProducts']>>,
  productId: string,
) => {
  if (!result.ok) throw new Error(result.error.message);
  const product = result.value.products.find((entry) => entry.id === productId);
  if (product === undefined) throw new Error(`Product ${productId} is not live`);
  return product;
};
