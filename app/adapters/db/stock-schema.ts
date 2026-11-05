import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { STOCK_EVENT_TYPES, STOCK_RESERVATION_STATUSES } from '#core/domain/index.js';

import { products, tenants } from './app-schema.js';

export interface StockEventReference {
  checkoutSnapshotId?: string;
  orderId?: string;
  reservationId?: string;
  reason?: string;
}

export const productStock = pgTable('product_stock', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  onHand: integer('on_hand').notNull(),
  reserved: integer('reserved').notNull().default(0),
  lowStockThreshold: integer('low_stock_threshold'),
  lowStockNotifiedAt: timestamp('low_stock_notified_at', { withTimezone: true, mode: 'string' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.productId] }),
  foreignKey({ name: 'product_stock_tenant_product_fk', columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }).onDelete('cascade'),
  check('product_stock_on_hand_check', sql`${table.onHand} >= 0`),
  check('product_stock_reserved_check', sql`${table.reserved} >= 0`),
  check('product_stock_low_stock_threshold_check', sql`${table.lowStockThreshold} >= 0`),
]);

export const stockEvents = pgTable('stock_events', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  type: text('type', { enum: STOCK_EVENT_TYPES }).notNull(),
  quantity: integer('quantity').notNull(),
  reference: jsonb('reference').$type<StockEventReference>().notNull().default({}),
  actorUserId: text('actor_user_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  foreignKey({ name: 'stock_events_tenant_product_fk', columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }).onDelete('cascade'),
  check('stock_events_type_check', sql`${table.type} IN ('tracking_enabled', 'adjusted', 'reserved', 'released', 'committed', 'committed_late', 'oversold', 'returned')`),
  index('stock_events_tenant_product_idx').on(table.tenantId, table.productId, table.occurredAt),
  index('stock_events_tenant_product_order_commit_idx')
    .on(table.tenantId, table.productId, sql`(${table.reference} ->> 'orderId')`)
    .where(sql`${table.type} IN ('committed', 'committed_late')`),
]);

export const stockReservations = pgTable('stock_reservations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  checkoutSnapshotId: text('checkout_snapshot_id').notNull(),
  quantity: integer('quantity').notNull().default(1),
  status: text('status', { enum: STOCK_RESERVATION_STATUSES }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
  foreignKey({ name: 'stock_reservations_tenant_product_fk', columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }).onDelete('cascade'),
  check('stock_reservations_quantity_check', sql`${table.quantity} > 0`),
  check('stock_reservations_status_check', sql`${table.status} IN ('active', 'committed', 'released')`),
  index('stock_reservations_tenant_status_expires_idx').on(table.tenantId, table.status, table.expiresAt),
  uniqueIndex('stock_reservations_tenant_snapshot_product_uidx').on(table.tenantId, table.checkoutSnapshotId, table.productId),
  index('stock_reservations_status_expires_idx').on(table.expiresAt).where(sql`${table.status} = 'active'`),
]);
