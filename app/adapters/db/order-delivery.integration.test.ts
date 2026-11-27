import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DELETED_MEMBER_DISPLAY, memberTombstone, orderSchema, SHIPX_STATUS_CANCELED, type DeliveryCorrectionCommand } from '#core/domain/index.js';
import { createOrderDeliveryRepository } from './order-delivery.js';
import { createMemberErasureRepository, createOrderRepository } from './repositories.js';
import { createShipxShipmentRepository } from './shipx.js';
import { checkoutSnapshots, couponCheckoutSessions, coupons, members, orderChanges, orderShipments, orders, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-11-25T10:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const shipping = {
  rateId: 'locker', label: 'Locker', amountCents: 1200, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'ABC01M', name: null, address: null }, phone: null,
  address: { name: 'Example Buyer', line1: 'Street 1', line2: null, postalCode: '00-001', city: 'Example City', country: 'PL' },
};
const order = (id: string) => orderSchema.parse({
  id, tenantId: 'workspace', memberId: 'member', productId: 'book', priceId: null, kind: 'one_time', status: 'paid',
  amountCents: 1200, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: now, paidAt: now, shipping, fulfilmentStatus: 'to_pack',
});
const command = (orderId: string, fields: Partial<DeliveryCorrectionCommand['input']> = { phone: '500000000' }): DeliveryCorrectionCommand => ({
  input: { orderId, expected: {
    ...(fields.phone === undefined ? {} : { phone: null }),
    ...(fields.recipientName === undefined ? {} : { recipientName: shipping.address.name }),
    ...(fields.address === undefined ? {} : { address: { line1: shipping.address.line1, line2: shipping.address.line2, postalCode: shipping.address.postalCode, city: shipping.address.city } }),
  }, ...fields }, pickupPoint: null, at: now, byUserId: 'staff', byEmail: 'staff@example.org',
});
const seedShipment = async (orderId: string, change: Partial<typeof orderShipments.$inferInsert> = {}) => {
  await database.db.insert(orderShipments).values({ id: `shipment-${orderId}`, tenantId: 'workspace', orderId,
    provider: 'inpost_shipx', environment: 'sandbox', organizationId: 'org', providerShipmentId: 'draft', status: 'offers_prepared',
    createdAt: '2026-11-25T09:00:00.000Z', updatedAt: now, ...change });
};
beforeAll(async () => {
  database = await createTestDatabase('together_delivery_correction', baseDatabaseUrl);
  await database.db.insert(tenants).values([{ id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now }, { id: 'other', slug: 'other', name: 'Other', createdAt: now }]);
  await database.db.insert(products).values({ id: 'book', tenantId: 'workspace', type: 'physical', deliveryMethod: 'shipping', slug: 'book', title: 'Book', description: '', priceCents: 1200, currency: 'PLN', published: true, createdAt: now });
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Example Buyer' });
  await database.db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', displayName: 'Example Buyer', createdAt: now });
});
afterAll(async () => { await database?.close(); });

