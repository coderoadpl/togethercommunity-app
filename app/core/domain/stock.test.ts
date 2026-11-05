import { describe, expect, it } from 'vitest';

import {
  adjustStockInputSchema,
  availableStock,
  enableStockTrackingInputSchema,
  firstSoldOutProductId,
  lowStockAlertFor,
  productStockView,
  publicProductStock,
  publicStockVersion,
  stockAdjustmentEventType,
  stockCheckoutExpiry,
  stockIsLow,
  type StockCommitEffect,
  type StockLevel,
} from './stock.js';

const level = (overrides: Partial<StockLevel> = {}): StockLevel => ({
  productId: 'poster',
  onHand: 5,
  reserved: 1,
  lowStockThreshold: null,
  lowStockNotifiedAt: null,
  updatedAt: '2026-11-05T10:00:00.000Z',
  ...overrides,
});

const effect = (overrides: Partial<StockCommitEffect> = {}): StockCommitEffect => ({
  productId: 'poster',
  outcome: 'committed',
  onHandBefore: 5,
  onHandAfter: 4,
  reservedAfter: 0,
  lowStockThreshold: 2,
  lowStockNotifiedAt: null,
  oversold: false,
  ...overrides,
});

describe('stock availability', () => {
  it('subtracts reserved pieces from on hand and never goes below zero', () => {
    expect(availableStock({ onHand: 5, reserved: 2 })).toBe(3);
    expect(availableStock({ onHand: 1, reserved: 1 })).toBe(0);
    expect(availableStock({ onHand: 0, reserved: 2 })).toBe(0);
  });

  it('is low only when a threshold is set and availability reaches it', () => {
    expect(stockIsLow(level({ lowStockThreshold: null }))).toBe(false);
    expect(stockIsLow(level({ onHand: 4, reserved: 1, lowStockThreshold: 3 }))).toBe(true);
    expect(stockIsLow(level({ onHand: 5, reserved: 1, lowStockThreshold: 3 }))).toBe(false);
  });

  it('derives the Studio view from the stored level', () => {
    expect(productStockView(level({ onHand: 2, reserved: 2, lowStockThreshold: 1 }))).toMatchObject({ available: 0, low: true, soldOut: true });
    expect(productStockView(level())).toMatchObject({ available: 4, low: false, soldOut: false });
  });

  it('never exposes counts publicly and treats untracked products as unlimited', () => {
    expect(publicProductStock(null)).toEqual({ tracked: false, soldOut: false, low: false });
    expect(publicProductStock(level({ onHand: 1, reserved: 1 }))).toEqual({ tracked: true, soldOut: true, low: false });
    expect(publicProductStock(level({ onHand: 3, reserved: 1, lowStockThreshold: 2 }))).toEqual({ tracked: true, soldOut: false, low: true });
  });

  it('finds the first sold-out tracked product in selection order and skips untracked ones', () => {
    const levels = [level({ productId: 'a', onHand: 1, reserved: 0 }), level({ productId: 'b', onHand: 1, reserved: 1 })];
    expect(firstSoldOutProductId(['untracked', 'a', 'b'], levels)).toBe('b');
    expect(firstSoldOutProductId(['untracked', 'a'], levels)).toBeNull();
  });

  it('expires the Stripe session a minute above the Stripe minimum and the reservation five minutes later', () => {
    expect(stockCheckoutExpiry('2026-11-05T10:00:00.000Z')).toEqual({
      sessionExpiresAt: '2026-11-05T10:31:00.000Z',
      reservationExpiresAt: '2026-11-05T10:36:00.000Z',
    });
  });

  it('records a positive adjustment with the returned reason as a return', () => {
    expect(stockAdjustmentEventType(1, 'returned')).toBe('returned');
    expect(stockAdjustmentEventType(1, ' Returned ')).toBe('returned');
    expect(stockAdjustmentEventType(-1, 'returned')).toBe('adjusted');
    expect(stockAdjustmentEventType(3, 'delivery')).toBe('adjusted');
  });
});

