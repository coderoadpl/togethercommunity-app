import { and, asc, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import {
  CHANGE_PROPOSAL_GROUP_LIMITS,
  changeProposalExpiresAt,
  changeProposalReference,
  ok,
  type AppError,
  type ChangeProposalOperation,
  type Identity,
  type Result,
  type ShopManagementKey,
  type ShopManagementKeyEvent,
} from '#core/domain/index.js';
import {
  approveChangeProposalGroup,
  createChangeProposalGroup,
  getChangeProposalGroup,
  getOwnChangeProposalGroup,
  rejectChangeProposalGroup,
  shopManagementKeyCapabilities,
  submitChangeProposal,
  submitGroupedChangeProposal,
  withdrawOwnChangeProposalGroup,
  type Ctx,
  type StorageProvider,
} from '#core/server/index.js';

import { createChangeProposalGroupRepository } from './change-proposal-groups.js';
import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { createChangeProposalEventRepository, createChangeProposalRepository } from './change-proposals.js';
import { closeDb, createDb, type Db } from './client.js';
import { createTenantSecretRepository } from './repositories.js';
import {
  changeProposalEvents,
  changeProposalGroups,
  changeProposals,
  emailOutbox,
  entityVersions,
  productDownloadAssets,
  productPrices,
  products,
  productStock,
  salesLinkEvents,
  salesLinks,
  shopManagementKeyEvents,
  shopManagementKeys,
  stockEvents,
  tenants,
} from './schema.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-change-proposal-groups';
const NEIGHBOUR = 't-change-proposal-groups-neighbour';
const NOW = '2026-03-01T10:00:00.000Z';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const KEY_ID = 'key-propose';
const OTHER_KEY_ID = 'key-other';
const NEIGHBOUR_KEY_ID = 'key-neighbour';
const SCOPES: ShopManagementKey['scopes'] = ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'];

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;
let now = NOW;

const identity = (userId: string, tenantId = TENANT): Identity => ({
  userId, email: `${userId}@example.test`, name: userId, emailVerified: true, tenantAccess: 'staff',
  tenantId, tenantSlug: tenantId, tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const shopKey = (id: string, tenantId = TENANT): ShopManagementKey => ({
  id, tenantId, name: `Agent ${id}`, keyHash: `hash-${id}`, scopes: SCOPES, mode: 'propose', issuedByUserId: ISSUER,
  createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-06-20T00:00:00.000Z', revokedAt: null,
});

const keyCtx = (keyId = KEY_ID, tenantId = TENANT): Ctx => ({
  identity: identity(ISSUER, tenantId),
  capabilities: shopManagementKeyCapabilities({ scopes: SCOPES, mode: 'propose' }),
  machineActor: { kind: 'shop_management_key', apiKeyId: keyId, mode: 'propose' },
});

const ownerSession: Ctx = { identity: identity(OWNER) };

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 9).toString('base64'));

const storageCalls: string[] = [];
const storage: StorageProvider = (() => {
  const refuse = (name: string) => () => {
    storageCalls.push(name);
    throw new Error(`storage.${name} is not expected`);
  };
  return {
    objectUrl: (configuration, objectKey) => new URL(`${configuration.endpoint}/${configuration.bucket}/${objectKey}`),
    delete: async (input) => {
      storageCalls.push(`delete ${input.url}`);
      return ok({ deleted: true });
    },
    list: refuse('list'), getObject: refuse('getObject'), putObject: refuse('putObject'), probe: refuse('probe'), probeCors: refuse('probeCors'),
    presignPut: refuse('presignPut'), presignGet: refuse('presignGet'), head: refuse('head'), healthcheck: refuse('healthcheck'), test: refuse('test'),
  };
})();

const deps = (db: Db = database.db) => {
  const logger = { error: vi.fn<(message: string) => void>() };
  return {
    changeProposalTransaction: createChangeProposalTransaction(db, logger, (connection) =>
      createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto)),
    changeProposals: createChangeProposalRepository(db),
    changeProposalGroups: createChangeProposalGroupRepository(db),
    changeProposalEvents: createChangeProposalEventRepository(db),
    shopManagementKeys: createShopManagementKeyRepository(db),
    storage,
    logger,
    ids: { nextId: () => `group-${String(++sequence)}` },
    clock: { nowIso: () => now },
  };
};

