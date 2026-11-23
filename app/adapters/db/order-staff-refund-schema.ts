import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { ORDER_REFUND_JOB_STATUSES, STAFF_REFUND_KINDS } from '#core/domain/index.js';

import { orders, tenants } from './app-schema.js';

export const orderStaffRefunds = pgTable('order_staff_refunds', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull(),
  paymentIntentId: text('payment_intent_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull(),
  kind: text('kind', { enum: STAFF_REFUND_KINDS }).notNull(),
  requestKey: text('request_key').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status', { enum: ORDER_REFUND_JOB_STATUSES }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }),
  lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
  lastError: text('last_error'),
  providerRefundId: text('provider_refund_id'),
  providerRefundStatus: text('provider_refund_status'),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'string' }),
  statusChecks: integer('status_checks').notNull().default(0),
  keyGeneration: integer('key_generation').notNull().default(0),
  permissionBlockedAt: timestamp('permission_blocked_at', { withTimezone: true, mode: 'string' }),
  transientFailureStreak: integer('transient_failure_streak').notNull().default(0),
  createOutcomeUnknown: boolean('create_outcome_unknown').notNull().default(false),
  requestedByUserId: text('requested_by_user_id').notNull(),
  requestedByEmail: text('requested_by_email').notNull(),
  note: text('note'),
  restocked: boolean('restocked').notNull().default(false),
  removedFromPackingList: boolean('removed_from_packing_list').notNull().default(false),
  buyerNotifiedAt: timestamp('buyer_notified_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  foreignKey({ name: 'order_staff_refunds_tenant_order_fk', columns: [table.tenantId, table.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
  uniqueIndex('order_staff_refunds_tenant_request_key_uidx').on(table.tenantId, table.requestKey),
  uniqueIndex('order_staff_refunds_tenant_order_waiting_uidx').on(table.tenantId, table.orderId)
    .where(sql`${table.status} IN ('pending', 'running', 'blocked_permission')`),
  uniqueIndex('order_staff_refunds_idempotency_key_uidx').on(table.idempotencyKey),
  index('order_staff_refunds_due_idx').on(table.status, table.nextAttemptAt),
  index('order_staff_refunds_tenant_order_idx').on(table.tenantId, table.orderId, table.createdAt),
  check('order_staff_refunds_amount_check', sql`${table.amountCents} > 0`),
  check('order_staff_refunds_kind_check', sql`${table.kind} IN ('remainder', 'amount')`),
  check('order_staff_refunds_note_check', sql`char_length(${table.note}) <= 500`),
  check('order_staff_refunds_status_check', sql`${table.status} IN ('pending', 'running', 'submitted', 'succeeded', 'failed', 'blocked_permission', 'skipped_refunded', 'resolved_externally', 'unconfirmed')`),
]);
