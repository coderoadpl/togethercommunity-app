import { and, asc, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import {
  appError,
  changeProposalExpiresAt,
  err,
  ok,
  type ChangeProposalOperation,
  type Identity,
  type ShopManagementKey,
  type ShopManagementKeyEvent,
} from '#core/domain/index.js';
import {
  approveChangeProposal,
  getChangeProposal,
  getChangeProposalSummary,
  getOwnChangeProposal,
  listChangeProposals,
  listOwnChangeProposals,
  rejectChangeProposal,
  shopManagementKeyCapabilities,
  submitChangeProposal,
  withdrawOwnChangeProposal,
  type ChangeProposalTransaction,
  type ChangeProposalTransactionScope,
  type Ctx,
  type StorageProvider,
} from '#core/server/index.js';

import { createChangeProposalGroupRepository } from './change-proposal-groups.js';
import { createQuarantinedImageRepository } from './change-proposal-images.js';
import { createChangeProposalOwnerNotifier, createChangeProposalPeopleReader } from './change-proposal-people.js';
import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { createChangeProposalEventRepository, createChangeProposalRepository, createChangeProposalTargetLabelReader } from './change-proposals.js';
import { closeDb, createDb, type Db } from './client.js';
import { createKeyDownloadFileRepository } from './key-download-files.js';
import { createProductRepository, createTenantSecretRepository } from './repositories.js';
import {
  changeProposalEvents,
  changeProposalGroups,
  changeProposals,
  courseLessons,
  courseModules,
  courses,
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
  tenantAdmins,
  tenants,
  user,
} from './schema.js';
import { createSalesLinkRepository } from './sales-links.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-change-proposal-approve';
const NOW = '2026-03-01T10:00:00.000Z';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const KEY_ID = 'key-propose';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;

const identity = (userId: string): Identity => ({
  userId, email: `${userId}@example.test`, name: userId, emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const key: ShopManagementKey = {
  id: KEY_ID, tenantId: TENANT, name: 'Catalogue agent', keyHash: 'hash-approve',
  scopes: ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'],
  mode: 'propose', issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z', revokedAt: null,
};

const keyCtx: Ctx = {
  identity: identity(ISSUER),
  capabilities: shopManagementKeyCapabilities(key),
  machineActor: { kind: 'shop_management_key', apiKeyId: KEY_ID, mode: 'propose' },
};

const ownerSession: Ctx = { identity: identity(OWNER) };

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 7).toString('base64'));

const storageDeletes: string[] = [];
const storage: StorageProvider = (() => {
  const refuse = () => { throw new Error('Only object deletes are expected'); };
  return {
    objectUrl: (configuration, objectKey) => new URL(`${configuration.endpoint}/${configuration.bucket}/${objectKey}`),
    delete: async (input) => {
      storageDeletes.push(input.url);
      return ok({ deleted: true });
    },
    list: refuse, getObject: refuse, putObject: refuse, probe: refuse, copyObject: refuse, digestObject: refuse, probeCors: refuse, presignPut: refuse,
    presignGet: refuse, head: refuse, healthcheck: refuse, test: refuse,
  };
})();

const deps = (db: Db = database.db, lockWait: { lockWaitMs?: number } = {}) => {
  const logger = { error: vi.fn<(message: string) => void>() };
  return {
    changeProposalTransaction: createChangeProposalTransaction(db, logger, (connection) =>
      createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto), lockWait),
    changeProposals: createChangeProposalRepository(db, lockWait),
    changeProposalGroups: createChangeProposalGroupRepository(db, lockWait),
    shopManagementKeys: createShopManagementKeyRepository(db),
    changeProposalTargetLabels: createChangeProposalTargetLabelReader(db),
    changeProposalPeople: createChangeProposalPeopleReader(db),
    changeProposalOwnerNotifier: createChangeProposalOwnerNotifier(db, lockWait),
    realtimeBus: { publish: () => undefined },
    quarantinedImages: createQuarantinedImageRepository(db, lockWait),
    keyDownloadFiles: createKeyDownloadFileRepository(db, lockWait),
    secretResolver: createTenantSecretResolver(createTenantSecretRepository(db), secretCrypto),
    contentHash: createContentHash(),
    storage,
    logger,
    ids: { nextId: () => `approve-${String(++sequence)}` },
    clock: { nowIso: () => NOW },
  };
};

const submit = async (operation: ChangeProposalOperation, input: unknown): Promise<string> => {
  const submitted = await submitChangeProposal(keyCtx, { operation, input }, deps());
  if (!submitted.ok) throw new Error(`${operation}: ${submitted.error.message}`);
  return submitted.value.id;
};

const approve = (id: string, db: Db = database.db) => approveChangeProposal(ownerSession, { id }, deps(db));

const statusOf = async (id: string) =>
  (await database.db.select({ status: changeProposals.status }).from(changeProposals).where(eq(changeProposals.id, id)))[0]?.status;

const eventsOf = async (id: string) =>
  (await createChangeProposalEventRepository(database.db).listByProposal(TENANT, id)).map(({ sequence: position, kind }) => `${String(position)}:${kind}`);

const productRow = async (id: string) =>
  (await database.db.select().from(products).where(and(eq(products.tenantId, TENANT), eq(products.id, id))))[0];

const onHand = async (productId: string) =>
  (await database.db.select({ onHand: productStock.onHand }).from(productStock)
    .where(and(eq(productStock.tenantId, TENANT), eq(productStock.productId, productId))))[0]?.onHand;

const productVersionAuthors = async (productId: string) =>
  (await database.db.select({ createdBy: entityVersions.createdBy }).from(entityVersions)
    .where(and(eq(entityVersions.tenantId, TENANT), eq(entityVersions.entityId, productId)))).map(({ createdBy }) => createdBy);

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

