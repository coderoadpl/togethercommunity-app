import type { Order } from '#core/domain/index.js';

export const normalizeOrderDates = (order: Order): Order => ({
  ...order,
  paidAt: order.paidAt == null ? null : new Date(order.paidAt).toISOString(),
});
