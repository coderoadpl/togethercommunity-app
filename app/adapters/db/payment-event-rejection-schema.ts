import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { tenants } from './app-schema.js';

export const paymentEventRejections = pgTable('payment_event_rejections', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  checkoutSessionId: text('checkout_session_id'),
  reasonCode: text('reason_code').notNull(),
  reasonMessage: text('reason_message').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'string' }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull(),
  attempts: integer('attempts').notNull().default(1),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.eventId] }),
  index('payment_event_rejections_unresolved_idx').on(table.tenantId, table.lastSeenAt).where(sql`${table.resolvedAt} IS NULL`),
  check('payment_event_rejections_attempts_check', sql`${table.attempts} > 0`),
]);
