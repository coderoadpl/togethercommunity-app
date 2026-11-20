import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import {
  changeProposalOperationSchema,
  type ChangeProposalOperation,
  type Identity,
  type ShopManagementKey,
} from '#core/domain/index.js';
import {
  shopManagementKeyCapabilities,
  submitChangeProposal,
  type ChangeProposalSubmitDeps,
  type Ctx,
  type RealtimeEvent,
  type StorageProvider,
} from '#core/server/index.js';

import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { createChangeProposalRepository } from './change-proposals.js';
import { closeDb, createDb, type Db } from './client.js';
import { createTenantAccessReader, createTenantSecretRepository, createUnreadNotificationRaiser } from './repositories.js';
import {
  changeProposalEvents,
  changeProposals,
  emailOutbox,
  entityVersions,
  productDownloadAssets,
  productPrices,
  products,
  productStock,
  salesLinkEvents,
  salesLinks,
  notifications,
  stockEvents,
  tenantAdmins,
  tenants,
  user,
} from './schema.js';
import { createSalesLinkRepository } from './sales-links.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-change-proposal-submit';
const NOW = '2026-03-01T10:00:00.000Z';
const OWNER = 'user-owner';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;
const published: RealtimeEvent[] = [];

const owner: Identity = {
  userId: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
};

const key: ShopManagementKey = {
  id: 'key-propose', tenantId: TENANT, name: 'Catalogue agent', keyHash: 'hash-propose',
  scopes: ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'],
  mode: 'propose', issuedByUserId: OWNER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z', revokedAt: null,
};

const keyCtx: Ctx = {
  identity: owner,
  capabilities: shopManagementKeyCapabilities(key),
  machineActor: { kind: 'shop_management_key', apiKeyId: key.id, mode: 'propose' },
};

const storageCalls: string[] = [];
const refuse = (name: string) => () => {
  storageCalls.push(name);
  throw new Error(`storage.${name} must not run in a dry run`);
};
const storage: StorageProvider = {
  objectUrl: (_configuration, objectKey) => new URL(`https://storage.example.test/${objectKey}`),
  delete: refuse('delete'), list: refuse('list'), getObject: refuse('getObject'), putObject: refuse('putObject'),
  probe: refuse('probe'), probeCors: refuse('probeCors'), presignPut: refuse('presignPut'), presignGet: refuse('presignGet'),
  head: refuse('head'), healthcheck: refuse('healthcheck'), test: refuse('test'),
};

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 5).toString('base64'));

const deps = (db: Db = database.db, logger = { error: vi.fn<(message: string) => void>() }): ChangeProposalSubmitDeps => ({
  changeProposalTransaction: createChangeProposalTransaction(db, logger, (connection) =>
    createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto)),
  changeProposals: createChangeProposalRepository(db),
  shopManagementKeys: createShopManagementKeyRepository(db),
  unreadNotifications: createUnreadNotificationRaiser(db),
  tenantAccess: createTenantAccessReader(db),
  realtimeBus: { publish: (event) => { published.push(event); } },
  storage,
  logger,
  ids: { nextId: () => `submit-${String(++sequence)}` },
  clock: { nowIso: () => NOW },
});

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

const insertProduct = async (id: string, values: { type: 'physical' | 'digital_download'; published?: boolean }) => {
  await database.db.insert(products).values({
    id, tenantId: TENANT, slug: id, title: `Title of ${id}`, type: values.type, published: values.published ?? false,
    everPublished: values.published ?? false, description: '', priceCents: 0, currency: 'EUR', createdAt: NOW,
  });
};

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposal_submit', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: TENANT, slug: 'acme', name: 'Acme', createdAt: NOW });
  await createShopManagementKeyRepository(database.db).create(TENANT, key, {
    id: 'key-event-1', tenantId: TENANT, apiKeyId: key.id, kind: 'created', actorUserId: OWNER, method: null, route: null, resourceId: null, at: key.createdAt,
  });
  await createTenantSecretRepository(database.db).upsert(TENANT, {
    id: 'storage-configuration', tenantId: TENANT, key: 's3.configuration', maskedPreview: 'configured', updatedAt: NOW,
    ...secretCrypto.encrypt(JSON.stringify({
      provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'downloads', accessKeyId: 'a', secretAccessKey: 's',
    })),
  });
  await insertProduct('mug', { type: 'physical' });
  await insertProduct('live', { type: 'physical', published: true });
  await insertProduct('draft', { type: 'digital_download' });
  await database.db.insert(productPrices).values([
    { id: 'price-mug', tenantId: TENANT, productId: 'mug', kind: 'one_time', amountCents: 900, currency: 'EUR', active: true, createdAt: NOW },
    { id: 'price-live', tenantId: TENANT, productId: 'live', kind: 'one_time', amountCents: 1500, currency: 'EUR', active: true, createdAt: NOW },
  ]);
  await database.db.insert(productStock).values({ tenantId: TENANT, productId: 'live', onHand: 10, reserved: 0, lowStockThreshold: 2, updatedAt: NOW });
  await database.db.insert(productDownloadAssets).values({
    id: 'asset-1', tenantId: TENANT, productId: 'draft', lineageId: 'lineage-1', fileName: 'guide.pdf', contentType: 'application/pdf',
    sizeBytes: 10, storageKey: 'downloads/guide.pdf', status: 'ready', createdAt: NOW,
  });
  const saved = await createSalesLinkRepository(database.db).save(TENANT, {
    id: 'link-spring', tenantId: TENANT, slug: 'spring', title: 'Spring', heading: 'Spring sale', description: '', productIds: ['live'],
    active: false, listed: false, validFrom: null, validTo: null, cancelReturnUrl: null, revision: 1, createdAt: NOW, updatedAt: NOW,
  }, null);
  if (!saved.ok) throw new Error(saved.error.message);
});

