import { foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { orders, tenants } from './app-schema.js';

export const metaCapiEvents = pgTable('meta_capi_events', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  transactionId: text('transaction_id').primaryKey().references(() => orders.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true, mode: 'string' }),
  eventTime: timestamp('event_time', { withTimezone: true, mode: 'string' }),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'string' }).notNull(),
  status: text('status', { enum: ['sent', 'blocked', 'expired', 'failed'] }).notNull(),
  fbtraceId: text('fbtrace_id'),
  error: text('error'),
  fieldsSent: jsonb('fields_sent').$type<string[]>().notNull(),
}, (table) => [index('meta_capi_events_tenant_recorded_idx').on(table.tenantId, table.recordedAt),
  foreignKey({ name: 'meta_capi_events_tenant_order_fk', columns: [table.tenantId, table.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade')]);

export const metaCapiOutbox = pgTable('meta_capi_outbox', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').primaryKey().references(() => orders.id, { onDelete: 'cascade' }),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true, mode: 'string' }).notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  fbp: text('fbp'),
  textVersion: text('text_version').notNull(),
  textSnapshot: text('text_snapshot').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [index('meta_capi_outbox_due_idx').on(table.tenantId, table.availableAt),
  foreignKey({ name: 'meta_capi_outbox_tenant_order_fk', columns: [table.tenantId, table.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade')]);

export const metaCapiConsentEvidence = pgTable('meta_capi_consent_evidence', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  decision: text('decision', { enum: ['granted', 'denied', 'withdrawn'] }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
  textVersion: text('text_version').notNull(),
  textSnapshot: text('text_snapshot').notNull(),
  source: text('source').notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.orderId, table.decision] }),
  foreignKey({ name: 'meta_capi_consent_tenant_order_fk', columns: [table.tenantId, table.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade')]);
