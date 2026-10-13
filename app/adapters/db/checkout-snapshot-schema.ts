import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { CheckoutSnapshot, OrderLine } from '#core/domain/index.js';
import { tenants } from './app-schema.js';

export const checkoutSnapshots = pgTable('checkout_snapshots', {
  mode: text('mode'),
  partnerCodeId: text('partner_code_id'),
  partnerTerms: jsonb('partner_terms').$type<NonNullable<CheckoutSnapshot['partnerTerms']>>(),
  discountCents: integer('discount_cents').notNull().default(0),
  providerSessionId: text('provider_session_id'),
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  salesLinkId: text('sales_link_id'),
  lines: jsonb('lines').$type<OrderLine[]>().notNull(),
  currency: text('currency').notNull(),
  createdAt: text('created_at').notNull(),
});

