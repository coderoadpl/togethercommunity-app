import { sql } from 'drizzle-orm';
import { bigserial, check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { SHIPX_SHIPMENT_EVENT_TYPES } from '#core/domain/index.js';
import { tenants } from './app-schema.js';

export const orderShipments = pgTable('order_shipments', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull(),
  provider: text('provider', { enum: ['inpost_shipx'] }).notNull(),
  environment: text('environment', { enum: ['sandbox', 'production'] }).notNull(),
  organizationId: text('organization_id').notNull(),
  providerShipmentId: text('provider_shipment_id'),
  status: text('status').notNull(),
  trackingNumber: text('tracking_number'),
  createAttemptedAt: timestamp('create_attempted_at', { withTimezone: true, mode: 'string' }),
  operationToken: text('operation_token'),
  operationStartedAt: timestamp('operation_started_at', { withTimezone: true, mode: 'string' }),
  boughtAt: timestamp('bought_at', { withTimezone: true, mode: 'string' }),
  labelFetchedAt: timestamp('label_fetched_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  uniqueIndex('order_shipments_tenant_order_uidx').on(table.tenantId, table.orderId),
  check('order_shipments_provider_check', sql`${table.provider} IN ('inpost_shipx')`),
  check('order_shipments_environment_check', sql`${table.environment} IN ('sandbox', 'production')`),
]);

export const orderShipmentEvents = pgTable('order_shipment_events', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sequence: bigserial('sequence', { mode: 'number' }).notNull(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull(),
  provider: text('provider', { enum: ['inpost_shipx'] }).notNull(),
  providerShipmentId: text('provider_shipment_id'),
  type: text('type', { enum: SHIPX_SHIPMENT_EVENT_TYPES }).notNull(),
  actorUserId: text('actor_user_id'),
  operationToken: text('operation_token'),
  details: jsonb('details').$type<Record<string, string | number | null>>(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  index('order_shipment_events_tenant_order_created_idx').on(table.tenantId, table.orderId, table.createdAt),
  check('order_shipment_events_provider_check', sql`${table.provider} IN ('inpost_shipx')`),
  check('order_shipment_events_type_check', sql`${table.type} IN ('attempt_claimed', 'attempt_marked', 'shipment_adopted', 'shipment_created', 'offer_bought', 'payment_failed', 'attempt_released', 'attempt_discarded', 'lease_taken_over', 'label_fetched')`),
]);
