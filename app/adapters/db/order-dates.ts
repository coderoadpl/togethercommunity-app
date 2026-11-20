import type { Order } from '#core/domain/index.js';

export const normalizeOrderDates = ({ cancelReason, clientReference, ...order }: Order): Order => ({
  ...order,
  ...(cancelReason == null ? {} : { cancelReason }),
  ...(clientReference == null ? {} : { clientReference }),
  paidAt: order.paidAt == null ? null : new Date(order.paidAt).toISOString(),
});