afterAll(async () => { await database?.close(); });

const INPUTS: Record<ChangeProposalOperation, unknown> = {
  'product.create': { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 },
  'product.update': { id: 'live', title: 'Big mug', vatRate: 23 },
  'product.publish': { id: 'mug' },
  'product.unpublish': { id: 'live' },
  'product.delete-draft': { productId: 'draft' },
  'price.create': { productId: 'live', kind: 'one_time', amountCents: 2500, currency: 'EUR' },
  'price.deactivate': { id: 'price-live' },
  'stock.enable': { productId: 'mug', onHand: 4, lowStockThreshold: 1 },
  'stock.adjust': { productId: 'live', delta: -3, reason: 'Breakage' },
  'stock.set-threshold': { productId: 'live', lowStockThreshold: 5 },
  'sales-link.create': { slug: 'summer', title: 'Summer', heading: 'Summer sale', productIds: ['mug'] },
  'sales-link.update': { id: 'link-spring', expectedRevision: 1, slug: 'spring', title: 'Spring', heading: 'Spring sale, extended', productIds: ['live'] },
  'sales-link.delete': { id: 'link-spring' },
  'settings.update': { name: 'Acme shop', invoiceVatMode: 'rate', invoiceVatRatePercent: 8 },
};

describe('submitChangeProposal over the database', () => {
  it.each(changeProposalOperationSchema.options)(
    '%s leaves no live row, event, outbox row, content-version bump or storage call behind',
    async (operation) => {
      const before = await liveTables();
      const proposalsBefore = (await database.db.select().from(changeProposals)).length;

      const result = await submitChangeProposal(keyCtx, { operation, input: INPUTS[operation] }, deps());

      if (!result.ok) throw new Error(`${operation}: ${result.error.message}`);
      expect(await liveTables()).toEqual(before);
      expect(storageCalls).toEqual([]);
      const [stored] = await database.db.select().from(changeProposals).where(eq(changeProposals.id, result.value.id));
      expect(stored).toMatchObject({ operation, status: 'pending', proposedByKeyId: key.id, proposedByKeyName: key.name });
      expect(stored?.effect).not.toEqual({});
      expect((await database.db.select().from(changeProposals)).length).toBe(proposalsBefore + 1);
      expect(await database.db.select().from(changeProposalEvents).where(eq(changeProposalEvents.proposalId, result.value.id)))
        .toEqual([expect.objectContaining({ kind: 'proposed', sequence: 1, apiKeyId: key.id })]);
    },
  );

  it('records only the changed field of a published product and keeps its content version', async () => {
    const [tenantBefore] = await database.db.select({ contentVersion: tenants.contentVersion }).from(tenants).where(eq(tenants.id, TENANT));
    const result = await submitChangeProposal(keyCtx, { operation: 'product.update', input: { id: 'live', description: 'Fresh' } }, deps());
    if (!result.ok) throw new Error(result.error.message);
    const [stored] = await database.db.select().from(changeProposals).where(eq(changeProposals.id, result.value.id));
    expect(stored?.effect).toEqual({ description: { before: '', after: 'Fresh' } });
    expect(await database.db.select({ contentVersion: tenants.contentVersion }).from(tenants).where(eq(tenants.id, TENANT))).toEqual([tenantBefore]);
  });

  it('submits a draft deletion on a one-connection pool with the real secret resolver', async () => {
    const single = createDb('node-postgres', database.url, { max: 1, connectionTimeoutMillis: 2_000 });
    const logger = { error: vi.fn<(message: string) => void>() };
    try {
      const before = await liveTables();
      const result = await submitChangeProposal(keyCtx, { operation: 'product.delete-draft', input: INPUTS['product.delete-draft'] }, deps(single, logger));
      expect(result).toMatchObject({ ok: true, value: { operation: 'product.delete-draft', status: 'pending' } });
      expect(logger.error).not.toHaveBeenCalled();
      expect(storageCalls).toEqual([]);
      expect(await liveTables()).toEqual(before);
    } finally {
      await closeDb(single);
    }
  });

  it('returns a live refusal unchanged and stores nothing', async () => {
    const proposalsBefore = (await database.db.select().from(changeProposals)).length;
    const result = await submitChangeProposal(keyCtx, { operation: 'stock.adjust', input: { productId: 'live', delta: -50, reason: 'Count' } }, deps());
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect((await database.db.select().from(changeProposals)).length).toBe(proposalsBefore);
  });
});

