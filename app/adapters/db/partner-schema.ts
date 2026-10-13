import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { checkoutSnapshots } from './checkout-snapshot-schema.js';
import { tenants, members, orders } from './app-schema.js';

export const partnerPrograms = pgTable('partner_programs', {
  id: text('id').primaryKey(), tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), name: text('name').notNull(), commissionPct: integer('commission_pct').notNull(), graceDays: integer('grace_days').notNull().default(14), status: text('status', { enum: ['active', 'archived'] }).notNull(), notes: text('notes').notNull(), createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(), revision: integer('revision').notNull(),
});
export const partners = pgTable('partners', {
  id: text('id').primaryKey(), tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), programId: text('program_id').notNull().references(() => partnerPrograms.id), memberId: text('member_id').notNull(), status: text('status', { enum: ['active', 'archived'] }).notNull(), createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [uniqueIndex('partners_program_member_uidx').on(table.programId, table.memberId), foreignKey({ columns: [table.tenantId, table.memberId], foreignColumns: [members.tenantId, members.id] })]);
export const partnerCodes = pgTable('partner_codes', {
  id: text('id').primaryKey(), tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), programId: text('program_id').notNull().references(() => partnerPrograms.id), partnerId: text('partner_id').notNull().references(() => partners.id), code: text('code').notNull(), discountPct: integer('discount_pct').notNull(), salesLinkIds: jsonb('sales_link_ids').$type<string[]>().notNull(), validFrom: timestamp('valid_from', { withTimezone: true, mode: 'string' }), validTo: timestamp('valid_to', { withTimezone: true, mode: 'string' }), maxRedemptions: integer('max_redemptions'), status: text('status', { enum: ['active', 'archived'] }).notNull(), stripeCouponId: text('stripe_coupon_id'), stripePromotionCodeId: text('stripe_promotion_code_id'), createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(), revision: integer('revision').notNull(),
}, (table) => [uniqueIndex('partner_codes_tenant_code_uidx').on(table.tenantId, sql`lower(${table.code})`)]);
export const commissions = pgTable('commissions', {
  id: text('id').primaryKey(), tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), orderId: text('order_id').notNull().references(() => orders.id), orderLineId: text('order_line_id').notNull(), programId: text('program_id').notNull().references(() => partnerPrograms.id), partnerId: text('partner_id').notNull().references(() => partners.id), partnerCodeId: text('partner_code_id').notNull().references(() => partnerCodes.id), baseCents: integer('base_cents').notNull(), pct: integer('pct').notNull(), amountCents: integer('amount_cents').notNull(), status: text('status', { enum: ['pending', 'payable', 'paid', 'voided'] }).notNull(), payableAt: timestamp('payable_at', { withTimezone: true, mode: 'string' }).notNull(), voidedReason: text('voided_reason'), payoutId: text('payout_id'), createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [uniqueIndex('commissions_order_line_uidx').on(table.tenantId, table.orderId, table.orderLineId)]);
export const partnerEvents = pgTable('partner_events', {
  id: text('id').primaryKey(), tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }), entityId: text('entity_id').notNull(), entityType: text('entity_type').notNull(), type: text('type').notNull(), snapshot: jsonb('snapshot').$type<unknown>().notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const partnerCheckoutReservations = pgTable('partner_checkout_reservations', {
  id: text('id').primaryKey().references(() => checkoutSnapshots.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  partnerCodeId: text('partner_code_id').notNull().references(() => partnerCodes.id),
  status: text('status', { enum: ['reserved', 'consumed', 'released'] }).notNull(),
  orderId: text('order_id').references(() => orders.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [index('partner_checkout_reservations_code_idx').on(table.tenantId, table.partnerCodeId)]);
