import { index, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';

import type { PurchaseSmokeReceipt } from '#core/domain/index.js';

import { tenants } from './app-schema.js';

export const purchaseSmokeCheckouts = pgTable('purchase_smoke_checkouts', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reference: text('reference').primaryKey(),
  apiKeyId: text('api_key_id').notNull(),
  runId: text('run_id').notNull(),
  scenario: text('scenario').notNull(),
  sessionId: text('session_id').notNull(),
  url: text('url').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('purchase_smoke_checkouts_run_uidx').on(table.tenantId, table.apiKeyId, table.runId, table.scenario),
  uniqueIndex('purchase_smoke_checkouts_session_uidx').on(table.tenantId, table.sessionId),
  index('purchase_smoke_checkouts_created_idx').on(table.tenantId, table.createdAt),
]);

export const purchaseSmokeReceipts = pgTable('purchase_smoke_receipts', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reference: text('reference').notNull().references(() => purchaseSmokeCheckouts.reference, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull(),
  receipt: jsonb('receipt').$type<PurchaseSmokeReceipt>().notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.reference, table.eventId] })]);