const unwrap = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

const newGroup = async (ctx = keyCtx(), title = 'Spring launch'): Promise<string> =>
  unwrap(await createChangeProposalGroup(ctx, { title }, deps())).id;

const join = (groupId: string, operation: ChangeProposalOperation, input: unknown, ctx = keyCtx(), db: Db = database.db) =>
  submitGroupedChangeProposal(ctx, { groupId, operation, input }, deps(db));

const add = async (groupId: string, operation: ChangeProposalOperation, input: unknown): Promise<string> => {
  const receipt = unwrap(await join(groupId, operation, input));
  const last = receipt.items.at(-1);
  if (last === undefined) throw new Error('The group has no items');
  return last.id;
};

const itemsOf = async (groupId: string) =>
  database.db.select().from(changeProposals).where(eq(changeProposals.groupId, groupId)).orderBy(asc(changeProposals.groupPosition));

const statusesOf = async (groupId: string) => (await itemsOf(groupId)).map((item) => item.status);

const itemIdsOf = async (groupId: string) => (await itemsOf(groupId)).map((item) => item.id);

const approve = async (groupId: string, db: Db = database.db) =>
  approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: await itemIdsOf(groupId) }, deps(db));

const eventsOf = async (id: string) =>
  (await createChangeProposalEventRepository(database.db).listByProposal(TENANT, id)).map(({ sequence: position, kind, note }) => ({ position, kind, note }));

const liveTables = async () => ({
  products: await database.db.select().from(products).where(eq(products.tenantId, TENANT)).orderBy(asc(products.id)),
  prices: await database.db.select().from(productPrices).where(eq(productPrices.tenantId, TENANT)).orderBy(asc(productPrices.id)),
  stock: await database.db.select().from(productStock).where(eq(productStock.tenantId, TENANT)).orderBy(asc(productStock.productId)),
  stockEvents: await database.db.select().from(stockEvents).where(eq(stockEvents.tenantId, TENANT)),
  downloads: await database.db.select().from(productDownloadAssets).where(eq(productDownloadAssets.tenantId, TENANT)),
  versions: await database.db.select().from(entityVersions),
  outbox: await database.db.select().from(emailOutbox),
  tenant: await database.db.select().from(tenants).where(eq(tenants.id, TENANT)),
  salesLinks: await database.db.select().from(salesLinks).where(eq(salesLinks.tenantId, TENANT)).orderBy(asc(salesLinks.id)),
  salesLinkEvents: await database.db.select().from(salesLinkEvents).where(eq(salesLinkEvents.tenantId, TENANT)),
});

const proposalTables = async () => ({
  groups: await database.db.select().from(changeProposalGroups).orderBy(asc(changeProposalGroups.id)),
  proposals: await database.db.select().from(changeProposals).orderBy(asc(changeProposals.id)),
  events: await database.db.select().from(changeProposalEvents).orderBy(asc(changeProposalEvents.id)),
});

const connectedClient = async (): Promise<pg.Client> => {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  return client;
};

const untilLockWaiters = async (observer: pg.Client, count: number): Promise<void> => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const waiting = await observer.query<{ count: number }>(
      "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
    );
    if ((waiting.rows[0]?.count ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`Fewer than ${String(count)} sessions started waiting on a lock`);
  }
};

const createKey = async (key: ShopManagementKey) => {
  await createShopManagementKeyRepository(database.db).create(key.tenantId, key, {
    id: `key-event-${String(++sequence)}`, tenantId: key.tenantId, apiKeyId: key.id, kind: 'created', actorUserId: ISSUER,
    method: null, route: null, resourceId: null, at: key.createdAt,
  });
};

const revokeKey = (at = now) => createShopManagementKeyRepository(database.db).revoke(TENANT, KEY_ID, at, {
  id: `key-event-${String(++sequence)}`, tenantId: TENANT, apiKeyId: KEY_ID, kind: 'revoked', actorUserId: OWNER,
  method: null, route: null, resourceId: null, at,
} satisfies ShopManagementKeyEvent, { at, actorUserId: OWNER, nextEventId: () => `withdrawal-${String(++sequence)}` });

