import { z } from 'zod';

import { orderCancelReasonSchema, type Order } from './commerce.js';
import { currencySchema } from './product.js';

export const ORDER_REFUND_JOB_STATUSES = [
  'pending',
  'running',
  'submitted',
  'succeeded',
  'failed',
  'blocked_permission',
  'skipped_refunded',
] as const;

const orderRefundJobStatusSchema = z.enum(ORDER_REFUND_JOB_STATUSES);

export const orderRefundJobSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  orderId: z.string().min(1),
  paymentIntentId: z.string().min(1).nullable(),
  amountCents: z.number().int().positive(),
  currency: currencySchema,
  reason: orderCancelReasonSchema,
  idempotencyKey: z.string().min(1),
  status: orderRefundJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().datetime().nullable(),
  lockedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  providerRefundId: z.string().nullable(),
  providerRefundStatus: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrderRefundJob = z.infer<typeof orderRefundJobSchema>;

const outOfStockRefundIdempotencyKey = (orderId: string): string => `oos-refund-${orderId}`;

export const outOfStockRefundJob = (
  order: Pick<Order, 'id' | 'tenantId' | 'amountCents' | 'currency' | 'providerObjectIds'>,
  input: { id: string; now: string },
): OrderRefundJob => orderRefundJobSchema.parse({
  id: input.id,
  tenantId: order.tenantId,
  orderId: order.id,
  paymentIntentId: order.providerObjectIds['paymentIntent'] ?? null,
  amountCents: order.amountCents,
  currency: order.currency,
  reason: 'out_of_stock',
  idempotencyKey: outOfStockRefundIdempotencyKey(order.id),
  status: 'pending',
  attempts: 0,
  nextAttemptAt: input.now,
  lockedAt: null,
  lastError: null,
  providerRefundId: null,
  providerRefundStatus: null,
  createdAt: input.now,
  updatedAt: input.now,
});
