import { and, eq, inArray, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { decodeOrderChangeCursor, listOrderChangesQuerySchema, orderLineSchema, orderSchema, type Order, type OrderChange, type OrderChangeRead, type OrderShipping } from '#core/domain/index.js';

import { orderChanges, orderFeedEpoch } from './order-change-schema.js';
import { createOrderChangeRepository, rotateOrderFeedEpoch } from './order-changes.js';
import { createOrderFulfilmentRepository } from './order-fulfilment.js';
import { createOrderVerificationRepository } from './order-verification.js';
import { createOrderRepository, createPaymentRefundRepository } from './repositories.js';
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
let sequence = 0;

const createOrder = async (tenantId: string, extra: Partial<Order> = {}): Promise<string> => {
  sequence += 1;
  const id = `order-${String(sequence)}`;
  await createOrderRepository(database.db).create(tenantId, orderSchema.parse({
    id, tenantId, memberId: 'member', productId: 'accessory', priceId: null, kind: 'one_time', status: 'paid',
    amountCents: 4900, currency: 'PLN', provider: 'simulated', providerObjectIds: { checkoutSession: `cs-${id}` }, couponId: null,
    discountCents: 0, lines: [productLine], createdAt: now, ...extra,
  }));
  return id;
};

const changes = createOrderChangeRepository;

const changesOf = (read: OrderChangeRead): OrderChange[] => {
  if (read.kind === 'reset') throw new Error(`Unexpected feed reset to ${read.cursor}`);
  return read.changes;
};

const resetOf = (read: OrderChangeRead): string => {
  if (read.kind !== 'reset') throw new Error('Expected a feed reset');
  return read.cursor;
};

const storedEpoch = async (): Promise<string> => {
  const [row] = await database.db.select({ epoch: orderFeedEpoch.epoch }).from(orderFeedEpoch);
  if (row === undefined) throw new Error('The order feed epoch row is missing');
  return row.epoch;
};

const databaseState = async () => {
  const [row] = await database.db.select({
    epoch: orderFeedEpoch.epoch,
    rowVersion: sql<string>`xmin::text`,
    rotatedAt: orderFeedEpoch.rotatedAt,
    changes: sql<string>`(SELECT count(*) FROM order_changes)::text`,
  }).from(orderFeedEpoch);
  if (row === undefined) throw new Error('The order feed epoch row is missing');
  return row;
};

const withEpoch = (cursor: string | undefined, epoch: string): string => {
  const position = cursor === undefined ? null : decodeOrderChangeCursor(cursor);
  return `${epoch}.${position?.xactId ?? '0'}.${position?.id ?? '0'}`;
};

const listAll = async (tenantId: string, after?: string): Promise<OrderChange[]> => {
  const collected: OrderChange[] = [];
  let cursor = after;
  for (;;) {
    const page = changesOf(await changes(database.db).listOrderChanges(tenantId, { after: cursor, limit: 200 }));
    collected.push(...page);
    if (page.length < 200) return collected;
    cursor = page.at(-1)?.cursor;
  }
};

const waitFor = async (condition: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (!(await condition()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const settledCursor = async (tenantId: string): Promise<string | undefined> => {
  await waitFor(async () => {
    const [row] = await database.db
      .select({ settled: sql<boolean>`coalesce(bool_and(${orderChanges.xactId} < pg_snapshot_xmin(pg_current_snapshot())), true)` })
      .from(orderChanges)
      .where(eq(orderChanges.tenantId, tenantId));
    return row?.settled === true;
  });
  return (await listAll(tenantId)).at(-1)?.cursor;
};

const eventually = async (tenantId: string, after: string | undefined, expectedOrderIds: string[]): Promise<OrderChange[]> => {
  let page: OrderChange[] = [];
  await waitFor(async () => {
    page = await listAll(tenantId, after);
    return page.length >= expectedOrderIds.length;
  });
  expect(page.map((change) => change.orderId)).toEqual(expectedOrderIds);
  return page;
};

const withClients = async (operation: (first: pg.Client, second: pg.Client) => Promise<void>): Promise<void> => {
  const first = new pg.Client({ connectionString: database.url });
  const second = new pg.Client({ connectionString: database.url });
  await first.connect();
  await second.connect();
  try {
    await operation(first, second);
  } finally {
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
    await first.end();
    await second.end();
  }
};

const touch = (client: pg.Client, orderId: string) =>
  client.query(`UPDATE orders SET attribution = jsonb_build_object('source', $2::text) WHERE tenant_id = 'workspace' AND id = $1`, [orderId, `touch-${String(++sequence)}`]);

beforeAll(async () => {
  database = await createTestDatabase('together_order_changes', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values(['workspace', 'other', 'quiet'].map((id) => ({ id, slug: id, name: id, createdAt: now })));
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  for (const tenantId of ['workspace', 'other']) {
    await database.db.insert(members).values({ id: 'member', tenantId, userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
    await database.db.insert(products).values({ id: 'accessory', tenantId, type: 'physical', deliveryMethod: 'shipping', slug: 'accessory', title: 'Printed accessory', description: '', priceCents: 4900, currency: 'PLN', published: true, vatRate: 23, createdAt: now });
  }
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('order change log on Postgres', () => {
  it('holds back a committed change while an earlier transaction that touched an order is still open', async () => {
    const first = await createOrder('workspace');
    const second = await createOrder('workspace');
    const cursor = await settledCursor('workspace');
    await withClients(async (open, committed) => {
      await open.query('BEGIN');
      await touch(open, first);
      await committed.query('BEGIN');
      await touch(committed, second);
      await committed.query('COMMIT');

      expect(await listAll('workspace', cursor)).toEqual([]);

      await open.query('COMMIT');
    });
    await eventually('workspace', cursor, [first, second]);
  });

  it('still returns a lower-id change that commits after a higher-id change was already read', async () => {
    const lowerId = await createOrder('workspace');
    const higherId = await createOrder('workspace');
    const cursor = await settledCursor('workspace');
    let afterHigher: string | undefined;
    await withClients(async (late, early) => {
      await early.query('BEGIN');
      await early.query('SELECT pg_current_xact_id()');
      await late.query('BEGIN');
      await touch(late, lowerId);
      await touch(early, higherId);
      await early.query('COMMIT');

      const read = await eventually('workspace', cursor, [higherId]);
      afterHigher = read.at(-1)?.cursor;

      await late.query('COMMIT');
    });
    const latest = await database.db
      .select({ orderId: orderChanges.orderId, id: sql<string>`max(${orderChanges.id})::text` })
      .from(orderChanges)
      .where(and(eq(orderChanges.tenantId, 'workspace'), inArray(orderChanges.orderId, [lowerId, higherId])))
      .groupBy(orderChanges.orderId);
    const idOf = (orderId: string) => BigInt(latest.find((row) => row.orderId === orderId)?.id ?? '0');
    expect(idOf(lowerId)).toBeLessThan(idOf(higherId));

    await eventually('workspace', afterHigher, [lowerId]);
  });

  it('records every existing order write path without touching the repository methods', async () => {
    const cursor = await settledCursor('workspace');
    const physical = await createOrder('workspace', { shipping, fulfilmentStatus: 'to_pack' });
    const issued = await createOrderVerificationRepository(database.db).issueLine('workspace', { orderId: physical, productId: 'accessory', count: 1, staffUserId: 'staff', occurredAt: now });
    expect(issued.ok).toBe(true);
    const shipped = await createOrderFulfilmentRepository(database.db).ship('workspace', {
      orderId: physical, eventId: `ship-${physical}`, email: null,
      shipment: { carrier: 'other', trackingNumber: 'TRACK-0001', shippedAt: now, shippedBy: 'staff' },
    });
    expect(shipped.ok).toBe(true);
    const refunds = createPaymentRefundRepository(database.db);
    expect(await refunds.markOrderPartiallyRefunded('workspace', physical)).toMatchObject({ status: 'partially_refunded' });
    expect(await refunds.markOrderRefunded('workspace', physical)).toMatchObject({ status: 'refunded' });
    const testOrder = await createOrder('workspace', { mode: 'test', status: 'pending' });
    const pending = await createOrderRepository(database.db).findById('workspace', testOrder);
    if (pending === null) throw new Error('Pending test order was not stored');
    expect(await createOrderRepository(database.db).completeTestCheckout('workspace', { ...pending, paidAt: now })).toMatchObject({ status: 'paid' });

    const logged = await eventually('workspace', cursor, [physical, physical, physical, physical, physical, testOrder, testOrder]);
    expect(new Set(logged.map((change) => change.cursor)).size).toBe(logged.length);
  });

  it('does not log an update that leaves the order row unchanged', async () => {
    const orderId = await createOrder('workspace');
    const cursor = await settledCursor('workspace');
    await database.db.execute(sql`UPDATE orders SET status = status, lines = lines WHERE tenant_id = 'workspace' AND id = ${orderId}`);
    const later = await createOrder('workspace');
    await eventually('workspace', cursor, [later]);
  });

  it('keeps each workspace to its own changes', async () => {
    const ownCursor = await settledCursor('workspace');
    const otherCursor = await settledCursor('other');
    const foreign = await createOrder('other');
    const own = await createOrder('workspace');
    await eventually('workspace', ownCursor, [own]);
    await eventually('other', otherCursor, [foreign]);
  });

  it('pages within the limit and continues from the returned cursor', async () => {
    const cursor = await settledCursor('workspace');
    const created = [await createOrder('workspace'), await createOrder('workspace'), await createOrder('workspace')];
    await eventually('workspace', cursor, created);
    const repository = changes(database.db);
    const firstPage = changesOf(await repository.listOrderChanges('workspace', { after: cursor, limit: 2 }));
    expect(firstPage.map((change) => change.orderId)).toEqual(created.slice(0, 2));
    const secondPage = changesOf(await repository.listOrderChanges('workspace', { after: firstPage.at(-1)?.cursor, limit: 2 }));
    expect(secondPage.map((change) => change.orderId)).toEqual(created.slice(2));
    await expect(repository.listOrderChanges('workspace', { after: cursor, limit: 201 })).rejects.toThrow();
    await expect(repository.listOrderChanges('workspace', { after: cursor, limit: 0 })).rejects.toThrow();
  });
});

describe('order change feed epoch on Postgres', () => {
  it('answers a cursor of another epoch with a fresh cursor at the end of the log that then returns only later changes', async () => {
    const delivered = await createOrder('workspace');
    const tail = await settledCursor('workspace');
    const reset = resetOf(await changes(database.db).listOrderChanges('workspace', { after: withEpoch(tail, 'f'.repeat(32)), limit: 200 }));
    expect(reset).toBe(tail);
    expect(changesOf(await changes(database.db).listOrderChanges('workspace', { after: reset, limit: 200 })).map((change) => change.orderId)).not.toContain(delivered);
    const later = await createOrder('workspace');
    await eventually('workspace', reset, [later]);
  });

  it('answers a cursor the database has not reached with a fresh cursor of that workspace only and writes nothing', async () => {
    const tail = await settledCursor('workspace');
    const otherTail = await settledCursor('other');
    const before = await databaseState();
    const transaction = vi.spyOn(database.db, 'transaction');
    try {
      const forged = `${before.epoch}.18446744073709551615.0`;
      expect(resetOf(await changes(database.db).listOrderChanges('workspace', { after: forged, limit: 200 }))).toBe(withEpoch(tail, before.epoch));
      expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { accessMode: 'read only' });
    } finally {
      transaction.mockRestore();
    }
    expect(await databaseState()).toEqual(before);
    const foreign = await createOrder('other');
    await eventually('other', otherTail, [foreign]);
  });

  it('gives each workspace a fresh cursor of its own log and never one that reveals another workspace', async () => {
    const ownTail = await settledCursor('workspace');
    const foreign = await createOrder('other');
    await settledCursor('other');
    const stale = withEpoch(ownTail, 'f'.repeat(32));
    const epoch = await storedEpoch();
    expect(resetOf(await changes(database.db).listOrderChanges('workspace', { after: stale, limit: 200 }))).toBe(withEpoch(ownTail, epoch));
    expect(resetOf(await changes(database.db).listOrderChanges('quiet', { after: stale, limit: 200 }))).toBe(`${epoch}.0.0`);
    const ownFresh = resetOf(await changes(database.db).listOrderChanges('workspace', { after: stale, limit: 200 }));
    expect(changesOf(await changes(database.db).listOrderChanges('workspace', { after: ownFresh, limit: 200 })).map((change) => change.orderId)).not.toContain(foreign);
    expect(changesOf(await changes(database.db).listOrderChanges('quiet', { after: `${epoch}.0.0`, limit: 200 }))).toEqual([]);
  });

  it('rotates the epoch on demand so every earlier cursor is answered with a reset', async () => {
    const tail = await settledCursor('workspace');
    const before = await storedEpoch();
    const rotated = await rotateOrderFeedEpoch(database.db);
    expect(rotated).toMatch(/^[0-9a-f]{32}$/);
    expect(rotated).not.toBe(before);
    expect(await storedEpoch()).toBe(rotated);
    expect(resetOf(await changes(database.db).listOrderChanges('workspace', { after: tail, limit: 200 }))).toBe(withEpoch(tail, rotated));
  });
});

describe('order change query', () => {
  const epoch = '0123456789abcdef0123456789abcdef';

  it('accepts limits from 1 to 200 and opaque cursors only', () => {
    expect(listOrderChangesQuerySchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(listOrderChangesQuerySchema.safeParse({ limit: '200', after: `${epoch}.18446744073709551615.9223372036854775807` }).success).toBe(true);
    for (const limit of [0, 201, 1.5, 'many']) {
      expect(listOrderChangesQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    for (const after of ['', '12', '1.2', '-1.2', `${epoch}.01.2`, `${epoch}.1.02`, `${epoch}.1.2.3`, ` ${epoch}.1.2`, `${epoch}.18446744073709551616.1`,
      `${epoch}.1.9223372036854775808`, `${epoch.toUpperCase()}.1.2`, `${epoch.slice(1)}.1.2`, `${epoch}0.1.2`]) {
      expect(listOrderChangesQuerySchema.safeParse({ limit: 10, after }).success).toBe(false);
    }
    expect(listOrderChangesQuerySchema.safeParse({ limit: 10, before: `${epoch}.1.1` }).success).toBe(false);
  });
});
