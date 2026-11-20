import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderSchema } from '#core/domain/index.js';
import { createOrderVerificationRepository } from './order-verification.js';
import { createOrderRepository, createPaymentRefundRepository } from './repositories.js';
import { members, orderIssueEvents, orders, products, tenantAdmins, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-10-08T12:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const order = (id: string) => orderSchema.parse({ id, tenantId: 'workspace', memberId: 'member', productId: 'physical', priceId: null, kind: 'one_time', status: 'paid', amountCents: 10500, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: now, lines: [
  { productId: 'physical', name: 'Printed material', productType: 'physical', grossCents: 10500, netCents: 10000, vatCents: 500, vatRate: 5, vatExemptionBasis: null, issuedCount: 0 },
  { productId: 'digital', name: 'Digital material', productType: 'digital_download', grossCents: 0, netCents: 0, vatCents: 0, vatRate: 23, vatExemptionBasis: null, issuedCount: null },
] });
const orderOfUnits = (id: string, quantity: number) => {
  const base = order(id);
  return { ...base, lines: base.lines?.map((line) => line.productId === 'physical' ? { ...line, quantity } : line) };
};
beforeAll(async () => {
  database = await createTestDatabase('together_order_verification', baseDatabaseUrl);
  await database.db.insert(tenants).values([{ id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now }, { id: 'other', slug: 'other', name: 'Other workspace', createdAt: now }]);
  await database.db.insert(products).values({ id: 'physical', tenantId: 'workspace', type: 'physical', description: '', slug: 'printed', title: 'Printed material', priceCents: 10500, currency: 'PLN', published: true, vatRate: 5, createdAt: now });
  await database.db.insert(user).values([
    { id: 'buyer', email: 'buyer@example.org', name: 'Buyer' },
    { id: 'named-staff', email: 'named-staff@example.org', name: ' Jordan Smith ' },
    { id: 'unnamed-staff', email: 'unnamed-staff@example.org', name: ' ' },
    { id: 'external-staff', email: 'external-staff@example.org', name: 'Other staff' },
  ]);
  await database.db.insert(tenantAdmins).values([
    { id: 'named-staff-role', tenantId: 'workspace', userId: 'named-staff', role: 'admin' },
    { id: 'unnamed-staff-role', tenantId: 'workspace', userId: 'unnamed-staff', role: 'admin' },
    { id: 'external-staff-role', tenantId: 'other', userId: 'external-staff', role: 'admin' },
  ]);
  await database.db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('order verification storage', () => {
  it('preserves historical null payment dates and normalizes stored payment timestamps on order reads', async () => {
    const ordersRepo = createOrderRepository(database.db);
    await ordersRepo.create('workspace', order('historical-payment'));
    expect(await ordersRepo.findById('workspace', 'historical-payment')).toMatchObject({ paidAt: null });
    await ordersRepo.create('workspace', { ...order('dated-payment'), providerObjectIds: { checkoutSession: 'dated-checkout' } });
    await database.db.update(orders).set({ paidAt: '2026-10-13T20:38:00+02:00' }).where(eq(orders.id, 'dated-payment'));
    const paidAt = '2026-10-13T18:38:00.000Z';
    expect(await ordersRepo.findById('workspace', 'dated-payment')).toMatchObject({ paidAt });
    expect((await ordersRepo.list('workspace', { page: 1, pageSize: 20 })).orders).toContainEqual(expect.objectContaining({ id: 'dated-payment', paidAt }));
    expect(await ordersRepo.listForMember('workspace', 'member')).toContainEqual(expect.objectContaining({ id: 'dated-payment', paidAt }));
    expect(await createOrderVerificationRepository(database.db).findByReference('workspace', 'dated-payment')).toMatchObject({ paidAt });
    expect(await createPaymentRefundRepository(database.db).findOrderByProviderObjectIds('workspace', { checkoutSession: 'dated-checkout' })).toMatchObject({ paidAt });
  });
  it('records the payment time when completing a pending test checkout', async () => {
    const ordersRepo = createOrderRepository(database.db);
    const pending = { ...order('pending-payment'), mode: 'test' as const, status: 'pending' as const };
    await ordersRepo.create('workspace', pending);
    const paidAt = '2026-10-13T18:38:00.000Z';
    expect(await ordersRepo.completeTestCheckout('workspace', { ...pending, paidAt })).toMatchObject({ createdAt: now, paidAt, status: 'paid' });
    expect(await ordersRepo.findById('workspace', pending.id)).toMatchObject({ createdAt: now, paidAt, status: 'paid' });
  });
  it('resolves stable opaque tokens and order numbers with tenant isolation', async () => {
    await createOrderRepository(database.db).create('workspace', order('lookup-order'));
    const repo = createOrderVerificationRepository(database.db);
    const found = await repo.findByReference('workspace', 'lookup-order');
    expect(found?.verificationToken).toMatch(/^[a-f0-9]{64}$/u);
    const token = found?.verificationToken ?? '';
    expect(await repo.findByReference('workspace', token)).toEqual(found);
    expect(await repo.findByToken('workspace', token)).toEqual(found);
    expect(await repo.findByToken('workspace', 'lookup-order')).toBeNull();
    expect(await repo.findByReference('other', token)).toBeNull();
    expect(await repo.findByReference('other', 'lookup-order')).toBeNull();
    expect(await repo.findByToken('other', token)).toBeNull();
    expect(await repo.findByReference('workspace', 'unknown')).toBeNull();
  });
  it('allows one concurrent issue and rejects duplicate collection without changing its history', async () => {
    const paidAt = '2026-10-08T10:00:00.000Z';
    await createOrderRepository(database.db).create('workspace', { ...order('concurrent-order'), paidAt });
    const repo = createOrderVerificationRepository(database.db);
    const attempts = [
      { orderId: 'concurrent-order', productId: 'physical', count: 1, staffUserId: 'first-staff', occurredAt: now },
      { orderId: 'concurrent-order', productId: 'physical', count: 1, staffUserId: 'second-staff', occurredAt: '2026-10-08T13:00:00.000Z' },
    ];
    const results = await Promise.all(attempts.map((input) => repo.issueLine('workspace', input)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { code: 'conflict', message: 'Order line has already been issued' } }]);
    const winner = attempts[results.findIndex((result) => result.ok)];
    expect(winner).toBeDefined();
    const issuedLine = { issuedCount: 1, issuedAt: winner?.occurredAt, issuedBy: winner?.staffUserId };
    expect(await repo.findByReference('workspace', 'concurrent-order')).toMatchObject({ paidAt, lines: [issuedLine, { issuedCount: null }] });
    expect(await repo.issueLine('workspace', { orderId: 'concurrent-order', productId: 'physical', count: 1, staffUserId: 'later-staff', occurredAt: '2026-10-09T12:00:00.000Z' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await repo.findByReference('workspace', 'concurrent-order')).toMatchObject({ lines: [issuedLine, { issuedCount: null }] });
    const events = await database.db.select().from(orderIssueEvents).where(and(eq(orderIssueEvents.tenantId, 'workspace'), eq(orderIssueEvents.orderId, 'concurrent-order')));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ issuedCount: 1, staffUserId: winner?.staffUserId });
    expect(new Date(events[0]?.occurredAt ?? '').toISOString()).toBe(winner?.occurredAt);
  });
  it('issues a line of two units twice and refuses the third issue', async () => {
    await createOrderRepository(database.db).create('workspace', orderOfUnits('two-units', 2));
    const repo = createOrderVerificationRepository(database.db);
    const input = { orderId: 'two-units', productId: 'physical', count: 1, staffUserId: 'named-staff', occurredAt: now };
    expect(await repo.issueLine('workspace', input)).toMatchObject({ ok: true, value: { lines: [{ issuedCount: 1, quantity: 2 }, { issuedCount: null }] } });
    expect(await repo.issueLine('workspace', { ...input, occurredAt: '2026-10-08T13:00:00.000Z' })).toMatchObject({ ok: true, value: { lines: [{ issuedCount: 2, issuedAt: now }, { issuedCount: null }] } });
    expect(await repo.issueLine('workspace', input)).toEqual({ ok: false, error: { code: 'conflict', message: 'Order line has already been issued' } });
    const events = await database.db.select().from(orderIssueEvents).where(and(eq(orderIssueEvents.tenantId, 'workspace'), eq(orderIssueEvents.orderId, 'two-units')));
    expect(events.map((event) => event.issuedCount).toSorted()).toEqual([1, 2]);
  });
  it('issues several units at once only within the quantity left', async () => {
    await createOrderRepository(database.db).create('workspace', orderOfUnits('batch-units', 2));
    await createOrderRepository(database.db).create('workspace', orderOfUnits('over-units', 2));
    const repo = createOrderVerificationRepository(database.db);
    const input = { productId: 'physical', staffUserId: 'named-staff', occurredAt: now };
    expect(await repo.issueLine('workspace', { ...input, orderId: 'batch-units', count: 2 })).toMatchObject({ ok: true, value: { lines: [{ issuedCount: 2 }, { issuedCount: null }] } });
    expect(await repo.issueLine('workspace', { ...input, orderId: 'batch-units', count: 1 })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await repo.issueLine('workspace', { ...input, orderId: 'over-units', count: 3 })).toEqual({ ok: false, error: { code: 'conflict', message: 'Issue count exceeds the quantity left to issue' } });
    expect(await repo.issueLine('workspace', { ...input, orderId: 'over-units', count: 1 })).toMatchObject({ ok: true });
    expect(await repo.issueLine('workspace', { ...input, orderId: 'over-units', count: 2 })).toMatchObject({ ok: false, error: { code: 'conflict', message: 'Issue count exceeds the quantity left to issue' } });
    expect(await repo.findByReference('workspace', 'over-units')).toMatchObject({ lines: [{ issuedCount: 1 }, { issuedCount: null }] });
    expect(await database.db.select().from(orderIssueEvents).where(eq(orderIssueEvents.orderId, 'over-units'))).toHaveLength(1);
  });
  it('lets concurrent issues of a two-unit line pass only up to its quantity', async () => {
    await createOrderRepository(database.db).create('workspace', orderOfUnits('racing-units', 2));
    const repo = createOrderVerificationRepository(database.db);
    const results = await Promise.all(['first', 'second', 'third'].map((staffUserId) => repo.issueLine('workspace', { orderId: 'racing-units', productId: 'physical', count: 1, staffUserId, occurredAt: now })));
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(await repo.findByReference('workspace', 'racing-units')).toMatchObject({ lines: [{ issuedCount: 2 }, { issuedCount: null }] });
  });
  it('reports one unit for a stored line without a quantity', async () => {
    await createOrderRepository(database.db).create('workspace', order('legacy-units'));
    expect((await createOrderVerificationRepository(database.db).findByReference('workspace', 'legacy-units'))?.lines?.map((line) => line.quantity)).toEqual([1, 1]);
    const [stored] = await database.db.select().from(orders).where(and(eq(orders.tenantId, 'workspace'), eq(orders.id, 'legacy-units')));
    expect(stored?.lines[0]).not.toHaveProperty('quantity');
  });
  it.each([
    { staffUserId: 'named-staff', issuedByDisplayName: 'Jordan Smith' },
    { staffUserId: 'unnamed-staff', issuedByDisplayName: 'unnamed-staff@example.org' },
    { staffUserId: 'external-staff', issuedByDisplayName: undefined },
  ])('resolves the tenant-scoped display name for $staffUserId without changing stored identity', async ({ staffUserId, issuedByDisplayName }) => {
    const orderId = `display-${staffUserId}`;
    await createOrderRepository(database.db).create('workspace', order(orderId));
    const repo = createOrderVerificationRepository(database.db);
    expect(await repo.issueLine('workspace', { orderId, productId: 'physical', count: 1, staffUserId, occurredAt: now })).toMatchObject({
      ok: true,
      value: { lines: [{ issuedBy: staffUserId, issuedByDisplayName }, { issuedCount: null }] },
    });
    const found = await repo.findByReference('workspace', orderId);
    expect(found?.lines?.[0]).toMatchObject({ issuedBy: staffUserId, issuedByDisplayName });
    const [stored] = await database.db.select().from(orders).where(and(eq(orders.tenantId, 'workspace'), eq(orders.id, orderId)));
    expect(stored?.lines[0]).toMatchObject({ issuedBy: staffUserId });
    expect(stored?.lines[0]).not.toHaveProperty('issuedByDisplayName');
  });
  it('does not issue another tenant, non-physical, missing or non-paid lines', async () => {
    await createOrderRepository(database.db).create('workspace', order('restricted-order'));
    const repo = createOrderVerificationRepository(database.db);
    const input = { orderId: 'restricted-order', productId: 'physical', count: 1, staffUserId: 'staff', occurredAt: now };
    expect(await repo.issueLine('other', input)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await repo.issueLine('workspace', { ...input, productId: 'missing' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await repo.issueLine('workspace', { ...input, productId: 'digital' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    for (const status of ['pending', 'failed', 'refunded', 'partially_refunded'] as const) {
      await database.db.update(orders).set({ status }).where(eq(orders.id, input.orderId));
      expect(await repo.issueLine('workspace', input)).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(await database.db.select().from(orderIssueEvents).where(eq(orderIssueEvents.orderId, input.orderId))).toEqual([]);
    expect(await repo.findByReference('workspace', input.orderId)).toMatchObject({ lines: [{ issuedCount: 0 }, { issuedCount: null }] });
  });
  it('refuses to hand over a paid order cancelled because it sold out', async () => {
    await createOrderRepository(database.db).create('workspace', { ...order('cancelled-order'), cancelReason: 'out_of_stock' });
    const repo = createOrderVerificationRepository(database.db);
    const input = { orderId: 'cancelled-order', productId: 'physical', count: 1, staffUserId: 'named-staff', occurredAt: now };
    expect(await repo.issueLine('workspace', input)).toEqual({ ok: false, error: { code: 'conflict', message: 'A cancelled order cannot be issued' } });
    expect(await database.db.select().from(orderIssueEvents).where(eq(orderIssueEvents.orderId, input.orderId))).toEqual([]);
    expect(await repo.findByReference('workspace', input.orderId)).toMatchObject({ status: 'paid', cancelReason: 'out_of_stock', lines: [{ issuedCount: 0 }, { issuedCount: null }] });
  });
});
