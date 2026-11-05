import { and, asc, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { products, productStock, stockEvents, stockReservations, tenants } from './schema.js';
import { createStockRepository } from './stock.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-11-05T10:00:00.000Z';
const later = '2026-11-05T10:35:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;

const productFor = async (tenantId: string, onHand: number | null, lowStockThreshold: number | null = null): Promise<string> => {
  sequence += 1;
  const id = `product-${String(sequence)}`;
  await database.db.insert(products).values({ id, tenantId, type: 'physical', description: '', slug: id, title: `Printed item ${String(sequence)}`, priceCents: 1000, currency: 'PLN', published: true, vatRate: 5, createdAt: now });
  if (onHand !== null) {
    const enabled = await createStockRepository(database.db).enableTracking(tenantId, { productId: id, onHand, lowStockThreshold, actorUserId: 'staff', now });
    if (!enabled.ok) throw new Error(enabled.error.message);
  }
  return id;
};

const level = async (productId: string) => {
  const [row] = await database.db.select().from(productStock).where(and(eq(productStock.tenantId, 'workspace'), eq(productStock.productId, productId)));
  return row;
};

const eventTypes = async (productId: string) =>
  (await database.db.select({ type: stockEvents.type }).from(stockEvents).where(eq(stockEvents.productId, productId)).orderBy(asc(stockEvents.occurredAt))).map((row) => row.type);

const reservationStatuses = async (productId: string) =>
  (await database.db.select({ status: stockReservations.status }).from(stockReservations).where(eq(stockReservations.productId, productId))).map((row) => row.status);

const withLockedRows = async <T>(lockSql: string, parameters: unknown[], waiters: number, operations: () => Promise<T>[]): Promise<T[]> => {
  const blocker = new pg.Client({ connectionString: database.url });
  const observer = new pg.Client({ connectionString: database.url });
  await blocker.connect();
  await observer.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query(lockSql, parameters);
    let finished = false;
    const pending = Promise.allSettled(operations()).finally(() => { finished = true; });
    while (!finished) {
      const waiting = await observer.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      );
      if ((waiting.rows[0]?.count ?? 0) >= waiters) break;
    }
    expect(finished).toBe(false);
    await blocker.query('COMMIT');
    const settled = await pending;
    return settled.map((outcome) => {
      if (outcome.status === 'rejected') throw outcome.reason;
      return outcome.value;
    });
  } finally {
    await blocker.end();
    await observer.end();
  }
};

beforeAll(async () => {
  database = await createTestDatabase('together_stock', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now },
    { id: 'other', slug: 'other', name: 'Other workspace', createdAt: now },
  ]);
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(() => { sequence += 100; });

