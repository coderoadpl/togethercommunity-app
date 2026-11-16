import { sql } from 'drizzle-orm';
import { bigserial, boolean, check, customType, foreignKey, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { orders, tenants } from './app-schema.js';

const xid8 = customType<{ data: string; driverData: string }>({ dataType: () => 'xid8' });

export const orderChanges = pgTable('order_changes', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull(),
  xactId: xid8('xact_id').notNull().default(sql`pg_current_xact_id()`),
  changedAt: timestamp('changed_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: 'order_changes_tenant_order_fk', columns: [table.tenantId, table.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
  index('order_changes_tenant_cursor_idx').on(table.tenantId, table.xactId, table.id),
  index('order_changes_tenant_order_idx').on(table.tenantId, table.orderId),
]);

export const orderFeedEpoch = pgTable('order_feed_epoch', {
  singleton: boolean('singleton').primaryKey().default(true),
  epoch: text('epoch').notNull(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  check('order_feed_epoch_singleton_check', sql`${table.singleton}`),
  check('order_feed_epoch_epoch_check', sql`${table.epoch} ~ '^[0-9a-f]{32}$'`),
]);
