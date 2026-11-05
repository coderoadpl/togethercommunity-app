import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import { appError, err, MAX_STOCK_QUANTITY, notFound, ok, stockAdjustmentEventType, validation, type StockCommitEffect, type StockEventType, type StockLevel } from '#core/domain/index.js';
import type { StockRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { productStock, stockEvents, stockReservations, type StockEventReference } from './stock-schema.js';

type StockRow = typeof productStock.$inferSelect;
type Executor = Parameters<Parameters<Db['transaction']>[0]>[0];

class SoldOutRollback extends Error {
  constructor(readonly productId: string) {
    super(`Product ${productId} is sold out`);
  }
}

const iso = (value: string): string => new Date(value).toISOString();

const isoOrNull = (value: string | null): string | null => value === null ? null : iso(value);

const toLevel = (row: StockRow): StockLevel => ({
  productId: row.productId,
  onHand: row.onHand,
  reserved: row.reserved,
  lowStockThreshold: row.lowStockThreshold,
  lowStockNotifiedAt: isoOrNull(row.lowStockNotifiedAt),
  updatedAt: iso(row.updatedAt),
});

const notTracked = () => notFound('Stock tracking is not enabled for this product');

const aboveStockCap = () => validation(`Stock quantities cannot exceed ${String(MAX_STOCK_QUANTITY)}`);

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

const stockKey = (tenantId: string, productId: string) => and(eq(productStock.tenantId, tenantId), eq(productStock.productId, productId));

const lockStock = async (tx: Executor, tenantId: string, productId: string): Promise<StockRow | null> => {
  const [row] = await tx.select().from(productStock).where(stockKey(tenantId, productId)).for('update');
  return row ?? null;
};

const appendEvent = async (
  tx: Executor,
  tenantId: string,
  event: { productId: string; type: StockEventType; quantity: number; reference: StockEventReference; actorUserId?: string | null; occurredAt: string },
): Promise<void> => {
  await tx.insert(stockEvents).values({ tenantId, ...event, actorUserId: event.actorUserId ?? null });
};

const releaseReservation = async (tx: Executor, tenantId: string, reservationId: string, reason: string, now: string): Promise<number> => {
  const [released] = await tx.update(stockReservations)
    .set({ status: 'released', updatedAt: now })
    .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.id, reservationId), eq(stockReservations.status, 'active')))
    .returning({ productId: stockReservations.productId, quantity: stockReservations.quantity, checkoutSnapshotId: stockReservations.checkoutSnapshotId });
  if (released === undefined) return 0;
  await tx.update(productStock)
    .set({ reserved: sql`greatest(${productStock.reserved} - ${released.quantity}, 0)`, updatedAt: now })
    .where(stockKey(tenantId, released.productId));
  await appendEvent(tx, tenantId, {
    productId: released.productId,
    type: 'released',
    quantity: -released.quantity,
    reference: { checkoutSnapshotId: released.checkoutSnapshotId, reservationId, reason },
    occurredAt: now,
  });
  return 1;
};

const applyCommit = async (
  tx: Executor,
  tenantId: string,
  input: {
    productId: string;
    quantity: number;
    releaseReserved: boolean;
    outcome: 'committed' | 'committed_late';
    reference: StockEventReference;
    now: string;
  },
): Promise<StockCommitEffect | null> => {
  const current = await lockStock(tx, tenantId, input.productId);
  if (current === null) return null;
  const onHandAfter = Math.max(current.onHand - input.quantity, 0);
  const shortfall = input.quantity - (current.onHand - onHandAfter);
  const reservedAfter = input.releaseReserved ? Math.max(current.reserved - input.quantity, 0) : current.reserved;
  await tx.update(productStock)
    .set({ onHand: onHandAfter, reserved: reservedAfter, updatedAt: input.now })
    .where(stockKey(tenantId, input.productId));
  await appendEvent(tx, tenantId, {
    productId: input.productId,
    type: input.outcome,
    quantity: onHandAfter - current.onHand,
    reference: input.reference,
    occurredAt: input.now,
  });
  if (shortfall > 0) {
    await appendEvent(tx, tenantId, {
      productId: input.productId,
      type: 'oversold',
      quantity: -shortfall,
      reference: input.reference,
      occurredAt: input.now,
    });
  }
  return {
    productId: input.productId,
    outcome: input.outcome,
    onHandBefore: current.onHand,
    reservedBefore: current.reserved,
    onHandAfter,
    reservedAfter,
    lowStockThreshold: current.lowStockThreshold,
    lowStockNotifiedAt: isoOrNull(current.lowStockNotifiedAt),
    soldOutNotifiedAt: isoOrNull(current.soldOutNotifiedAt),
    oversold: shortfall > 0,
  };
};

