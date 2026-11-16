import {
  appError,
  err,
  MAX_STOCK_QUANTITY,
  mergeStockQuantities,
  notFound,
  ok,
  stockAdjustmentEventType,
  stockAlertMarkers,
  validation,
  type StockCommitEffect,
  type StockEventType,
  type StockLevel,
  type StockQuantity,
  type StockReservationStatus,
} from '#core/domain/index.js';

import type { StockRepository } from '../stock-ports.js';

export interface FakeStockReservation {
  id: string;
  tenantId: string;
  productId: string;
  checkoutSnapshotId: string;
  quantity: number;
  status: StockReservationStatus;
  expiresAt: string;
}

interface FakeStockEvent {
  tenantId: string;
  productId: string;
  type: StockEventType;
  quantity: number;
  reference: Record<string, string>;
}

export const createStockRepositoryFake = () => {
  const levels = new Map<string, StockLevel & { tenantId: string; soldOutNotifiedAt: string | null }>();
  const reservations: FakeStockReservation[] = [];
  const events: FakeStockEvent[] = [];
  let sequence = 0;
  const key = (tenantId: string, productId: string) => `${tenantId}:${productId}`;
  const level = (tenantId: string, productId: string) => levels.get(key(tenantId, productId)) ?? null;
  const view = (stored: StockLevel): StockLevel => ({
    productId: stored.productId,
    onHand: stored.onHand,
    reserved: stored.reserved,
    lowStockThreshold: stored.lowStockThreshold,
    lowStockNotifiedAt: stored.lowStockNotifiedAt,
    updatedAt: stored.updatedAt,
  });
  const record = (tenantId: string, productId: string, type: StockEventType, quantity: number, reference: Record<string, string> = {}) => {
    events.push({ tenantId, productId, type, quantity, reference });
  };
  const resetMarkers = (stored: StockLevel & { soldOutNotifiedAt: string | null }) => {
    Object.assign(stored, stockAlertMarkers(stored));
  };
  const releaseOne = (reservation: FakeStockReservation, reason: string, now: string): number => {
    if (reservation.status !== 'active') return 0;
    reservation.status = 'released';
    const stored = level(reservation.tenantId, reservation.productId);
    if (stored !== null) {
      stored.reserved = Math.max(stored.reserved - reservation.quantity, 0);
      stored.updatedAt = now;
      resetMarkers(stored);
    }
    record(reservation.tenantId, reservation.productId, 'released', -reservation.quantity, { checkoutSnapshotId: reservation.checkoutSnapshotId, reservationId: reservation.id, reason });
    return 1;
  };
  const effectOf = (
    stored: StockLevel & { soldOutNotifiedAt: string | null },
    outcome: StockCommitEffect['outcome'],
    oversold: boolean,
    before: { onHand: number; reserved: number } = stored,
  ): StockCommitEffect => ({
    productId: stored.productId,
    outcome,
    onHandBefore: before.onHand,
    reservedBefore: before.reserved,
    onHandAfter: stored.onHand,
    reservedAfter: stored.reserved,
    lowStockThreshold: stored.lowStockThreshold,
    lowStockNotifiedAt: stored.lowStockNotifiedAt,
    soldOutNotifiedAt: stored.soldOutNotifiedAt,
    oversold,
  });
  const applyCommit = (tenantId: string, productId: string, quantity: number, releaseReserved: boolean, outcome: 'committed' | 'committed_late', reference: Record<string, string>, now: string): StockCommitEffect | null => {
    const stored = level(tenantId, productId);
    if (stored === null) return null;
    const before = { onHand: stored.onHand, reserved: stored.reserved };
    stored.onHand = Math.max(before.onHand - quantity, 0);
    if (releaseReserved) stored.reserved = Math.max(stored.reserved - quantity, 0);
    stored.updatedAt = now;
    record(tenantId, productId, outcome, stored.onHand - before.onHand, reference);
    const shortfall = quantity - (before.onHand - stored.onHand);
    if (shortfall > 0) record(tenantId, productId, 'oversold', -shortfall, reference);
    return effectOf(stored, outcome, shortfall > 0, before);
  };
  const sortedQuantities = (items: readonly StockQuantity[]) =>
    mergeStockQuantities(items).toSorted((left, right) => left.productId < right.productId ? -1 : 1);

  const repository: StockRepository = {
    find: async (tenantId, productId) => {
      const stored = level(tenantId, productId);
      return stored === null ? null : view(stored);
    },
    listByProducts: async (tenantId, productIds) =>
      productIds.flatMap((productId) => {
        const stored = level(tenantId, productId);
        return stored === null ? [] : [view(stored)];
      }),
    listByTenant: async (tenantId) =>
      [...levels.values()].filter((stored) => stored.tenantId === tenantId).map(view).toSorted((left, right) => left.productId.localeCompare(right.productId)),
    enableTracking: async (tenantId, input) => {
      if (level(tenantId, input.productId) !== null) return err(appError('conflict', 'Stock tracking is already enabled for this product'));
      if (input.onHand > MAX_STOCK_QUANTITY || (input.lowStockThreshold ?? 0) > MAX_STOCK_QUANTITY) return err(validation('Stock quantities cannot exceed the cap'));
      const stored = { tenantId, productId: input.productId, onHand: input.onHand, reserved: 0, lowStockThreshold: input.lowStockThreshold, lowStockNotifiedAt: null, soldOutNotifiedAt: null, updatedAt: input.now };
      levels.set(key(tenantId, input.productId), stored);
      record(tenantId, input.productId, 'tracking_enabled', input.onHand);
      return ok(view(stored));
    },
    adjust: async (tenantId, input) => {
      const stored = level(tenantId, input.productId);
      if (stored === null) return err(notFound('Stock tracking is not enabled for this product'));
      if (stored.onHand + input.delta < 0) return err(validation('Stock on hand cannot go below zero'));
      if (stored.onHand + input.delta > MAX_STOCK_QUANTITY) return err(validation('Stock quantities cannot exceed the cap'));
      stored.onHand += input.delta;
      stored.updatedAt = input.now;
      resetMarkers(stored);
      record(tenantId, input.productId, stockAdjustmentEventType(input.delta, input.reason), input.delta, { reason: input.reason });
      return ok(view(stored));
    },
    setThreshold: async (tenantId, input) => {
      const stored = level(tenantId, input.productId);
      if (stored === null) return err(notFound('Stock tracking is not enabled for this product'));
      stored.lowStockThreshold = input.lowStockThreshold;
      stored.updatedAt = input.now;
      stored.lowStockNotifiedAt = stockAlertMarkers(stored).lowStockNotifiedAt;
      return ok(view(stored));
    },
    reserve: async (tenantId, input) => {
      const tracked = sortedQuantities(input.items).flatMap(({ productId, quantity }) => {
        const stored = level(tenantId, productId);
        return stored === null ? [] : [{ stored, quantity }];
      });
      const short = tracked.find(({ stored, quantity }) => stored.onHand - stored.reserved < quantity);
      if (short !== undefined) return err({ soldOutProductId: short.stored.productId });
      const reservationIds = tracked.map(({ stored, quantity }) => {
        sequence += 1;
        const reservation = { id: `reservation-${String(sequence)}`, tenantId, productId: stored.productId, checkoutSnapshotId: input.checkoutSnapshotId, quantity, status: 'active' as const, expiresAt: input.expiresAt };
        reservations.push(reservation);
        stored.reserved += quantity;
        stored.updatedAt = input.now;
        record(tenantId, stored.productId, 'reserved', quantity, { checkoutSnapshotId: input.checkoutSnapshotId, reservationId: reservation.id });
        return reservation.id;
      });
      return ok({ reservationIds });
    },
    release: async (tenantId, input) => {
      const selected = 'checkoutSnapshotId' in input
        ? reservations.filter((reservation) => reservation.tenantId === tenantId && reservation.checkoutSnapshotId === input.checkoutSnapshotId)
        : reservations.filter((reservation) => reservation.tenantId === tenantId && input.reservationIds.includes(reservation.id));
      return selected.reduce((count, reservation) => count + releaseOne(reservation, input.reason, input.now), 0);
    },
    commit: async (tenantId, input) => {
      const effects: StockCommitEffect[] = [];
      const own = input.checkoutSnapshotId === null ? [] : reservations.filter((reservation) => reservation.tenantId === tenantId && reservation.checkoutSnapshotId === input.checkoutSnapshotId);
      const reference = { ...(input.checkoutSnapshotId === null ? {} : { checkoutSnapshotId: input.checkoutSnapshotId }), orderId: input.orderId };
      for (const reservation of own) {
        const stored = level(tenantId, reservation.productId);
        if (stored === null) continue;
        if (reservation.status === 'committed') {
          effects.push(effectOf(stored, 'unchanged', false));
          continue;
        }
        const wasActive = reservation.status === 'active';
        reservation.status = 'committed';
        const effect = applyCommit(tenantId, reservation.productId, reservation.quantity, wasActive, wasActive ? 'committed' : 'committed_late', { ...reference, reservationId: reservation.id }, input.now);
        if (effect !== null) effects.push(effect);
      }
      for (const { productId, quantity } of sortedQuantities(input.items)) {
        const stored = level(tenantId, productId);
        if (own.some((reservation) => reservation.productId === productId) || stored === null) continue;
        if (input.checkoutSnapshotId === null && events.some((event) => event.tenantId === tenantId && event.productId === productId && (event.type === 'committed' || event.type === 'committed_late') && event.reference['orderId'] === input.orderId)) {
          effects.push(effectOf(stored, 'unchanged', false));
          continue;
        }
        if (input.checkoutSnapshotId !== null) {
          sequence += 1;
          reservations.push({ id: `reservation-${String(sequence)}`, tenantId, productId, checkoutSnapshotId: input.checkoutSnapshotId, quantity, status: 'committed', expiresAt: input.now });
        }
        const effect = applyCommit(tenantId, productId, quantity, false, 'committed_late', reference, input.now);
        if (effect !== null) effects.push(effect);
      }
      return effects;
    },
    markLowStockNotified: async (tenantId, input) => {
      const stored = level(tenantId, input.productId);
      if (stored === null) return;
      stored.lowStockNotifiedAt = input.now;
      if (input.soldOut) stored.soldOutNotifiedAt = input.now;
    },
    releaseExpired: async (now, limit, tenantId) => reservations
      .filter((reservation) => reservation.status === 'active' && reservation.expiresAt <= now && (tenantId === undefined || reservation.tenantId === tenantId))
      .toSorted((left, right) => left.expiresAt.localeCompare(right.expiresAt))
      .slice(0, limit)
      .reduce((count, reservation) => count + releaseOne(reservation, 'expired', now), 0),
  };
  const track = (tenantId: string, productId: string, onHand: number, lowStockThreshold: number | null = null) => {
    levels.set(key(tenantId, productId), { tenantId, productId, onHand, reserved: 0, lowStockThreshold, lowStockNotifiedAt: null, soldOutNotifiedAt: null, updatedAt: '2026-11-05T09:00:00.000Z' });
  };
  return { repository, levels: { get: (tenantId: string, productId: string) => level(tenantId, productId) }, reservations, events, track };
};
