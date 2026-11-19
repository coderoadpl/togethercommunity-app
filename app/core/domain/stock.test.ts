import { describe, expect, it } from 'vitest';

import {
  adjustStockInputSchema,
  availableStock,
  enableStockTrackingInputSchema,
  firstShortStockProductId,
  lowStockAlertFor,
  mergeStockQuantities,
  productStockView,
  publicProductStock,
  publicProductStockSchema,
  publicStockLookup,
  publicStockVersion,
  purchasableLineQuantity,
  purchasableSets,
  stockAdjustmentEventType,
  stockAlertMarkers,
  stockIsLow,
  stockQuantitiesFromLines,
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
  reservedBefore: 0,
  onHandAfter: 4,
  reservedAfter: 0,
  lowStockThreshold: 2,
  lowStockNotifiedAt: null,
  soldOutNotifiedAt: null,
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

  it('exposes the available count of tracked products and no count for untracked ones', () => {
    expect(publicProductStock(null)).toEqual({ tracked: false, soldOut: false, low: false, available: null });
    expect(publicProductStock(level({ onHand: 1, reserved: 1 }))).toEqual({ tracked: true, soldOut: true, low: false, available: 0 });
    expect(publicProductStock(level({ onHand: 3, reserved: 1, lowStockThreshold: 2 }))).toEqual({ tracked: true, soldOut: false, low: true, available: 2 });
    expect(publicProductStock(level({ onHand: 1, reserved: 4 }))).toMatchObject({ soldOut: true, available: 0 });
  });

  it('looks up the public stock per product and treats a product without a level as untracked', () => {
    const stockOf = publicStockLookup([level({ productId: 'a', onHand: 4, reserved: 1 })]);
    expect(stockOf('a')).toEqual({ tracked: true, soldOut: false, low: false, available: 3 });
    expect(stockOf('untracked')).toEqual({ tracked: false, soldOut: false, low: false, available: null });
  });

  it('defaults the available count of a payload recorded without it and rejects negative counts', () => {
    expect(publicProductStockSchema.parse({ tracked: true, soldOut: false, low: false })).toEqual({ tracked: true, soldOut: false, low: false, available: null });
    expect(publicProductStockSchema.safeParse({ tracked: true, soldOut: false, low: false, available: -1 }).success).toBe(false);
    expect(publicProductStockSchema.safeParse({ tracked: true, soldOut: false, low: false, available: 1.5 }).success).toBe(false);
  });

  it('bounds the purchasable line quantity by the rule and the available count', () => {
    expect(purchasableLineQuantity(10, { soldOut: false, available: null })).toBe(10);
    expect(purchasableLineQuantity(10, { soldOut: false, available: 3 })).toBe(3);
    expect(purchasableLineQuantity(10, { soldOut: false, available: 25 })).toBe(10);
    expect(purchasableLineQuantity(1, { soldOut: false, available: 25 })).toBe(1);
    expect(purchasableLineQuantity(10, { soldOut: true, available: 0 })).toBe(0);
  });

  it('counts the whole sets the tracked products cover and ignores untracked ones', () => {
    const levels = [level({ productId: 'a', onHand: 7, reserved: 2 }), level({ productId: 'b', onHand: 3, reserved: 0 })];
    expect(purchasableSets([{ productId: 'a', quantity: 1 }, { productId: 'b', quantity: 1 }, { productId: 'untracked', quantity: 1 }], levels)).toBe(3);
    expect(purchasableSets([{ productId: 'a', quantity: 2 }], levels)).toBe(2);
    expect(purchasableSets([{ productId: 'a', quantity: 1 }, { productId: 'a', quantity: 1 }, { productId: 'a', quantity: 1 }], levels)).toBe(1);
    expect(purchasableSets([{ productId: 'untracked', quantity: 1 }], levels)).toBeNull();
    expect(purchasableSets([{ productId: 'b', quantity: 1 }], [level({ productId: 'b', onHand: 1, reserved: 1 })])).toBe(0);
  });

  it('finds the first tracked product whose availability is below the requested quantity', () => {
    const levels = [level({ productId: 'a', onHand: 3, reserved: 1 }), level({ productId: 'b', onHand: 5, reserved: 0 })];
    expect(firstShortStockProductId([{ productId: 'untracked', quantity: 9 }, { productId: 'b', quantity: 5 }, { productId: 'a', quantity: 2 }], levels)).toBeNull();
    expect(firstShortStockProductId([{ productId: 'b', quantity: 5 }, { productId: 'a', quantity: 3 }], levels)).toBe('a');
  });

  it('sums repeated products in first-seen order', () => {
    expect(mergeStockQuantities([{ productId: 'b', quantity: 1 }, { productId: 'a', quantity: 2 }, { productId: 'b', quantity: 3 }]))
      .toEqual([{ productId: 'b', quantity: 4 }, { productId: 'a', quantity: 2 }]);
  });

  it('takes stock quantities from product lines, counting a line without quantity as one and skipping delivery', () => {
    expect(stockQuantitiesFromLines([
      { productId: 'poster', productType: 'physical', quantity: 3 },
      { productId: 'course', productType: 'course' },
      { productId: 'shipping:rate-1', productType: 'shipping' },
    ])).toEqual([{ productId: 'poster', quantity: 3 }, { productId: 'course', quantity: 1 }]);
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
  const notified = '2026-11-05T09:00:00.000Z';

  it('alerts the first time availability crosses the threshold', () => {
    expect(lowStockAlertFor(effect({ onHandAfter: 2 }))).toEqual({ available: 2, oversold: false, soldOut: false });
    expect(lowStockAlertFor(effect({ onHandAfter: 3 }))).toBeNull();
  });

  it('stays quiet after the first alert until the last piece is sold', () => {
    expect(lowStockAlertFor(effect({ onHandAfter: 1, lowStockNotifiedAt: notified }))).toBeNull();
    expect(lowStockAlertFor(effect({ onHandBefore: 1, onHandAfter: 0, lowStockNotifiedAt: notified }))).toEqual({ available: 0, oversold: false, soldOut: true });
  });

  it('sends the zero alert for the commit that sells the last piece on hand, not while held pieces keep availability at zero', () => {
    expect(lowStockAlertFor(effect({ onHandBefore: 3, reservedBefore: 3, onHandAfter: 2, reservedAfter: 2, lowStockNotifiedAt: notified }))).toBeNull();
    expect(lowStockAlertFor(effect({ onHandBefore: 2, reservedBefore: 2, onHandAfter: 1, reservedAfter: 1, lowStockNotifiedAt: notified }))).toBeNull();
    expect(lowStockAlertFor(effect({ onHandBefore: 1, reservedBefore: 1, onHandAfter: 0, reservedAfter: 0, lowStockNotifiedAt: notified }))).toEqual({ available: 0, oversold: false, soldOut: true });
    expect(lowStockAlertFor(effect({ onHandBefore: 3, reservedBefore: 3, onHandAfter: 2, reservedAfter: 2 }))).toEqual({ available: 0, oversold: false, soldOut: false });
  });

  it('sends the zero alert when a late commit takes the last free piece while other checkouts hold the rest', () => {
    expect(lowStockAlertFor(effect({ outcome: 'committed_late', onHandBefore: 3, reservedBefore: 2, onHandAfter: 2, reservedAfter: 2, lowStockNotifiedAt: notified }))).toEqual({ available: 0, oversold: false, soldOut: true });
  });

  it('sends the zero alert only once until the marker is reset', () => {
    expect(lowStockAlertFor(effect({ onHandBefore: 1, reservedBefore: 1, onHandAfter: 0, reservedAfter: 0, lowStockNotifiedAt: notified, soldOutNotifiedAt: notified }))).toBeNull();
    expect(lowStockAlertFor(effect({ outcome: 'committed_late', onHandBefore: 3, reservedBefore: 2, onHandAfter: 2, reservedAfter: 2, lowStockNotifiedAt: notified, soldOutNotifiedAt: notified }))).toBeNull();
  });

  it('always alerts an oversold commit, even without a threshold', () => {
    expect(lowStockAlertFor(effect({ onHandBefore: 0, onHandAfter: 0, lowStockThreshold: null, lowStockNotifiedAt: notified, oversold: true }))).toEqual({ available: 0, oversold: true, soldOut: false });
  });

  it('never alerts for an unchanged commit or an untracked threshold', () => {
    expect(lowStockAlertFor(effect({ outcome: 'unchanged', onHandAfter: 0 }))).toBeNull();
    expect(lowStockAlertFor(effect({ onHandAfter: 0, lowStockThreshold: null }))).toBeNull();
  });
});

describe('stock alert markers after availability changes', () => {
  const notified = '2026-11-05T09:00:00.000Z';
  const markers = { lowStockNotifiedAt: notified, soldOutNotifiedAt: notified };

  it('keeps both markers while nothing is available', () => {
    expect(stockAlertMarkers({ onHand: 1, reserved: 1, lowStockThreshold: 1, ...markers })).toEqual(markers);
  });

  it('clears the zero marker once a piece is available and keeps the low marker at or below the threshold', () => {
    expect(stockAlertMarkers({ onHand: 2, reserved: 1, lowStockThreshold: 1, ...markers })).toEqual({ lowStockNotifiedAt: notified, soldOutNotifiedAt: null });
  });

  it('clears both markers above the threshold, or above zero without a threshold', () => {
    expect(stockAlertMarkers({ onHand: 3, reserved: 1, lowStockThreshold: 1, ...markers })).toEqual({ lowStockNotifiedAt: null, soldOutNotifiedAt: null });
    expect(stockAlertMarkers({ onHand: 1, reserved: 0, lowStockThreshold: null, ...markers })).toEqual({ lowStockNotifiedAt: null, soldOutNotifiedAt: null });
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