describe('the owner notification of a submitted proposal over the database', () => {
  const OTHER_OWNER = 'user-owner-two';
  const ownerNotifications = async () =>
    (await database.db.select().from(notifications).where(eq(notifications.tenantId, TENANT)).orderBy(asc(notifications.recipientUserId)));
  const propose = async (title: string) => {
    const result = await submitChangeProposal(keyCtx, { operation: 'product.update', input: { id: 'mug', title } }, deps());
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };

  beforeAll(async () => {
    await database.db.insert(user).values([
      { id: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true },
      { id: OTHER_OWNER, email: 'second-owner@example.test', name: 'Second owner', emailVerified: true },
      { id: 'user-admin', email: 'admin@example.test', name: 'Admin', emailVerified: true },
    ]);
    await database.db.insert(tenantAdmins).values([
      { id: 'grant-owner', tenantId: TENANT, userId: OWNER, role: 'owner' },
      { id: 'grant-owner-two', tenantId: TENANT, userId: OTHER_OWNER, role: 'owner' },
      { id: 'grant-admin', tenantId: TENANT, userId: 'user-admin', role: 'admin' },
    ]);
  });

  it('raises one unread notification per owner and key, re-raises it once read, and publishes only what it wrote', async () => {
    await database.db.delete(notifications);
    published.length = 0;
    await propose('First rename');
    await propose('Second rename');

    const unread = await ownerNotifications();
    expect(unread.map((row) => [row.recipientUserId, row.kind, row.sourceKey, row.readAt])).toEqual([
      [OWNER, 'change-proposal', `change-proposal:${key.id}`, null],
      [OTHER_OWNER, 'change-proposal', `change-proposal:${key.id}`, null],
    ]);
    expect(unread[0]?.payload).toMatchObject({ contextKind: 'tenant', contextId: null, authorDisplay: key.name, snippet: '' });
    expect(published.map((event) => event.kind === 'notification' ? event.notificationKind : null)).toEqual(['change-proposal', 'change-proposal']);

    await database.db.update(notifications).set({ readAt: NOW }).where(eq(notifications.recipientUserId, OWNER));
    await propose('Third rename');

    const after = await ownerNotifications();
    expect(after).toHaveLength(2);
    expect(after.every((row) => row.readAt === null)).toBe(true);
    expect(after.find((row) => row.recipientUserId === OWNER)?.id).toBe(unread.find((row) => row.recipientUserId === OWNER)?.id);
    expect(published).toHaveLength(3);
  });

  it('keeps one notification per owner and key under concurrent submissions', async () => {
    await database.db.delete(notifications);
    await Promise.all(['Parallel one', 'Parallel two', 'Parallel three'].map((title) => propose(title)));
    expect((await ownerNotifications()).map((row) => row.recipientUserId)).toEqual([OWNER, OTHER_OWNER]);
  });

  it('never fails the submission when the notification cannot be written, and logs it', async () => {
    const logger = { error: vi.fn<(message: string) => void>() };
    const failing = { ...deps(database.db, logger), unreadNotifications: { raiseUnread: () => Promise.reject(new Error('notifications table locked')) } };
    const result = await submitChangeProposal(keyCtx, { operation: 'product.update', input: { id: 'mug', title: 'Logged rename' } }, failing);

    expect(result).toMatchObject({ ok: true, value: { status: 'pending' } });
    if (!result.ok) return;
    expect(await database.db.select().from(changeProposals).where(eq(changeProposals.id, result.value.id))).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[change-proposal] owner notification failed'));
  });

  it('raises nothing for a refused submission', async () => {
    await database.db.delete(notifications);
    const result = await submitChangeProposal(keyCtx, { operation: 'stock.adjust', input: { productId: 'live', delta: -500, reason: 'Count' } }, deps());
    expect(result.ok).toBe(false);
    expect(await ownerNotifications()).toEqual([]);
  });
});
