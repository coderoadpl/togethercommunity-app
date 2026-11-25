import { jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { tenants } from './app-schema.js';

export const staffListLayouts = pgTable('staff_list_layouts', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  listId: text('list_id').notNull(),
  layout: jsonb('layout').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.userId, table.listId] }),
]);
