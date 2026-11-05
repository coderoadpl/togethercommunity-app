import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderSchema, type OrderShipment } from '#core/domain/index.js';
import type { OrderShipmentEmail } from '#core/server/index.js';
import { createOrderFulfilmentRepository } from './order-fulfilment.js';
import { createOrderRepository } from './repositories.js';
import { emailOutbox, members, orderFulfilmentEvents, orders, products, tenantAdmins, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-11-05T09:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const shipping = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
  address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: null,
};

const order = (id: string, status: 'paid' | 'pending' = 'paid') => orderSchema.parse({
  id, tenantId: 'workspace', memberId: 'member', productId: 'stand', priceId: null, kind: 'one_time', status,
  amountCents: 7398, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: now, paidAt: status === 'paid' ? now : null, shipping, fulfilmentStatus: 'to_pack',
  lines: [
    { productId: 'stand', name: 'Printed stand', productType: 'physical', grossCents: 5899, netCents: 4796, vatCents: 1103, vatRate: 23, vatExemptionBasis: null, issuedCount: 0 },
    { productId: 'shipping:locker', name: 'Parcel locker', productType: 'shipping', grossCents: 1499, netCents: 1219, vatCents: 280, vatRate: 23, vatExemptionBasis: null, issuedCount: null },
  ],
});

const shipment = (shippedBy: string, trackingNumber: string, shippedAt = '2026-11-05T10:00:00.000Z'): OrderShipment => ({
  carrier: 'inpost', trackingNumber, shippedAt, shippedBy,
});

const email = (id: string, trackingNumber: string): OrderShipmentEmail => ({
  id,
  to: 'buyer@example.org',
  payload: {
    kind: 'order-shipped',
    language: 'en',
    tenantName: 'Workspace',
    shipment: {
      orderNumber: 'order',
      items: ['Printed stand'],
      delivery: { method: 'Parcel locker', pickupPoint: { code: 'WAW01M', name: null, address: null }, address: null },
      carrier: 'inpost',
      trackingNumber,
      trackingUrl: `https://inpost.pl/sledzenie-przesylek?number=${trackingNumber}`,
    },
  },
});

beforeAll(async () => {
  database = await createTestDatabase('together_order_fulfilment', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now },
    { id: 'other', slug: 'other', name: 'Other workspace', createdAt: now },
  ]);
  await database.db.insert(products).values({ id: 'stand', tenantId: 'workspace', type: 'physical', deliveryMethod: 'shipping', description: '', slug: 'stand', title: 'Printed stand', priceCents: 5899, currency: 'PLN', published: true, vatRate: 23, createdAt: now });
  await database.db.insert(user).values([
    { id: 'buyer', email: 'buyer@example.org', name: 'Buyer' },
    { id: 'first-staff', email: 'first@example.org', name: 'First Packer' },
    { id: 'second-staff', email: 'second@example.org', name: 'Second Packer' },
  ]);
  await database.db.insert(tenantAdmins).values([
    { id: 'first-staff-role', tenantId: 'workspace', userId: 'first-staff', role: 'admin' },
    { id: 'second-staff-role', tenantId: 'workspace', userId: 'second-staff', role: 'admin' },
  ]);
  await database.db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
}, 60_000);
afterAll(async () => { await database?.close(); });

const eventsFor = async (orderId: string) => database.db.select().from(orderFulfilmentEvents)
  .where(and(eq(orderFulfilmentEvents.tenantId, 'workspace'), eq(orderFulfilmentEvents.orderId, orderId)));

const outboxFor = async (ids: string[]) => (await database.db.select().from(emailOutbox).where(eq(emailOutbox.tenantId, 'workspace')))
  .filter((row) => ids.includes(row.id));

