import type { Order } from '#core/domain/index.js';

export const normalizeOrderDates = ({ cancelReason, ...order }: Order): Order => ({
  ...order,
  ...(cancelReason == null ? {} : { cancelReason }),
  paidAt: order.paidAt == null ? null : new Date(order.paidAt).toISOString(),
});
