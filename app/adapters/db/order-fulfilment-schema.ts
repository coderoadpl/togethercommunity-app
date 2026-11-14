import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { OrderShipment } from '#core/domain/index.js';
import { tenants } from './app-schema.js';

export const orderFulfilmentEvents = pgTable('order_fulfilment_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull(),
  type: text('type', { enum: ['shipped'] }).notNull(),
  payload: jsonb('payload').$type<Pick<OrderShipment, 'carrier' | 'trackingNumber'>>().notNull(),
  actorUserId: text('actor_user_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  uniqueIndex('order_fulfilment_events_tenant_order_type_uidx').on(table.tenantId, table.orderId, table.type),
  check('order_fulfilment_events_type_check', sql`${table.type} IN ('shipped')`),
]);
