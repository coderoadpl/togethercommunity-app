import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  changeProposalOperationSchema,
  ok,
  type ChangeProposalOperation,
  type Identity,
  type ShopManagementKey,
} from '#core/domain/index.js';
import {
  shopManagementKeyCapabilities,
  submitChangeProposal,
  type ChangeProposalSubmitDeps,
  type Ctx,
  type StorageProvider,
} from '#core/server/index.js';

import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { createChangeProposalRepository } from './change-proposals.js';
import {
  changeProposalEvents,
  changeProposals,
  emailOutbox,
  entityVersions,
  productDownloadAssets,
  productPrices,
  products,
  productStock,
  stockEvents,
  tenants,
} from './schema.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-change-proposal-submit';
const NOW = '2026-03-01T10:00:00.000Z';
const OWNER = 'user-owner';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;

const owner: Identity = {
  userId: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
};

const key: ShopManagementKey = {
  id: 'key-propose', tenantId: TENANT, name: 'Catalogue agent', keyHash: 'hash-propose', scopes: ['shop:catalog:write'],
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

const deps = (): ChangeProposalSubmitDeps => {
  const logger = { error: vi.fn<(message: string) => void>() };
  return {
    changeProposalTransaction: createChangeProposalTransaction(database.db, logger),
    changeProposals: createChangeProposalRepository(database.db),
    shopManagementKeys: createShopManagementKeyRepository(database.db),
    storage,
    secretResolver: {
      resolve: async () => ok(JSON.stringify({
        provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'downloads', accessKeyId: 'a', secretAccessKey: 's',
      })),
    },
    logger,
    ids: { nextId: () => `submit-${String(++sequence)}` },
    clock: { nowIso: () => NOW },
  };
};

const liveTables = async () => ({
  products: await database.db.select().from(products).where(eq(products.tenantId, TENANT)).orderBy(asc(products.id)),
  prices: await database.db.select().from(productPrices).where(eq(productPrices.tenantId, TENANT)).orderBy(asc(productPrices.id)),
  stock: await database.db.select().from(productStock).where(eq(productStock.tenantId, TENANT)).orderBy(asc(productStock.productId)),
  stockEvents: await database.db.select().from(stockEvents).where(eq(stockEvents.tenantId, TENANT)),
  downloads: await database.db.select().from(productDownloadAssets).where(eq(productDownloadAssets.tenantId, TENANT)),
  versions: await database.db.select().from(entityVersions),
  outbox: await database.db.select().from(emailOutbox),
  tenant: await database.db.select().from(tenants).where(eq(tenants.id, TENANT)),
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

  it('returns a live refusal unchanged and stores nothing', async () => {
    const proposalsBefore = (await database.db.select().from(changeProposals)).length;
    const result = await submitChangeProposal(keyCtx, { operation: 'stock.adjust', input: { productId: 'live', delta: -50, reason: 'Count' } }, deps());
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect((await database.db.select().from(changeProposals)).length).toBe(proposalsBefore);
  });
});
