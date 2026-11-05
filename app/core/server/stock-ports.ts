import type { AppError, Result, StockCommitEffect, StockLevel } from '#core/domain/index.js';

interface StockReleaseInput {
  reason: string;
  now: string;
}

export interface StockRepository {
  find(tenantId: string, productId: string): Promise<StockLevel | null>;
  listByProducts(tenantId: string, productIds: readonly string[]): Promise<StockLevel[]>;
  listByTenant(tenantId: string): Promise<StockLevel[]>;
  enableTracking(tenantId: string, input: { productId: string; onHand: number; lowStockThreshold: number | null; actorUserId: string | null; now: string }): Promise<Result<StockLevel, AppError>>;
  adjust(tenantId: string, input: { productId: string; delta: number; reason: string; actorUserId: string | null; now: string }): Promise<Result<StockLevel, AppError>>;
  setThreshold(tenantId: string, input: { productId: string; lowStockThreshold: number | null; now: string }): Promise<Result<StockLevel, AppError>>;
  reserve(tenantId: string, input: { checkoutSnapshotId: string; productIds: readonly string[]; expiresAt: string; quantity: 1; now: string }): Promise<Result<{ reservationIds: string[] }, { soldOutProductId: string }>>;
  release(tenantId: string, input: StockReleaseInput & ({ checkoutSnapshotId: string } | { reservationIds: readonly string[] })): Promise<number>;
  commit(tenantId: string, input: { checkoutSnapshotId: string | null; orderId: string; productIds: readonly string[]; now: string }): Promise<StockCommitEffect[]>;
  markLowStockNotified(tenantId: string, input: { productId: string; now: string }): Promise<void>;
  releaseExpired(now: string, limit: number, tenantId?: string): Promise<number>;
}
