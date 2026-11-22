import { and, asc, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { lowStockAlertFor, type StockCommitEffect } from '#core/domain/index.js';

import { products, productStock, stockEvents, stockReservations, tenants } from './schema.js';
import { createStockRepository, orderCommitLookup } from './stock.js';
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
      () => Array.from({ length: 8 }, (_, index) => repo.reserve('workspace', { checkoutSnapshotId: `snapshot-${String(index)}`, items: [{ productId, quantity: 1 }], expiresAt: later, now })),
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
    expect(await repo.reserve('workspace', { checkoutSnapshotId: 'bundle-1', items: [{ productId: available, quantity: 1 }, { productId: soldOut, quantity: 1 }, { productId: untracked, quantity: 1 }], expiresAt: later, now })).toEqual({ ok: false, error: { soldOutProductId: soldOut } });
    expect(await level(available)).toMatchObject({ reserved: 0 });
    const reserved = await repo.reserve('workspace', { checkoutSnapshotId: 'bundle-2', items: [{ productId: available, quantity: 1 }, { productId: untracked, quantity: 1 }], expiresAt: later, now });
    expect(reserved.ok && reserved.value.reservationIds).toHaveLength(1);
    expect(await reservationStatuses(untracked)).toEqual([]);
  });

  it('decrements on hand once when three commits for one snapshot race', async () => {
    const productId = await productFor('workspace', 2);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'race-commit', items: [{ productId, quantity: 1 }], expiresAt: later, now });
    const results = await withLockedRows(
      'SELECT 1 FROM stock_reservations WHERE tenant_id = $1 AND checkout_snapshot_id = $2 FOR UPDATE',
      ['workspace', 'race-commit'],
      3,
      () => Array.from({ length: 3 }, (_, index) => repo.commit('workspace', { checkoutSnapshotId: 'race-commit', orderId: `order-${String(index)}`, items: [{ productId, quantity: 1 }], now })),
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
      () => Array.from({ length: 3 }, () => repo.commit('workspace', { checkoutSnapshotId: 'legacy-snapshot', orderId: 'legacy-order', items: [{ productId, quantity: 1 }], now })),
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
      () => Array.from({ length: 3 }, () => repo.commit('workspace', { checkoutSnapshotId: null, orderId: 'snapshotless-order', items: [{ productId, quantity: 1 }], now })),
    );
    expect(results.flat().map((effect) => effect.outcome).toSorted()).toEqual(['committed_late', 'unchanged', 'unchanged']);
    expect(await repo.commit('workspace', { checkoutSnapshotId: null, orderId: 'snapshotless-order', items: [{ productId, quantity: 1 }], now })).toEqual([expect.objectContaining({ outcome: 'unchanged', onHandAfter: 2 })]);
    expect(await level(productId)).toMatchObject({ onHand: 2, reserved: 0 });
    expect(await repo.commit('workspace', { checkoutSnapshotId: null, orderId: 'another-order', items: [{ productId, quantity: 1 }], now })).toEqual([expect.objectContaining({ outcome: 'committed_late', onHandAfter: 1 })]);
    expect((await eventTypes(productId)).filter((type) => type === 'committed_late')).toHaveLength(2);
  });

  it('finishes a bundle commit and a concurrent reserve of the same products without a deadlock', async () => {
    const [unreserved, reserved] = [await productFor('workspace', 2), await productFor('workspace', 2)].toSorted();
    if (unreserved === undefined || reserved === undefined) throw new Error('Missing products');
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'lock-order-commit', items: [{ productId: reserved, quantity: 1 }], expiresAt: later, now });
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
      const reserving = track(repo.reserve('workspace', { checkoutSnapshotId: 'lock-order-reserve', items: [{ productId: reserved, quantity: 1 }, { productId: unreserved, quantity: 1 }], expiresAt: later, now }));
      await waitForLockWaiters(1);
      const committing = track(repo.commit('workspace', { checkoutSnapshotId: 'lock-order-commit', orderId: 'lock-order', items: [{ productId: unreserved, quantity: 1 }, { productId: reserved, quantity: 1 }], now }));
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
      const lookup = orderCommitLookup(database.db, 'workspace', 'product', 'order').toSQL();
      const plan = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${lookup.sql}`, lookup.params);
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
      await repo.reserve('workspace', { checkoutSnapshotId: snapshotId, items: [{ productId, quantity: 1 }], expiresAt: now, now });
      const operations: Array<() => Promise<unknown>> = [
        () => repo.releaseExpired(later, 100, 'workspace'),
        () => repo.commit('workspace', { checkoutSnapshotId: snapshotId, orderId: `order-${snapshotId}`, items: [{ productId, quantity: 1 }], now: later }),
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
    await repo.reserve('workspace', { checkoutSnapshotId: 'oversold', items: [{ productId, quantity: 1 }], expiresAt: later, now });
    expect((await repo.adjust('workspace', { productId, delta: -1, reason: 'damaged', actorUserId: 'staff', now })).ok).toBe(true);
    const [effect] = await repo.commit('workspace', { checkoutSnapshotId: 'oversold', orderId: 'order-oversold', items: [{ productId, quantity: 1 }], now });
    expect(effect).toMatchObject({ outcome: 'committed', onHandAfter: 0, reservedAfter: 0, oversold: true, lowStockThreshold: 0 });
    expect(await level(productId)).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await eventTypes(productId)).toEqual(['tracking_enabled', 'reserved', 'adjusted', 'committed', 'oversold']);
    const events = await database.db.select({ type: stockEvents.type, quantity: stockEvents.quantity }).from(stockEvents).where(eq(stockEvents.productId, productId));
    expect(events.find((event) => event.type === 'oversold')?.quantity).toBe(-1);
    expect(events.find((event) => event.type === 'committed')?.quantity).toBe(0);
  });

  it('reports the reserved count before a commit and keeps the sold-out marker until an adjustment frees a piece', async () => {
    const productId = await productFor('workspace', 3, 2);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'sold-out-held-1', items: [{ productId, quantity: 1 }], expiresAt: later, now });
    await repo.reserve('workspace', { checkoutSnapshotId: 'sold-out-held-2', items: [{ productId, quantity: 1 }], expiresAt: later, now });
    const [late] = await repo.commit('workspace', { checkoutSnapshotId: 'sold-out-late', orderId: 'order-sold-out-late', items: [{ productId, quantity: 1 }], now });
    expect(late).toMatchObject({ outcome: 'committed_late', onHandBefore: 3, reservedBefore: 2, onHandAfter: 2, reservedAfter: 2, soldOutNotifiedAt: null });
    await repo.markLowStockNotified('workspace', { productId, soldOut: true, now });
    const [held] = await repo.commit('workspace', { checkoutSnapshotId: 'sold-out-held-1', orderId: 'order-sold-out-held-1', items: [{ productId, quantity: 1 }], now });
    expect(held).toMatchObject({ outcome: 'committed', onHandBefore: 2, reservedBefore: 2, onHandAfter: 1, reservedAfter: 1, lowStockNotifiedAt: now, soldOutNotifiedAt: now });
    expect((await repo.adjust('workspace', { productId, delta: -1, reason: 'damaged', actorUserId: 'staff', now })).ok).toBe(true);
    expect((await level(productId))?.soldOutNotifiedAt).not.toBeNull();
    expect((await repo.adjust('workspace', { productId, delta: 2, reason: 'delivery', actorUserId: 'staff', now })).ok).toBe(true);
    expect(await level(productId)).toMatchObject({ onHand: 2, reserved: 1, soldOutNotifiedAt: null });
  });

  it('sends the zero alert again after the expiry sweep frees the piece that sold out', async () => {
    const productId = await productFor('workspace', 2, 1);
    const repo = createStockRepository(database.db);
    const alertAndMark = async (effect: StockCommitEffect | undefined) => {
      if (effect === undefined) throw new Error('Missing commit effect');
      const alert = lowStockAlertFor(effect);
      if (alert !== null) await repo.markLowStockNotified('workspace', { productId, soldOut: alert.soldOut, now });
      return alert;
    };
    await repo.reserve('workspace', { checkoutSnapshotId: 'zero-held', items: [{ productId, quantity: 1 }], expiresAt: '2026-11-05T09:30:00.000Z', now });
    const [first] = await repo.commit('workspace', { checkoutSnapshotId: 'zero-first', orderId: 'order-zero-first', items: [{ productId, quantity: 1 }], now });
    expect(await alertAndMark(first)).toEqual({ available: 0, oversold: false, soldOut: true });
    expect(await level(productId)).toMatchObject({ onHand: 1, reserved: 1, lowStockNotifiedAt: expect.any(String), soldOutNotifiedAt: expect.any(String) });

    expect(await repo.releaseExpired(now, 10, 'workspace')).toBe(1);
    expect(await level(productId)).toMatchObject({ onHand: 1, reserved: 0, lowStockNotifiedAt: expect.any(String), soldOutNotifiedAt: null });

    const [second] = await repo.commit('workspace', { checkoutSnapshotId: 'zero-second', orderId: 'order-zero-second', items: [{ productId, quantity: 1 }], now });
    expect(await alertAndMark(second)).toEqual({ available: 0, oversold: false, soldOut: true });
  });

  it('clears both alert markers when an explicit release lifts availability above the threshold', async () => {
    const productId = await productFor('workspace', 2, 1);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'release-a', items: [{ productId, quantity: 1 }], expiresAt: later, now });
    await repo.reserve('workspace', { checkoutSnapshotId: 'release-b', items: [{ productId, quantity: 1 }], expiresAt: later, now });
    await repo.markLowStockNotified('workspace', { productId, soldOut: true, now });
    expect(await repo.release('workspace', { checkoutSnapshotId: 'release-a', reason: 'checkout_failed', now })).toBe(1);
    expect(await level(productId)).toMatchObject({ reserved: 1, lowStockNotifiedAt: expect.any(String), soldOutNotifiedAt: null });
    expect(await repo.release('workspace', { checkoutSnapshotId: 'release-b', reason: 'checkout_failed', now })).toBe(1);
    expect(await level(productId)).toMatchObject({ reserved: 0, lowStockNotifiedAt: null, soldOutNotifiedAt: null });
  });

  it('commits late after the reservation was released and releases idempotently', async () => {
    const productId = await productFor('workspace', 2);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'late', items: [{ productId, quantity: 1 }], expiresAt: later, now });
    expect(await repo.release('workspace', { checkoutSnapshotId: 'late', reason: 'checkout_failed', now })).toBe(1);
    expect(await repo.release('workspace', { checkoutSnapshotId: 'late', reason: 'checkout_failed', now })).toBe(0);
    const [effect] = await repo.commit('workspace', { checkoutSnapshotId: 'late', orderId: 'order-late', items: [{ productId, quantity: 1 }], now });
    expect(effect).toMatchObject({ outcome: 'committed_late', onHandAfter: 1, reservedAfter: 0, oversold: false });
    expect(await repo.release('workspace', { checkoutSnapshotId: 'late', reason: 'checkout_failed', now })).toBe(0);
    expect(await level(productId)).toMatchObject({ onHand: 1, reserved: 0 });
  });

  it('lets a payment that lands after the expiry sweep pass the stock check and commit late exactly once', async () => {
    const productId = await productFor('workspace', 49);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'swept-late', items: [{ productId, quantity: 1 }], expiresAt: now, now });
    expect(await repo.releaseExpired(later, 100, 'workspace')).toBeGreaterThanOrEqual(1);
    expect(await reservationStatuses(productId)).toEqual(['released']);
    expect(await level(productId)).toMatchObject({ onHand: 49, reserved: 0 });
    expect(await repo.lockForCommit('workspace', { checkoutSnapshotId: 'swept-late', items: [{ productId, quantity: 1 }] }))
      .toEqual({ trackedProductIds: [productId], shortProductIds: [] });
    const [effect] = await repo.commit('workspace', { checkoutSnapshotId: 'swept-late', orderId: 'order-swept-late', items: [{ productId, quantity: 1 }], now: later });
    expect(effect).toMatchObject({ outcome: 'committed_late', onHandBefore: 49, onHandAfter: 48, reservedAfter: 0, oversold: false });
    expect(await repo.commit('workspace', { checkoutSnapshotId: 'swept-late', orderId: 'order-swept-late', items: [{ productId, quantity: 1 }], now: later }))
      .toEqual([expect.objectContaining({ outcome: 'unchanged', onHandAfter: 48, reservedAfter: 0 })]);
    expect(await level(productId)).toMatchObject({ onHand: 48, reserved: 0 });
    expect(await reservationStatuses(productId)).toEqual(['committed']);
    expect(await eventTypes(productId)).toEqual(['tracking_enabled', 'reserved', 'released', 'committed_late']);
  });

  it('sweeps only expired active reservations in expiry order within the batch limit', async () => {
    const productId = await productFor('workspace', 5);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'expired-1', items: [{ productId, quantity: 1 }], expiresAt: '2026-11-05T09:00:00.000Z', now });
    await repo.reserve('workspace', { checkoutSnapshotId: 'expired-2', items: [{ productId, quantity: 1 }], expiresAt: '2026-11-05T09:30:00.000Z', now });
    await repo.reserve('workspace', { checkoutSnapshotId: 'current', items: [{ productId, quantity: 1 }], expiresAt: later, now });
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
    await repo.markLowStockNotified('workspace', { productId, soldOut: false, now });
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

const reservationsOf = async (checkoutSnapshotId: string) =>
  (await database.db.select({ productId: stockReservations.productId, quantity: stockReservations.quantity, status: stockReservations.status })
    .from(stockReservations)
    .where(and(eq(stockReservations.tenantId, 'workspace'), eq(stockReservations.checkoutSnapshotId, checkoutSnapshotId)))
    .orderBy(asc(stockReservations.productId)));

const eventQuantities = async (productId: string) =>
  (await database.db.select({ type: stockEvents.type, quantity: stockEvents.quantity }).from(stockEvents)
    .where(eq(stockEvents.productId, productId))
    .orderBy(asc(stockEvents.type)))
    .filter((event) => event.type !== 'tracking_enabled');

describe('stock quantities on Postgres', () => {
  it('rolls back the whole call when one product lacks the requested quantity', async () => {
    const [enough, short] = [await productFor('workspace', 5), await productFor('workspace', 2)].toSorted();
    if (enough === undefined || short === undefined) throw new Error('Missing products');
    const repo = createStockRepository(database.db);
    expect(await repo.reserve('workspace', { checkoutSnapshotId: 'short-q3', items: [{ productId: short, quantity: 3 }, { productId: enough, quantity: 1 }], expiresAt: later, now }))
      .toEqual({ ok: false, error: { soldOutProductId: short } });
    expect(await level(enough)).toMatchObject({ onHand: 5, reserved: 0 });
    expect(await level(short)).toMatchObject({ onHand: 2, reserved: 0 });
    expect(await reservationsOf('short-q3')).toEqual([]);
    expect(await eventQuantities(enough)).toEqual([]);
    expect(await eventQuantities(short)).toEqual([]);
  });

  it('reserves each product by its own quantity and releases what each reservation holds', async () => {
    const [first, second] = [await productFor('workspace', 3), await productFor('workspace', 3)].toSorted();
    if (first === undefined || second === undefined) throw new Error('Missing products');
    const repo = createStockRepository(database.db);
    const reserved = await repo.reserve('workspace', { checkoutSnapshotId: 'mixed', items: [{ productId: second, quantity: 1 }, { productId: first, quantity: 2 }], expiresAt: later, now });
    expect(reserved.ok && reserved.value.reservationIds).toHaveLength(2);
    expect(await reservationsOf('mixed')).toEqual([
      { productId: first, quantity: 2, status: 'active' },
      { productId: second, quantity: 1, status: 'active' },
    ]);
    expect(await level(first)).toMatchObject({ onHand: 3, reserved: 2 });
    expect(await level(second)).toMatchObject({ onHand: 3, reserved: 1 });
    expect(await eventQuantities(first)).toEqual([{ type: 'reserved', quantity: 2 }]);
    expect(await repo.release('workspace', { checkoutSnapshotId: 'mixed', reason: 'checkout_failed', now })).toBe(2);
    expect(await level(first)).toMatchObject({ onHand: 3, reserved: 0 });
    expect(await level(second)).toMatchObject({ onHand: 3, reserved: 0 });
    expect(await eventQuantities(first)).toEqual([{ type: 'released', quantity: -2 }, { type: 'reserved', quantity: 2 }]);
  });

  it('merges repeated products of one call into a single reservation of the summed quantity', async () => {
    const productId = await productFor('workspace', 3);
    const repo = createStockRepository(database.db);
    const reserved = await repo.reserve('workspace', { checkoutSnapshotId: 'repeated', items: [{ productId, quantity: 1 }, { productId, quantity: 2 }], expiresAt: later, now });
    expect(reserved.ok && reserved.value.reservationIds).toHaveLength(1);
    expect(await reservationsOf('repeated')).toEqual([{ productId, quantity: 3, status: 'active' }]);
    expect(await level(productId)).toMatchObject({ onHand: 3, reserved: 3 });
  });

  it('refuses a quantity below one without touching stock', async () => {
    const productId = await productFor('workspace', 3);
    const repo = createStockRepository(database.db);
    await expect(repo.reserve('workspace', { checkoutSnapshotId: 'zero', items: [{ productId, quantity: 0 }], expiresAt: later, now })).rejects.toThrow('must be a positive integer');
    await expect(repo.commit('workspace', { checkoutSnapshotId: 'zero', orderId: 'order-zero', items: [{ productId, quantity: 1.5 }], now })).rejects.toThrow('must be a positive integer');
    expect(await level(productId)).toMatchObject({ onHand: 3, reserved: 0 });
  });

  it('commits a held quantity and releases the same amount from reserved', async () => {
    const productId = await productFor('workspace', 5);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'held-q2', items: [{ productId, quantity: 2 }], expiresAt: later, now });
    const [effect] = await repo.commit('workspace', { checkoutSnapshotId: 'held-q2', orderId: 'order-held-q2', items: [{ productId, quantity: 2 }], now });
    expect(effect).toMatchObject({ outcome: 'committed', onHandBefore: 5, reservedBefore: 2, onHandAfter: 3, reservedAfter: 0, oversold: false });
    expect(await eventQuantities(productId)).toEqual([{ type: 'committed', quantity: -2 }, { type: 'reserved', quantity: 2 }]);
  });

  it('commits the line quantity late when the snapshot never held stock', async () => {
    const productId = await productFor('workspace', 5);
    const repo = createStockRepository(database.db);
    const [effect] = await repo.commit('workspace', { checkoutSnapshotId: 'late-q3', orderId: 'order-late-q3', items: [{ productId, quantity: 3 }], now });
    expect(effect).toMatchObject({ outcome: 'committed_late', onHandBefore: 5, onHandAfter: 2, reservedAfter: 0, oversold: false });
    expect(await level(productId)).toMatchObject({ onHand: 2, reserved: 0 });
    expect(await reservationsOf('late-q3')).toEqual([{ productId, quantity: 3, status: 'committed' }]);
    expect(await eventQuantities(productId)).toEqual([{ type: 'committed_late', quantity: -3 }]);
    expect(await repo.commit('workspace', { checkoutSnapshotId: 'late-q3', orderId: 'order-late-q3', items: [{ productId, quantity: 3 }], now }))
      .toEqual([expect.objectContaining({ outcome: 'unchanged', onHandAfter: 2 })]);
  });

  it('clamps a late commit of three at zero and records the missing piece as oversold', async () => {
    const productId = await productFor('workspace', 2);
    const repo = createStockRepository(database.db);
    const [effect] = await repo.commit('workspace', { checkoutSnapshotId: null, orderId: 'order-oversold-q3', items: [{ productId, quantity: 3 }], now });
    expect(effect).toMatchObject({ outcome: 'committed_late', onHandBefore: 2, onHandAfter: 0, oversold: true });
    expect(await eventQuantities(productId)).toEqual([{ type: 'committed_late', quantity: -2 }, { type: 'oversold', quantity: -1 }]);
  });

  it('lets exactly one of two concurrent reservations of two pieces take three on hand', async () => {
    const productId = await productFor('workspace', 3);
    const repo = createStockRepository(database.db);
    const results = await withLockedRows(
      'SELECT 1 FROM product_stock WHERE tenant_id = $1 AND product_id = $2 FOR UPDATE',
      ['workspace', productId],
      2,
      () => ['pair-1', 'pair-2'].map((checkoutSnapshotId) => repo.reserve('workspace', { checkoutSnapshotId, items: [{ productId, quantity: 2 }], expiresAt: later, now })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { soldOutProductId: productId } }]);
    expect(await level(productId)).toMatchObject({ onHand: 3, reserved: 2 });
    expect(await eventQuantities(productId)).toEqual([{ type: 'reserved', quantity: 2 }]);
  });
  it('reports late lines that no longer fit and leaves lines held by the snapshot itself alone, without writing anything', async () => {
    const held = await productFor('workspace', 1);
    const released = await productFor('workspace', 1);
    const unreserved = await productFor('workspace', 2);
    const untracked = await productFor('workspace', null);
    const repo = createStockRepository(database.db);
    await repo.reserve('workspace', { checkoutSnapshotId: 'check-own', items: [{ productId: released, quantity: 1 }], expiresAt: later, now });
    await repo.release('workspace', { checkoutSnapshotId: 'check-own', reason: 'expired', now });
    await repo.reserve('workspace', { checkoutSnapshotId: 'check-own-held', items: [{ productId: held, quantity: 1 }], expiresAt: later, now });
    expect((await repo.adjust('workspace', { productId: held, delta: -1, reason: 'damaged', actorUserId: 'staff', now })).ok).toBe(true);
    expect((await repo.adjust('workspace', { productId: released, delta: -1, reason: 'damaged', actorUserId: 'staff', now })).ok).toBe(true);
    await repo.reserve('workspace', { checkoutSnapshotId: 'check-other', items: [{ productId: unreserved, quantity: 1 }], expiresAt: later, now });
    const before = await Promise.all([held, released, unreserved].map(eventTypes));

    expect(await repo.lockForCommit('workspace', { checkoutSnapshotId: 'check-own-held', items: [{ productId: held, quantity: 1 }, { productId: untracked, quantity: 1 }] }))
      .toEqual({ trackedProductIds: [held], shortProductIds: [] });
    expect(await repo.lockForCommit('workspace', { checkoutSnapshotId: 'check-own', items: [{ productId: released, quantity: 1 }, { productId: unreserved, quantity: 1 }] }))
      .toEqual({ trackedProductIds: [released, unreserved].sort(), shortProductIds: [released] });
    expect(await repo.lockForCommit('workspace', { checkoutSnapshotId: null, items: [{ productId: unreserved, quantity: 2 }] }))
      .toEqual({ trackedProductIds: [unreserved], shortProductIds: [unreserved] });
    expect(await repo.lockForCommit('workspace', { checkoutSnapshotId: null, items: [{ productId: unreserved, quantity: 1 }] }))
      .toEqual({ trackedProductIds: [unreserved], shortProductIds: [] });
    expect(await repo.lockForCommit('other', { checkoutSnapshotId: null, items: [{ productId: unreserved, quantity: 5 }] }))
      .toEqual({ trackedProductIds: [], shortProductIds: [] });

    expect(await Promise.all([held, released, unreserved].map(eventTypes))).toEqual(before);
    expect(await level(released)).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await level(unreserved)).toMatchObject({ onHand: 2, reserved: 1 });
  });

  it('holds the stock rows it checked until the surrounding transaction ends', async () => {
    const productId = await productFor('workspace', 1);
    const repo = createStockRepository(database.db);
    const observer = new pg.Client({ connectionString: database.url });
    await observer.connect();
    try {
      let release = (): void => undefined;
      let locked = (): void => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
      const checking = database.db.transaction(async (tx) => {
        const checked = await createStockRepository(tx).lockForCommit('workspace', { checkoutSnapshotId: null, items: [{ productId, quantity: 1 }] });
        locked();
        await gate;
        return checked;
      });
      await lockTaken;
      let adjusted = false;
      const adjusting = repo.adjust('workspace', { productId, delta: -1, reason: 'damaged', actorUserId: 'staff', now }).finally(() => { adjusted = true; });
      for (;;) {
        const waiting = await observer.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if ((waiting.rows[0]?.count ?? 0) >= 1) break;
      }
      expect(adjusted).toBe(false);
      release();
      expect(await checking).toEqual({ trackedProductIds: [productId], shortProductIds: [] });
      expect((await adjusting).ok).toBe(true);
    } finally {
      await observer.end();
    }
  });
});
