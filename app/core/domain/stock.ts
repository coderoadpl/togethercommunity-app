import { z } from 'zod';

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
});

export type PublicProductStock = z.output<typeof publicProductStockSchema>;

export const availableStock = (level: Pick<StockLevel, 'onHand' | 'reserved'>): number =>
  Math.max(level.onHand - level.reserved, 0);

export const stockIsLow = (level: Pick<StockLevel, 'onHand' | 'reserved' | 'lowStockThreshold'>): boolean =>
  level.lowStockThreshold !== null && availableStock(level) <= level.lowStockThreshold;

export const productStockView = (level: StockLevel): ProductStock => ({
  ...level,
  available: availableStock(level),
  low: stockIsLow(level),
  soldOut: availableStock(level) < 1,
});

export const publicProductStock = (level: StockLevel | null): PublicProductStock =>
  level === null
    ? { tracked: false, soldOut: false, low: false }
    : { tracked: true, soldOut: availableStock(level) < 1, low: stockIsLow(level) };

export const publicStockVersion = (levels: readonly StockLevel[]): string =>
  levels
    .map((level) => {
      const flags = publicProductStock(level);
      return `${level.productId}:${flags.soldOut ? 'sold-out' : 'available'}:${flags.low ? 'low' : 'normal'}`;
    })
    .sort()
    .join('|');

export const firstSoldOutProductId = (productIds: readonly string[], levels: readonly StockLevel[]): string | null =>
  productIds.find((productId) => {
    const level = levels.find((candidate) => candidate.productId === productId);
    return level !== undefined && availableStock(level) < 1;
  }) ?? null;

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
  onHandAfter: number;
  reservedAfter: number;
  lowStockThreshold: number | null;
  lowStockNotifiedAt: string | null;
  oversold: boolean;
}

export const lowStockAlertFor = (effect: StockCommitEffect): { available: number; oversold: boolean } | null => {
  if (effect.outcome === 'unchanged') return null;
  const available = availableStock({ onHand: effect.onHandAfter, reserved: effect.reservedAfter });
  if (effect.oversold) return { available, oversold: true };
  if (effect.lowStockThreshold === null || available > effect.lowStockThreshold) return null;
  return effect.lowStockNotifiedAt === null || available === 0 ? { available, oversold: false } : null;
};
