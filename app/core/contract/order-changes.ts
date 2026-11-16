import { orderChangeFeedQuerySchema, orderChangeFeedSchema } from '#core/domain/index.js';

export const orderChangeContracts = {
  orderChanges: { input: orderChangeFeedQuerySchema, output: orderChangeFeedSchema },
} as const;
export const ORDER_CHANGE_ROUTES = {
  orderChanges: { method: 'GET', path: '/api/orders/changes' },
} as const;
