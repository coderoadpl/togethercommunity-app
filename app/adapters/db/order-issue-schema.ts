import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './app-schema.js';

export const orderIssueEvents = pgTable('order_issue_events', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull(),
  productId: text('product_id').notNull(),
  issuedCount: integer('issued_count').notNull(),
  staffUserId: text('staff_user_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.orderId, table.productId, table.issuedCount] })]);
