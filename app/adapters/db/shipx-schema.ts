import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
