import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderSchema } from '#core/domain/index.js';
import { createOrderVerificationRepository } from './order-verification.js';
import { createOrderRepository } from './repositories.js';
import { members, orderIssueEvents, orders, products, tenantAdmins, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-10-08T12:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const order = (id: string) => orderSchema.parse({ id, tenantId: 'workspace', memberId: 'member', productId: 'physical', priceId: null, kind: 'one_time', status: 'paid', amountCents: 10500, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: now, lines: [
  { productId: 'physical', name: 'Printed material', productType: 'physical', grossCents: 10500, netCents: 10000, vatCents: 500, vatRate: 5, vatExemptionBasis: null, issuedCount: 0 },
  { productId: 'digital', name: 'Digital material', productType: 'digital_download', grossCents: 0, netCents: 0, vatCents: 0, vatRate: 23, vatExemptionBasis: null, issuedCount: null },
] });
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
    await createOrderRepository(database.db).create('workspace', order('concurrent-order'));
    const repo = createOrderVerificationRepository(database.db);
    const attempts = [
      { orderId: 'concurrent-order', productId: 'physical', staffUserId: 'first-staff', occurredAt: now },
      { orderId: 'concurrent-order', productId: 'physical', staffUserId: 'second-staff', occurredAt: '2026-10-08T13:00:00.000Z' },
    ];
    const results = await Promise.all(attempts.map((input) => repo.issueLine('workspace', input)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { code: 'conflict', message: 'Order line has already been issued' } }]);
    const winner = attempts[results.findIndex((result) => result.ok)];
    expect(winner).toBeDefined();
    const issuedLine = { issuedCount: 1, issuedAt: winner?.occurredAt, issuedBy: winner?.staffUserId };
    expect(await repo.findByReference('workspace', 'concurrent-order')).toMatchObject({ lines: [issuedLine, { issuedCount: null }] });
    expect(await repo.issueLine('workspace', { orderId: 'concurrent-order', productId: 'physical', staffUserId: 'later-staff', occurredAt: '2026-10-09T12:00:00.000Z' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await repo.findByReference('workspace', 'concurrent-order')).toMatchObject({ lines: [issuedLine, { issuedCount: null }] });
    const events = await database.db.select().from(orderIssueEvents).where(and(eq(orderIssueEvents.tenantId, 'workspace'), eq(orderIssueEvents.orderId, 'concurrent-order')));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ issuedCount: 1, staffUserId: winner?.staffUserId });
    expect(new Date(events[0]?.occurredAt ?? '').toISOString()).toBe(winner?.occurredAt);
  });
  it.each([
    { staffUserId: 'named-staff', issuedByDisplayName: 'Jordan Smith' },
    { staffUserId: 'unnamed-staff', issuedByDisplayName: 'unnamed-staff@example.org' },
    { staffUserId: 'external-staff', issuedByDisplayName: undefined },
  ])('resolves the tenant-scoped display name for $staffUserId without changing stored identity', async ({ staffUserId, issuedByDisplayName }) => {
    const orderId = `display-${staffUserId}`;
    await createOrderRepository(database.db).create('workspace', order(orderId));
    const repo = createOrderVerificationRepository(database.db);
    expect(await repo.issueLine('workspace', { orderId, productId: 'physical', staffUserId, occurredAt: now })).toMatchObject({
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
    const input = { orderId: 'restricted-order', productId: 'physical', staffUserId: 'staff', occurredAt: now };
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
});
