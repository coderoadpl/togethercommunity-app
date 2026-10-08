import type { AppError, OrderListItem, Result } from '#core/domain/index.js';

export interface OrderVerificationRepository {
  findByToken(tenantId: string, token: string): Promise<OrderListItem | null>;
  findByReference(tenantId: string, reference: string): Promise<OrderListItem | null>;
  issueLine(tenantId: string, input: { orderId: string; productId: string; staffUserId: string; occurredAt: string }): Promise<Result<OrderListItem, AppError>>;
}