const insertProduct = async (id: string, values: { type?: 'physical' | 'digital_download'; published?: boolean; everPublished?: boolean } = {}) => {
  await database.db.insert(products).values({
    id, tenantId: TENANT, slug: id, title: `Title of ${id}`, type: values.type ?? 'physical', published: values.published ?? false,
    everPublished: values.everPublished ?? values.published ?? false, description: '', priceCents: 0, currency: 'EUR', createdAt: NOW,
  });
};

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposal_approve', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: TENANT, slug: 'acme', name: 'Acme', createdAt: NOW });
  await createTenantSecretRepository(database.db).upsert(TENANT, {
    id: 'storage-configuration', tenantId: TENANT, key: 's3.configuration', maskedPreview: 'configured', updatedAt: NOW,
    ...secretCrypto.encrypt(JSON.stringify({
      provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'downloads', accessKeyId: 'a', secretAccessKey: 's',
    })),
  });
  await database.db.insert(courses).values([
    { id: 'course-intro', tenantId: TENANT, name: 'Intro course', description: '', createdAt: NOW },
    { id: 'course-advanced', tenantId: TENANT, name: 'Advanced course', description: '', createdAt: NOW },
  ]);
  await database.db.insert(courseModules).values({
    id: 'module-basics', tenantId: TENANT, courseIds: ['course-intro'], title: 'Basics', createdAt: NOW,
    chapters: [{ id: 'chapter-basics', name: 'Basics', contents: [{ id: 'content-welcome', lessonId: 'lesson-welcome', name: 'Welcome' }] }],
  });
  await database.db.insert(courseLessons).values({ id: 'lesson-welcome', tenantId: TENANT, name: 'Welcome', createdAt: NOW });
});

afterAll(async () => { await database?.close(); });

beforeEach(async () => {
  storageDeletes.length = 0;
  for (const table of [changeProposalEvents, changeProposals, changeProposalGroups, shopManagementKeyEvents, shopManagementKeys, stockEvents, productStock,
    productDownloadAssets, productPrices, salesLinkEvents, salesLinks, entityVersions, products]) {
    await database.db.delete(table);
  }
  await database.db.update(tenants).set({ name: 'Acme', invoiceVatMode: 'rate', invoiceVatRatePercent: 23 }).where(eq(tenants.id, TENANT));
  await createShopManagementKeyRepository(database.db).create(TENANT, key, {
    id: `key-event-${String(++sequence)}`, tenantId: TENANT, apiKeyId: KEY_ID, kind: 'created', actorUserId: ISSUER,
    method: null, route: null, resourceId: null, at: key.createdAt,
  });
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
  const saved = await createSalesLinkRepository(database.db).save(TENANT, {
    id: 'link-spring', tenantId: TENANT, slug: 'spring', title: 'Spring', heading: 'Spring sale', description: '', productIds: ['live'],
    active: false, listed: false, validFrom: null, validTo: null, cancelReturnUrl: null, revision: 1, createdAt: NOW, updatedAt: NOW,
  }, null);
  if (!saved.ok) throw new Error(saved.error.message);
});

