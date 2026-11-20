import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import type { OrganizationAuditEvent } from '#core/domain/index.js';

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  maxWorkspaces: integer('max_workspaces').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('organizations_slug_uidx').on(table.slug),
  check('organizations_status_check', sql`${table.status} IN ('active', 'suspended')`),
  check('organizations_max_workspaces_check', sql`${table.maxWorkspaces} >= 0`),
]);

export const organizationMembers = pgTable('organization_members', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  role: text('role', { enum: ['owner', 'admin'] }).notNull(),
  createdAt: text('created_at').notNull(),
  createdByUserId: text('created_by_user_id').notNull(),
}, (table) => [
  uniqueIndex('organization_members_org_user_uidx').on(table.organizationId, table.userId),
  index('organization_members_user_idx').on(table.userId),
  check('organization_members_role_check', sql`${table.role} IN ('owner', 'admin')`),
]);

export const organizationAuditEvents = pgTable('organization_audit_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  actorEmail: text('actor_email').notNull(),
  actorKeyId: text('actor_key_id'),
  subjectTenantId: text('subject_tenant_id'),
  subjectUserId: text('subject_user_id'),
  data: jsonb('data').$type<OrganizationAuditEvent['data']>().notNull().default({}),
  at: text('at').notNull(),
}, (table) => [index('organization_audit_events_org_at_idx').on(table.organizationId, table.at)]);