const orderAlreadyCommitted = async (tx: Executor, tenantId: string, productId: string, orderId: string): Promise<boolean> => {
  const [row] = await tx.select({ id: stockEvents.id }).from(stockEvents)
    .where(and(
      eq(stockEvents.tenantId, tenantId),
      eq(stockEvents.productId, productId),
      sql`${stockEvents.type} IN ('committed', 'committed_late')`,
      sql`(${stockEvents.reference} ->> 'orderId') = ${orderId}`,
    ))
    .limit(1);
  return row !== undefined;
};

const unchanged = async (tx: Executor, tenantId: string, productId: string): Promise<StockCommitEffect | null> => {
  const [row] = await tx.select().from(productStock).where(stockKey(tenantId, productId));
  return row === undefined ? null : {
    productId,
    outcome: 'unchanged',
    onHandBefore: row.onHand,
    reservedBefore: row.reserved,
    onHandAfter: row.onHand,
    reservedAfter: row.reserved,
    lowStockThreshold: row.lowStockThreshold,
    lowStockNotifiedAt: isoOrNull(row.lowStockNotifiedAt),
    soldOutNotifiedAt: isoOrNull(row.soldOutNotifiedAt),
    oversold: false,
  };
};

const resetNotification = (threshold: number | null, available: number, notifiedAt: string | null): string | null =>
  threshold === null || available > threshold ? null : notifiedAt;

