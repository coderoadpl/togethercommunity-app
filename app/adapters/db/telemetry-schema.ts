import { bigint, bigserial, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type { TelemetryEvent, TelemetryStoreSettings } from '#core/domain/telemetry.js';

export const telemetryConnections = pgTable('telemetry_connections', {
  tenantId: text('tenant_id').primaryKey(),
  settings: jsonb('settings').$type<TelemetryStoreSettings>().notNull(),
});
export const telemetryAccounting = pgTable('telemetry_accounting', {
  tenantId: text('tenant_id').primaryKey(),
  pendingBytes: integer('pending_bytes').notNull().default(0),
  lastAcknowledgedSequence: bigint('last_acknowledged_sequence', { mode: 'number' }).notNull().default(0),
  lastAcknowledgedAt: timestamp('last_acknowledged_at', { mode: 'string', withTimezone: true }),
  gapCount: integer('gap_count').notNull().default(0),
  gapFrom: timestamp('gap_from', { mode: 'string', withTimezone: true }),
  gapThrough: timestamp('gap_through', { mode: 'string', withTimezone: true }),
}, (table) => [check('telemetry_pending_bytes_nonnegative', sql`${table.pendingBytes} >= 0`)]);
export const telemetryOutbox = pgTable('telemetry_outbox', {
  sequence: bigserial('sequence', { mode: 'number' }).primaryKey(),
  tenantId: text('tenant_id').notNull(),
  eventId: text('event_id').notNull(),
  event: jsonb('event').$type<TelemetryEvent>().notNull(),
  chargedBytes: integer('charged_bytes').notNull(),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull(),
  retryAt: timestamp('retry_at', { mode: 'string', withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
}, (table) => [
  uniqueIndex('telemetry_outbox_event_unique').on(table.tenantId, table.eventId),
  index('telemetry_outbox_tenant_sequence').on(table.tenantId, table.sequence),
]);
