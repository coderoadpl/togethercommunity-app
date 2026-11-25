import { z } from 'zod';
import { deliveryCorrectionInputSchema, correctOrderPersonalizationInputSchema, orderExportFileSchema, orderListItemSchema, packingListQuerySchema, shipOrderInputSchema } from '#core/domain/index.js';

export const orderFulfilmentContracts = {
  correctOrderDelivery: { input: deliveryCorrectionInputSchema, output: z.object({ order: orderListItemSchema, recreateShipment: z.boolean() }) },
  shipOrder: { input: shipOrderInputSchema, output: z.object({ order: orderListItemSchema }) },
  ordersPackingList: { input: packingListQuerySchema, output: orderExportFileSchema },
  correctOrderPersonalization: { input: correctOrderPersonalizationInputSchema, output: z.object({ order: orderListItemSchema }) },
} as const;
export const ORDER_FULFILMENT_ROUTES = {
  correctOrderDelivery: { method: 'POST', path: '/api/orders/:orderId/delivery-details' },
  shipOrder: { method: 'POST', path: '/api/orders/:orderId/ship' },
  ordersPackingList: { method: 'GET', path: '/api/orders/packing-list' },
  correctOrderPersonalization: { method: 'POST', path: '/api/orders/:orderId/personalization' },
} as const;