describe('order fulfilment storage', () => {
  it('lets one of two concurrent shipments win and writes its projection, event and e-mail together', async () => {
    await createOrderRepository(database.db).create('workspace', order('concurrent'));
    const repo = createOrderFulfilmentRepository(database.db);
    const attempts = [
      { orderId: 'concurrent', eventId: 'event-first', shipment: shipment('first-staff', 'FIRST001'), email: email('mail-first', 'FIRST001') },
      { orderId: 'concurrent', eventId: 'event-second', shipment: shipment('second-staff', 'SECOND02', '2026-11-05T10:00:01.000Z'), email: email('mail-second', 'SECOND02') },
    ];
    const results = await Promise.all(attempts.map((input) => repo.ship('workspace', input)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { code: 'fulfilment_conflict', message: 'Order has already been shipped' } }]);
    const winner = attempts[results.findIndex((result) => result.ok)];
    const stored = await createOrderRepository(database.db).findById('workspace', 'concurrent');
    expect(stored).toMatchObject({
      fulfilmentStatus: 'shipped',
      shipment: { ...winner?.shipment, shippedByDisplayName: winner?.shipment.shippedBy === 'first-staff' ? 'First Packer' : 'Second Packer' },
    });
    const events = await eventsFor('concurrent');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: winner?.eventId, type: 'shipped', actorUserId: winner?.shipment.shippedBy, payload: { carrier: 'inpost', trackingNumber: winner?.shipment.trackingNumber } });
    expect(new Date(events[0]?.occurredAt ?? '').toISOString()).toBe(winner?.shipment.shippedAt);
    const outbox = await outboxFor(['mail-first', 'mail-second']);
    expect(outbox.map((row) => row.id)).toEqual([winner?.email.id]);
    expect(outbox[0]).toMatchObject({ kind: 'order-shipped', to: 'buyer@example.org', status: 'queued' });
  });

  it('keeps the first shipment when the same order is shipped again later', async () => {
    await createOrderRepository(database.db).create('workspace', order('repeat'));
    const repo = createOrderFulfilmentRepository(database.db);
    expect(await repo.ship('workspace', { orderId: 'repeat', eventId: 'repeat-1', shipment: shipment('first-staff', 'REPEAT01'), email: null })).toMatchObject({ ok: true });
    expect(await repo.ship('workspace', { orderId: 'repeat', eventId: 'repeat-2', shipment: shipment('second-staff', 'REPEAT02'), email: email('repeat-mail', 'REPEAT02') }))
      .toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
    expect(await createOrderRepository(database.db).findById('workspace', 'repeat')).toMatchObject({ shipment: { trackingNumber: 'REPEAT01' } });
    expect(await eventsFor('repeat')).toHaveLength(1);
    expect(await outboxFor(['repeat-mail'])).toEqual([]);
  });

  it('writes nothing when the e-mail cannot be queued', async () => {
    await createOrderRepository(database.db).create('workspace', order('mail-failure'));
    await database.db.insert(emailOutbox).values({ id: 'taken-id', tenantId: 'workspace', kind: 'order-shipped', to: 'x@example.org', payload: {}, nextAttemptAt: now, createdAt: now });
    const repo = createOrderFulfilmentRepository(database.db);
    expect(await repo.ship('workspace', { orderId: 'mail-failure', eventId: 'mail-failure-event', shipment: shipment('first-staff', 'MAIL0001'), email: email('taken-id', 'MAIL0001') }))
      .toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(await createOrderRepository(database.db).findById('workspace', 'mail-failure')).toMatchObject({ fulfilmentStatus: 'to_pack', shipment: null });
    expect(await eventsFor('mail-failure')).toEqual([]);
  });

  it('refuses unpaid orders and other workspaces without writing', async () => {
    await createOrderRepository(database.db).create('workspace', order('unpaid', 'pending'));
    const repo = createOrderFulfilmentRepository(database.db);
    const input = { orderId: 'unpaid', eventId: 'unpaid-event', shipment: shipment('first-staff', 'UNPAID01'), email: null };
    expect(await repo.ship('workspace', input)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await repo.ship('other', input)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await eventsFor('unpaid')).toEqual([]);
  });

  it('ships refunded orders that still wait to be packed', async () => {
    await createOrderRepository(database.db).create('workspace', order('refunded'));
    await database.db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, 'refunded'));
    const repo = createOrderFulfilmentRepository(database.db);
    expect(await repo.ship('workspace', { orderId: 'refunded', eventId: 'refunded-event', shipment: shipment('first-staff', 'REFUND01'), email: null }))
      .toMatchObject({ ok: true, value: { status: 'refunded', fulfilmentStatus: 'shipped' } });
  });

  it('filters the order list by the shipped status', async () => {
    const listed = await createOrderRepository(database.db).list('workspace', { fulfilmentStatus: 'shipped', page: 1, pageSize: 20 });
    expect(listed.orders.map((item) => item.id).sort()).toEqual(['concurrent', 'refunded', 'repeat']);
  });
});
