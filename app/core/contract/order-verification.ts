import { z } from 'zod';
import { orderListItemSchema, orderVerificationReferenceSchema, issueOrderLineInputSchema } from '#core/domain/index.js';

export const orderVerificationContracts = {
  verifyOrder: { input: z.object({ reference: orderVerificationReferenceSchema }).strict(), output: z.object({ order: orderListItemSchema }) },
  issueOrderLine: { input: issueOrderLineInputSchema, output: z.object({ order: orderListItemSchema }) },
} as const;
export const ORDER_VERIFICATION_ROUTES = {
  verifyOrder: { method: 'GET', path: '/api/orders/verify/:reference' },
  issueOrderLine: { method: 'POST', path: '/api/orders/:orderId/lines/:productId/issue' },
} as const;