describe('approving a change proposal over the database', () => {
  it('applies once under two concurrent approvals on two connections, as the approving owner', async () => {
    const id = await submit('product.update', { id: 'mug', title: 'Big mug' });
    const first = createDb('node-postgres', database.url, { max: 1 });
    const second = createDb('node-postgres', database.url, { max: 1 });
    try {
      const results = await Promise.all([approve(id, first), approve(id, second)]);

      expect(results.filter((result) => result.ok)).toEqual([expect.objectContaining({ value: expect.objectContaining({ status: 'applied', decidedByUserId: OWNER }) })]);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, error: expect.objectContaining({ code: 'conflict', details: { changeProposalStatus: 'applied' } }) },
      ]);
    } finally {
      await closeDb(first);
      await closeDb(second);
    }
    expect((await productRow('mug'))?.title).toBe('Big mug');
    expect(await productVersionAuthors('mug')).toEqual([OWNER]);
    expect(await eventsOf(id)).toEqual(['1:proposed', '2:applied']);
    const [row] = await database.db.select().from(changeProposals).where(eq(changeProposals.id, id));
    expect(row).toMatchObject({ status: 'applied', decidedByUserId: OWNER, decidedAt: NOW, appliedResourceId: 'mug', failureCode: null });
  }, 30_000);

  it('applies when another field of the product changed and is stale when the touched field changed', async () => {
    const applied = await submit('product.update', { id: 'mug', title: 'Big mug' });
    const stale = await submit('product.update', { id: 'live', title: 'Big live mug' });
    await database.db.update(products).set({ description: 'Edited meanwhile' }).where(eq(products.id, 'mug'));
    await database.db.update(products).set({ title: 'Owner title' }).where(eq(products.id, 'live'));

    expect(await approve(applied)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(await approve(stale)).toMatchObject({ ok: true, value: { status: 'stale', appliedResourceId: null } });

    expect(await productRow('mug')).toMatchObject({ title: 'Big mug', description: 'Edited meanwhile' });
    expect((await productRow('live'))?.title).toBe('Owner title');
    expect(await productVersionAuthors('live')).toEqual([]);
    expect(await eventsOf(stale)).toEqual(['1:proposed', '2:stale']);
  });

  it('applies a stock delta on the moved balance and is stale once tracking is gone', async () => {
    const id = await submit('stock.adjust', { productId: 'live', delta: 50, reason: 'Delivery' });
    await database.db.update(productStock).set({ onHand: 9 }).where(eq(productStock.productId, 'live'));

    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'live' } });
    expect(await onHand('live')).toBe(59);
    expect(await database.db.select({ quantity: stockEvents.quantity, actorUserId: stockEvents.actorUserId }).from(stockEvents)
      .where(eq(stockEvents.productId, 'live'))).toEqual([{ quantity: 50, actorUserId: OWNER }]);

    const untracked = await submit('stock.adjust', { productId: 'live', delta: 1, reason: 'Count' });
    await database.db.delete(stockEvents);
    await database.db.delete(productStock);
    expect(await approve(untracked)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(await database.db.select().from(productStock)).toEqual([]);
  });

  it('records the live error and changes nothing when publishing lost its active price', async () => {
    const id = await submit('product.publish', { id: 'mug' });
    await database.db.update(productPrices).set({ active: false }).where(eq(productPrices.id, 'price-mug'));

    expect(await approve(id)).toMatchObject({
      ok: true,
      value: { status: 'failed', failureCode: 'validation', failureMessage: 'Physical products require an active one-time price' },
    });
    expect((await productRow('mug'))?.published).toBe(false);
    expect(await eventsOf(id)).toEqual(['1:proposed', '2:apply_failed']);
  });

  it('keeps the proposal pending and rolls the live write back on an infrastructure failure', async () => {
    const id = await submit('product.delete-draft', { productId: 'draft' });
    const real = deps();
    const failing: ChangeProposalTransaction = {
      ...real.changeProposalTransaction,
      run: (tenantId, operation) => real.changeProposalTransaction.run(tenantId, (scope) => operation({
        ...scope,
        repositories: {
          ...scope.repositories,
          changeProposals: { ...scope.repositories.changeProposals, transition: () => Promise.reject(new Error('connection lost')) },
        },
      })),
    };

    await expect(approveChangeProposal(ownerSession, { id }, { ...real, changeProposalTransaction: failing })).rejects.toThrow('connection lost');

    expect(await statusOf(id)).toBe('pending');
    expect(await eventsOf(id)).toEqual(['1:proposed']);
    expect(await productRow('draft')).toBeDefined();
    expect(storageDeletes).toEqual([]);
  });

  it.each([
    appError('unavailable', 'The database is busy'),
    appError('internal', 'Lost the connection'),
  ])('rolls a written live change back and keeps the proposal pending when the live use-case answers $code', async (error) => {
    const id = await submit('sales-link.update', { id: 'link-spring', expectedRevision: 1, slug: 'spring', title: 'Spring', heading: 'Spring sale, extended', productIds: ['live'] });
    const real = deps();
    const savingThenFailing = (scope: ChangeProposalTransactionScope): ChangeProposalTransactionScope => ({
      ...scope,
      repositories: {
        ...scope.repositories,
        salesLinks: {
          ...scope.repositories.salesLinks,
          save: async (tenantId, link, expectedRevision) => {
            const saved = await scope.repositories.salesLinks.save(tenantId, link, expectedRevision);
            return saved.ok ? err(error) : saved;
          },
        },
      },
      savepoint: (operation) => scope.savepoint((nested) => operation(savingThenFailing(nested))),
    });
    const failing: ChangeProposalTransaction = {
      ...real.changeProposalTransaction,
      run: (tenantId, operation) => real.changeProposalTransaction.run(tenantId, (scope) => operation(savingThenFailing(scope))),
    };

    expect(await approveChangeProposal(ownerSession, { id }, { ...real, changeProposalTransaction: failing })).toEqual({ ok: false, error });

    expect(await statusOf(id)).toBe('pending');
    expect(await eventsOf(id)).toEqual(['1:proposed']);
    expect(await createSalesLinkRepository(database.db).findById(TENANT, 'link-spring')).toMatchObject({ heading: 'Spring sale', revision: 1 });
    const [row] = await database.db.select().from(changeProposals).where(eq(changeProposals.id, id));
    expect(row).toMatchObject({ decidedAt: null, decidedByUserId: null, failureCode: null, failureMessage: null });
    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'applied' } });
  });

  it('deletes stored files after an applied draft deletion and never after a stale or failed one', async () => {
    const stale = await submit('product.delete-draft', { productId: 'draft' });
    await database.db.update(products).set({ title: 'Renamed draft' }).where(eq(products.id, 'draft'));
    expect(await approve(stale)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(storageDeletes).toEqual([]);

    const failed = await submit('product.delete-draft', { productId: 'draft' });
    const linked = await createSalesLinkRepository(database.db).save(TENANT, {
      id: 'link-draft', tenantId: TENANT, slug: 'draft-offer', title: 'Draft offer', heading: 'Draft offer', description: '', productIds: ['draft'],
      active: false, listed: false, validFrom: null, validTo: null, cancelReturnUrl: null, revision: 1, createdAt: NOW, updatedAt: NOW,
    }, null);
    expect(linked.ok).toBe(true);
    expect(await approve(failed)).toMatchObject({ ok: true, value: { status: 'failed', failureCode: 'validation' } });
    expect(storageDeletes).toEqual([]);

    await database.db.delete(salesLinkEvents).where(eq(salesLinkEvents.salesLinkId, 'link-draft'));
    await database.db.delete(salesLinks).where(eq(salesLinks.id, 'link-draft'));
    const applied = await submit('product.delete-draft', { productId: 'draft' });
    expect(await approve(applied)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'draft' } });
    expect(storageDeletes).toEqual(['https://storage.example.test/downloads/downloads/guide.pdf']);
    expect(await productRow('draft')).toBeUndefined();
  });

  it('applies a sales link update and is stale for an update or a deletion after the revision moved', async () => {
    const update = { id: 'link-spring', expectedRevision: 1, slug: 'spring', title: 'Spring', heading: 'Spring sale, extended', productIds: ['live'] };
    const applied = await submit('sales-link.update', update);
    expect(await approve(applied)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'link-spring' } });
    expect(await createSalesLinkRepository(database.db).findById(TENANT, 'link-spring')).toMatchObject({ heading: 'Spring sale, extended', revision: 2 });

    const staleUpdate = await submit('sales-link.update', { ...update, expectedRevision: 2, heading: 'Third heading' });
    const staleDelete = await submit('sales-link.delete', { id: 'link-spring' });
    const current = await createSalesLinkRepository(database.db).findById(TENANT, 'link-spring');
    if (current === null) throw new Error('The sales link disappeared');
    expect(await createSalesLinkRepository(database.db).save(TENANT, { ...current, title: 'Renamed live', revision: 3 }, 2)).toMatchObject({ ok: true });

    expect(await approve(staleUpdate)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(await approve(staleDelete)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(await createSalesLinkRepository(database.db).findById(TENANT, 'link-spring')).toMatchObject({ title: 'Renamed live', revision: 3 });
  });

  it('applies a sales link deletion and records it in the link history', async () => {
    const id = await submit('sales-link.delete', { id: 'link-spring' });
    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'link-spring' } });
    expect(await createSalesLinkRepository(database.db).findById(TENANT, 'link-spring')).toBeNull();
    expect((await database.db.select({ type: salesLinkEvents.type }).from(salesLinkEvents).orderBy(asc(salesLinkEvents.revision))).map(({ type }) => type))
      .toEqual(['created', 'deleted']);
  });

  it('applies a settings update and is stale once a field it changes moved', async () => {
    const applied = await submit('settings.update', { name: 'Acme shop' });
    const stale = await submit('settings.update', { invoiceVatMode: 'exempt', invoiceExemptionBasisKind: 'art_113_1', invoiceExemptionBasis: 'Article 113(1) of the VAT Act' });

    expect(await approve(applied)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: null } });
    await database.db.update(tenants).set({ invoiceVatRatePercent: 8 }).where(eq(tenants.id, TENANT));
    expect(await approve(stale)).toMatchObject({ ok: true, value: { status: 'stale' } });

    expect((await database.db.select({ name: tenants.name, vatMode: tenants.invoiceVatMode, vatRate: tenants.invoiceVatRatePercent }).from(tenants)
      .where(eq(tenants.id, TENANT)))).toEqual([{ name: 'Acme shop', vatMode: 'rate', vatRate: 8 }]);
  });
});