const insertProduct = async (id: string, values: { type?: 'physical' | 'digital_download'; published?: boolean } = {}) => {
  await database.db.insert(products).values({
    id, tenantId: TENANT, slug: id, title: `Title of ${id}`, type: values.type ?? 'physical', published: values.published ?? false,
    everPublished: values.published ?? false, description: '', priceCents: 0, currency: 'EUR', createdAt: NOW,
  });
};

const TEAPOT = { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0, currency: 'EUR' } as const;

const launchChain = async () => {
  const groupId = await newGroup();
  const snapshots = [await liveTables()];
  const created = await add(groupId, 'product.create', TEAPOT);
  snapshots.push(await liveTables());
  const teapot = changeProposalReference(created);
  await add(groupId, 'price.create', { productId: teapot, kind: 'one_time', amountCents: 2500, currency: 'EUR' });
  snapshots.push(await liveTables());
  await add(groupId, 'stock.enable', { productId: teapot, onHand: 4, lowStockThreshold: 1 });
  snapshots.push(await liveTables());
  await add(groupId, 'product.publish', { id: teapot });
  snapshots.push(await liveTables());
  await add(groupId, 'sales-link.create', { slug: 'teapot-offer', title: 'Teapot', heading: 'Teapot offer', productIds: [teapot, 'live'] });
  snapshots.push(await liveTables());
  return { groupId, snapshots, teapot };
};

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposal_groups', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values([
    { id: TENANT, slug: 'acme', name: 'Acme', createdAt: NOW },
    { id: NEIGHBOUR, slug: 'studio', name: 'Studio', createdAt: NOW },
  ]);
  await createTenantSecretRepository(database.db).upsert(TENANT, {
    id: 'storage-configuration', tenantId: TENANT, key: 's3.configuration', maskedPreview: 'configured', updatedAt: NOW,
    ...secretCrypto.encrypt(JSON.stringify({
      provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'downloads', accessKeyId: 'a', secretAccessKey: 's',
    })),
  });
});

afterAll(async () => { await database?.close(); });

beforeEach(async () => {
  now = NOW;
  storageCalls.length = 0;
  for (const table of [changeProposalEvents, changeProposals, changeProposalGroups, shopManagementKeyEvents, shopManagementKeys, stockEvents,
    productStock, productDownloadAssets, productPrices, salesLinkEvents, salesLinks, entityVersions, products]) {
    await database.db.delete(table);
  }
  await createKey(shopKey(KEY_ID));
  await createKey(shopKey(OTHER_KEY_ID));
  await createKey(shopKey(NEIGHBOUR_KEY_ID, NEIGHBOUR));
  await insertProduct('mug');
  await insertProduct('live', { published: true });
  await insertProduct('draft', { type: 'digital_download' });
  await database.db.insert(productPrices).values([
    { id: 'price-mug', tenantId: TENANT, productId: 'mug', kind: 'one_time', amountCents: 900, currency: 'EUR', active: true, createdAt: NOW },
    { id: 'price-live', tenantId: TENANT, productId: 'live', kind: 'one_time', amountCents: 1500, currency: 'EUR', active: true, createdAt: NOW },
  ]);
  await database.db.insert(productStock).values({ tenantId: TENANT, productId: 'live', onHand: 12, reserved: 0, lowStockThreshold: 2, updatedAt: NOW });
  await database.db.insert(productDownloadAssets).values({
    id: 'asset-1', tenantId: TENANT, productId: 'draft', lineageId: 'lineage-1', fileName: 'guide.pdf', contentType: 'application/pdf',
    sizeBytes: 10, storageKey: 'downloads/guide.pdf', status: 'ready', createdAt: NOW,
  });
});

