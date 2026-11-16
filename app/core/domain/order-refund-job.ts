import { z } from 'zod';

import { orderCancelReasonSchema, orderRefundJobStatusSchema, type Order } from './commerce.js';
import { currencySchema } from './product.js';

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
  submittedAt: z.string().datetime().nullable().default(null),
  statusChecks: z.number().int().nonnegative().default(0),
  keyGeneration: z.number().int().nonnegative().default(0),
  permissionBlockedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrderRefundJob = z.output<typeof orderRefundJobSchema>;
type OrderRefundJobStatus = OrderRefundJob['status'];

const outOfStockRefundIdempotencyKey = (orderId: string): string => `oos-refund-${orderId}`;

export const orderRefundIdempotencyKey = (job: Pick<OrderRefundJob, 'idempotencyKey' | 'keyGeneration'>): string =>
  job.keyGeneration === 0 ? job.idempotencyKey : `${job.idempotencyKey}-${String(job.keyGeneration)}`;

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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const ORDER_REFUND_RETRY_DELAYS_MS = [MINUTE_MS, 5 * MINUTE_MS, 30 * MINUTE_MS, 2 * HOUR_MS, 6 * HOUR_MS] as const;
const ORDER_REFUND_RETRY_EVERY_MS = 12 * HOUR_MS;
const ORDER_REFUND_RETRY_WINDOW_MS = 7 * DAY_MS;
const ORDER_REFUND_STATUS_CHECKS_AFTER_MS = [DAY_MS, 7 * DAY_MS] as const;
const ORDER_REFUND_PERMISSION_RETRY_MS = HOUR_MS;
const ORDER_REFUND_PERMISSION_WINDOW_MS = 72 * HOUR_MS;

const retryDelayMs = (attempt: number): number => ORDER_REFUND_RETRY_DELAYS_MS[attempt - 1] ?? ORDER_REFUND_RETRY_EVERY_MS;

export const orderRefundRetryAt = (failedAttempts: number, now: string, queuedAt: string): string | null => {
  const next = Date.parse(now) + retryDelayMs(failedAttempts);
  return next - Date.parse(queuedAt) > ORDER_REFUND_RETRY_WINDOW_MS ? null : new Date(next).toISOString();
};

export const orderRefundPermissionRetryAt = (blockedAt: string, now: string): string | null =>
  Date.parse(now) - Date.parse(blockedAt) >= ORDER_REFUND_PERMISSION_WINDOW_MS
    ? null
    : new Date(Date.parse(now) + ORDER_REFUND_PERMISSION_RETRY_MS).toISOString();

export const orderRefundStatusCheckAt = (submittedAt: string, completedChecks: number): string | null => {
  const after = ORDER_REFUND_STATUS_CHECKS_AFTER_MS[completedChecks];
  return after === undefined ? null : new Date(Date.parse(submittedAt) + after).toISOString();
};

type OrderRefundJobPhase = 'refund' | 'status_check';

export interface ClaimedOrderRefundJob {
  job: OrderRefundJob;
  phase: OrderRefundJobPhase;
  lease: { status: OrderRefundJobStatus; lockedAt: string };
}

export const ORDER_REFUND_ALERTS = ['retrying', 'blocked_permission', 'blocked_permission_failed', 'failed', 'failed_after_submission', 'unconfirmed'] as const;
export type OrderRefundAlert = (typeof ORDER_REFUND_ALERTS)[number];

export const orderRefundJobViewSchema = orderRefundJobSchema.pick({
  status: true,
  attempts: true,
  nextAttemptAt: true,
  lastError: true,
  amountCents: true,
  currency: true,
  idempotencyKey: true,
  providerRefundId: true,
  providerRefundStatus: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type OrderRefundJobView = z.output<typeof orderRefundJobViewSchema>;

export const orderRefundJobView = (job: OrderRefundJob): OrderRefundJobView =>
  orderRefundJobViewSchema.parse({ ...job, idempotencyKey: orderRefundIdempotencyKey(job) });
