import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decodeOrderChangeCursor, orderLineSchema, orderSchema, type Identity, type Order, type OrderChangeFeed, type OrderShipping } from '#core/domain/index.js';
import { listOrderChangeFeed, type OrderChangeFeedDeps } from '#core/server/index.js';

import { waitForSettledOrderChanges } from './order-change-feed-test-helpers.js';
import { createOrderChangeRepository } from './order-changes.js';
import { createOrderFulfilmentRepository } from './order-fulfilment.js';
import { createOrderRepository } from './repositories.js';
import { members, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-11-16T12:00:00.000Z';
const productLine = orderLineSchema.parse({ productId: 'accessory', name: 'Printed accessory', productType: 'physical', grossCents: 4900, netCents: 3984, vatCents: 916, vatRate: 23, vatExemptionBasis: null, issuedCount: 0 });
const shipping: OrderShipping = {
  rateId: 'courier', label: 'Courier', amountCents: 0, vatRatePercent: 23, carrier: 'other', pickupPoint: null,
  address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: '+48600100200',
};
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: OrderChangeFeedDeps;
let sequence = 0;

const staff = (tenantId: string): Identity => ({
  userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null, tenantAccess: 'staff', tenantId,
  tenantSlug: tenantId, tenantName: tenantId, staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null,
  memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const createOrder = async (tenantId: string, extra: Partial<Order> = {}): Promise<string> => {
  sequence += 1;
  const id = `feed-order-${String(sequence)}`;
  await createOrderRepository(database.db).create(tenantId, orderSchema.parse({
    id, tenantId, memberId: 'member', productId: 'accessory', priceId: null, kind: 'one_time', status: 'paid', paidAt: now,
    amountCents: 4900, currency: 'PLN', provider: 'simulated', providerObjectIds: { checkoutSession: `cs-${id}` }, couponId: null,
    discountCents: 0, lines: [productLine], shipping, fulfilmentStatus: 'to_pack', createdAt: now, ...extra,
  }));
  return id;
};

const feed = async (tenantId: string, query: Record<string, unknown>): Promise<OrderChangeFeed> => {
  const result = await listOrderChangeFeed({ identity: staff(tenantId) }, query, deps);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const feedUntil = async (
  tenantId: string,
  query: Record<string, unknown>,
  done: (page: OrderChangeFeed) => boolean,
): Promise<OrderChangeFeed> => {
  const deadline = Date.now() + 15_000;
  let page = await feed(tenantId, query);
  while (!done(page) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    page = await feed(tenantId, query);
  }
  return page;
};

const drained = async (tenantId: string, mode?: 'live' | 'test'): Promise<string | null> => {
  const marker = await createOrder(tenantId, mode === undefined ? {} : { mode });
  let after: string | null = null;
  for (;;) {
    const page = await feedUntil(tenantId, { ...(after === null ? {} : { after }), ...(mode === undefined ? {} : { mode }), limit: 200 },
      (candidate) => candidate.changes.length > 0);
    if (page.changes.length === 0) throw new Error('The marker order never reached the feed');
    after = page.nextCursor;
    if (page.changes.some((change) => change.order.id === marker)) return after;
  }
};

const ids = (page: OrderChangeFeed): string[] => page.changes.map((change) => change.order.id);

const position = (cursor: string) => {
  const decoded = decodeOrderChangeCursor(cursor);
  if (decoded === null) throw new Error(`Unexpected cursor ${cursor}`);
  return [BigInt(decoded.xactId), BigInt(decoded.id)] as const;
};

const isAfter = (later: string, earlier: string): boolean => {
  const [laterXact, laterId] = position(later);
  const [earlierXact, earlierId] = position(earlier);
  return laterXact > earlierXact || (laterXact === earlierXact && laterId > earlierId);
};

beforeAll(async () => {
  database = await createTestDatabase('together_order_change_feed', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  deps = { changes: createOrderChangeRepository(database.db), orders: createOrderRepository(database.db) };
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: now })));
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  for (const tenantId of ['workspace', 'other']) {
    await database.db.insert(members).values({ id: 'member', tenantId, userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
    await database.db.insert(products).values({ id: 'accessory', tenantId, type: 'physical', deliveryMethod: 'shipping', slug: 'accessory', title: 'Printed accessory', description: '', priceCents: 4900, currency: 'PLN', published: true, vatRate: 23, createdAt: now });
  }
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('order change feed on Postgres', () => {
  it('returns a shipped order again, in its shipped state, at a larger cursor', async () => {
    const start = await drained('workspace');
    const orderId = await createOrder('workspace');
    const created = await feedUntil('workspace', { after: start }, (page) => ids(page).includes(orderId));
    const firstCursor = created.changes.find((change) => change.order.id === orderId)?.cursor;
    if (firstCursor === undefined) throw new Error('The new order was not in the feed');
    expect(created.changes.find((change) => change.order.id === orderId)?.order).toMatchObject({ status: 'paid', fulfilmentStatus: 'to_pack', memberEmail: 'buyer@example.org', productTitle: 'Printed accessory', invoice: null });

    const shipped = await createOrderFulfilmentRepository(database.db).ship('workspace', {
      orderId, eventId: `ship-${orderId}`, email: null,
      shipment: { carrier: 'other', trackingNumber: 'TRACK-0001', shippedAt: now, shippedBy: 'staff' },
    });
    expect(shipped.ok).toBe(true);

    const later = await feedUntil('workspace', { after: created.nextCursor }, (page) => ids(page).includes(orderId));
    const change = later.changes.find((entry) => entry.order.id === orderId);
    expect(change?.order).toMatchObject({ fulfilmentStatus: 'shipped', shipment: { trackingNumber: 'TRACK-0001' } });
    expect(change === undefined ? false : isAfter(change.cursor, firstCursor)).toBe(true);
  });

  it('returns an order changed several times within a page once, at its latest cursor', async () => {
    const start = await drained('workspace');
    const orderId = await createOrder('workspace');
    const other = await createOrder('workspace');
    await createOrderFulfilmentRepository(database.db).ship('workspace', {
      orderId, eventId: `ship-${orderId}`, email: null,
      shipment: { carrier: 'other', trackingNumber: 'TRACK-0002', shippedAt: now, shippedBy: 'staff' },
    });
    await waitForSettledOrderChanges(database.db, 'workspace');
    const page = await feed('workspace', { after: start });
    expect(ids(page)).toEqual([other, orderId]);
    expect(page.changes[1]?.order.fulfilmentStatus).toBe('shipped');
    expect(page.nextCursor).toBe(page.changes[1]?.cursor);
  });

  it('leaves test orders out of the live feed and live orders out of the test feed', async () => {
    const liveStart = await drained('workspace', 'live');
    const testStart = await drained('workspace', 'test');
    const testOrder = await createOrder('workspace', { mode: 'test' });
    const liveOrder = await createOrder('workspace', { mode: 'live' });
    const live = await feedUntil('workspace', { after: liveStart, mode: 'live' }, (page) => ids(page).includes(liveOrder));
    expect(ids(live)).toEqual([liveOrder]);
    const test = await feedUntil('workspace', { after: testStart, mode: 'test' }, (page) => ids(page).includes(testOrder));
    expect(ids(test)).toEqual([testOrder]);
  });

  it('never returns another workspace\'s orders', async () => {
    const start = await drained('workspace');
    const foreign = await createOrder('other');
    const own = await createOrder('workspace');
    const page = await feedUntil('workspace', { after: start }, (candidate) => ids(candidate).includes(own));
    expect(ids(page)).toEqual([own]);
    expect(ids(page)).not.toContain(foreign);
    const everything = await feed('workspace', { limit: 200 });
    expect(everything.changes.every((change) => change.order.tenantId === 'workspace')).toBe(true);
  });

  it('returns at most limit changes and continues from the returned cursor', async () => {
    const start = await drained('workspace');
    const created = [await createOrder('workspace'), await createOrder('workspace'), await createOrder('workspace')];
    await feedUntil('workspace', { after: start, limit: 200 }, (page) => ids(page).length === 3);
    const first = await feed('workspace', { after: start, limit: 2 });
    expect(ids(first)).toEqual(created.slice(0, 2));
    const second = await feed('workspace', { after: first.nextCursor, limit: '2' });
    expect(ids(second)).toEqual(created.slice(2));
    const empty = await feed('workspace', { after: second.nextCursor, limit: 2 });
    expect(empty).toEqual({ changes: [], nextCursor: second.nextCursor });
  });
});