describe('a change proposal group over the database', () => {
  it('previews the chain item by item without a trace, then applies it as one unit with the effects that were stored', async () => {
    const { groupId, snapshots } = await launchChain();

    for (const snapshot of snapshots) expect(snapshot).toEqual(snapshots[0]);
    expect(storageCalls).toEqual([]);
    const stored = await itemsOf(groupId);
    expect(stored.map((item) => item.groupPosition)).toEqual([1, 2, 3, 4, 5]);
    expect(stored[3]?.effect).toEqual({ published: { before: false, after: true } });

    const approved = unwrap(await approve(groupId));

    expect(approved.status).toBe('applied');
    expect(approved.items.map((item) => item.effect)).toEqual(stored.map((item) => item.effect));
    const [teapotRow] = await database.db.select().from(products).where(and(eq(products.tenantId, TENANT), eq(products.slug, 'teapot')));
    if (teapotRow === undefined) throw new Error('The approved product is missing');
    expect(teapotRow).toMatchObject({ published: true, title: 'Teapot' });
    expect(await database.db.select({ amountCents: productPrices.amountCents }).from(productPrices).where(eq(productPrices.productId, teapotRow.id)))
      .toEqual([{ amountCents: 2500 }]);
    expect(await database.db.select({ onHand: productStock.onHand }).from(productStock).where(eq(productStock.productId, teapotRow.id))).toEqual([{ onHand: 4 }]);
    const [link] = await database.db.select().from(salesLinks).where(eq(salesLinks.slug, 'teapot-offer'));
    expect(link?.productIds).toEqual([teapotRow.id, 'live']);
    expect((await itemsOf(groupId)).map((item) => [item.status, item.decidedByUserId])).toEqual(Array.from({ length: 5 }, () => ['applied', OWNER]));
    expect((await itemsOf(groupId))[0]?.appliedResourceId).toBe(teapotRow.id);
    for (const item of stored) expect((await eventsOf(item.id)).map((event) => event.kind)).toEqual(['proposed', 'applied']);
  });

  it('stores nothing and leaves no trace when a later item is refused by its dry run', async () => {
    const groupId = await newGroup();
    const created = await add(groupId, 'product.create', TEAPOT);
    const live = await liveTables();
    const proposals = await proposalTables();

    expect(await join(groupId, 'product.publish', { id: changeProposalReference(created) }))
      .toMatchObject({ ok: false, error: { code: 'validation', message: 'Physical products require an active one-time price' } });
    expect(await join(groupId, 'price.create', { productId: changeProposalReference('group-unknown'), kind: 'one_time', amountCents: 1, currency: 'EUR' }))
      .toMatchObject({ ok: false, error: { code: 'validation' } });

    expect(await liveTables()).toEqual(live);
    expect(await proposalTables()).toEqual(proposals);
  });

  it('answers 409 when an earlier item no longer applies, and stores nothing', async () => {
    const groupId = await newGroup();
    await add(groupId, 'product.update', { id: 'mug', title: 'Big mug' });
    await database.db.update(products).set({ title: 'Owner title' }).where(eq(products.id, 'mug'));
    const proposals = await proposalTables();

    expect(await join(groupId, 'stock.adjust', { productId: 'live', delta: 1, reason: 'Count' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await proposalTables()).toEqual(proposals);
  });

  it('rolls back every item when the third one is stale and records the notes as designed', async () => {
    const groupId = await newGroup();
    const created = await add(groupId, 'product.create', TEAPOT);
    await add(groupId, 'price.create', { productId: changeProposalReference(created), kind: 'one_time', amountCents: 2500, currency: 'EUR' });
    const offending = await add(groupId, 'product.update', { id: 'mug', title: 'Big mug' });
    await add(groupId, 'product.publish', { id: changeProposalReference(created) });
    await database.db.update(products).set({ title: 'Owner title' }).where(eq(products.id, 'mug'));
    const live = await liveTables();

    const decided = unwrap(await approve(groupId));

    expect(decided.status).toBe('stale');
    expect(await liveTables()).toEqual(live);
    expect(await statusesOf(groupId)).toEqual(['stale', 'stale', 'stale', 'stale']);
    const note = `Not applied: item 3 (${offending}) of this group could not be applied, so nothing in the group was changed`;
    for (const item of await itemsOf(groupId)) {
      expect(await eventsOf(item.id)).toEqual([
        { position: 1, kind: 'proposed', note: null },
        { position: 2, kind: 'stale', note: item.id === offending ? null : note },
      ]);
    }
    expect(await approve(groupId)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'stale' } } });
  });

  it('rolls back every item when the third one fails and records its failure', async () => {
    const groupId = await newGroup();
    const created = await add(groupId, 'product.create', TEAPOT);
    await add(groupId, 'price.create', { productId: changeProposalReference(created), kind: 'one_time', amountCents: 2500, currency: 'EUR' });
    const offending = await add(groupId, 'stock.adjust', { productId: 'live', delta: -10, reason: 'Count' });
    await add(groupId, 'product.publish', { id: changeProposalReference(created) });
    await database.db.update(productStock).set({ onHand: 5 }).where(eq(productStock.productId, 'live'));
    const live = await liveTables();

    expect(unwrap(await approve(groupId)).status).toBe('failed');

    expect(await liveTables()).toEqual(live);
    const rows = await itemsOf(groupId);
    expect(rows.map((item) => item.status)).toEqual(['stale', 'stale', 'failed', 'stale']);
    expect(rows.find((item) => item.id === offending)).toMatchObject({ failureCode: 'validation', appliedResourceId: null });
    expect(rows.every((item) => item.appliedResourceId === null)).toBe(true);
  });

  it('runs a draft deletion of the group after the commit only', async () => {
    const groupId = await newGroup();
    await add(groupId, 'product.delete-draft', { productId: 'draft' });
    await add(groupId, 'product.update', { id: 'mug', title: 'Big mug' });
    expect(storageCalls).toEqual([]);

    expect(unwrap(await approve(groupId)).status).toBe('applied');
    expect(storageCalls).toEqual(['delete https://storage.example.test/downloads/downloads/guide.pdf']);
  });

  it('applies once under two concurrent group approvals on two connections', async () => {
    const { groupId } = await launchChain();
    const itemIds = await itemIdsOf(groupId);
    const first = createDb('node-postgres', database.url, { max: 1 });
    const second = createDb('node-postgres', database.url, { max: 1 });
    try {
      const results = await Promise.all([
        approveChangeProposalGroup(ownerSession, { id: groupId, itemIds }, deps(first)),
        approveChangeProposalGroup(ownerSession, { id: groupId, itemIds }, deps(second)),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, error: expect.objectContaining({ code: 'conflict', details: expect.objectContaining({ changeProposalGroupStatus: 'applied' }) }) },
      ]);
    } finally {
      await closeDb(first);
      await closeDb(second);
    }
    expect(await database.db.select().from(products).where(eq(products.slug, 'teapot'))).toHaveLength(1);
    expect(await database.db.select().from(salesLinks).where(eq(salesLinks.slug, 'teapot-offer'))).toHaveLength(1);
    for (const id of itemIds) expect((await eventsOf(id)).map((event) => event.kind)).toEqual(['proposed', 'applied']);
  }, 30_000);

  it('admits one of two concurrent joins at the same position and answers the other 409', async () => {
    const groupId = await newGroup();
    const first = createDb('node-postgres', database.url, { max: 1 });
    const second = createDb('node-postgres', database.url, { max: 1 });
    try {
      const results = await Promise.all([
        join(groupId, 'product.update', { id: 'mug', title: 'Big mug' }, keyCtx(), first),
        join(groupId, 'stock.adjust', { productId: 'live', delta: 1, reason: 'Count' }, keyCtx(), second),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: expect.objectContaining({ code: 'conflict' }) }]);
    } finally {
      await closeDb(first);
      await closeDb(second);
    }
    expect((await itemsOf(groupId)).map((item) => item.groupPosition)).toEqual([1]);
  }, 30_000);
});

