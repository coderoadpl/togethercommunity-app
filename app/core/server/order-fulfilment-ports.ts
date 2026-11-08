import type { AppError, EmailOutboxPayload, OrderListItem, OrderShipment, Result } from '#core/domain/index.js';

export interface OrderShipmentEmail {
  id: string;
  to: string;
  payload: Extract<EmailOutboxPayload, { kind: 'order-shipped' }>;
}

export interface OrderFulfilmentRepository {
  ship(tenantId: string, input: {
    orderId: string;
    eventId: string;
    shipment: OrderShipment;
    email: OrderShipmentEmail | null;
  }): Promise<Result<OrderListItem, AppError>>;
}
