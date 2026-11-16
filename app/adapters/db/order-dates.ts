import type { Order } from '#core/domain/index.js';

export const normalizeOrderDates = ({ clientReference, ...order }: Order): Order => ({
  ...order,
  ...(clientReference == null ? {} : { clientReference }),
  paidAt: order.paidAt == null ? null : new Date(order.paidAt).toISOString(),
});
