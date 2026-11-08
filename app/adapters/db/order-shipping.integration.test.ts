import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, memberTombstone, orderLineSchema, orderSchema, type Identity, type OrderShipping } from '#core/domain/index.js';
import { exportOrders } from '#core/server/index.js';

import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { createMemberErasureRepository, createOrderRepository, createTenantRepository } from './repositories.js';
import { emailOutbox, members, orders, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-11-05T12:00:00.000Z';
const productLine = orderLineSchema.parse({ productId: 'accessory', name: 'Printed accessory', productType: 'physical', grossCents: 4900, netCents: 3984, vatCents: 916, vatRate: 23, vatExemptionBasis: null, issuedCount: 0 });
const shippingLine = orderLineSchema.parse({ productId: 'shipping:locker', name: 'Parcel locker', productType: 'shipping', grossCents: 1499, netCents: 1219, vatCents: 280, vatRate: 23, vatExemptionBasis: null, issuedCount: null });
const shipping: OrderShipping = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'WAW01M', name: 'Locker WAW01M', address: 'Main Street 1, Warsaw' },
  address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: 'Flat 2', postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: '+48600100200',
};
const order = (id: string, extra: Partial<ReturnType<typeof orderSchema.parse>> = {}) => orderSchema.parse({
  id, tenantId: 'workspace', memberId: 'member', productId: 'accessory', priceId: null, kind: 'one_time', status: 'paid',
  amountCents: 6399, currency: 'PLN', provider: 'simulated', providerObjectIds: { checkoutSession: `cs-${id}` }, couponId: null,
  discountCents: 0, lines: [productLine, shippingLine], createdAt: now, ...extra,
});
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_order_shipping', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: now })));
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
  await database.db.insert(products).values({ id: 'accessory', tenantId: 'workspace', type: 'physical', deliveryMethod: 'shipping', slug: 'accessory', title: 'Printed accessory', description: '', priceCents: 4900, currency: 'PLN', published: true, vatRate: 23, createdAt: now });
  const repository = createOrderRepository(database.db);
  await repository.create('workspace', order('shipped', { shipping, fulfilmentStatus: 'to_pack' }));
  await repository.create('workspace', order('collected', { lines: [productLine], amountCents: 4900 }));
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('order shipping persistence', () => {
  it('round-trips the checkout shipping snapshot within its workspace', async () => {
    const snapshots = createCheckoutSnapshotRepository(database.db);
    const snapshotShipping = { rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23 as const, carrier: 'inpost' as const, pickupPoint: shipping.pickupPoint, allowedCountries: ['PL'] };
    await snapshots.create('workspace', { id: 'snapshot-shipping', tenantId: 'workspace', salesLinkId: null, lines: [productLine, shippingLine], shipping: snapshotShipping, currency: 'PLN', createdAt: now });
    expect(await snapshots.findById('workspace', 'snapshot-shipping')).toMatchObject({ lines: [productLine, shippingLine], shipping: snapshotShipping });
    expect(await snapshots.findById('other', 'snapshot-shipping')).toBeNull();
  });

  it('stores the delivery data and fulfilment status on paid orders and filters orders to pack', async () => {
    const repository = createOrderRepository(database.db);
    expect(await repository.findById('workspace', 'shipped')).toMatchObject({ shipping, fulfilmentStatus: 'to_pack', lines: [productLine, shippingLine] });
    expect(await repository.findById('workspace', 'collected')).toMatchObject({ shipping: null, fulfilmentStatus: null });
    const toPack = await repository.list('workspace', { fulfilmentStatus: 'to_pack', page: 1, pageSize: 20 });
    expect(toPack.total).toBe(1);
    expect(toPack.orders.map((item) => item.id)).toEqual(['shipped']);
  });

  it('copies shipping into a completed staff test order', async () => {
    const repository = createOrderRepository(database.db);
    const pending = order('test-pending', { mode: 'test', status: 'pending', providerObjectIds: { checkoutSession: 'cs_test_pending' } });
    await repository.create('workspace', pending);
    const completed = await repository.completeTestCheckout('workspace', { ...pending, paidAt: now, shipping, fulfilmentStatus: 'to_pack' });
    expect(completed).toMatchObject({ status: 'paid', shipping, fulfilmentStatus: 'to_pack' });
  });

  it('never reports a shipping line as a missing product grant', async () => {
    const rows = await createOrderRepository(database.db).listPaidWithoutGrant('workspace', { paidBefore: now, limit: 100 });
    expect(rows.some((row) => row.productId.startsWith('shipping:'))).toBe(false);
  });

  it('exports the delivery columns in CSV and JSON', async () => {
    const identity: Identity = {
      userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, tenantAccess: 'staff', tenantId: 'workspace',
      tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner', memberId: null, image: null, memberDisplayName: null,
      memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
    };
    const ctx = { identity };
    const deps = { orders: createOrderRepository(database.db) };
    const csv = await exportOrders(ctx, { format: 'csv', fulfilmentStatus: 'to_pack' }, deps);
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    const [header, row] = csv.value.content.split('\n');
    expect(header).toContain('shipping_rate,shipping_point,shipping_name,shipping_phone,shipping_address,shipping_postal_code,shipping_city,shipping_country,fulfilment_status');
    expect(row).toContain('"Parcel locker","WAW01M, Locker WAW01M, Main Street 1, Warsaw","Jane Buyer","\'+48600100200","Garden Street 5, Flat 2","00-950","Warsaw","PL","to_pack"');
    const json = await exportOrders(ctx, { format: 'json', fulfilmentStatus: 'to_pack' }, deps);
    expect(json.ok && JSON.parse(json.value.content)).toMatchObject([{ shipping_rate: 'Parcel locker', shipping_point: 'WAW01M, Locker WAW01M, Main Street 1, Warsaw', shipping_phone: '+48600100200', fulfilment_status: 'to_pack' }]);
  });

  it('persists shipping rates and the parcel locker map token in tenant settings', async () => {
    const tenantRepository = createTenantRepository(database.db);
    const current = await tenantRepository.findSettings('workspace');
    expect(current).toMatchObject({ shippingRates: [], inpostGeowidgetToken: null });
    if (current === null) return;
    const rates = [{ id: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23 as const, carrier: 'inpost' as const, pickupPoint: 'inpost_locker' as const, active: true, deliveryEstimateDays: { min: 1, max: 2 } }];
    await tenantRepository.updateSettings('workspace', { ...current, shippingRates: rates, inpostGeowidgetToken: 'public-map-token' });
    expect(await tenantRepository.findSettings('workspace')).toMatchObject({ shippingRates: rates, inpostGeowidgetToken: 'public-map-token' });
    expect(await tenantRepository.findSettings('other')).toMatchObject({ shippingRates: [], inpostGeowidgetToken: null });
  });

  it('pseudonymises the delivery name, street and phone on member erasure and keeps the rate and amounts', async () => {
    const address = { name: 'Jane Buyer', line1: 'Garden Street 5', line2: 'Flat 2', postalCode: '00-950', city: 'Warsaw', country: 'PL' };
    const confirmation = (to: string, delivery: Record<string, unknown>) => ({
      tenantId: 'workspace', kind: 'welcome-sign-in', to, nextAttemptAt: now, createdAt: now,
      payload: {
        kind: 'welcome-sign-in', language: 'en', tenantName: 'Workspace', actionUrl: 'https://workspace.example.org/sign-in', productType: 'physical',
        purchase: {
          orderNumber: 'ORDER-1', verificationUrl: 'https://workspace.example.org/verify', qrImageUrl: 'https://workspace.example.org/qr.png',
          lines: [{ name: 'Printed accessory', grossCents: 4900, vatRate: 23 }], currency: 'PLN', totalCents: 6399, delivery,
        },
      },
    });
    await database.db.insert(emailOutbox).values([
      { id: 'outbox-courier', ...confirmation(' Buyer@Example.org ', { method: 'Courier', pickupPoint: null, address }) },
      { id: 'outbox-locker', ...confirmation('buyer@example.org', { method: 'Parcel locker', pickupPoint: { code: 'WAW01M', name: 'Locker WAW01M', address: 'Main Street 1, Warsaw' }, address: null }) },
      { id: 'outbox-other', ...confirmation('someone@example.org', { method: 'Courier', pickupPoint: null, address }) },
    ]);
    await createMemberErasureRepository(database.db, { compute: (tenantId, email) => `${tenantId}:${email}` }).pseudonymize('workspace', {
      memberId: 'member', deletedAt: now, tombstoneEmail: memberTombstone('member').email,
      severedUserId: memberTombstone('member').userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
    });
    const erased = await createOrderRepository(database.db).findById('workspace', 'shipped');
    expect(erased).toMatchObject({
      amountCents: 6399,
      lines: [productLine, shippingLine],
      fulfilmentStatus: 'to_pack',
      shipping: {
        rateId: 'locker', label: 'Parcel locker', amountCents: 1499, pickupPoint: shipping.pickupPoint, phone: null,
        address: { name: DELETED_MEMBER_DISPLAY, line1: DELETED_MEMBER_DISPLAY, line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
      },
    });
    const delivery = async (id: string) => (await database.db.select({ payload: emailOutbox.payload }).from(emailOutbox).where(eq(emailOutbox.id, id)))[0]?.payload;
    expect(await delivery('outbox-courier')).toMatchObject({ purchase: { totalCents: 6399, delivery: {
      method: 'Courier', pickupPoint: null,
      address: { name: DELETED_MEMBER_DISPLAY, line1: DELETED_MEMBER_DISPLAY, line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
    } } });
    expect(await delivery('outbox-locker')).toMatchObject({ purchase: { delivery: {
      method: 'Parcel locker', pickupPoint: { code: 'WAW01M', name: 'Locker WAW01M', address: 'Main Street 1, Warsaw' }, address: null,
    } } });
    expect(await delivery('outbox-other')).toMatchObject({ purchase: { delivery: { address } } });
  });

  it('pseudonymises shipment e-mail addresses only within the erased member workspace', async () => {
    const email = 'shipment-buyer@example.org';
    await database.db.insert(user).values({ id: 'shipment-buyer', email, name: 'Shipment Buyer' });
    await database.db.insert(members).values(['workspace', 'other'].map((tenantId) => ({
      id: `shipment-member-${tenantId}`, tenantId, userId: 'shipment-buyer', email, displayName: 'Shipment Buyer', createdAt: now,
    })));
    const payload = {
      kind: 'order-shipped', language: 'en', tenantName: 'Workspace',
      shipment: {
        orderNumber: 'ORDER-SHIPPED', items: ['Printed accessory'],
        delivery: { method: 'Courier', pickupPoint: null, address: shipping.address },
        carrier: 'inpost', trackingNumber: 'ABCD1234', trackingUrl: 'https://example.org/tracking/ABCD1234',
      },
    };
    await database.db.insert(emailOutbox).values(['workspace', 'other'].map((tenantId) => ({
      id: `outbox-shipment-${tenantId}`, tenantId, kind: 'order-shipped', to: ' Shipment-Buyer@Example.org ',
      nextAttemptAt: now, createdAt: now, payload,
    })));
    const stored = async (tenantId: string) => (await database.db.select().from(emailOutbox).where(eq(emailOutbox.id, `outbox-shipment-${tenantId}`)))[0];
    const otherBefore = await stored('other');
    expect(otherBefore).toBeDefined();
    const memberId = 'shipment-member-workspace';
    const tombstone = memberTombstone(memberId);
    await createMemberErasureRepository(database.db, { compute: (tenantId, value) => `${tenantId}:${value}` }).pseudonymize('workspace', {
      memberId, deletedAt: now, tombstoneEmail: tombstone.email,
      severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
    });
    expect((await stored('workspace'))?.payload).toEqual({
      ...payload,
      shipment: { ...payload.shipment, delivery: { ...payload.shipment.delivery, address: {
        ...shipping.address, name: DELETED_MEMBER_DISPLAY, line1: DELETED_MEMBER_DISPLAY, line2: null,
      } } },
    });
    expect(await stored('other')).toEqual(otherBefore);
  });

  it('erases a member whose stored delivery data has no address object without failing or keeping a street', async () => {
    await database.db.insert(user).values({ id: 'legacy-buyer', email: 'legacy@example.org', name: 'Legacy Buyer' });
    await database.db.insert(members).values({ id: 'legacy-member', tenantId: 'workspace', userId: 'legacy-buyer', email: 'legacy@example.org', displayName: 'Legacy Buyer', createdAt: now });
    const repository = createOrderRepository(database.db);
    const legacy = { memberId: 'legacy-member' };
    await repository.create('workspace', order('legacy-address-object', { ...legacy, shipping }));
    for (const id of ['legacy-null-address', 'legacy-missing-address', 'legacy-string-address', 'legacy-scalar']) {
      await repository.create('workspace', order(id, { ...legacy, shipping }));
    }
    const withoutAddress = Object.fromEntries(Object.entries(shipping).filter(([key]) => key !== 'address'));
    const rawShipping = {
      'legacy-null-address': { ...shipping, address: null },
      'legacy-missing-address': withoutAddress,
      'legacy-string-address': { ...shipping, address: 'Garden Street 5' },
      'legacy-scalar': null,
    };
    for (const [id, value] of Object.entries(rawShipping)) {
      await database.db.update(orders).set({ shipping: sql`${JSON.stringify(value)}::jsonb` }).where(eq(orders.id, id));
    }
    await createMemberErasureRepository(database.db, { compute: (tenantId, email) => `${tenantId}:${email}` }).pseudonymize('workspace', {
      memberId: 'legacy-member', deletedAt: now, tombstoneEmail: memberTombstone('legacy-member').email,
      severedUserId: memberTombstone('legacy-member').userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
    });
    const stored = async (id: string) => (await database.db.select({ shipping: sql<unknown>`${orders.shipping}` }).from(orders).where(eq(orders.id, id)))[0]?.shipping;
    expect(await stored('legacy-address-object')).toMatchObject({
      phone: null, address: { name: DELETED_MEMBER_DISPLAY, line1: DELETED_MEMBER_DISPLAY, line2: null, postalCode: '00-950' },
    });
    expect(await stored('legacy-null-address')).toEqual({ ...shipping, address: null, phone: null });
    expect(await stored('legacy-missing-address')).toEqual({ ...withoutAddress, phone: null });
    expect(await stored('legacy-string-address')).toEqual({ ...shipping, address: { name: DELETED_MEMBER_DISPLAY, line1: DELETED_MEMBER_DISPLAY, line2: null }, phone: null });
    expect(await stored('legacy-scalar')).toBeNull();
  });
});
