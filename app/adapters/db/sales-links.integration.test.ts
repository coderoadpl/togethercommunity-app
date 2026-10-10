import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { salesLinkSchema } from '#core/domain/index.js';
import type { Db } from './client.js';
import { members, orders, products, salesLinkEvents, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';
import { createSalesLinkRepository } from './sales-links.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-10-08T12:00:00.000Z';
const link = salesLinkSchema.parse({ id: 'link', tenantId: 'workspace', slug: 'collection', title: 'Collection offer', heading: 'Your collection', productIds: ['product'], active: true, revision: 1, createdAt: now, updatedAt: now });
describe('sales-link persistence', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_sales_links', baseDatabaseUrl));
    await db.insert(tenants).values([{ id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now }, { id: 'other', slug: 'other', name: 'Other workspace', createdAt: now }]);
    await db.insert(products).values([{ id: 'product', tenantId: 'workspace', type: 'physical', description: '', slug: 'item', title: 'Printed item', priceCents: 1050, currency: 'PLN', published: true, accessItems: [], vatRate: 5, createdAt: now }, { id: 'foreign', tenantId: 'other', type: 'physical', description: '', slug: 'item', title: 'Other item', priceCents: 1050, currency: 'PLN', published: true, accessItems: [], vatRate: 5, createdAt: now }]);
    await db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
    await db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
  });
  afterAll(async () => { await close(); });
  it('isolates products, slugs, reads, updates and deletes by workspace', async () => {
    const repo = createSalesLinkRepository(db);
    expect(await repo.save('workspace', link, null)).toMatchObject({ ok: true });
    expect(await repo.save('other', { ...link, id: 'other-link' }, null)).toMatchObject({ ok: false });
    expect(await repo.save('other', { ...link, id: 'other-link', productIds: ['foreign'] }, null)).toMatchObject({ ok: true });
    expect(await repo.findById('other', link.id)).toBeNull();
    expect(await repo.delete('other', link.id, now)).toMatchObject({ ok: false });
    expect(await repo.save('workspace', { ...link, id: 'duplicate' }, null)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const competing = await Promise.all(['First edit', 'Second edit'].map((heading) => repo.save('workspace', { ...link, heading, revision: 2 }, 1)));
    expect(competing.filter((result) => result.ok)).toHaveLength(1);
    expect(competing.filter((result) => !result.ok)).toHaveLength(1);
  });
  it('retains append-only history after deletion and releases the slug', async () => {
    const repo = createSalesLinkRepository(db);
    const draft = { ...link, id: 'draft', slug: 'draft' };
    expect(await repo.save('workspace', draft, null)).toMatchObject({ ok: true });
    expect(await repo.delete('workspace', draft.id, now)).toMatchObject({ ok: true });
    expect(await repo.findById('workspace', draft.id)).toBeNull();
    expect(await repo.findBySlug('workspace', draft.slug)).toBeNull();
    expect(await db.select().from(salesLinkEvents).where(eq(salesLinkEvents.salesLinkId, draft.id))).toHaveLength(2);
    expect(await repo.save('workspace', { ...draft, id: 'replacement' }, null)).toMatchObject({ ok: true });
  });
  it('requires deactivation once any completed payment references the link', async () => {
    const repo = createSalesLinkRepository(db);
    await db.insert(orders).values({ id: 'paid', tenantId: 'workspace', memberId: 'member', productId: 'product', kind: 'one_time', status: 'paid', amountCents: 1050, currency: 'PLN', provider: 'simulated', salesLinkId: link.id, createdAt: now });
    expect(await repo.delete('workspace', link.id, now)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    await db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, 'paid'));
    expect(await repo.delete('workspace', link.id, now)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});
