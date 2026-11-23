import { createHash, createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createChangeProposalTransaction } from '#adapters/db/change-proposal-transaction.js';
import { createTenantSecretRepository } from '#adapters/db/repositories.js';
import {
  changeProposalDownloadFiles,
  changeProposalEvents,
  emailOutbox,
  entityVersions,
  members,
  productDownloadAssets,
  productGrants,
  productPrices,
  products,
  productStock,
  salesLinks,
  stockEvents,
  tenantAdmins,
  tenants,
} from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createS3StorageProvider } from '#adapters/storage/s3.js';
import { createShopManagementClient, isProposedChange, type ShopManagementClient } from '#core/client/index.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  changeProposalApproveOutputSchema,
  changeProposalFileOutputSchema,
  changeProposalGroupOutputSchema,
  changeProposalRejectOutputSchema,
  changeProposalShowOutputSchema,
  myProductsOutputSchema,
  SHOP_CATALOG_ROUTES,
  shopCatalogContracts,
  type ChangeProposalProposedOutput,
} from '#core/contract/index.js';
import { changeProposalReference, type AppError, type ChangeProposalEffect, type ChangeProposalKeyReceipt, type Result } from '#core/domain/index.js';
import type { TenantSecretResolver } from '#core/server/index.js';
import { createObjectStorageFake, fakeStorageSecrets, type FakeObjectStorage } from '#core/server/testing/object-storage-fake.js';

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
let storage: FakeObjectStorage;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });

const proposed = <A extends object>(result: Result<ChangeProposalProposedOutput | ({ outcome: 'applied' } & A), AppError>): ChangeProposalKeyReceipt => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  if (!isProposedChange(result.value)) throw new Error('Expected a proposal, got a live change');
  return result.value.proposal;
};

const STORAGE_ORIGIN = 'https://storage.example.test';

const storageKeyOf = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1));

const STORAGE_CREDENTIALS = { accessKeyId: 'a', secretAccessKey: 's', region: 'auto' };

let storageNow = Date.parse(now);

const rfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

const byCodePoint = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const amzTime = (stamp: string): number =>
  Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`);

const signedRequestRefusal = (method: string, target: URL): string | null => {
  const signature = target.searchParams.get('X-Amz-Signature');
  const stamp = target.searchParams.get('X-Amz-Date') ?? '';
  const expires = Number(target.searchParams.get('X-Amz-Expires'));
  if (signature === null || target.searchParams.get('X-Amz-SignedHeaders') !== 'host') return 'unsigned';
  if (storageNow < amzTime(stamp) || storageNow > amzTime(stamp) + expires * 1000) return 'expired';
  const scope = `${stamp.slice(0, 8)}/${STORAGE_CREDENTIALS.region}/s3/aws4_request`;
  if (target.searchParams.get('X-Amz-Credential') !== `${STORAGE_CREDENTIALS.accessKeyId}/${scope}`) return 'foreign credential';
  const query = [...target.searchParams.entries()].filter(([name]) => name !== 'X-Amz-Signature')
    .map(([name, value]) => [rfc3986(name), rfc3986(value)] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) => leftName === rightName ? byCodePoint(leftValue, rightValue) : byCodePoint(leftName, rightName))
    .map(([name, value]) => `${name}=${value}`).join('&');
  const path = target.pathname.split('/').map((segment) => rfc3986(decodeURIComponent(segment))).join('/');
  const request = [method, path, query, `host:${target.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const signingKey = [stamp.slice(0, 8), STORAGE_CREDENTIALS.region, 's3', 'aws4_request']
    .reduce<Buffer>((current, part) => createHmac('sha256', current).update(part).digest(), Buffer.from(`AWS4${STORAGE_CREDENTIALS.secretAccessKey}`));
  const expected = createHmac('sha256', signingKey)
    .update(['AWS4-HMAC-SHA256', stamp, scope, createHash('sha256').update(request).digest('hex')].join('\n')).digest('hex');
  return expected === signature ? null : 'signature mismatch';
};