describe('delivery correction persistence', () => {
  it('serializes concurrent corrections, rewrites jsonb and emits the order changes feed', async () => {
    await createOrderRepository(database.db).create('workspace', order('concurrent'));
    const repo = createOrderDeliveryRepository(database.db);
    const results = await Promise.all([
      repo.correctDelivery('workspace', command('concurrent')),
      repo.correctDelivery('workspace', command('concurrent', { recipientName: 'Corrected Buyer' })),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const stored = await createOrderRepository(database.db).findById('workspace', 'concurrent');
    expect(stored?.shipping).toMatchObject({ phone: '+48500000000', address: { name: 'Corrected Buyer', country: 'PL' } });
    expect(stored?.shipping?.corrections).toHaveLength(2);
    expect(stored?.shipping?.corrections?.map((entry) => entry.field).sort()).toEqual(['phone', 'recipient_name']);
    const changes = await database.db.select().from(orderChanges).where(and(eq(orderChanges.tenantId, 'workspace'), eq(orderChanges.orderId, 'concurrent')));
    expect(changes).toHaveLength(3);
  });
  it('checks the shipment and order guards under the lock and leaves denied rows unchanged', async () => {
    const repo = createOrderDeliveryRepository(database.db);
    for (const id of ['bought', 'shipped', 'draft', 'busy', 'attempted']) await createOrderRepository(database.db).create('workspace', order(id));
    await seedShipment('bought', { status: 'confirmed', trackingNumber: 'TRACK001' });
    await seedShipment('draft');
    await seedShipment('attempted', { providerShipmentId: null, createAttemptedAt: now });
    await seedShipment('busy', { operationToken: 'active', operationStartedAt: now });
    await database.db.update(orders).set({ fulfilmentStatus: 'shipped' }).where(eq(orders.id, 'shipped'));
    expect(await repo.correctDelivery('workspace', command('bought'))).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_bought' } });
    expect(await repo.correctDelivery('workspace', command('shipped'))).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipped' } });
    expect(await repo.correctDelivery('workspace', command('busy'))).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_exists' } });
    expect(await repo.correctDelivery('workspace', command('attempted'))).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_exists' } });
    expect(await repo.correctDelivery('other', command('draft'))).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await repo.correctDelivery('workspace', command('draft'))).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_exists' } });
    expect((await createOrderRepository(database.db).findById('workspace', 'bought'))?.shipping?.corrections).toBeUndefined();
    expect((await database.db.select().from(orderShipments)).filter((row) => row.orderId === 'draft')).toHaveLength(1);
  });
  it('persists a correction without replacing the canceled InPost label', async () => {
    await createOrderRepository(database.db).create('workspace', order('canceled-label'));
    await seedShipment('canceled-label', { status: SHIPX_STATUS_CANCELED, trackingNumber: 'TRACK001', boughtAt: now, createAttemptedAt: now });
    expect(await createOrderDeliveryRepository(database.db).correctDelivery('workspace', command('canceled-label'))).toMatchObject({
      ok: true, value: { order: { shipping: { phone: '+48500000000' } } },
    });
    const [shipment] = await database.db.select().from(orderShipments).where(and(eq(orderShipments.tenantId, 'workspace'), eq(orderShipments.orderId, 'canceled-label')));
    expect(shipment).toMatchObject({ status: SHIPX_STATUS_CANCELED, trackingNumber: 'TRACK001', providerShipmentId: 'draft' });
  });
  it('allows only one concurrent edit of the same field', async () => {
    await createOrderRepository(database.db).create('workspace', order('conflict'));
    const repo = createOrderDeliveryRepository(database.db);
    const results = await Promise.all([
      repo.correctDelivery('workspace', command('conflict', { phone: '500000000' })),
      repo.correctDelivery('workspace', command('conflict', { phone: '600000000' })),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toMatchObject([{ error: { code: 'delivery_correction_conflict' } }]);
  });
  it('serializes a shipment claim after correction and rejects further corrections under its lease', async () => {
    await createOrderRepository(database.db).create('workspace', order('claimed'));
    const repo = createOrderDeliveryRepository(database.db);
    expect(await repo.correctDelivery('workspace', command('claimed'))).toMatchObject({ ok: true });
    const claim = await createShipxShipmentRepository(database.db).acquire('workspace', {
      id: 'claim', orderId: 'claimed', token: 'lease', environment: 'sandbox', organizationId: 'org', now,
      leaseExpiredBefore: '2026-11-25T09:00:00.000Z', actorUserId: 'staff', orderShippable: () => true,
    });
    expect(claim.kind).toBe('acquired');
    expect((await createOrderRepository(database.db).findById('workspace', 'claimed'))?.shipping?.phone).toBe('+48500000000');
    expect(await repo.correctDelivery('workspace', command('claimed', { recipientName: 'New Buyer' }))).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_exists' } });
  });
  it('removes historical delivery personal data when the member is erased', async () => {
    await createOrderRepository(database.db).create('workspace', { ...order('snapshot-order'), providerObjectIds: { checkoutSession: 'session-erased' } });
    await database.db.insert(coupons).values({ id: 'coupon', tenantId: 'workspace', code: 'SAVE', kind: 'percent', value: 10, scope: { kind: 'all' }, appliesTo: 'one_time', createdAt: now });
    const abandoned = { tenantId: 'workspace', couponId: 'coupon', productId: 'book', originalCents: 1200, discountCents: 120, finalCents: 1080, currency: 'PLN', startedAt: now };
    await database.db.insert(couponCheckoutSessions).values([
      { ...abandoned, id: 'coupon-buyer', providerSessionId: 'session-abandoned', memberEmail: 'Buyer@example.org' },
      { ...abandoned, id: 'coupon-unrelated', providerSessionId: 'session-unrelated', memberEmail: 'someone@example.org' },
      { ...abandoned, id: 'coupon-other-order', providerSessionId: 'session-other-order', memberEmail: 'buyer@example.org' },
    ]);
    await database.db.insert(user).values({ id: 'other-buyer', email: 'other@example.org', name: 'Other Buyer' });
    await database.db.insert(members).values({ id: 'other-member', tenantId: 'workspace', userId: 'other-buyer', email: 'other@example.org', displayName: 'Other Buyer', createdAt: now });
    await createOrderRepository(database.db).create('workspace', { ...order('other-order'), memberId: 'other-member', providerObjectIds: { checkoutSession: 'session-other-order' } });
    const snapshotSessions = [
      { tenantId: 'workspace', providerSessionId: 'session-erased' },
      { tenantId: 'other', providerSessionId: 'session-erased' },
      { tenantId: 'workspace', providerSessionId: 'session-abandoned' },
      { tenantId: 'other', providerSessionId: 'session-abandoned' },
      { tenantId: 'workspace', providerSessionId: 'session-unrelated' },
      { tenantId: 'workspace', providerSessionId: 'session-unlinked' },
      { tenantId: 'workspace', providerSessionId: 'session-other-order' },
    ];
    await database.db.insert(checkoutSnapshots).values(snapshotSessions.map<typeof checkoutSnapshots.$inferInsert>(({ tenantId, providerSessionId }) => ({
      id: `${tenantId}:${providerSessionId}`, tenantId, providerSessionId, currency: 'PLN', lines: [], createdAt: now,
      shipping: { rateId: 'locker', label: 'Locker', amountCents: 1200, vatRatePercent: 23, carrier: 'inpost', pickupPoint: null, allowedCountries: ['PL'], phone: '+48500000000' },
    })));
    const tombstone = memberTombstone('member');
    await createMemberErasureRepository(database.db, { compute: (tenantId, value) => `${tenantId}:${value}` }).pseudonymize('workspace', {
      memberId: 'member', deletedAt: now, tombstoneEmail: tombstone.email, severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
    });
    const [stored] = await database.db.select().from(orders).where(eq(orders.id, 'concurrent'));
    const snapshots = await database.db.select().from(checkoutSnapshots);
    const redacted = snapshots.filter((row) => row.shipping != null && !('phone' in row.shipping));
    expect(redacted.map((row) => row.id).sort()).toEqual(['workspace:session-abandoned', 'workspace:session-erased']);
    expect(snapshots).toHaveLength(snapshotSessions.length);
    expect(await createOrderDeliveryRepository(database.db).correctDelivery('workspace', command('snapshot-order'))).toMatchObject({ ok: false, error: { code: 'delivery_correction_member_erased' } });
    expect(stored?.shipping?.corrections ?? []).toEqual([]);
    expect(JSON.stringify(stored?.shipping)).not.toContain('Corrected Buyer');
  });
});
