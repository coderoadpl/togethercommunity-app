import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkoutSnapshotSchema, orderLineSchema, orderSchema } from '#core/domain/index.js';

import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { createOrderRepository } from './repositories.js';
import { members, orders, productGrants, products, salesLinks, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-10-08T12:00:00.000Z';
const physicalLine = orderLineSchema.parse({ productId: 'physical', name: 'Printed material', productType: 'physical', grossCents: 10500, netCents: 10000, vatCents: 500, vatRate: 5, vatExemptionBasis: null, issuedCount: 0 });
const digitalLine = orderLineSchema.parse({ productId: 'download', name: 'Digital material', productType: 'digital_download', grossCents: 12300, netCents: 10000, vatCents: 2300, vatRate: 23, vatExemptionBasis: null, issuedCount: null });
const order = (id: string) => orderSchema.parse({ id, tenantId: 'workspace', memberId: 'member', productId: 'physical', priceId: null, kind: 'one_time', status: 'paid', amountCents: 22800, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, salesLinkId: 'sales-link', lines: [physicalLine, digitalLine], createdAt: now });
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_order_lines', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: 'workspace', slug: 'workspace', name: 'Workspace', invoiceVatRatePercent: 8, createdAt: now },
    { id: 'other', slug: 'other', name: 'Other workspace', createdAt: now },
  ]);
  await database.db.insert(products).values([
    { id: 'physical', tenantId: 'workspace', type: 'physical', description: '', slug: 'printed', title: 'Printed material', priceCents: 10500, currency: 'PLN', published: true, vatRate: 5, createdAt: now },
    { id: 'download', tenantId: 'workspace', type: 'digital_download', description: '', slug: 'download', title: 'Digital material', priceCents: 12300, currency: 'PLN', published: true, vatRate: 23, createdAt: now },
    { id: 'physical-legacy', tenantId: 'workspace', type: 'physical', description: '', slug: 'printed-legacy', title: 'Printed material', priceCents: 12300, currency: 'PLN', published: true, vatRate: 23, createdAt: now },
    { id: 'exempt', tenantId: 'workspace', type: 'physical', description: '', slug: 'exempt', title: 'Exempt material', priceCents: 5000, currency: 'PLN', published: true, vatRate: 'exempt', vatExemptionBasis: 'Section 1', createdAt: now },
    { id: 'legacy', tenantId: 'workspace', type: 'course', description: '', slug: 'legacy', title: 'Legacy product', priceCents: 10800, currency: 'PLN', published: true, createdAt: now },
  ]);
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('order and checkout snapshots', () => {
  it('stores independent opaque stable tokens and complete immutable lines', async () => {
    const repository = createOrderRepository(database.db);
    await repository.create('workspace', order('order-a'));
    await repository.create('workspace', order('order-b'));
    const first = await repository.findById('workspace', 'order-a');
    const second = await repository.findById('workspace', 'order-b');
    expect(first?.verificationToken).toMatch(/^[a-f0-9]{64}$/u);
    expect(second?.verificationToken).toMatch(/^[a-f0-9]{64}$/u);
    expect(first?.verificationToken).not.toBe(second?.verificationToken);
    expect(first?.verificationToken).not.toBe(first?.id);
    expect(first?.lines).toEqual([physicalLine, digitalLine]);
    expect(first).toMatchObject({ amountCents: 22800, salesLinkId: 'sales-link' });
    await database.db.update(products).set({ title: 'Changed printed material', priceCents: 15000, vatRate: 23 }).where(eq(products.id, 'physical'));
    await repository.create('workspace', order('order-a'));
    const reread = await repository.findById('workspace', 'order-a');
    expect(reread?.verificationToken).toBe(first?.verificationToken);
    expect(reread?.lines).toEqual([physicalLine, digitalLine]);
    expect(await repository.findById('other', 'order-a')).toBeNull();
  });

  it('captures a single line and physical issue count for inserts from the previous release', async () => {
    const [physical] = await database.db.insert(orders).values({ id: 'old-physical', tenantId: 'workspace', memberId: 'member', productId: 'physical-legacy', kind: 'one_time', status: 'paid', amountCents: 12300, currency: 'PLN', provider: 'simulated', createdAt: now }).returning();
    expect(physical?.lines).toMatchObject([{ productId: 'physical-legacy', productType: 'physical', grossCents: 12300, vatRate: 23, netCents: 10000, vatCents: 2300, issuedCount: 0 }]);
    const [legacy] = await database.db.insert(orders).values({ id: 'old-digital', tenantId: 'workspace', memberId: 'member', productId: 'legacy', kind: 'one_time', status: 'paid', amountCents: 10800, currency: 'PLN', provider: 'simulated', createdAt: now }).returning();
    expect(legacy?.lines).toMatchObject([{ productId: 'legacy', productType: 'course', grossCents: 10800, vatRate: null, netCents: 10800, vatCents: 0, issuedCount: null }]);
    expect(legacy?.verificationToken).toMatch(/^[a-f0-9]{64}$/u);
    const [exempt] = await database.db.insert(orders).values({ id: 'old-exempt', tenantId: 'workspace', memberId: 'member', productId: 'exempt', kind: 'one_time', status: 'paid', amountCents: 5000, currency: 'PLN', provider: 'simulated', createdAt: now }).returning();
    expect(exempt?.lines).toMatchObject([{ vatRate: 'exempt', grossCents: 5000, netCents: 5000, vatCents: 0, vatExemptionBasis: 'Section 1', vatExemptionBasisKind: 'other', issuedCount: 0 }]);
  });

  it('reconstructs the pre-coupon list price for old-release inserts', async () => {
    const [row] = await database.db.insert(orders).values({ id: 'old-discounted', tenantId: 'workspace', memberId: 'member', productId: 'physical-legacy', kind: 'one_time', status: 'paid', amountCents: 11070, discountCents: 1230, currency: 'PLN', provider: 'simulated', createdAt: now }).returning();
    expect(row).toMatchObject({ amountCents: 11070, discountCents: 1230, lines: [{ grossCents: 12300, netCents: 10000, vatCents: 2300 }] });
  });

  it('keeps implicit rates unresolved even with an unsupported legacy tenant rate', async () => {
    await database.db.update(tenants).set({ invoiceVatRatePercent: 99 }).where(eq(tenants.id, 'workspace'));
    await database.db.insert(orders).values({ id: 'old-invalid-rate', tenantId: 'workspace', memberId: 'member', productId: 'legacy', kind: 'one_time', status: 'paid', amountCents: 10800, currency: 'PLN', provider: 'simulated', createdAt: now });
    expect(await createOrderRepository(database.db).findById('workspace', 'old-invalid-rate')).toMatchObject({ lines: [{ vatRate: null, grossCents: 10800, vatCents: 0 }] });
    await database.db.update(tenants).set({ invoiceVatRatePercent: 8 }).where(eq(tenants.id, 'workspace'));
  });

  it('joins the originating sales-link title for order lists and details within the tenant', async () => {
    await database.db.insert(salesLinks).values({ id: 'sales-link', tenantId: 'workspace', slug: 'collection', title: 'Collection offer', heading: 'Complete collection', description: '', productIds: ['physical', 'download'], active: true, listed: false, revision: 1, createdAt: now, updatedAt: now });
    const repository = createOrderRepository(database.db);
    await repository.create('workspace', order('titled-order'));
    expect(await repository.findById('workspace', 'titled-order')).toMatchObject({ salesLinkTitle: 'Collection offer' });
    const page = await repository.list('workspace', { page: 1, pageSize: 100 });
    expect(page.orders.find((item) => item.id === 'titled-order')).toMatchObject({ salesLinkTitle: 'Collection offer' });
    await database.db.update(salesLinks).set({ tenantId: 'other' }).where(eq(salesLinks.id, 'sales-link'));
    expect(await repository.findById('workspace', 'titled-order')).toMatchObject({ salesLinkTitle: undefined });
  });

  it('reports the missing later grant once per payment and excludes physical lines', async () => {
    const repository = createOrderRepository(database.db);
    const firstLine = orderLineSchema.parse({ ...digitalLine, productId: 'legacy', name: 'First digital item', productType: 'course' });
    await database.db.insert(productGrants).values({ id: 'grant-first', tenantId: 'workspace', memberId: 'member', productId: 'legacy', source: 'simulated', createdAt: now });
    await repository.create('workspace', orderSchema.parse({ ...order('missing-later'), productId: 'legacy', lines: [firstLine, physicalLine, digitalLine] }));
    const rows = await repository.listPaidWithoutGrant('workspace', { paidBefore: now, limit: 100 });
    expect(rows.filter((row) => row.orderId === 'missing-later')).toMatchObject([{ productId: 'download', productTitle: 'Digital material', amountCents: 22800 }]);
    expect(rows.filter((row) => row.orderId === 'missing-later')).toHaveLength(1);
    expect(rows.some((row) => row.orderId === 'old-physical')).toBe(false);
    expect(await repository.listPaidWithoutGrant('other', { paidBefore: now, limit: 100 })).toEqual([]);
  });

  it('reads checkout snapshots only within their workspace and preserves source prices', async () => {
    const repository = createCheckoutSnapshotRepository(database.db);
    const snapshot = checkoutSnapshotSchema.parse({ id: 'checkout-1', tenantId: 'workspace', salesLinkId: 'sales-link', lines: [physicalLine, digitalLine], currency: 'PLN', createdAt: now });
    await repository.create('workspace', snapshot);
    expect(await repository.findById('workspace', snapshot.id)).toEqual(snapshot);
    expect(await repository.findById('other', snapshot.id)).toBeNull();
    expect(await repository.findById('workspace', 'missing')).toBeNull();
    await database.db.update(products).set({ priceCents: 20000, title: 'Changed digital material' }).where(eq(products.id, 'download'));
    expect(await repository.findById('workspace', snapshot.id)).toEqual(snapshot);
  });
});
