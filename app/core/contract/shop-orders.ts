import { z } from 'zod';

import { listOrdersQuerySchema, type ShopManagementScope } from '#core/domain/index.js';

import { orderFulfilmentContracts } from './order-fulfilment.js';
import { orderVerificationContracts } from './order-verification.js';
import { orderDetailOutputSchema, ordersExportOutputSchema, ordersExportQuerySchema, ordersListOutputSchema } from './routes.js';
import { shipxContracts } from './shipx.js';

const READ = 'shop:orders:read' satisfies ShopManagementScope;
const FULFIL = 'shop:fulfilment:write' satisfies ShopManagementScope;

export const SHOP_ORDER_ROUTES = {
  listOrders: { method: 'GET', path: '/api/m2m/shop/orders', scope: READ },
  exportOrders: { method: 'GET', path: '/api/m2m/shop/orders/export', scope: READ },
  ordersPackingList: { method: 'GET', path: '/api/m2m/shop/orders/packing-list', scope: READ },
  verifyOrder: { method: 'GET', path: '/api/m2m/shop/orders/verify/:reference', scope: READ },
  getOrder: { method: 'GET', path: '/api/m2m/shop/orders/:orderId', scope: READ },
  shipOrder: { method: 'POST', path: '/api/m2m/shop/orders/:orderId/ship', scope: FULFIL },
  issueOrderLine: { method: 'POST', path: '/api/m2m/shop/orders/:orderId/lines/:productId/issue', scope: FULFIL },
  shipxShipment: { method: 'GET', path: '/api/m2m/shop/orders/:orderId/shipx', scope: READ },
  shipxCreate: { method: 'POST', path: '/api/m2m/shop/orders/:orderId/shipx', scope: FULFIL },
  shipxRefresh: { method: 'POST', path: '/api/m2m/shop/orders/:orderId/shipx/refresh', scope: FULFIL },
  shipxDiscard: { method: 'POST', path: '/api/m2m/shop/orders/:orderId/shipx/discard', scope: FULFIL },
  shipxLabel: { method: 'POST', path: '/api/m2m/shop/orders/:orderId/shipx/label', scope: FULFIL },
} as const;

export const shopOrderContracts = {
  listOrders: { input: listOrdersQuerySchema, output: ordersListOutputSchema },
  exportOrders: { input: ordersExportQuerySchema, output: ordersExportOutputSchema },
  ordersPackingList: orderFulfilmentContracts.ordersPackingList,
  verifyOrder: orderVerificationContracts.verifyOrder,
  getOrder: { input: z.object({ orderId: z.string().min(1) }).strict(), output: orderDetailOutputSchema },
  shipOrder: orderFulfilmentContracts.shipOrder,
  issueOrderLine: orderVerificationContracts.issueOrderLine,
  shipxShipment: shipxContracts.shipxShipment,
  shipxCreate: shipxContracts.shipxCreate,
  shipxRefresh: shipxContracts.shipxRefresh,
  shipxDiscard: shipxContracts.shipxDiscard,
  shipxLabel: shipxContracts.shipxLabel,
} as const;