describe('stock repository on Postgres', () => {
  it('lets exactly one of eight concurrent reservations take the last piece', async () => {
    const productId = await productFor('workspace', 1);
    const repo = createStockRepository(database.db);
    const results = await withLockedRows(
      'SELECT 1 FROM product_stock WHERE tenant_id = $1 AND product_id = $2 FOR UPDATE',
      ['workspace', productId],
      8,
      () => Array.from({ length: 8 }, (_, index) => repo.reserve('workspace', { checkoutSnapshotId: `snapshot-${String(index)}`, productIds: [productId], expiresAt: later, quantity: 1, now })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(Array.from({ length: 7 }, () => ({ ok: false, error: { soldOutProductId: productId } })));
    expect(await level(productId)).toMatchObject({ onHand: 1, reserved: 1 });
    expect(await reservationStatuses(productId)).toEqual(['active']);
    expect((await eventTypes(productId)).filter((type) => type === 'reserved')).toHaveLength(1);
  });

  it('rolls back every reservation of a bundle when one tracked product is sold out and skips untracked products', async () => {
    const available = await productFor('workspace', 3);
    const soldOut = await productFor('workspace', 0);
    const untracked = await productFor('workspace', null);
    const repo = createStockRepository(database.db);
    expect(await repo.reserve('workspace', { checkoutSnapshotId: 'bundle-1', productIds: [available, soldOut, untracked], expiresAt: later, quantity: 1, now })).toEqual({ ok: false, error: { soldOutProductId: soldOut } });
    expect(await level(available)).toMatchObject({ reserved: 0 });
    const reserved = await repo.reserve('workspace', { checkoutSnapshotId: 'bundle-2', productIds: [available, untracked], expiresAt: later, quantity: 1, now });
    expect(reserved.ok && reserved.value.reservationIds).toHaveLength(1);
    expect(await reservationStatuses(untracked)).toEqual([]);
  });

  it('decrements on hand once when three commits for one snapshot race', async () => {
    const productId = await productFor('workspace', 2);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'race-commit', productIds: [productId], expiresAt: later, quantity: 1, now });
    const results = await withLockedRows(
      'SELECT 1 FROM stock_reservations WHERE tenant_id = $1 AND checkout_snapshot_id = $2 FOR UPDATE',
      ['workspace', 'race-commit'],
      3,
      () => Array.from({ length: 3 }, (_, index) => repo.commit('workspace', { checkoutSnapshotId: 'race-commit', orderId: `order-${String(index)}`, productIds: [productId], now })),
    );
    expect(results.flat().map((effect) => effect.outcome).toSorted()).toEqual(['committed', 'unchanged', 'unchanged']);
    expect(await level(productId)).toMatchObject({ onHand: 1, reserved: 0 });
    expect(await reservationStatuses(productId)).toEqual(['committed']);
    expect((await eventTypes(productId)).filter((type) => type === 'committed')).toHaveLength(1);
  });

  it('records one late commit when concurrent commits find no reservation for a tracked product', async () => {
    const productId = await productFor('workspace', 2);
    const repo = createStockRepository(database.db);
    const results = await withLockedRows(
      'SELECT 1 FROM product_stock WHERE tenant_id = $1 AND product_id = $2 FOR UPDATE',
      ['workspace', productId],
      3,
      () => Array.from({ length: 3 }, () => repo.commit('workspace', { checkoutSnapshotId: 'legacy-snapshot', orderId: 'legacy-order', productIds: [productId], now })),
    );
    expect(results.flat().map((effect) => effect.outcome).toSorted()).toEqual(['committed_late', 'unchanged', 'unchanged']);
    expect(await level(productId)).toMatchObject({ onHand: 1, reserved: 0 });
    expect((await eventTypes(productId)).filter((type) => type === 'committed_late')).toHaveLength(1);
  });

  it('decrements once when a commit without a snapshot is applied three times for one order', async () => {
    const productId = await productFor('workspace', 3);
    const repo = createStockRepository(database.db);
    const results = await withLockedRows(
      'SELECT 1 FROM product_stock WHERE tenant_id = $1 AND product_id = $2 FOR UPDATE',
      ['workspace', productId],
      3,
      () => Array.from({ length: 3 }, () => repo.commit('workspace', { checkoutSnapshotId: null, orderId: 'snapshotless-order', productIds: [productId], now })),
    );
    expect(results.flat().map((effect) => effect.outcome).toSorted()).toEqual(['committed_late', 'unchanged', 'unchanged']);
    expect(await repo.commit('workspace', { checkoutSnapshotId: null, orderId: 'snapshotless-order', productIds: [productId], now })).toEqual([expect.objectContaining({ outcome: 'unchanged', onHandAfter: 2 })]);
    expect(await level(productId)).toMatchObject({ onHand: 2, reserved: 0 });
    expect(await repo.commit('workspace', { checkoutSnapshotId: null, orderId: 'another-order', productIds: [productId], now })).toEqual([expect.objectContaining({ outcome: 'committed_late', onHandAfter: 1 })]);
    expect((await eventTypes(productId)).filter((type) => type === 'committed_late')).toHaveLength(2);
  });

  it('finishes a bundle commit and a concurrent reserve of the same products without a deadlock', async () => {
    const [unreserved, reserved] = [await productFor('workspace', 2), await productFor('workspace', 2)].toSorted();
    if (unreserved === undefined || reserved === undefined) throw new Error('Missing products');
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'lock-order-commit', productIds: [reserved], expiresAt: later, quantity: 1, now });
    const blocker = new pg.Client({ connectionString: database.url });
    const observer = new pg.Client({ connectionString: database.url });
    await blocker.connect();
    await observer.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        "INSERT INTO stock_reservations (tenant_id, product_id, checkout_snapshot_id, quantity, status, expires_at, created_at, updated_at) VALUES ($1, $2, $3, 1, 'active', $4, $4, $4)",
        ['workspace', unreserved, 'lock-order-reserve', later],
      );
      let settledCount = 0;
      const track = <T>(operation: Promise<T>) => Promise.allSettled([operation]).finally(() => { settledCount += 1; });
      const waitForLockWaiters = async (waiters: number) => {
        for (;;) {
          expect(settledCount).toBe(0);
          const waiting = await observer.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
          );
          if ((waiting.rows[0]?.count ?? 0) >= waiters) return;
        }
      };
      const reserving = track(repo.reserve('workspace', { checkoutSnapshotId: 'lock-order-reserve', productIds: [reserved, unreserved], expiresAt: later, quantity: 1, now }));
      await waitForLockWaiters(1);
      const committing = track(repo.commit('workspace', { checkoutSnapshotId: 'lock-order-commit', orderId: 'lock-order', productIds: [unreserved, reserved], now }));
      await waitForLockWaiters(2);
      await blocker.query('ROLLBACK');
      const [[reserveOutcome], [commitOutcome]] = await Promise.all([reserving, committing]);
      expect(reserveOutcome).toEqual({ status: 'fulfilled', value: { ok: true, value: { reservationIds: [expect.any(String), expect.any(String)] } } });
      expect(commitOutcome).toEqual({ status: 'fulfilled', value: expect.any(Array) });
      if (commitOutcome?.status === 'fulfilled') {
        expect(commitOutcome.value.map((effect) => [effect.productId, effect.outcome]).toSorted()).toEqual([[reserved, 'committed'], [unreserved, 'committed_late']].toSorted());
      }
      expect(await level(reserved)).toMatchObject({ onHand: 1, reserved: 1 });
      expect(await level(unreserved)).toMatchObject({ onHand: 1, reserved: 1 });
    } finally {
      await blocker.end();
      await observer.end();
    }
  });

  it('lets the order lookup of a commit without a snapshot use its partial index', async () => {
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        "EXPLAIN SELECT id FROM stock_events WHERE tenant_id = $1 AND product_id = $2 AND type IN ('committed', 'committed_late') AND (reference ->> 'orderId') = $3 LIMIT 1",
        ['workspace', 'product', 'order'],
      );
      expect(plan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain('stock_events_tenant_product_order_commit_idx');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('ends committed or released but never both when the expiry sweep races a commit', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const productId = await productFor('workspace', 1);
      const snapshotId = `sweep-race-${String(attempt)}`;
      const repo = createStockRepository(database.db);
      await repo.reserve('workspace', { checkoutSnapshotId: snapshotId, productIds: [productId], expiresAt: now, quantity: 1, now });
      const operations: Array<() => Promise<unknown>> = [
        () => repo.releaseExpired(later, 100, 'workspace'),
        () => repo.commit('workspace', { checkoutSnapshotId: snapshotId, orderId: `order-${snapshotId}`, productIds: [productId], now: later }),
      ];
      await withLockedRows(
        'SELECT 1 FROM stock_reservations WHERE tenant_id = $1 AND checkout_snapshot_id = $2 FOR UPDATE',
        ['workspace', snapshotId],
        2,
        () => (attempt % 2 === 0 ? operations : operations.toReversed()).map((operation) => operation()),
      );
      const stored = await level(productId);
      expect(stored).toMatchObject({ onHand: 0, reserved: 0 });
      expect(await reservationStatuses(productId)).toEqual(['committed']);
      const types = await eventTypes(productId);
      expect(types.filter((type) => type === 'committed' || type === 'committed_late')).toHaveLength(1);
      expect(types.includes('committed_late')).toBe(types.includes('released'));
    }
  });

  it('clamps an oversold commit at zero and records the shortfall', async () => {
    const productId = await productFor('workspace', 1, 0);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'oversold', productIds: [productId], expiresAt: later, quantity: 1, now });
    expect((await repo.adjust('workspace', { productId, delta: -1, reason: 'damaged', actorUserId: 'staff', now })).ok).toBe(true);
    const [effect] = await repo.commit('workspace', { checkoutSnapshotId: 'oversold', orderId: 'order-oversold', productIds: [productId], now });
    expect(effect).toMatchObject({ outcome: 'committed', onHandAfter: 0, reservedAfter: 0, oversold: true, lowStockThreshold: 0 });
    expect(await level(productId)).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await eventTypes(productId)).toEqual(['tracking_enabled', 'reserved', 'adjusted', 'committed', 'oversold']);
    const events = await database.db.select({ type: stockEvents.type, quantity: stockEvents.quantity }).from(stockEvents).where(eq(stockEvents.productId, productId));
    expect(events.find((event) => event.type === 'oversold')?.quantity).toBe(-1);
    expect(events.find((event) => event.type === 'committed')?.quantity).toBe(0);
  });

  it('commits late after the reservation was released and releases idempotently', async () => {
    const productId = await productFor('workspace', 2);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'late', productIds: [productId], expiresAt: later, quantity: 1, now });
    expect(await repo.release('workspace', { checkoutSnapshotId: 'late', reason: 'checkout_failed', now })).toBe(1);
    expect(await repo.release('workspace', { checkoutSnapshotId: 'late', reason: 'checkout_failed', now })).toBe(0);
    const [effect] = await repo.commit('workspace', { checkoutSnapshotId: 'late', orderId: 'order-late', productIds: [productId], now });
    expect(effect).toMatchObject({ outcome: 'committed_late', onHandAfter: 1, reservedAfter: 0, oversold: false });
    expect(await repo.release('workspace', { checkoutSnapshotId: 'late', reason: 'checkout_failed', now })).toBe(0);
    expect(await level(productId)).toMatchObject({ onHand: 1, reserved: 0 });
  });

  it('sweeps only expired active reservations in expiry order within the batch limit', async () => {
    const productId = await productFor('workspace', 5);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'expired-1', productIds: [productId], expiresAt: '2026-11-05T09:00:00.000Z', quantity: 1, now });
    await repo.reserve('workspace', { checkoutSnapshotId: 'expired-2', productIds: [productId], expiresAt: '2026-11-05T09:30:00.000Z', quantity: 1, now });
    await repo.reserve('workspace', { checkoutSnapshotId: 'current', productIds: [productId], expiresAt: later, quantity: 1, now });
    expect(await repo.releaseExpired(now, 1, 'workspace')).toBe(1);
    expect(await repo.releaseExpired(now, 10, 'workspace')).toBe(1);
    expect(await repo.releaseExpired(now, 10, 'workspace')).toBe(0);
    const rows = await database.db.select({ snapshot: stockReservations.checkoutSnapshotId, status: stockReservations.status }).from(stockReservations).where(eq(stockReservations.productId, productId));
    expect(Object.fromEntries(rows.map((row) => [row.snapshot, row.status]))).toEqual({ 'expired-1': 'released', 'expired-2': 'released', current: 'active' });
    expect(await level(productId)).toMatchObject({ onHand: 5, reserved: 1 });
  });

  it('resets the low-stock notification when availability rises above the threshold and keeps tenants apart', async () => {
    const productId = await productFor('workspace', 2, 2);
    const repo = createStockRepository(database.db);
    await repo.markLowStockNotified('workspace', { productId, now });
    expect((await repo.find('workspace', productId))?.lowStockNotifiedAt).toBe(now);
    await repo.adjust('workspace', { productId, delta: 1, reason: 'delivery', actorUserId: 'staff', now });
    expect((await repo.find('workspace', productId))?.lowStockNotifiedAt).toBeNull();
    expect(await repo.find('other', productId)).toBeNull();
    expect(await repo.listByProducts('other', [productId])).toEqual([]);
    expect(await repo.listByTenant('other')).toEqual([]);
    expect((await repo.listByTenant('workspace')).map((stored) => stored.productId)).toContain(productId);
    expect((await repo.adjust('other', { productId, delta: 1, reason: 'delivery', actorUserId: 'staff', now })).ok).toBe(false);
    expect((await repo.enableTracking('workspace', { productId, onHand: 1, lowStockThreshold: null, actorUserId: 'staff', now }))).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect((await repo.adjust('workspace', { productId, delta: -10, reason: 'count', actorUserId: 'staff', now }))).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect((await repo.adjust('workspace', { productId, delta: 1, reason: 'returned', actorUserId: 'staff', now })).ok).toBe(true);
    expect(await eventTypes(productId)).toEqual(['tracking_enabled', 'adjusted', 'returned']);
  });

  it('refuses tracking and adjustments above the stock cap', async () => {
    const productId = await productFor('workspace', 999_999);
    const untracked = await productFor('workspace', null);
    const repo = createStockRepository(database.db);
    expect(await repo.adjust('workspace', { productId, delta: 2, reason: 'count', actorUserId: 'staff', now })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await repo.adjust('workspace', { productId, delta: 1, reason: 'count', actorUserId: 'staff', now })).toMatchObject({ ok: true, value: { onHand: 1_000_000 } });
    expect(await repo.enableTracking('workspace', { productId: untracked, onHand: 1_000_001, lowStockThreshold: null, actorUserId: 'staff', now })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await repo.enableTracking('workspace', { productId: untracked, onHand: 1, lowStockThreshold: 1_000_001, actorUserId: 'staff', now })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await repo.find('workspace', untracked)).toBeNull();
  });
});