describe('stock inputs', () => {
  it('rejects a zero adjustment and an empty reason', () => {
    expect(adjustStockInputSchema.safeParse({ productId: 'p', delta: 0, reason: 'count' }).success).toBe(false);
    expect(adjustStockInputSchema.safeParse({ productId: 'p', delta: 2, reason: ' ' }).success).toBe(false);
    expect(adjustStockInputSchema.safeParse({ productId: 'p', delta: -2, reason: 'damaged' }).success).toBe(true);
  });

  it('rejects negative on-hand counts and defaults the threshold to none', () => {
    expect(enableStockTrackingInputSchema.safeParse({ productId: 'p', onHand: -1 }).success).toBe(false);
    expect(enableStockTrackingInputSchema.parse({ productId: 'p', onHand: 3 })).toEqual({ productId: 'p', onHand: 3, lowStockThreshold: null });
  });
});

describe('low-stock alert decision', () => {
  it('alerts the first time availability crosses the threshold', () => {
    expect(lowStockAlertFor(effect({ onHandAfter: 2 }))).toEqual({ available: 2, oversold: false });
    expect(lowStockAlertFor(effect({ onHandAfter: 3 }))).toBeNull();
  });

  it('stays quiet after the first alert until the last piece is sold', () => {
    const notified = '2026-11-05T09:00:00.000Z';
    expect(lowStockAlertFor(effect({ onHandAfter: 1, lowStockNotifiedAt: notified }))).toBeNull();
    expect(lowStockAlertFor(effect({ onHandBefore: 1, onHandAfter: 0, lowStockNotifiedAt: notified }))).toEqual({ available: 0, oversold: false });
  });

  it('sends the zero alert once, for the commit that sells the last piece on hand, not while held pieces keep availability at zero', () => {
    const notified = '2026-11-05T09:00:00.000Z';
    expect(lowStockAlertFor(effect({ onHandBefore: 3, onHandAfter: 2, reservedAfter: 2, lowStockNotifiedAt: notified }))).toBeNull();
    expect(lowStockAlertFor(effect({ onHandBefore: 2, onHandAfter: 1, reservedAfter: 1, lowStockNotifiedAt: notified }))).toBeNull();
    expect(lowStockAlertFor(effect({ onHandBefore: 1, onHandAfter: 0, reservedAfter: 0, lowStockNotifiedAt: notified }))).toEqual({ available: 0, oversold: false });
    expect(lowStockAlertFor(effect({ onHandBefore: 3, onHandAfter: 2, reservedAfter: 2 }))).toEqual({ available: 0, oversold: false });
  });

  it('always alerts an oversold commit, even without a threshold', () => {
    expect(lowStockAlertFor(effect({ onHandAfter: 0, lowStockThreshold: null, lowStockNotifiedAt: '2026-11-05T09:00:00.000Z', oversold: true }))).toEqual({ available: 0, oversold: true });
  });

  it('never alerts for an unchanged commit or an untracked threshold', () => {
    expect(lowStockAlertFor(effect({ outcome: 'unchanged', onHandAfter: 0 }))).toBeNull();
    expect(lowStockAlertFor(effect({ onHandAfter: 0, lowStockThreshold: null }))).toBeNull();
  });
});

describe('public stock version', () => {
  it('changes only when a public flag changes, independent of order and exact counts', () => {
    const plenty = [level({ productId: 'b', onHand: 9, reserved: 0 }), level({ productId: 'a', onHand: 5, reserved: 1 })];
    expect(publicStockVersion(plenty)).toBe(publicStockVersion(plenty.toReversed()));
    expect(publicStockVersion([level({ productId: 'a', onHand: 4, reserved: 1 }), level({ productId: 'b', onHand: 9, reserved: 0 })])).toBe(publicStockVersion(plenty));
    expect(publicStockVersion([level({ productId: 'a', onHand: 1, reserved: 1 }), level({ productId: 'b', onHand: 9, reserved: 0 })])).not.toBe(publicStockVersion(plenty));
  });
});
