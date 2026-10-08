import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { OrderLine } from '#core/domain/index.js';
import { tenants } from './app-schema.js';

export const checkoutSnapshots = pgTable('checkout_snapshots', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  salesLinkId: text('sales_link_id'),
  lines: jsonb('lines').$type<OrderLine[]>().notNull(),
  currency: text('currency').notNull(),
  createdAt: text('created_at').notNull(),
});

