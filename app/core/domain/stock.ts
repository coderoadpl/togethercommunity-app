import { z } from 'zod';

import { orderLineQuantity, productLines, type OrderLineType } from './commerce.js';

export const STOCK_EVENT_TYPES = [
  'tracking_enabled',
  'adjusted',
  'reserved',
  'released',
  'committed',
  'committed_late',
  'oversold',
  'returned',
] as const;

export type StockEventType = (typeof STOCK_EVENT_TYPES)[number];

export const STOCK_RESERVATION_STATUSES = ['active', 'committed', 'released'] as const;

export type StockReservationStatus = (typeof STOCK_RESERVATION_STATUSES)[number];

const STOCK_RETURN_REASON = 'returned';

const STOCK_CHECKOUT_SESSION_MINUTES = 31;
const STOCK_RESERVATION_MINUTES = 36;
export const STOCK_SWEEP_BATCH_SIZE = 100;

export const MAX_STOCK_QUANTITY = 1_000_000;

const stockQuantitySchema = z.number().int().min(0).max(MAX_STOCK_QUANTITY);

const stockLevelSchema = z.object({
  productId: z.string().min(1),
  onHand: stockQuantitySchema,
  reserved: stockQuantitySchema,
  lowStockThreshold: stockQuantitySchema.nullable(),
  lowStockNotifiedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

export type StockLevel = z.output<typeof stockLevelSchema>;

export const productStockSchema = stockLevelSchema.extend({
  available: stockQuantitySchema,
  low: z.boolean(),
  soldOut: z.boolean(),
});

export type ProductStock = z.output<typeof productStockSchema>;

export const publicProductStockSchema = z.object({
  tracked: z.boolean(),
  soldOut: z.boolean(),
  low: z.boolean(),
  available: z.number().int().min(0).nullable().default(null),
});

export type PublicProductStock = z.output<typeof publicProductStockSchema>;

export const availableStock = (level: Pick<StockLevel, 'onHand' | 'reserved'>): number =>
  Math.max(level.onHand - level.reserved, 0);

export const stockIsLow = (level: Pick<StockLevel, 'onHand' | 'reserved' | 'lowStockThreshold'>): boolean =>
  level.lowStockThreshold !== null && availableStock(level) <= level.lowStockThreshold;

export const stockAlertMarkers = (level: {
  onHand: number;
  reserved: number;
  lowStockThreshold: number | null;
  lowStockNotifiedAt: string | null;
  soldOutNotifiedAt: string | null;
}): { lowStockNotifiedAt: string | null; soldOutNotifiedAt: string | null } => {
  const available = availableStock(level);
  return {
    lowStockNotifiedAt: level.lowStockThreshold === null || available > level.lowStockThreshold ? null : level.lowStockNotifiedAt,
    soldOutNotifiedAt: available > 0 ? null : level.soldOutNotifiedAt,
  };
};

export const productStockView = (level: StockLevel): ProductStock => ({
  ...level,
  available: availableStock(level),
  low: stockIsLow(level),
  soldOut: availableStock(level) < 1,
});

export const publicProductStock = (level: StockLevel | null): PublicProductStock =>
  level === null
    ? { tracked: false, soldOut: false, low: false, available: null }
    : { tracked: true, soldOut: availableStock(level) < 1, low: stockIsLow(level), available: availableStock(level) };

export const publicStockLookup = (levels: readonly StockLevel[]): ((productId: string) => PublicProductStock) => {
  const byProduct = new Map(levels.map((level) => [level.productId, level]));
  return (productId) => publicProductStock(byProduct.get(productId) ?? null);
};

export const publicStockVersion = (levels: readonly StockLevel[]): string =>
  levels
    .map((level) => {
      const stock = publicProductStock(level);
      return `${level.productId}:${String(stock.available)}:${stock.low ? 'low' : 'normal'}`;
    })
    .sort()
    .join('|');

export const purchasableLineQuantity = (
  ruleBound: number,
  stock: Pick<PublicProductStock, 'soldOut' | 'available'>,
): number => {
  if (stock.soldOut) return 0;
  return stock.available === null ? ruleBound : Math.min(ruleBound, stock.available);
};

export interface StockQuantity {
  productId: string;
  quantity: number;
}

export const mergeStockQuantities = (items: readonly StockQuantity[]): StockQuantity[] => {
  const merged = new Map<string, number>();
  for (const item of items) merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
};

export const stockQuantitiesFromLines = (
  lines: readonly { productId: string; productType: OrderLineType; quantity?: number | undefined }[],
): StockQuantity[] =>
  mergeStockQuantities(productLines(lines).map((line) => ({ productId: line.productId, quantity: orderLineQuantity(line) })));

export const firstShortStockProductId = (items: readonly StockQuantity[], levels: readonly StockLevel[]): string | null =>
  items.find((item) => {
    const level = levels.find((candidate) => candidate.productId === item.productId);
    return level !== undefined && availableStock(level) < item.quantity;
  })?.productId ?? null;

export const purchasableSets = (items: readonly StockQuantity[], levels: readonly StockLevel[]): number | null => {
  const counts = mergeStockQuantities(items).flatMap((item) => {
    const level = levels.find((candidate) => candidate.productId === item.productId);
    return level === undefined || item.quantity < 1 ? [] : [Math.floor(availableStock(level) / item.quantity)];
  });
  return counts.length === 0 ? null : Math.min(...counts);
};

export const stockCheckoutExpiry = (nowIso: string): { sessionExpiresAt: string; reservationExpiresAt: string } => {
  const now = Date.parse(nowIso);
  return {
    sessionExpiresAt: new Date(now + STOCK_CHECKOUT_SESSION_MINUTES * 60_000).toISOString(),
    reservationExpiresAt: new Date(now + STOCK_RESERVATION_MINUTES * 60_000).toISOString(),
  };
};

export const stockAdjustmentEventType = (delta: number, reason: string): 'adjusted' | 'returned' =>
  delta > 0 && reason.trim().toLowerCase() === STOCK_RETURN_REASON ? 'returned' : 'adjusted';

export const enableStockTrackingInputSchema = z.object({
  productId: z.string().min(1),
  onHand: stockQuantitySchema,
  lowStockThreshold: stockQuantitySchema.nullable().default(null),
}).strict();

export const adjustStockInputSchema = z.object({
  productId: z.string().min(1),
  delta: z.number().int().min(-MAX_STOCK_QUANTITY).max(MAX_STOCK_QUANTITY).refine((delta) => delta !== 0, 'The adjustment must not be zero'),
  reason: z.string().trim().min(1).max(200),
}).strict();

export const stockThresholdInputSchema = z.object({
  productId: z.string().min(1),
  lowStockThreshold: stockQuantitySchema.nullable(),
}).strict();

export interface StockCommitEffect {
  productId: string;
  outcome: 'committed' | 'committed_late' | 'unchanged';
  onHandBefore: number;
  reservedBefore: number;
  onHandAfter: number;
  reservedAfter: number;
  lowStockThreshold: number | null;
  lowStockNotifiedAt: string | null;
  soldOutNotifiedAt: string | null;
  oversold: boolean;
}

interface LowStockAlert {
  available: number;
  oversold: boolean;
  soldOut: boolean;
}

export const lowStockAlertFor = (effect: StockCommitEffect): LowStockAlert | null => {
  if (effect.outcome === 'unchanged') return null;
  const available = availableStock({ onHand: effect.onHandAfter, reserved: effect.reservedAfter });
  const crossedToZero = availableStock({ onHand: effect.onHandBefore, reserved: effect.reservedBefore }) > 0
    || (effect.onHandBefore > 0 && effect.onHandAfter === 0);
  const soldOut = available === 0 && crossedToZero && effect.soldOutNotifiedAt === null;
  if (effect.oversold) return { available, oversold: true, soldOut };
  if (effect.lowStockThreshold === null || available > effect.lowStockThreshold) return null;
  return effect.lowStockNotifiedAt === null || soldOut ? { available, oversold: false, soldOut } : null;
};