describe('approving what a product grants over the database', () => {
  const accessOf = async (id: string) => (await productRow(id))?.accessItems;

  it('applies the stored list as the approving owner after locking the courses, and is stale once the list moved', async () => {
    const lessonItem = [{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-welcome'] }];
    await insertProduct('workbook', { type: 'digital_download' });
    const id = await submit('product.set-access', { id: 'draft', accessItems: lessonItem });
    const moved = await submit('product.set-access', { id: 'workbook', accessItems: [{ level: 'course', courseId: 'course-advanced' }] });
    expect(await accessOf('draft')).toEqual([]);
    await database.db.update(products).set({ accessItems: [{ level: 'course', courseId: 'course-intro' }] }).where(eq(products.id, 'workbook'));

    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'draft' } });
    expect(await accessOf('draft')).toEqual(lessonItem);
    expect(await productVersionAuthors('draft')).toEqual([OWNER]);
    expect(await approve(moved)).toMatchObject({ ok: true, value: { status: 'stale', appliedResourceId: null } });
    expect(await accessOf('workbook')).toEqual([{ level: 'course', courseId: 'course-intro' }]);
  });

  it('fails with the validation error and applies nothing once a course of the list is archived after the proposal', async () => {
    const id = await submit('product.set-access', { id: 'draft', accessItems: [{ level: 'course', courseId: 'course-advanced' }] });
    await database.db.update(courses).set({ archivedAt: NOW }).where(eq(courses.id, 'course-advanced'));
    try {
      expect((await createChangeProposalTargetLabelReader(database.db).accessTitles(TENANT, { courseIds: ['course-advanced', 'course-intro'], moduleIds: [], lessonIds: [] }))
        .courses.map((course) => [course.id, course.archived]).toSorted()).toEqual([['course-advanced', true], ['course-intro', false]]);
      expect(await approve(id)).toMatchObject({
        ok: true, value: { status: 'failed', failureCode: 'validation', failureMessage: 'Product access items may only reference existing, active courses' },
      });
    } finally {
      await database.db.update(courses).set({ archivedAt: null }).where(eq(courses.id, 'course-advanced'));
    }
    expect(await accessOf('draft')).toEqual([]);
    expect(await eventsOf(id)).toEqual(['1:proposed', '2:apply_failed']);
  });

  it('answers busy from the live access write that the database picks as a deadlock victim, and writes nothing', async () => {
    const other = await connectedClient();
    const observer = await connectedClient();
    try {
      await other.query('begin');
      await other.query('select id from products where tenant_id = $1 and id = $2 for update', [TENANT, 'draft']);
      const write = createProductRepository(database.db).updateAccessItems(TENANT, 'draft', [{ level: 'course', courseId: 'course-intro' }]);
      await untilLockWaiters(observer, 1);
      const crossing = other.query('select id from courses where tenant_id = $1 and id = $2 for update', [TENANT, 'course-intro']);
      expect(await write).toBe('busy');
      await crossing;
      await other.query('rollback');
    } finally {
      await other.end();
      await observer.end();
    }
    expect(await accessOf('draft')).toEqual([]);
  }, 30_000);

  it('refuses at submission a lesson that sits in no module of the named course and stores nothing', async () => {
    const result = await submitChangeProposal(keyCtx, {
      operation: 'product.set-access', input: { id: 'draft', accessItems: [{ level: 'lessons', courseId: 'course-advanced', lessonIds: ['lesson-welcome'] }] },
    }, deps());
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: 'Product access lessonIds must belong to the item courseId through its modules and chapters' } });
    expect(await database.db.select().from(changeProposals)).toEqual([]);
  });
});

describe('approval races with the other terminal transitions', () => {
  type Competitor = readonly [string, (proposalId: string) => Promise<unknown>, string];

  const revocation = (at = NOW) => createShopManagementKeyRepository(database.db).revoke(TENANT, KEY_ID, at, {
    id: `key-event-${String(++sequence)}`, tenantId: TENANT, apiKeyId: KEY_ID, kind: 'revoked', actorUserId: OWNER,
    method: null, route: null, resourceId: null, at,
  } satisfies ShopManagementKeyEvent, { at, actorUserId: OWNER, nextEventId: () => `withdrawal-${String(++sequence)}` });

  const competitors: readonly Competitor[] = [
    ['a rejection', (proposalId) => rejectChangeProposal(ownerSession, { id: proposalId }, deps()), 'rejected'],
    ['a withdrawal', (proposalId) => withdrawOwnChangeProposal(keyCtx, { id: proposalId }, deps()), 'withdrawn'],
    ['a key revocation', () => revocation(), 'withdrawn'],
  ];

  it.each(competitors)('ends in the approval when %s queues behind it', async (_label, compete) => {
    const id = await submit('product.update', { id: 'mug', title: 'Big mug' });
    const blocker = await connectedClient();
    const observer = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query('select id from products where tenant_id = $1 and id = $2 for update', [TENANT, 'mug']);
      const approval = approve(id);
      await untilLockWaiters(observer, 1);
      const competing = compete(id);
      await untilLockWaiters(observer, 2);
      await blocker.query('commit');

      expect(await approval).toMatchObject({ ok: true, value: { status: 'applied' } });
      await competing;
    } finally {
      await blocker.end();
      await observer.end();
    }
    expect(await statusOf(id)).toBe('applied');
    expect(await eventsOf(id)).toEqual(['1:proposed', '2:applied']);
    expect((await productRow('mug'))?.title).toBe('Big mug');
  }, 30_000);

  it.each(competitors)('ends in %s when the approval queues behind it', async (_label, compete, status) => {
    const id = await submit('product.update', { id: 'mug', title: 'Big mug' });
    const blocker = await connectedClient();
    const observer = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query('select id from change_proposals where tenant_id = $1 and id = $2 for update', [TENANT, id]);
      const competing = compete(id);
      await untilLockWaiters(observer, 1);
      const approval = approve(id);
      await untilLockWaiters(observer, 2);
      await blocker.query('commit');

      await competing;
      expect(await approval).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: status } } });
    } finally {
      await blocker.end();
      await observer.end();
    }
    expect(await statusOf(id)).toBe(status);
    expect(await eventsOf(id)).toEqual(['1:proposed', `2:${status === 'rejected' ? 'rejected' : 'withdrawn'}`]);
    expect((await productRow('mug'))?.title).toBe('Title of mug');
    expect(await productVersionAuthors('mug')).toEqual([]);
  }, 30_000);
});

