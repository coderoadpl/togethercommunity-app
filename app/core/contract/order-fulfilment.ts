import { z } from 'zod';
import { orderExportFileSchema, orderListItemSchema, packingListQuerySchema, shipOrderInputSchema } from '#core/domain/index.js';

export const orderFulfilmentContracts = {
  shipOrder: { input: shipOrderInputSchema, output: z.object({ order: orderListItemSchema }) },
  ordersPackingList: { input: packingListQuerySchema, output: orderExportFileSchema },
} as const;
export const ORDER_FULFILMENT_ROUTES = {
  shipOrder: { method: 'POST', path: '/api/orders/:orderId/ship' },
  ordersPackingList: { method: 'GET', path: '/api/orders/packing-list' },
} as const;