const storageEndpoint = (method: string, target: string): Response => {
  const url = new URL(target);
  if (signedRequestRefusal(method, url) !== null) return new Response(null, { status: 403 });
  const found = storage.objects.get(storageKeyOf(target));
  if (found === undefined) return new Response(null, { status: 404 });
  return new Response(method === 'GET' ? found.bytes.slice() : null, {
    headers: {
      'content-type': url.searchParams.get('response-content-type') ?? found.contentType,
      'content-disposition': url.searchParams.get('response-content-disposition') ?? 'attachment',
    },
  });
};

const workspaceFetch: typeof fetch = async (input, init) => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body: unknown = init?.body;
  if (target.startsWith(`${STORAGE_ORIGIN}/`) && init?.method === 'PUT' && body instanceof Uint8Array) {
    storage.objects.set(storageKeyOf(target), { bytes: new Uint8Array(body), contentType: new Headers(init.headers).get('content-type') ?? '' });
    return new Response(null, { status: 200 });
  }
  if (target.startsWith(`${STORAGE_ORIGIN}/`)) return storageEndpoint(init?.method ?? 'GET', target);
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
    salesLinks: ofWorkspace(await database.db.select().from(salesLinks)),
    files: ofWorkspace(await database.db.select().from(productDownloadAssets)),
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
  const env = envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'change-proposal-replay-test-secret-at-least-32-characters',
  });
  const deps = createDeps(env, { db: database.db, clock: { nowIso: () => now } });
  const secretCrypto = createSecretCrypto(env.SECRETS_MASTER_KEY);
  const withFakeStorage = (resolver: TenantSecretResolver): TenantSecretResolver => ({
    resolve: async (tenantId, key) => key === 's3.configuration' ? fakeStorageSecrets.resolve() : resolver.resolve(tenantId, key),
  });
  storage = createObjectStorageFake({ sha256: (bytes) => createHash('sha256').update(bytes).digest('hex') });
  const signer = createS3StorageProvider(fakeStorageSecrets, { now: () => new Date(now) });
  app = buildApp({
    ...deps,
    dispatchEmail: () => undefined,
    storage: { ...storage.storage, presignGet: signer.presignGet },
    secretResolver: withFakeStorage(deps.secretResolver),
    changeProposalTransaction: createChangeProposalTransaction(database.db, deps.logger, (connection) =>
      withFakeStorage(createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto))),
  });

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

const issueKey = async (mode: 'direct' | 'propose', name: string) => {
  const issued = await ownerRequest(API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
    name, scopes: ['shop:catalog:read', 'shop:catalog:write'], expiresAt, mode,
  });
  expect(issued.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await issued.json()).data;
};

const ownerGroup = async (id: string) => {
  const response = await ownerRequest('GET', API_PATHS.changeProposalGroup.replace(':id', id));
  expect(response.status).toBe(200);
  return envelope(changeProposalGroupOutputSchema).parse(await response.json()).data.group;
};

const approveGroup = async (id: string, itemIds: string[]) => {
  const response = await ownerRequest('POST', API_PATHS.changeProposalGroupApprove.replace(':id', id), { itemIds });
  expect(response.status).toBe(200);
  return envelope(changeProposalGroupOutputSchema).parse(await response.json()).data.group;
};

const unwrapped = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