describe('single decisions whose proposal expires during the lock wait', () => {
  const expiry = changeProposalExpiresAt(NOW);
  const decisions = [
    ['reject', (id: string, clock: { nowIso: () => string }) => rejectChangeProposal(ownerSession, { id, note: 'Too late' }, { ...deps(), clock }), OWNER, null],
    ['withdraw', (id: string, clock: { nowIso: () => string }) => withdrawOwnChangeProposal(keyCtx, { id }, { ...deps(), clock }), null, KEY_ID],
  ] as const;

  it.each(decisions)('records the expiry instead of the %s', async (_label, decide, actorUserId, apiKeyId) => {
    const id = await submit('product.update', { id: 'mug', title: 'Big mug' });
    let current = NOW;
    const blocker = await connectedClient();
    const observer = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query('select id from change_proposals where tenant_id = $1 and id = $2 for update', [TENANT, id]);
      const decision = decide(id, { nowIso: () => current });
      await untilLockWaiters(observer, 1);
      current = expiry;
      await blocker.query('commit');

      expect(await decision).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'expired' } } });
    } finally {
      await blocker.end();
      await observer.end();
    }
    const [row] = await database.db.select().from(changeProposals).where(eq(changeProposals.id, id));
    expect(row).toMatchObject({ status: 'pending', decidedAt: null, decidedByUserId: null, decisionNote: null });
    const events = await createChangeProposalEventRepository(database.db).listByProposal(TENANT, id);
    expect(events.map(({ kind, at, actorUserId: actor, apiKeyId: keyId }) => ({ kind, at, actor, keyId }))).toEqual([
      { kind: 'proposed', at: NOW, actor: null, keyId: KEY_ID },
      { kind: 'expired', at: expiry, actor: actorUserId, keyId: apiKeyId },
    ]);
  }, 30_000);

  it.each(decisions)('stamps the %s with the time read after the lock', async (_label, decide) => {
    const id = await submit('product.update', { id: 'mug', title: 'Big mug' });
    const later = '2026-03-01T10:00:07.000Z';
    let current = NOW;
    const blocker = await connectedClient();
    const observer = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query('select id from change_proposals where tenant_id = $1 and id = $2 for update', [TENANT, id]);
      const decision = decide(id, { nowIso: () => current });
      await untilLockWaiters(observer, 1);
      current = later;
      await blocker.query('commit');

      expect(await decision).toMatchObject({ ok: true });
    } finally {
      await blocker.end();
      await observer.end();
    }
    const [row] = await database.db.select().from(changeProposals).where(eq(changeProposals.id, id));
    expect(row?.decidedAt).toBe(later);
  }, 30_000);
});

describe('approving a draft deletion compares everything the deletion destroys', () => {
  it('is stale and deletes nothing when a download was added after the proposal', async () => {
    const id = await submit('product.delete-draft', { productId: 'draft' });
    await database.db.insert(productDownloadAssets).values({
      id: 'asset-late', tenantId: TENANT, productId: 'draft', lineageId: 'lineage-late', fileName: 'late.pdf', contentType: 'application/pdf',
      sizeBytes: 20, storageKey: 'downloads/late.pdf', status: 'ready', createdAt: NOW,
    });

    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'stale', appliedResourceId: null } });

    expect(await productRow('draft')).toBeDefined();
    expect((await database.db.select({ id: productDownloadAssets.id }).from(productDownloadAssets)).map(({ id: assetId }) => assetId).sort())
      .toEqual(['asset-1', 'asset-late']);
    expect(storageDeletes).toEqual([]);
    expect(await eventsOf(id)).toEqual(['1:proposed', '2:stale']);
  });

  it('is stale and deletes nothing when the stock moved after the proposal', async () => {
    await database.db.insert(productStock).values({ tenantId: TENANT, productId: 'draft', onHand: 4, reserved: 0, lowStockThreshold: null, updatedAt: NOW });
    const id = await submit('product.delete-draft', { productId: 'draft' });
    await database.db.update(productStock).set({ onHand: 5 }).where(eq(productStock.productId, 'draft'));

    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'stale' } });

    expect(await productRow('draft')).toBeDefined();
    expect(await onHand('draft')).toBe(5);
    expect(storageDeletes).toEqual([]);
  });

  it('shows the owner the downloads, every price and the stock it destroys', async () => {
    await database.db.insert(productPrices).values({
      id: 'price-draft-old', tenantId: TENANT, productId: 'draft', kind: 'one_time', amountCents: 500, currency: 'EUR', active: false, createdAt: NOW,
    });
    const id = await submit('product.delete-draft', { productId: 'draft' });
    const [row] = await database.db.select({ effect: changeProposals.effect }).from(changeProposals).where(eq(changeProposals.id, id));

    expect(row?.effect).toMatchObject({
      exists: { before: true, after: false },
      downloads: { before: [{ id: 'asset-1', fileName: 'guide.pdf', sizeBytes: 10, status: 'ready', versionNumber: 1 }], after: null },
      prices: { before: [{ id: 'price-draft-old', active: false, amountCents: 500 }], after: null },
      stock: { before: { tracked: false, onHand: null, reserved: null, lowStockThreshold: null }, after: null },
    });
  });
});

