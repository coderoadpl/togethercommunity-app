import { z } from 'zod';
import { createStaffRefundInputSchema, orderListItemSchema, orderStaffRefundViewSchema, staffRefundPreviewSchema } from '#core/domain/index.js';

const orderIdSchema = z.object({ orderId: z.string().min(1) });

export const staffRefundContracts = {
  orderRefundPreview: { input: orderIdSchema, output: staffRefundPreviewSchema },
  orderRefundCreate: {
    input: createStaffRefundInputSchema.extend(orderIdSchema.shape),
    output: z.object({ refund: orderStaffRefundViewSchema, created: z.boolean() }),
  },
  orderShipAnyway: { input: orderIdSchema, output: z.object({ order: orderListItemSchema }) },
} as const;

export const STAFF_REFUND_ROUTES = {
  orderRefundPreview: { method: 'GET', path: '/api/orders/:orderId/refund-preview' },
  orderRefundCreate: { method: 'POST', path: '/api/orders/:orderId/refunds' },
  orderShipAnyway: { method: 'POST', path: '/api/orders/:orderId/packing-list' },
} as const;
