import { readFileSync } from 'node:fs';
import pg from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { orderLineSchema } from '#core/domain/index.js';

import { createProductDraftRepository } from './product-drafts.js';
import { checkoutSnapshots, couponCheckoutSessions, coupons, members, orders, productDownloadAssets, productGrants, productPriceHistory, productPrices, products, salesLinks, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-10-11T12:00:00.000Z';
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const product = (id: string, tenantId = 'workspace') => ({ id, tenantId, slug: id, title: 'Draft product', description: '', priceCents: 100, currency: 'PLN', published: false, createdAt: now });
const line = (productId: string) => orderLineSchema.parse({ productId, name: 'Draft product', productType: 'physical', grossCents: 100, netCents: 100, vatCents: 0, vatRate: null, vatExemptionBasis: null, issuedCount: 0 });

beforeAll(async () => {
  database = await createTestDatabase('together_product_drafts', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now },
    { id: 'other', slug: 'other', name: 'Other workspace', createdAt: now },
  ]);
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.test', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.test', displayName: 'Buyer', createdAt: now });
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('product draft deletion persistence', () => {
  it('migrates existing publication states without inventing history and tracks new drafts', async () => {
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query('CREATE SCHEMA publication_migration');
      await client.query('SET search_path TO publication_migration');
      await client.query('CREATE TABLE products (id text PRIMARY KEY, published boolean NOT NULL)');
      await client.query("INSERT INTO products VALUES ('old-draft', false), ('published', true)");
      await client.query(readFileSync('drizzle/0141_product_publication_history.sql', 'utf8'));
      await client.query("INSERT INTO products (id, published) VALUES ('new-draft', false), ('new-published', true)");
      expect((await client.query('SELECT id, ever_published FROM products ORDER BY id')).rows).toEqual([
        { id: 'new-draft', ever_published: false },
        { id: 'new-published', ever_published: true },
        { id: 'old-draft', ever_published: null },
        { id: 'published', ever_published: true },
      ]);
    } finally {
      await client.end();
    }
  });

  it('deletes eligible draft data and permitted history while isolating tenants', async () => {
    const { db } = database;
    await db.insert(products).values([{ ...product('removable'), accessItems: [{ level: 'course', courseId: 'course' }] }, product('removable', 'other')]);
    await db.insert(productPrices).values({ id: 'draft-price', tenantId: 'workspace', productId: 'removable', kind: 'one_time', amountCents: 100, currency: 'PLN', createdAt: now });
    await db.insert(productDownloadAssets).values([1, 2].map((versionNumber) => ({ id: `asset-${String(versionNumber)}`, tenantId: 'workspace', productId: 'removable', lineageId: 'asset-1', versionNumber, fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: 100, storageKey: `files/${String(versionNumber)}`, status: 'ready' as const, createdAt: now })));
    await db.insert(coupons).values({ id: 'draft-coupon', tenantId: 'workspace', code: 'DRAFT', kind: 'percent', value: 10, scope: { kind: 'all' }, appliesTo: 'one_time', createdAt: now });
    await db.insert(couponCheckoutSessions).values({ id: 'draft-checkout', tenantId: 'workspace', couponId: 'draft-coupon', memberEmail: 'buyer@example.test', productId: 'removable', priceId: 'draft-price', originalCents: 100, discountCents: 10, finalCents: 90, currency: 'PLN', startedAt: now });
    const draftHistory = and(eq(productPriceHistory.tenantId, 'workspace'), eq(productPriceHistory.productId, 'removable'));
    const otherHistory = and(eq(productPriceHistory.tenantId, 'other'), eq(productPriceHistory.productId, 'removable'));
    expect(await db.select().from(productPriceHistory).where(draftHistory)).toHaveLength(2);
    const retainedHistory = await db.select().from(productPriceHistory).where(otherHistory);
    expect(retainedHistory).toHaveLength(1);
    const result = await createProductDraftRepository(db).deleteDraft('workspace', 'removable');
    expect(result).toMatchObject({ kind: 'deleted', assets: [{ id: 'asset-1' }, { id: 'asset-2' }] });
    expect(await db.select().from(products).where(eq(products.tenantId, 'workspace'))).toEqual([]);
    expect(await db.select().from(productPrices)).toEqual([]);
    expect(await db.select().from(productDownloadAssets)).toEqual([]);
    expect(await db.select().from(productPriceHistory).where(draftHistory)).toEqual([]);
    expect(await db.select().from(productPriceHistory).where(otherHistory)).toEqual(retainedHistory);
    expect(await db.select().from(couponCheckoutSessions).where(eq(couponCheckoutSessions.id, 'draft-checkout'))).toEqual([]);
    expect(await db.select().from(coupons).where(eq(coupons.id, 'draft-coupon'))).toHaveLength(1);
    expect(await db.select().from(products).where(eq(products.tenantId, 'other'))).toHaveLength(1);
    expect(await createProductDraftRepository(db).deleteDraft('workspace', 'removable')).toEqual({ kind: 'not_found' });
  });

  it('rolls back download removal when a later write fails', async () => {
    const { db } = database;
    await db.insert(products).values(product('rollback'));
    await db.insert(productDownloadAssets).values({ id: 'rollback-asset', tenantId: 'workspace', productId: 'rollback', lineageId: 'rollback-asset', fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: 100, storageKey: 'files/rollback', createdAt: now });
    await db.execute(sql`CREATE FUNCTION reject_draft_deletion() RETURNS trigger AS $$ BEGIN IF OLD.id = 'rollback' THEN RAISE EXCEPTION 'Test transaction failure'; END IF; RETURN OLD; END; $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER reject_draft_deletion BEFORE DELETE ON products FOR EACH ROW EXECUTE FUNCTION reject_draft_deletion()`);
    await expect(createProductDraftRepository(db).deleteDraft('workspace', 'rollback')).rejects.toThrow();
    expect(await db.select().from(productDownloadAssets).where(eq(productDownloadAssets.id, 'rollback-asset'))).toHaveLength(1);
    expect(await db.select().from(products).where(eq(products.id, 'rollback'))).toHaveLength(1);
  });

  it('retains publication history after publish, unpublish and attempted flag reset', async () => {
    const { db } = database;
    await db.insert(products).values(product('previously-published'));
    const where = and(eq(products.tenantId, 'workspace'), eq(products.id, 'previously-published'));
    await db.update(products).set({ published: true }).where(where);
    await db.update(products).set({ published: false, everPublished: false }).where(where);
    const historyWhere = and(eq(productPriceHistory.tenantId, 'workspace'), eq(productPriceHistory.productId, 'previously-published'));
    const history = await db.select().from(productPriceHistory).where(historyWhere);
    expect(history).toHaveLength(1);
    expect(await createProductDraftRepository(db).deleteDraft('workspace', 'previously-published')).toEqual({ kind: 'refused', reason: 'published' });
    expect(await db.select().from(productPriceHistory).where(historyWhere)).toEqual(history);
    expect((await db.select().from(products).where(where))[0]?.everPublished).toBe(true);
  });

  it('refuses unverified historical drafts', async () => {
    await database.db.insert(products).values({ ...product('unknown-history'), everPublished: null });
    expect(await createProductDraftRepository(database.db).deleteDraft('workspace', 'unknown-history')).toEqual({ kind: 'refused', reason: 'unknown_history' });
  });

  it('refuses any order, including a later line in a bundled order', async () => {
    const { db } = database;
    await db.insert(products).values([product('ordered'), product('bundle-line')]);
    await db.insert(orders).values({ id: 'order', tenantId: 'workspace', memberId: 'member', productId: 'ordered', kind: 'one_time', status: 'failed', amountCents: 200, currency: 'PLN', provider: 'simulated', lines: [line('ordered'), line('bundle-line')], createdAt: now });
    for (const id of ['ordered', 'bundle-line']) expect(await createProductDraftRepository(db).deleteDraft('workspace', id)).toEqual({ kind: 'refused', reason: 'orders' });
  });

  it('refuses expired grants', async () => {
    const { db } = database;
    await db.insert(products).values(product('granted'));
    await db.insert(productGrants).values({ id: 'grant', tenantId: 'workspace', memberId: 'member', productId: 'granted', source: 'manual', startsAt: '2026-10-01T12:00:00.000Z', expiresAt: now, createdAt: now });
    expect(await createProductDraftRepository(db).deleteDraft('workspace', 'granted')).toEqual({ kind: 'refused', reason: 'grants' });
  });

  it('refuses inactive sales-link references', async () => {
    const { db } = database;
    await db.insert(products).values(product('linked'));
    await db.insert(salesLinks).values({ id: 'sales-link', tenantId: 'workspace', slug: 'collection', title: 'Collection', heading: 'Collection', description: '', productIds: ['linked'], active: false, listed: false, revision: 1, createdAt: now, updatedAt: now });
    expect(await createProductDraftRepository(db).deleteDraft('workspace', 'linked')).toEqual({ kind: 'refused', reason: 'sales_links' });
  });

  it('refuses checkout snapshots and ignores other tenant snapshots', async () => {
    const { db } = database;
    await db.insert(products).values([product('checkout'), product('foreign-checkout')]);
    await db.insert(checkoutSnapshots).values([
      { id: 'checkout', tenantId: 'workspace', lines: [line('checkout')], currency: 'PLN', createdAt: now },
      { id: 'foreign', tenantId: 'other', lines: [line('foreign-checkout')], currency: 'PLN', createdAt: now },
    ]);
    expect(await createProductDraftRepository(db).deleteDraft('workspace', 'checkout')).toEqual({ kind: 'refused', reason: 'checkout_snapshots' });
    expect(await createProductDraftRepository(db).deleteDraft('workspace', 'foreign-checkout')).toEqual({ kind: 'deleted', assets: [] });
  });
});