describe('group approval races with key revocation', () => {
  it('ends applied when the revocation queues behind the approval', async () => {
    const groupId = await newGroup();
    await add(groupId, 'product.update', { id: 'mug', title: 'Big mug' });
    await add(groupId, 'stock.adjust', { productId: 'live', delta: 2, reason: 'Delivery' });
    const blocker = await connectedClient();
    const observer = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query('select id from products where tenant_id = $1 and id = $2 for update', [TENANT, 'mug']);
      const approval = approve(groupId);
      await untilLockWaiters(observer, 1);
      const revocation = revokeKey();
      await untilLockWaiters(observer, 2);
      await blocker.query('commit');

      expect(await approval).toMatchObject({ ok: true, value: { status: 'applied' } });
      await revocation;
    } finally {
      await blocker.end();
      await observer.end();
    }
    expect(await statusesOf(groupId)).toEqual(['applied', 'applied']);
    expect((await database.db.select({ title: products.title }).from(products).where(eq(products.id, 'mug')))[0]?.title).toBe('Big mug');
  }, 30_000);

  it('ends withdrawn and applies nothing when the approval queues behind the revocation', async () => {
    const groupId = await newGroup();
    await add(groupId, 'product.update', { id: 'mug', title: 'Big mug' });
    await add(groupId, 'stock.adjust', { productId: 'live', delta: 2, reason: 'Delivery' });
    const [last] = (await itemsOf(groupId)).slice(-1);
    const blocker = await connectedClient();
    const observer = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query('select id from change_proposals where tenant_id = $1 and id = $2 for update', [TENANT, last?.id]);
      const revocation = revokeKey();
      await untilLockWaiters(observer, 1);
      const approval = approve(groupId);
      await untilLockWaiters(observer, 2);
      await blocker.query('commit');

      await revocation;
      expect(await approval).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'withdrawn' } } });
    } finally {
      await blocker.end();
      await observer.end();
    }
    expect(await statusesOf(groupId)).toEqual(['withdrawn', 'withdrawn']);
    expect((await database.db.select({ title: products.title }).from(products).where(eq(products.id, 'mug')))[0]?.title).toBe('Title of mug');
  }, 30_000);
});