describe('approving a draft deletion beside live writers of the draft', () => {
  const draftStockEvents = async () =>
    (await database.db.select({ quantity: stockEvents.quantity }).from(stockEvents)
      .where(and(eq(stockEvents.tenantId, TENANT), eq(stockEvents.productId, 'draft')))).map(({ quantity }) => quantity);

  it('ends stale without a deadlock when a live stock adjustment holds the stock row and has not written its event yet', async () => {
    await database.db.insert(productStock).values({ tenantId: TENANT, productId: 'draft', onHand: 4, reserved: 0, lowStockThreshold: null, updatedAt: NOW });
    const id = await submit('product.delete-draft', { productId: 'draft' });
    const live = await connectedClient();
    const observer = await connectedClient();
    try {
      await live.query('begin');
      await live.query('select on_hand from product_stock where tenant_id = $1 and product_id = $2 for update', [TENANT, 'draft']);
      await live.query('update product_stock set on_hand = on_hand + 1 where tenant_id = $1 and product_id = $2', [TENANT, 'draft']);
      const approval = approve(id);
      await untilLockWaiters(observer, 1);

      await live.query(
        "insert into stock_events (tenant_id, product_id, type, quantity, reference, occurred_at) values ($1, $2, 'adjusted', 1, '{}'::jsonb, $3)",
        [TENANT, 'draft', NOW],
      );
      await live.query('commit');

      expect(await approval).toMatchObject({ ok: true, value: { status: 'stale' } });
    } finally {
      await live.end();
      await observer.end();
    }
    expect(await eventsOf(id)).toEqual(['1:proposed', '2:stale']);
    expect(await productRow('draft')).toBeDefined();
    expect(await onHand('draft')).toBe(5);
    expect(await draftStockEvents()).toEqual([1]);
    expect(storageDeletes).toEqual([]);
  }, 30_000);

  it('ends without a deadlock when a live draft deletion holds the product row and has not deleted the stock yet', async () => {
    await database.db.insert(productStock).values({ tenantId: TENANT, productId: 'draft', onHand: 4, reserved: 0, lowStockThreshold: null, updatedAt: NOW });
    const id = await submit('product.delete-draft', { productId: 'draft' });
    const live = await connectedClient();
    const observer = await connectedClient();
    try {
      await live.query('begin');
      await live.query('select id from products where tenant_id = $1 and id = $2 for update', [TENANT, 'draft']);
      const approval = approve(id);
      await untilLockWaiters(observer, 1);

      await live.query('delete from product_download_assets where tenant_id = $1 and product_id = $2', [TENANT, 'draft']);
      await live.query('delete from products where tenant_id = $1 and id = $2', [TENANT, 'draft']);
      await live.query('commit');

      expect(await approval).toMatchObject({ ok: true, value: { status: 'stale' } });
    } finally {
      await live.end();
      await observer.end();
    }
    expect(await eventsOf(id)).toEqual(['1:proposed', '2:stale']);
    expect(await productRow('draft')).toBeUndefined();
    expect(storageDeletes).toEqual([]);
  }, 30_000);
});

describe('approval against key revocation and purge', () => {
  const revocation = () => createShopManagementKeyRepository(database.db).revoke(TENANT, KEY_ID, NOW, {
    id: `key-event-${String(++sequence)}`, tenantId: TENANT, apiKeyId: KEY_ID, kind: 'revoked', actorUserId: OWNER,
    method: null, route: null, resourceId: null, at: NOW,
  }, { at: NOW, actorUserId: OWNER, nextEventId: () => `withdrawal-${String(++sequence)}` });

  const purge = () => createShopManagementKeyRepository(database.db).purge(TENANT, (apiKeyId) => ({
    id: `key-event-${String(++sequence)}`, tenantId: TENANT, apiKeyId, kind: 'purged', actorUserId: OWNER,
    method: null, route: null, resourceId: null, at: NOW,
  }), { at: NOW, actorUserId: OWNER, nextEventId: () => `withdrawal-${String(++sequence)}` });

  const keyChanges = [['a key revocation', revocation], ['a key purge', purge]] as const;

  const tenantName = async () => (await database.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, TENANT)))[0]?.name;

  it.each(keyChanges)('applies the settings change when %s queues behind the approval, without a deadlock', async (_label, keyChange) => {
    const id = await submit('settings.update', { name: 'Acme shop' });
    const blocker = await connectedClient();
    const observer = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query('select id from tenants where id = $1 for no key update', [TENANT]);
      const approval = approve(id);
      await untilLockWaiters(observer, 1);
      const competing = keyChange();
      await untilLockWaiters(observer, 2);
      await blocker.query('commit');

      expect(await approval).toMatchObject({ ok: true, value: { status: 'applied' } });
      await expect(competing).resolves.toBeTruthy();
    } finally {
      await blocker.end();
      await observer.end();
    }
    expect(await statusOf(id)).toBe('applied');
    expect(await eventsOf(id)).toEqual(['1:proposed', '2:applied']);
    expect(await tenantName()).toBe('Acme shop');
  }, 30_000);

  it.each(keyChanges)('withdraws the settings change when the approval queues behind %s, without a deadlock', async (_label, keyChange) => {
    const id = await submit('settings.update', { name: 'Acme shop' });
    const blocker = await connectedClient();
    const observer = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query('select id from change_proposals where tenant_id = $1 and id = $2 for update', [TENANT, id]);
      const competing = keyChange();
      await untilLockWaiters(observer, 1);
      const approval = approve(id);
      await untilLockWaiters(observer, 2);
      await blocker.query('commit');

      await expect(competing).resolves.toBeTruthy();
      expect(await approval).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'withdrawn' } } });
    } finally {
      await blocker.end();
      await observer.end();
    }
    expect(await statusOf(id)).toBe('withdrawn');
    expect(await tenantName()).toBe('Acme');
  }, 30_000);
});

describe('lock waits inside a change proposal transaction', () => {
  const holding = async <T>(statement: string, values: unknown[], work: () => Promise<T>): Promise<T> => {
    const blocker = await connectedClient();
    try {
      await blocker.query('begin');
      await blocker.query(statement, values);
      return await work();
    } finally {
      await blocker.query('rollback');
      await blocker.end();
    }
  };

  const busy = { ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: 5 } } };
  const brief = { lockWaitMs: 300 };
  const approveBriefly = (id: string) => approveChangeProposal(ownerSession, { id }, deps(database.db, brief));

  it('answers busy within the bound when the target row stays locked, and leaves the proposal pending', async () => {
    const id = await submit('product.update', { id: 'mug', title: 'Big mug' });
    const started = Date.now();

    const result = await holding('select id from products where tenant_id = $1 and id = $2 for update', [TENANT, 'mug'], () => approveBriefly(id));

    expect(result).toMatchObject(busy);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await statusOf(id)).toBe('pending');
    expect(await eventsOf(id)).toEqual(['1:proposed']);
    expect((await productRow('mug'))?.title).toBe('Title of mug');
    expect(await productVersionAuthors('mug')).toEqual([]);
  }, 30_000);

  it('answers busy for a dry run whose target row stays locked and stores nothing', async () => {
    const result = await holding('select id from products where tenant_id = $1 and id = $2 for update', [TENANT, 'mug'], () =>
      submitChangeProposal(keyCtx, { operation: 'product.update', input: { id: 'mug', title: 'Big mug' } }, deps(database.db, brief)));

    expect(result).toMatchObject(busy);
    expect(await database.db.select().from(changeProposals)).toEqual([]);
  }, 30_000);

  it('answers busy for a deadlock inside the transaction, applies nothing and leaves the proposal pending', async () => {
    const id = await submit('product.delete-draft', { productId: 'draft' });
    const real = deps();
    const deadlocked: ChangeProposalTransaction = {
      ...real.changeProposalTransaction,
      run: (tenantId, operation) => real.changeProposalTransaction.run(tenantId, (scope) => operation({
        ...scope,
        repositories: {
          ...scope.repositories,
          changeProposals: {
            ...scope.repositories.changeProposals,
            transition: () => Promise.reject(Object.assign(new Error('deadlock detected'), { code: '40P01' })),
          },
        },
      })),
    };

    expect(await approveChangeProposal(ownerSession, { id }, { ...real, changeProposalTransaction: deadlocked })).toMatchObject(busy);

    expect(await statusOf(id)).toBe('pending');
    expect(await eventsOf(id)).toEqual(['1:proposed']);
    expect(await productRow('draft')).toBeDefined();
    expect(storageDeletes).toEqual([]);
  });

  it('answers busy instead of failing when the sales links of the workspace stay locked', async () => {
    const id = await submit('sales-link.update', { id: 'link-spring', expectedRevision: 1, slug: 'spring', title: 'Spring', heading: 'Spring sale, extended', productIds: ['live'] });

    const result = await holding('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`sales-links:${TENANT}`], () => approveBriefly(id));

    expect(result).toMatchObject(busy);
    expect(await statusOf(id)).toBe('pending');
    expect(await createSalesLinkRepository(database.db).findById(TENANT, 'link-spring')).toMatchObject({ heading: 'Spring sale', revision: 1 });
  }, 30_000);
});

