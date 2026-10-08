import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { SalesLink } from '#core/domain/index.js';
import { tenants } from './app-schema.js';

export const salesLinks = pgTable('sales_links', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(), title: text('title').notNull(), heading: text('heading').notNull(), description: text('description').notNull(),
  productIds: jsonb('product_ids').$type<string[]>().notNull(), active: boolean('active').notNull(), listed: boolean('listed').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true, mode: 'string' }), validTo: timestamp('valid_to', { withTimezone: true, mode: 'string' }),
  revision: integer('revision').notNull(), createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(), deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
}, (table) => [uniqueIndex('sales_links_tenant_slug_uidx').on(table.tenantId, table.slug).where(sql`${table.deletedAt} IS NULL`), check('sales_links_revision_check', sql`${table.revision} > 0`), check('sales_links_window_check', sql`${table.validFrom} IS NULL OR ${table.validTo} IS NULL OR ${table.validFrom} < ${table.validTo}`)]);
export const salesLinkEvents = pgTable('sales_link_events', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), salesLinkId: text('sales_link_id').notNull(), revision: integer('revision').notNull(), type: text('type', { enum: ['created', 'updated', 'deleted'] }).notNull(), snapshot: jsonb('snapshot').$type<SalesLink>().notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.salesLinkId, table.revision] }), check('sales_link_events_type_check', sql`${table.type} IN ('created', 'updated', 'deleted')`)]);
