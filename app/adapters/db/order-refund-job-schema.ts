import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { ORDER_REFUND_JOB_STATUSES } from '#core/domain/index.js';

import { orders, tenants } from './app-schema.js';

export const orderRefundJobs = pgTable('order_refund_jobs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull(),
  paymentIntentId: text('payment_intent_id'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull(),
  reason: text('reason', { enum: ['out_of_stock'] }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status', { enum: ORDER_REFUND_JOB_STATUSES }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }),
  lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
  lastError: text('last_error'),
  providerRefundId: text('provider_refund_id'),
  providerRefundStatus: text('provider_refund_status'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  foreignKey({ name: 'order_refund_jobs_tenant_order_fk', columns: [table.tenantId, table.orderId], foreignColumns: [orders.tenantId, orders.id] }),
  uniqueIndex('order_refund_jobs_tenant_order_uidx').on(table.tenantId, table.orderId),
  uniqueIndex('order_refund_jobs_idempotency_key_uidx').on(table.idempotencyKey),
  index('order_refund_jobs_due_idx').on(table.status, table.nextAttemptAt),
  check('order_refund_jobs_amount_check', sql`${table.amountCents} > 0`),
  check('order_refund_jobs_reason_check', sql`${table.reason} IN ('out_of_stock')`),
  check('order_refund_jobs_status_check', sql`${table.status} IN ('pending', 'running', 'submitted', 'succeeded', 'failed', 'blocked_permission', 'skipped_refunded')`),
]);