describe('group storage rules', () => {
  it('reaches a group only through its own key and workspace', async () => {
    const groupId = await newGroup();
    await add(groupId, 'product.update', { id: 'mug', title: 'Big mug' });
    const repository = createChangeProposalGroupRepository(database.db);

    expect(await repository.findByKey(TENANT, OTHER_KEY_ID, groupId)).toBeNull();
    expect(await repository.findById(NEIGHBOUR, groupId)).toBeNull();
    expect(await join(groupId, 'product.update', { id: 'live', title: 'Other' }, keyCtx(OTHER_KEY_ID))).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await join(groupId, 'product.update', { id: 'live', title: 'Other' }, keyCtx(NEIGHBOUR_KEY_ID, NEIGHBOUR))).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await getOwnChangeProposalGroup(keyCtx(OTHER_KEY_ID), { id: groupId }, deps())).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await withdrawOwnChangeProposalGroup(keyCtx(NEIGHBOUR_KEY_ID, NEIGHBOUR), { id: groupId }, deps())).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await getChangeProposalGroup({ identity: identity(OWNER, NEIGHBOUR) }, { id: groupId }, deps())).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await statusesOf(groupId)).toEqual(['pending']);
  });

  it('refuses an item that names another key\'s group at the repository', async () => {
    const groupId = await newGroup();
    const repository = createChangeProposalGroupRepository(database.db);
    const createdAt = NOW;
    const added = await repository.addItem(TENANT, {
      id: 'planted', tenantId: TENANT, groupId, groupPosition: 1, operation: 'product.update', input: { id: 'mug', title: 'X' },
      effect: { title: { before: 'Title of mug', after: 'X' } }, target: { kind: 'product', id: 'mug' }, status: 'pending',
      proposedByKeyId: OTHER_KEY_ID, proposedByKeyName: 'Agent', proposedByIssuerUserId: ISSUER, createdAt,
      expiresAt: changeProposalExpiresAt(createdAt), decidedByUserId: null, decidedAt: null, decisionNote: null, appliedResourceId: null,
      failureCode: null, failureMessage: null,
    }, { id: 'planted-event', actorUserId: null, apiKeyId: OTHER_KEY_ID, note: null, at: createdAt }, createdAt);

    expect(added).toEqual({ kind: 'not_found' });
    expect(await itemsOf(groupId)).toEqual([]);
  });

  it('caps the open groups of a key and stops counting expired, settled and stale empty ones', async () => {
    for (let index = 0; index < CHANGE_PROPOSAL_GROUP_LIMITS.openGroupsPerKey; index += 1) await newGroup(keyCtx(), `Group ${String(index)}`);

    expect(await createChangeProposalGroup(keyCtx(), { title: 'One too many' }, deps()))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_open_groups' } } });
    expect(await createChangeProposalGroup(keyCtx(OTHER_KEY_ID), { title: 'Another key' }, deps())).toMatchObject({ ok: true });

    const [firstGroup] = await database.db.select().from(changeProposalGroups)
      .where(eq(changeProposalGroups.proposedByKeyId, KEY_ID)).orderBy(asc(changeProposalGroups.id)).limit(1);
    if (firstGroup === undefined) throw new Error('no group');
    await add(firstGroup.id, 'product.update', { id: 'mug', title: 'Big mug' });
    unwrap(await rejectChangeProposalGroup(ownerSession, { id: firstGroup.id }, deps()));
    expect(await createChangeProposalGroup(keyCtx(), { title: 'After a rejection' }, deps())).toMatchObject({ ok: true });
    expect(await createChangeProposalGroup(keyCtx(), { title: 'Over again' }, deps())).toMatchObject({ ok: false });

    now = changeProposalExpiresAt(NOW);
    expect(await createChangeProposalGroup(keyCtx(), { title: 'After expiry' }, deps())).toMatchObject({ ok: true });
  }, 60_000);

  it('withdraws the key\'s open groups on revocation and on purge, and leaves an expired group expired', async () => {
    const open = await newGroup();
    await add(open, 'product.update', { id: 'mug', title: 'Big mug' });
    await add(open, 'stock.adjust', { productId: 'live', delta: 1, reason: 'Count' });
    now = '2026-03-30T10:00:00.000Z';
    expect(await revokeKey(now)).not.toBeNull();
    expect(await statusesOf(open)).toEqual(['withdrawn', 'withdrawn']);
    for (const id of await itemIdsOf(open)) {
      expect(await eventsOf(id)).toEqual([{ position: 1, kind: 'proposed', note: null }, { position: 2, kind: 'withdrawn', note: 'key_revoked' }]);
    }

    now = NOW;
    const purged = await newGroup(keyCtx(OTHER_KEY_ID));
    const purgedItem = unwrap(await join(purged, 'product.update', { id: 'mug', title: 'Other' }, keyCtx(OTHER_KEY_ID))).items[0]?.id;
    const expired = await newGroup(keyCtx(OTHER_KEY_ID), 'Old');
    await database.db.insert(changeProposals).values({
      id: 'expired-item', tenantId: TENANT, groupId: expired, groupPosition: 1, operation: 'product.update', input: { id: 'mug', title: 'Old' },
      effect: { title: { before: 'Title of mug', after: 'Old' } }, targetKind: 'product', targetId: 'mug', status: 'pending',
      proposedByKeyId: OTHER_KEY_ID, proposedByKeyName: 'Agent', proposedByIssuerUserId: ISSUER, createdAt: '2026-01-01T10:00:00.000Z',
      expiresAt: '2026-01-31T10:00:00.000Z',
    });
    await createShopManagementKeyRepository(database.db).purge(TENANT, (apiKeyId) => ({
      id: `purge-${apiKeyId}`, tenantId: TENANT, apiKeyId, kind: 'purged', actorUserId: OWNER, method: null, route: null, resourceId: null, at: NOW,
    }), { at: NOW, actorUserId: OWNER, nextEventId: () => `purge-withdrawal-${String(++sequence)}` });

    expect(await statusesOf(purged)).toEqual(['withdrawn']);
    expect((await eventsOf(purgedItem ?? '')).at(-1)).toMatchObject({ kind: 'withdrawn', note: 'key_purged' });
    expect(await statusesOf(expired)).toEqual(['pending']);
  }, 30_000);

  it('records the expiry on every item of an expired group once', async () => {
    const groupId = await newGroup();
    const items = [await add(groupId, 'product.update', { id: 'mug', title: 'Big mug' }), await add(groupId, 'stock.adjust', { productId: 'live', delta: 1, reason: 'Count' })];
    now = changeProposalExpiresAt(NOW);

    expect(await approve(groupId)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'expired' } } });
    expect(await rejectChangeProposalGroup(ownerSession, { id: groupId }, deps())).toMatchObject({ ok: false, error: { code: 'conflict' } });
    for (const id of items) expect((await eventsOf(id)).map((event) => event.kind)).toEqual(['proposed', 'expired']);
  });

  it('keeps single proposals outside every group', async () => {
    const single = unwrap(await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'mug', title: 'Big mug' } }, deps()));
    expect(single.groupId).toBeNull();
    const [row] = await database.db.select().from(changeProposals).where(eq(changeProposals.id, single.id));
    expect(row).toMatchObject({ groupId: null, groupPosition: null });
  });
});