describe('a proposal whose operation this release does not know', () => {
  const plantLaterProposal = async (): Promise<string> => {
    await database.db.insert(changeProposals).values({
      id: 'proposal-later', tenantId: TENANT, groupId: null, groupPosition: null, operation: 'image.attach-cover',
      input: { productId: 'mug', imageId: 'image-1' }, effect: { coverUrl: { before: null, after: 'https://cdn.example.test/cover.png' } },
      targetKind: 'product', targetId: 'mug', status: 'pending', proposedByKeyId: KEY_ID, proposedByKeyName: 'Catalogue agent',
      proposedByIssuerUserId: ISSUER, createdAt: NOW, expiresAt: '2026-03-31T10:00:00.000Z', decidedByUserId: null, decidedAt: null,
    });
    return 'proposal-later';
  };

  const readDeps = () => ({
    ...deps(),
    changeProposalEvents: createChangeProposalEventRepository(database.db),
    changeProposalGroups: createChangeProposalGroupRepository(database.db),
  });

  it('stays readable for the owner and the key', async () => {
    const id = await plantLaterProposal();

    expect(await listChangeProposals(ownerSession, {}, readDeps())).toMatchObject({ ok: true, value: { proposals: [{ id, operation: 'image.attach-cover', status: 'pending' }] } });
    expect(await getChangeProposal(ownerSession, { id }, readDeps())).toMatchObject({ ok: true, value: { id, operation: 'image.attach-cover' } });
    expect(await listOwnChangeProposals(keyCtx, {}, deps())).toMatchObject({ ok: true, value: { proposals: [{ id, operation: 'image.attach-cover' }] } });
    expect(await getOwnChangeProposal(keyCtx, { id }, deps())).toMatchObject({ ok: true, value: { id, operation: 'image.attach-cover' } });
  });

  it('cannot be approved: the approval marks it stale, says why and applies nothing', async () => {
    const id = await plantLaterProposal();

    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'stale', operation: 'image.attach-cover', appliedResourceId: null } });

    const [event] = (await createChangeProposalEventRepository(database.db).listByProposal(TENANT, id)).filter(({ kind }) => kind === 'stale');
    expect(event?.note).toBe('This release does not know the operation "image.attach-cover", so the proposal cannot be applied; nothing was changed');
    expect((await productRow('mug'))?.coverUrl).toBeNull();
    expect(await productVersionAuthors('mug')).toEqual([]);
  });
});

describe('a proposal whose stored effect is empty', () => {
  const contentVersion = async () =>
    (await database.db.select({ contentVersion: tenants.contentVersion }).from(tenants).where(eq(tenants.id, TENANT)))[0]?.contentVersion;
  const storedEffect = async (id: string) =>
    (await database.db.select({ effect: changeProposals.effect }).from(changeProposals).where(eq(changeProposals.id, id)))[0]?.effect;

  it('rolls the product change back and is stale when the field moved live', async () => {
    const id = await submit('product.update', { id: 'mug', title: 'Title of mug' });
    expect(await storedEffect(id)).toEqual({});
    await database.db.update(products).set({ title: 'Owner title' }).where(eq(products.id, 'mug'));
    const version = await contentVersion();

    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'stale' } });

    expect((await productRow('mug'))?.title).toBe('Owner title');
    expect(await productVersionAuthors('mug')).toEqual([]);
    expect(await contentVersion()).toBe(version);
  });

  it('rolls the settings change back and is stale when the field moved live', async () => {
    const id = await submit('settings.update', { name: 'Acme' });
    expect(await storedEffect(id)).toEqual({});
    await database.db.update(tenants).set({ name: 'Owner name' }).where(eq(tenants.id, TENANT));
    const version = await contentVersion();

    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'stale' } });

    expect((await database.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, TENANT)))[0]?.name).toBe('Owner name');
    expect(await contentVersion()).toBe(version);
  });

  it('rolls the sales link change back and is stale when a field moved live without a new revision', async () => {
    const id = await submit('sales-link.update', { id: 'link-spring', expectedRevision: 1, slug: 'spring', title: 'Spring', heading: 'Spring sale', productIds: ['live'] });
    expect(Object.keys((await storedEffect(id)) ?? {}).filter((field) => field !== 'revision')).toEqual([]);
    await database.db.update(salesLinks).set({ heading: 'Owner heading' }).where(eq(salesLinks.id, 'link-spring'));
    const events = (await database.db.select().from(salesLinkEvents)).length;

    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'stale' } });

    expect(await createSalesLinkRepository(database.db).findById(TENANT, 'link-spring')).toMatchObject({ heading: 'Owner heading', revision: 1 });
    expect((await database.db.select().from(salesLinkEvents)).length).toBe(events);
  });
});