describe('change proposal group replay', () => {
  it('a propose-mode key builds a product, its price, its stock, its publication and a sales link as one group; the owner approves it and everything exists exactly as shown', async () => {
    const key = await issueKey('propose', 'Launch agent');
    const agent = createShopManagementClient({ baseUrl, apiKey: key.secret, fetchImpl: workspaceFetch });
    const empty = await liveState();
    const group = unwrapped(await agent.createProposalGroup({ title: 'Launch the field guide' })).group;
    const inGroup = { groupId: group.id };

    const product = proposed(await agent.createProduct({ title: 'Field guide', slug: 'field-guide', type: 'physical', priceCents: 3900, currency: 'PLN' }, undefined, inGroup));
    const productRef = changeProposalReference(product.id);
    const price = proposed(await agent.createProductPrice({ productId: productRef, kind: 'one_time', amountCents: 3900, currency: 'PLN' }, undefined, inGroup));
    const stock = proposed(await agent.enableProductStock({ productId: productRef, onHand: 10, lowStockThreshold: 2 }, undefined, inGroup));
    const publish = proposed(await agent.publishProduct({ id: productRef }, undefined, inGroup));
    const link = proposed(await agent.createSalesLink({ slug: 'field-guide-offer', title: 'Field guide', heading: 'The field guide', productIds: [productRef] }, undefined, inGroup));
    expect(await liveState()).toBe(empty);
    expect([product, price, stock, publish, link].map((item) => item.groupId)).toEqual(Array.from({ length: 5 }, () => group.id));
    expect(publish.input).toEqual({ id: productRef });

    const shown = await ownerGroup(group.id);
    expect(shown.status).toBe('open');
    expect(shown.items.map((item) => item.operation)).toEqual(['product.create', 'price.create', 'stock.enable', 'product.publish', 'sales-link.create']);
    expect(shown.items[3]?.effect).toEqual({ published: { before: false, after: true } });
    expect(shown.items[2]?.effect).toMatchObject({ tracked: { before: false, after: true }, onHand: { before: null, after: 10 } });
    const productEffect = shown.items[0]?.effect ?? {};
    const priceEffect = shown.items[1]?.effect ?? {};
    const linkEffect = shown.items[4]?.effect ?? {};
    expect(await liveState()).toBe(empty);

    const decided = await approveGroup(group.id, shown.items.map((item) => item.id));
    expect(decided.status).toBe('applied');
    expect(decided.items.map((item) => item.effect)).toEqual(shown.items.map((item) => item.effect));
    const [productId, priceId, , , linkId] = decided.items.map((item) => item.appliedResourceId ?? '');
    if (productId === undefined || priceId === undefined || linkId === undefined || [productId, priceId, linkId].includes('')) throw new Error('An applied item names no resource');
    expect(decided.items.slice(1, 4).map((item) => item.appliedResourceId)).toEqual([priceId, productId, productId]);

    const liveProduct = unwrappedProduct(await agent.listProducts(), productId);
    for (const field of ['title', 'slug', 'type', 'priceCents', 'currency'] as const) {
      expect(liveProduct[field], field).toEqual(afterValue(productEffect, field));
    }
    expect(liveProduct.published).toBe(true);
    const prices = (await database.db.select().from(productPrices)).filter((row) => row.productId === productId && row.active);
    expect(prices.map((row) => row.id)).toEqual([priceId]);
    expect(prices.map(({ kind, interval, amountCents, currency }) => ({ kind, interval, amountCents, currency }))).toEqual(afterValue(priceEffect, 'activePrices'));
    expect((await database.db.select().from(productStock)).find((row) => row.productId === productId)).toMatchObject({ onHand: 10, lowStockThreshold: 2 });
    const liveLink = (await database.db.select().from(salesLinks)).find((row) => row.id === linkId);
    expect(liveLink).toMatchObject({ slug: 'field-guide-offer', heading: 'The field guide', productIds: [productId] });
    expect(afterValue(linkEffect, 'productIds')).toEqual([productRef]);

    const receipt = unwrapped(await agent.getProposalGroup(group.id)).group;
    expect(receipt.status).toBe('applied');
    expect(receipt.items.map((item) => item.appliedResourceId)).toEqual([productId, priceId, productId, productId, linkId]);
    expect(JSON.stringify(receipt)).not.toContain('effect');
  });

  it('a group with one stale item applies nothing: the new product and its price are rolled back with it', async () => {
    const proposer = await issueKey('propose', 'Stale agent');
    const writer = await issueKey('direct', 'Live writer');
    const agent = createShopManagementClient({ baseUrl, apiKey: proposer.secret, fetchImpl: workspaceFetch });
    const live = await workspaceFetch(`${baseUrl}${SHOP_CATALOG_ROUTES.createProduct.path}`, {
      method: 'POST', headers: { 'x-api-key': writer.secret, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Existing atlas', type: 'physical', priceCents: 1000 }),
    });
    expect(live.status).toBe(200);
    const atlas = envelope(shopCatalogContracts.createProduct.output).parse(await live.json()).data.product.id;

    const group = unwrapped(await agent.createProposalGroup({ title: 'Second edition' })).group;
    const inGroup = { groupId: group.id };
    const product = proposed(await agent.createProduct({ title: 'Atlas, second edition', type: 'physical', priceCents: 1500 }, undefined, inGroup));
    proposed(await agent.createProductPrice({ productId: changeProposalReference(product.id), kind: 'one_time', amountCents: 1500 }, undefined, inGroup));
    const rename = proposed(await agent.updateProduct({ id: atlas, title: 'Atlas, first edition' }, undefined, inGroup));

    const renamed = await workspaceFetch(`${baseUrl}${SHOP_CATALOG_ROUTES.updateProduct.path}`, {
      method: 'POST', headers: { 'x-api-key': writer.secret, 'content-type': 'application/json' },
      body: JSON.stringify({ id: atlas, title: 'Atlas, owner edition' }),
    });
    expect(renamed.status).toBe(200);
    const before = await liveState();
    const shown = await ownerGroup(group.id);

    const decided = await approveGroup(group.id, shown.items.map((item) => item.id));

    expect(decided.status).toBe('stale');
    expect(decided.items.map((item) => [item.status, item.appliedResourceId])).toEqual([['stale', null], ['stale', null], ['stale', null]]);
    expect(await liveState()).toBe(before);
    expect((await database.db.select().from(products)).filter((row) => row.title === 'Atlas, second edition')).toEqual([]);
    const note = `Not applied: item 3 (${rename.id}) of this group could not be applied, so nothing in the group was changed`;
    const staleNotes = (await database.db.select().from(changeProposalEvents))
      .filter((event) => event.kind === 'stale' && decided.items.some((item) => item.id === event.proposalId))
      .map((event) => [event.proposalId, event.note]);
    const byProposal = (left: readonly unknown[], right: readonly unknown[]) => String(left[0]).localeCompare(String(right[0]));
    expect(staleNotes.toSorted(byProposal)).toEqual(decided.items.map((item) => [item.id, item.id === rename.id ? null : note]).toSorted(byProposal));
    expect((await ownerRequest('POST', API_PATHS.changeProposalGroupApprove.replace(':id', group.id), { itemIds: shown.items.map((item) => item.id) })).status).toBe(409);
    expect(await liveState()).toBe(before);
  });
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWMwTptJEmIY1ZA2GkrGwzVpAABIfDIQjwcm5wAAAABJRU5ErkJggg==', 'base64');

describe('change proposal image replay', () => {
  const coverUpload = (bytes: Uint8Array) => ({ kind: 'product-cover' as const, fileName: 'cover.png', contentType: 'image/png' as const, sizeBytes: bytes.byteLength, body: new Uint8Array(bytes) });
  const publicTarget = async (path: string): Promise<string | null> => {
    const served = await app.request(`${baseUrl}${path}`, { headers: { host: workspaceHost } });
    const location = served.headers.get('location');
    return location === null ? null : storageKeyOf(location);
  };

  it('a propose-mode key uploads a cover with the typed client; nothing is public until the owner approves, and then the public address serves those very bytes', async () => {
    const writer = await issueKey('direct', 'Cover writer');
    const live = await workspaceFetch(`${baseUrl}${SHOP_CATALOG_ROUTES.createProduct.path}`, {
      method: 'POST', headers: { 'x-api-key': writer.secret, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Cover atlas', type: 'physical', priceCents: 1000 }),
    });
    const productId = envelope(shopCatalogContracts.createProduct.output).parse(await live.json()).data.product.id;
    const key = await issueKey('propose', 'Cover agent');
    const agent = createShopManagementClient({ baseUrl, apiKey: key.secret, fetchImpl: workspaceFetch });
    const bytes = Buffer.concat([PNG, Buffer.from([11])]);
    const digest = createHash('sha256').update(bytes).digest('hex');

    const uploaded = unwrapped(await agent.uploadProductCover(coverUpload(bytes)));
    expect(uploaded).toEqual({ url: `/api/public/assets/product-cover/${digest}.png`, quarantined: true });
    expect(storage.keysUnder('image-assets/')).toEqual([]);
    const before = await liveState();
    const attach = proposed(await agent.updateProduct({ id: productId, coverUrl: uploaded.url }));
    expect(await liveState()).toBe(before);
    expect(await shownEffect(attach.id)).toEqual({ coverUrl: { before: null, after: uploaded.url } });
    const preview = await ownerRequest('GET', API_PATHS.changeProposalImage.replace(':id', attach.id).replace(':digest', digest));
    expect(preview.status).toBe(200);
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(new Uint8Array(bytes));
    const target = await publicTarget(uploaded.url);
    expect(target === null || !storage.objects.has(target)).toBe(true);

    expect((await approve(attach.id)).status).toBe('applied');
    expect((await database.db.select().from(products)).find((row) => row.id === productId)?.coverUrl).toBe(uploaded.url);
    const published = await publicTarget(uploaded.url);
    expect(published).toBe(`image-assets/acme/product-cover/${digest}.png`);
    expect(storage.objects.get(published ?? '')?.bytes).toEqual(new Uint8Array(bytes));
    expect(storage.keysUnder(`image-asset-quarantine/acme/${key.apiKey.id}/`)).toEqual([]);
  });

  it('a rejected cover never becomes public and its quarantined copy is removed', async () => {
    const writer = await issueKey('direct', 'Rejected cover writer');
    const live = await workspaceFetch(`${baseUrl}${SHOP_CATALOG_ROUTES.createProduct.path}`, {
      method: 'POST', headers: { 'x-api-key': writer.secret, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Rejected cover atlas', type: 'physical', priceCents: 1000 }),
    });
    const productId = envelope(shopCatalogContracts.createProduct.output).parse(await live.json()).data.product.id;
    const key = await issueKey('propose', 'Rejected cover agent');
    const agent = createShopManagementClient({ baseUrl, apiKey: key.secret, fetchImpl: workspaceFetch });
    const uploaded = unwrapped(await agent.uploadProductCover(coverUpload(Buffer.concat([PNG, Buffer.from([12])]))));
    const attach = proposed(await agent.updateProduct({ id: productId, coverUrl: uploaded.url }));
    expect(storage.keysUnder(`image-asset-quarantine/acme/${key.apiKey.id}/`)).toHaveLength(1);

    const rejected = await ownerRequest('POST', API_PATHS.changeProposalReject.replace(':id', attach.id), { note: 'Another cover' });
    expect(rejected.status).toBe(200);
    expect(storage.keysUnder(`image-asset-quarantine/acme/${key.apiKey.id}/`)).toEqual([]);
    const target = await publicTarget(uploaded.url);
    expect(target === null || !storage.objects.has(target)).toBe(true);
    expect((await database.db.select().from(products)).find((row) => row.id === productId)?.coverUrl).toBeNull();
  });
});

const WORKBOOK = new TextEncoder().encode('%PDF-1.7\nfield workbook\n%%EOF\n');

describe('change proposal download file replay', () => {
  const stageWorkbook = async (agent: ShopManagementClient, fileName: string) =>
    unwrapped(await agent.stageProductDownload({ fileName, contentType: 'application/pdf', sizeBytes: WORKBOOK.byteLength, body: new Uint8Array(WORKBOOK) })).file;

  const liveDigitalProduct = async (title: string): Promise<string> => {
    const writer = await issueKey('direct', `${title} writer`);
    const live = await workspaceFetch(`${baseUrl}${SHOP_CATALOG_ROUTES.createProduct.path}`, {
      method: 'POST', headers: { 'x-api-key': writer.secret, 'content-type': 'application/json' },
      body: JSON.stringify({ title, type: 'digital_download', priceCents: 1900 }),
    });
    expect(live.status).toBe(200);
    return envelope(shopCatalogContracts.createProduct.output).parse(await live.json()).data.product.id;
  };

  const buyerOf = async (productId: string): Promise<() => Promise<string[]>> => {
    const buyerEmail = `download-buyer-${productId}@example.test`;
    const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ name: 'Download Buyer', email: buyerEmail, password }),
    });
    expect(signup.status).toBe(200);
    const buyerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
    await database.db.execute(`update "user" set email_verified = true where id = '${buyerId}'`);
    await database.db.insert(members).values({ id: `member-${productId}`, tenantId: 'acme', userId: buyerId, email: buyerEmail, createdAt: now });
    await database.db.insert(productGrants).values({
      id: `grant-${productId}`, tenantId: 'acme', memberId: `member-${productId}`, productId, source: 'manual', startsAt: '2026-11-01T00:00:00.000Z', createdAt: now,
    });
    const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ email: buyerEmail, password }),
    });
    const token = z.object({ token: z.string() }).parse(await signin.json()).token;
    return async () => {
      const listed = await app.request(`${baseUrl}${API_PATHS.myProducts}`, { headers: { host: workspaceHost, authorization: `Bearer ${token}` } });
      expect(listed.status).toBe(200);
      const product = envelope(myProductsOutputSchema).parse(await listed.json()).data.products.find((entry) => entry.id === productId);
      return product?.downloads.map((download) => download.id) ?? [];
    };
  };

  it('a propose-mode key stages a workbook and proposes it; the owner downloads the very bytes, approves, and buyers then find the file', async () => {
    const productId = await liveDigitalProduct('Field workbook');
    const key = await issueKey('propose', 'Workbook agent');
    const agent = createShopManagementClient({ baseUrl, apiKey: key.secret, fetchImpl: workspaceFetch });
    const before = await liveState();
    const staged = await stageWorkbook(agent, 'workbook.pdf');
    const attach = proposed(await agent.addProductDownload({ productId, stagedFileId: staged.id, versionNote: 'First edition' }));
    expect(attach).toMatchObject({ operation: 'download.add', status: 'pending', target: { kind: 'product', id: productId } });
    expect(await liveState()).toBe(before);
    const buyerDownloads = await buyerOf(productId);
    expect(await buyerDownloads()).toEqual([]);

    const effect = await shownEffect(attach.id);
    expect(JSON.stringify(effect['files'])).toContain(staged.id);
    const link = await ownerRequest('GET', API_PATHS.changeProposalFile.replace(':id', attach.id).replace(':fileId', staged.id));
    expect(link.status).toBe(200);
    const { download } = envelope(changeProposalFileOutputSchema).parse(await link.json()).data;
    expect(storage.objects.get(storageKeyOf(download.url))?.bytes).toEqual(WORKBOOK);
    const recorded = (await database.db.select().from(changeProposalDownloadFiles)).find((row) => row.id === staged.id);
    const fetched = await workspaceFetch(download.url);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('application/octet-stream');
    expect(fetched.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''workbook.pdf");
    const bytes = new Uint8Array(await fetched.arrayBuffer());
    expect(bytes).toEqual(WORKBOOK);
    expect(bytes.byteLength).toBe(download.sizeBytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(recorded?.sha256);
    for (const method of ['HEAD', 'DELETE']) expect((await workspaceFetch(download.url, { method })).status).toBe(403);
    const tampered = new URL(download.url);
    tampered.searchParams.set('response-content-type', 'text/html');
    expect((await workspaceFetch(tampered.href)).status).toBe(403);
    storageNow = Date.parse(download.expiresAt) + 1000;
    expect((await workspaceFetch(download.url)).status).toBe(403);
    storageNow = Date.parse(now);

    const applied = await approve(attach.id);
    expect(applied).toMatchObject({ status: 'applied', appliedResourceId: staged.id });
    const files = unwrapped(await agent.listProductDownloads(productId)).assets;
    expect(files.map((file) => [file.id, file.fileName, file.versionNote, file.status])).toEqual([[staged.id, 'workbook.pdf', 'First edition', 'ready']]);
    expect((await database.db.select().from(productDownloadAssets)).find((row) => row.id === staged.id)?.storageKey).toBe(storageKeyOf(download.url));
    expect((await database.db.select().from(changeProposalDownloadFiles)).find((row) => row.id === staged.id)).toBeUndefined();
    expect(await buyerDownloads()).toEqual([staged.id]);
  });

  it('a group creates a digital product, attaches a workbook, prices and publishes it; the owner approves it as one and it is live with its file', async () => {
    const key = await issueKey('propose', 'Workbook launch agent');
    const agent = createShopManagementClient({ baseUrl, apiKey: key.secret, fetchImpl: workspaceFetch });
    const staged = await stageWorkbook(agent, 'launch-workbook.pdf');
    const empty = await liveState();
    const group = unwrapped(await agent.createProposalGroup({ title: 'Launch the workbook' })).group;
    const inGroup = { groupId: group.id };
    const product = proposed(await agent.createProduct({ title: 'Launch workbook', slug: 'launch-workbook', type: 'digital_download', priceCents: 2900, currency: 'PLN' }, undefined, inGroup));
    const productRef = changeProposalReference(product.id);
    proposed(await agent.addProductDownload({ productId: productRef, stagedFileId: staged.id }, undefined, inGroup));
    proposed(await agent.createProductPrice({ productId: productRef, kind: 'one_time', amountCents: 2900, currency: 'PLN' }, undefined, inGroup));
    proposed(await agent.publishProduct({ id: productRef }, undefined, inGroup));
    expect(await liveState()).toBe(empty);

    const shown = await ownerGroup(group.id);
    expect(shown.items.map((item) => item.operation)).toEqual(['product.create', 'download.add', 'price.create', 'product.publish']);
    expect(shown.items[3]?.effect).toEqual({ published: { before: false, after: true } });
    const decided = await approveGroup(group.id, shown.items.map((item) => item.id));
    expect(decided.status).toBe('applied');
    expect(decided.items.map((item) => item.effect)).toEqual(shown.items.map((item) => item.effect));
    const productId = decided.items[0]?.appliedResourceId ?? '';
    expect(decided.items[1]?.appliedResourceId).toBe(staged.id);
    expect(unwrappedProduct(await agent.listProducts(), productId).published).toBe(true);
    expect(unwrapped(await agent.listProductDownloads(productId)).assets.map((file) => file.id)).toEqual([staged.id]);
  });

  it('a rejected file proposal changes nothing and releases its staged file at once', async () => {
    const productId = await liveDigitalProduct('Rejected workbook');
    const key = await issueKey('propose', 'Rejected workbook agent');
    const agent = createShopManagementClient({ baseUrl, apiKey: key.secret, fetchImpl: workspaceFetch });
    const staged = await stageWorkbook(agent, 'rejected.pdf');
    const attach = proposed(await agent.addProductDownload({ productId, stagedFileId: staged.id }));
    expect(storage.keysUnder(`acme/product-downloads/key-files/${key.apiKey.id}/${staged.id}/`)).toHaveLength(1);
    const before = await liveState();
    const rejected = await ownerRequest('POST', API_PATHS.changeProposalReject.replace(':id', attach.id), { note: 'Not this edition' });
    expect(rejected.status).toBe(200);
    expect(await liveState()).toBe(before);
    expect(storage.keysUnder(`acme/product-downloads/key-files/${key.apiKey.id}/`)).toEqual([]);
    expect((await database.db.select().from(changeProposalDownloadFiles)).filter((row) => row.apiKeyId === key.apiKey.id)).toEqual([]);
    expect(unwrapped(await agent.listStagedDownloads()).files).toEqual([]);
    expect((await ownerRequest('GET', API_PATHS.changeProposalFile.replace(':id', attach.id).replace(':fileId', staged.id))).status).toBe(404);
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