export const createStockRepository = (db: Db): StockRepository => ({
  find: async (tenantId, productId) => {
    const [row] = await db.select().from(productStock).where(stockKey(tenantId, productId));
    return row === undefined ? null : toLevel(row);
  },

  listByProducts: async (tenantId, productIds) => {
    if (productIds.length === 0) return [];
    const rows = await db.select().from(productStock)
      .where(and(eq(productStock.tenantId, tenantId), inArray(productStock.productId, [...productIds])));
    return rows.map(toLevel);
  },

  listByTenant: async (tenantId) =>
    (await db.select().from(productStock).where(eq(productStock.tenantId, tenantId)).orderBy(asc(productStock.productId))).map(toLevel),

  enableTracking: async (tenantId, input) => db.transaction(async (tx) => {
    if (input.onHand > MAX_STOCK_QUANTITY || (input.lowStockThreshold ?? 0) > MAX_STOCK_QUANTITY) return err(aboveStockCap());
    const [row] = await tx.insert(productStock)
      .values({ tenantId, productId: input.productId, onHand: input.onHand, reserved: 0, lowStockThreshold: input.lowStockThreshold, updatedAt: input.now })
      .onConflictDoNothing()
      .returning();
    if (row === undefined) return err(appError('conflict', 'Stock tracking is already enabled for this product'));
    await appendEvent(tx, tenantId, {
      productId: input.productId,
      type: 'tracking_enabled',
      quantity: input.onHand,
      reference: {},
      actorUserId: input.actorUserId,
      occurredAt: input.now,
    });
    return ok(toLevel(row));
  }),

  adjust: async (tenantId, input) => db.transaction(async (tx) => {
    const current = await lockStock(tx, tenantId, input.productId);
    if (current === null) return err(notTracked());
    const onHand = current.onHand + input.delta;
    if (onHand < 0) return err(validation('Stock on hand cannot go below zero'));
    if (onHand > MAX_STOCK_QUANTITY) return err(aboveStockCap());
    const [row] = await tx.update(productStock)
      .set({
        onHand,
        lowStockNotifiedAt: resetNotification(current.lowStockThreshold, onHand - current.reserved, current.lowStockNotifiedAt),
        soldOutNotifiedAt: onHand - current.reserved > 0 ? null : current.soldOutNotifiedAt,
        updatedAt: input.now,
      })
      .where(stockKey(tenantId, input.productId))
      .returning();
    if (row === undefined) return err(notTracked());
    await appendEvent(tx, tenantId, {
      productId: input.productId,
      type: stockAdjustmentEventType(input.delta, input.reason),
      quantity: input.delta,
      reference: { reason: input.reason },
      actorUserId: input.actorUserId,
      occurredAt: input.now,
    });
    return ok(toLevel(row));
  }),

  setThreshold: async (tenantId, input) => db.transaction(async (tx) => {
    const current = await lockStock(tx, tenantId, input.productId);
    if (current === null) return err(notTracked());
    const [row] = await tx.update(productStock)
      .set({
        lowStockThreshold: input.lowStockThreshold,
        lowStockNotifiedAt: resetNotification(input.lowStockThreshold, current.onHand - current.reserved, current.lowStockNotifiedAt),
        updatedAt: input.now,
      })
      .where(stockKey(tenantId, input.productId))
      .returning();
    return row === undefined ? err(notTracked()) : ok(toLevel(row));
  }),

  reserve: async (tenantId, input) => {
    try {
      const reservationIds = await db.transaction(async (tx) => {
        const ids: string[] = [];
        for (const productId of sortedUnique(input.productIds)) {
          const updated = await tx.update(productStock)
            .set({ reserved: sql`${productStock.reserved} + ${input.quantity}`, updatedAt: input.now })
            .where(and(stockKey(tenantId, productId), sql`${productStock.onHand} - ${productStock.reserved} >= ${input.quantity}`))
            .returning({ productId: productStock.productId });
          if (updated.length === 0) {
            const [tracked] = await tx.select({ productId: productStock.productId }).from(productStock).where(stockKey(tenantId, productId));
            if (tracked !== undefined) throw new SoldOutRollback(productId);
            continue;
          }
          const [reservation] = await tx.insert(stockReservations).values({
            tenantId,
            productId,
            checkoutSnapshotId: input.checkoutSnapshotId,
            quantity: input.quantity,
            status: 'active',
            expiresAt: input.expiresAt,
            createdAt: input.now,
            updatedAt: input.now,
          }).returning({ id: stockReservations.id });
          if (reservation === undefined) throw new Error('Stock reservation insert returned no row');
          await appendEvent(tx, tenantId, {
            productId,
            type: 'reserved',
            quantity: input.quantity,
            reference: { checkoutSnapshotId: input.checkoutSnapshotId, reservationId: reservation.id },
            occurredAt: input.now,
          });
          ids.push(reservation.id);
        }
        return ids;
      });
      return ok({ reservationIds });
    } catch (cause) {
      if (cause instanceof SoldOutRollback) return err({ soldOutProductId: cause.productId });
      throw cause;
    }
  },

  release: async (tenantId, input) => db.transaction(async (tx) => {
    const reservationIds = 'checkoutSnapshotId' in input
      ? (await tx.select({ id: stockReservations.id }).from(stockReservations)
        .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.checkoutSnapshotId, input.checkoutSnapshotId), eq(stockReservations.status, 'active')))
        .orderBy(asc(stockReservations.productId))).map((row) => row.id)
      : sortedUnique(input.reservationIds);
    let released = 0;
    for (const reservationId of reservationIds) {
      released += await releaseReservation(tx, tenantId, reservationId, input.reason, input.now);
    }
    return released;
  }),

  commit: async (tenantId, input) => db.transaction(async (tx) => {
    const effects: StockCommitEffect[] = [];
    const reservations = input.checkoutSnapshotId === null
      ? []
      : await tx.select().from(stockReservations)
        .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.checkoutSnapshotId, input.checkoutSnapshotId)))
        .orderBy(asc(stockReservations.productId))
        .for('update');
    const tracked = new Set<string>();
    for (const productId of sortedUnique([...reservations.map((reservation) => reservation.productId), ...input.productIds])) {
      if (await lockStock(tx, tenantId, productId) !== null) tracked.add(productId);
    }
    const reference = (reservationId?: string): StockEventReference => ({
      ...(input.checkoutSnapshotId === null ? {} : { checkoutSnapshotId: input.checkoutSnapshotId }),
      orderId: input.orderId,
      ...(reservationId === undefined ? {} : { reservationId }),
    });
    for (const reservation of reservations) {
      if (reservation.status === 'committed') {
        const effect = await unchanged(tx, tenantId, reservation.productId);
        if (effect !== null) effects.push(effect);
        continue;
      }
      await tx.update(stockReservations)
        .set({ status: 'committed', updatedAt: input.now })
        .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.id, reservation.id)));
      const effect = await applyCommit(tx, tenantId, {
        productId: reservation.productId,
        quantity: reservation.quantity,
        releaseReserved: reservation.status === 'active',
        outcome: reservation.status === 'active' ? 'committed' : 'committed_late',
        reference: reference(reservation.id),
        now: input.now,
      });
      if (effect !== null) effects.push(effect);
    }
    const reservedProducts = new Set(reservations.map((reservation) => reservation.productId));
    for (const productId of sortedUnique(input.productIds)) {
      if (reservedProducts.has(productId) || !tracked.has(productId)) continue;
      let reservationId: string | undefined;
      if (input.checkoutSnapshotId === null) {
        if (await orderAlreadyCommitted(tx, tenantId, productId, input.orderId)) {
          const effect = await unchanged(tx, tenantId, productId);
          if (effect !== null) effects.push(effect);
          continue;
        }
      } else {
        const [inserted] = await tx.insert(stockReservations).values({
          tenantId,
          productId,
          checkoutSnapshotId: input.checkoutSnapshotId,
          quantity: 1,
          status: 'committed',
          expiresAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        }).onConflictDoNothing().returning({ id: stockReservations.id });
        if (inserted === undefined) {
          const effect = await unchanged(tx, tenantId, productId);
          if (effect !== null) effects.push(effect);
          continue;
        }
        reservationId = inserted.id;
      }
      const effect = await applyCommit(tx, tenantId, {
        productId,
        quantity: 1,
        releaseReserved: false,
        outcome: 'committed_late',
        reference: reference(reservationId),
        now: input.now,
      });
      if (effect !== null) effects.push(effect);
    }
    return effects;
  }),

  markLowStockNotified: async (tenantId, input) => {
    await db.update(productStock)
      .set({ lowStockNotifiedAt: input.now, ...(input.soldOut ? { soldOutNotifiedAt: input.now } : {}) })
      .where(stockKey(tenantId, input.productId));
  },

  releaseExpired: async (now, limit, tenantId) => {
    const due = await db.select({ tenantId: stockReservations.tenantId, id: stockReservations.id }).from(stockReservations)
      .where(and(
        eq(stockReservations.status, 'active'),
        lte(stockReservations.expiresAt, now),
        ...(tenantId === undefined ? [] : [eq(stockReservations.tenantId, tenantId)]),
      ))
      .orderBy(asc(stockReservations.expiresAt), asc(stockReservations.id))
      .limit(limit);
    let released = 0;
    for (const reservation of due) {
      released += await db.transaction((tx) => releaseReservation(tx, reservation.tenantId, reservation.id, 'expired', now));
    }
    return released;
  },
});