describe('the owner view and summary over the database', () => {
  beforeAll(async () => {
    await database.db.insert(user).values([
      { id: ISSUER, email: 'issuer@example.test', name: 'Issuer', emailVerified: true },
      { id: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true },
    ]);
    await database.db.insert(tenantAdmins).values([
      { id: 'grant-issuer', tenantId: TENANT, userId: ISSUER, role: 'owner' },
      { id: 'grant-owner', tenantId: TENANT, userId: OWNER, role: 'owner' },
    ]);
  });

  const ownerList = async () => {
    const listed = await listChangeProposals(ownerSession, {}, deps());
    if (!listed.ok) throw new Error(listed.error.message);
    return Object.fromEntries(listed.value.proposals.map((card) => [card.id, card]));
  };

  it('labels each card from live state, names the deciding account and shows whether the issuer still owns the workspace', async () => {
    const product = await submit('product.update', { id: 'mug', title: 'Big mug' });
    const price = await submit('price.deactivate', { id: 'price-live' });
    const link = await submit('sales-link.update', { id: 'link-spring', expectedRevision: 1, slug: 'spring', title: 'Spring', heading: 'Spring sale, extended', productIds: ['live'] });
    const settings = await submit('settings.update', { name: 'Acme shop' });
    const created = await submit('product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 });
    const yearly = await submit('price.create', { productId: 'draft', kind: 'recurring', interval: 'year', amountCents: 9900, currency: 'EUR' });
    expect(await rejectChangeProposal(ownerSession, { id: settings, note: 'Not now' }, deps())).toMatchObject({ ok: true });
    expect(await approve(created)).toMatchObject({ ok: true, value: { status: 'applied', targetLabel: 'Teapot' } });
    expect(await approve(yearly)).toMatchObject({ ok: true, value: { status: 'applied' } });
    await database.db.update(products).set({ title: 'Mug, renamed live' }).where(eq(products.id, 'mug'));

    const cards = await ownerList();

    expect([product, price, link, settings, created, yearly].map((id) => cards[id]?.targetLabel))
      .toEqual(['Mug, renamed live', 'Title of live', 'Spring', null, 'Teapot', 'Title of draft']);
    expect([product, price, link, settings, created, yearly].map((id) => cards[id]?.targetPrice)).toEqual([
      null, { kind: 'one_time', interval: null, intervalCount: 1, amountCents: 1500, currency: 'EUR' }, null, null, null,
      { kind: 'recurring', interval: 'year', intervalCount: 1, amountCents: 9900, currency: 'EUR' },
    ]);
    expect(cards[product]?.proposedBy).toEqual({
      keyId: KEY_ID, keyName: 'Catalogue agent', keyState: 'active', issuerUserId: ISSUER, issuerEmail: 'issuer@example.test', issuerIsVerifiedOwner: true,
      issuerIsFormerTeamMember: false,
    });
    expect(cards[settings]).toMatchObject({
      status: 'rejected', decidedByUserId: OWNER, decidedByEmail: 'owner@example.test', decidedByIsFormerTeamMember: false, decisionNote: 'Not now', decidedAt: NOW,
    });
    expect(cards[product]).toMatchObject({ decidedByEmail: null, failureCode: null, failureMessage: null });

    await database.db.update(tenantAdmins).set({ role: 'admin' }).where(eq(tenantAdmins.id, 'grant-issuer'));
    try {
      expect((await ownerList())[product]?.proposedBy).toMatchObject({ issuerEmail: 'issuer@example.test', issuerIsVerifiedOwner: false, issuerIsFormerTeamMember: false });
      await database.db.delete(tenantAdmins).where(eq(tenantAdmins.id, 'grant-issuer'));
      expect((await ownerList())[product]?.proposedBy).toMatchObject({ issuerEmail: null, issuerIsVerifiedOwner: false, issuerIsFormerTeamMember: true });
      await database.db.insert(tenantAdmins).values({ id: 'grant-issuer', tenantId: TENANT, userId: ISSUER, role: 'owner' });
      await database.db.update(user).set({ emailVerified: false }).where(eq(user.id, ISSUER));
      expect((await ownerList())[product]?.proposedBy).toMatchObject({ issuerIsVerifiedOwner: false });
    } finally {
      await database.db.insert(tenantAdmins).values({ id: 'grant-issuer', tenantId: TENANT, userId: ISSUER, role: 'owner' })
        .onConflictDoUpdate({ target: tenantAdmins.id, set: { role: 'owner' } });
      await database.db.update(user).set({ emailVerified: true }).where(eq(user.id, ISSUER));
    }

    await createSalesLinkRepository(database.db).delete(TENANT, 'link-spring', NOW);
    expect((await ownerList())[link]?.targetLabel).toBeNull();
  });

  it('approves exactly what was shown, whatever the live label says', async () => {
    const id = await submit('product.update', { id: 'mug', description: 'Fresh' });
    await database.db.update(products).set({ title: 'Renamed for the label only' }).where(eq(products.id, 'mug'));
    expect(await approve(id)).toMatchObject({ ok: true, value: { status: 'applied', targetLabel: 'Renamed for the label only' } });
    expect(await productRow('mug')).toMatchObject({ title: 'Renamed for the label only', description: 'Fresh' });
  });

  it('counts the pending, unexpired proposals and their groups for the summary', async () => {
    const first = await submit('product.update', { id: 'mug', title: 'Big mug' });
    await submit('stock.adjust', { productId: 'live', delta: 1, reason: 'Count' });
    const rejected = await submit('product.update', { id: 'live', title: 'Rejected' });
    expect(await rejectChangeProposal(ownerSession, { id: rejected }, deps())).toMatchObject({ ok: true });
    await database.db.insert(changeProposalGroups).values({ id: 'group-summary', tenantId: TENANT, title: 'Summary group', proposedByKeyId: KEY_ID, createdAt: NOW });
    await database.db.update(changeProposals).set({ groupId: 'group-summary', groupPosition: 1 }).where(eq(changeProposals.id, first));
    const [template] = await database.db.select().from(changeProposals).where(eq(changeProposals.id, rejected));
    if (template === undefined) throw new Error('The rejected proposal is missing');
    await database.db.insert(changeProposals).values({
      ...template,
      id: 'expired-proposal', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-31T00:00:00.000Z',
      decidedAt: null, decidedByUserId: null, decisionNote: null,
    });

    expect(await getChangeProposalSummary(ownerSession, deps())).toEqual({ ok: true, value: { pending: 2, pendingGroups: 1, hasProposals: true } });
    expect(await getChangeProposalSummary(keyCtx, deps())).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
