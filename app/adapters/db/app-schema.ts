import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import type { AccessItem, Chapter, LessonBlock } from '@core/domain/index.js';

export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
    contentVersion: integer('content_version').notNull().default(1),
  },
  (table) => [uniqueIndex('tenants_slug_uidx').on(table.slug)],
);

export const tenantAdmins = pgTable(
  'tenant_admins',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['owner', 'admin'] }).notNull(),
  },
  (table) => [
    index('tenant_admins_tenantId_idx').on(table.tenantId),
    index('tenant_admins_userId_idx').on(table.userId),
    uniqueIndex('tenant_admins_tenant_user_uidx').on(table.tenantId, table.userId),
  ],
);

export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    legacyId: text('legacy_id'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    marketingConsents: jsonb('marketing_consents')
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    externalCustomerIds: jsonb('external_customer_ids')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('members_tenantId_idx').on(table.tenantId),
    index('members_userId_idx').on(table.userId),
    uniqueIndex('members_tenant_user_uidx').on(table.tenantId, table.userId),
    uniqueIndex('members_tenant_legacy_uidx')
      .on(table.tenantId, table.legacyId)
      .where(sql`${table.legacyId} is not null`),
  ],
);

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull(),
    published: boolean('published').notNull().default(false),
    accessItems: jsonb('access_items').$type<AccessItem[]>().notNull().default([]),
    legacyId: text('legacy_id'),
    // ISO 8601 string; the domain speaks ISO strings, not driver-specific Dates.
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('products_tenantId_idx').on(table.tenantId),
    uniqueIndex('products_tenant_legacy_uidx')
      .on(table.tenantId, table.legacyId)
      .where(sql`${table.legacyId} is not null`),
  ],
);

export const productGrants = pgTable(
  'product_grants',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['simulated', 'manual'] }).notNull(),
    startsAt: text('starts_at')
      .notNull()
      .default(sql`to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`),
    expiresAt: text('expires_at'),
    legacyId: text('legacy_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('product_grants_tenantId_idx').on(table.tenantId),
    index('product_grants_memberId_idx').on(table.memberId),
    uniqueIndex('product_grants_tenant_member_product_uidx').on(
      table.tenantId,
      table.memberId,
      table.productId,
    ),
    uniqueIndex('product_grants_tenant_legacy_uidx')
      .on(table.tenantId, table.legacyId)
      .where(sql`${table.legacyId} is not null`),
  ],
);

export const tenantApiKeys = pgTable(
  'tenant_api_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('tenant_api_keys_tenantId_idx').on(table.tenantId),
    uniqueIndex('tenant_api_keys_key_hash_uidx').on(table.keyHash),
  ],
);

export const courses = pgTable(
  'courses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    imageUrl: text('image_url'),
    legacyId: text('legacy_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('courses_tenantId_idx').on(table.tenantId),
    uniqueIndex('courses_tenant_legacy_uidx')
      .on(table.tenantId, table.legacyId)
      .where(sql`${table.legacyId} is not null`),
  ],
);

export const courseModules = pgTable(
  'course_modules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseIds: jsonb('course_ids').$type<string[]>().notNull().default([]),
    title: text('title').notNull(),
    prefix: text('prefix'),
    chapters: jsonb('chapters').$type<Chapter[]>().notNull().default([]),
    legacyId: text('legacy_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('course_modules_tenantId_idx').on(table.tenantId),
    uniqueIndex('course_modules_tenant_legacy_uidx')
      .on(table.tenantId, table.legacyId)
      .where(sql`${table.legacyId} is not null`),
  ],
);

export const courseLessons = pgTable(
  'course_lessons',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contents: jsonb('contents').$type<LessonBlock[]>().notNull().default([]),
    legacyId: text('legacy_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('course_lessons_tenantId_idx').on(table.tenantId),
    uniqueIndex('course_lessons_tenant_legacy_uidx')
      .on(table.tenantId, table.legacyId)
      .where(sql`${table.legacyId} is not null`),
  ],
);

export const memberCourseProgress = pgTable(
  'member_course_progress',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    lastViewedLessonId: text('last_viewed_lesson_id'),
    lastViewedModuleId: text('last_viewed_module_id'),
    lastViewedChapterId: text('last_viewed_chapter_id'),
    completedLessonIds: jsonb('completed_lesson_ids').$type<string[]>().notNull().default([]),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('member_course_progress_tenantId_idx').on(table.tenantId),
    index('member_course_progress_memberId_idx').on(table.memberId),
    uniqueIndex('member_course_progress_tenant_member_course_uidx').on(
      table.tenantId,
      table.memberId,
      table.courseId,
    ),
  ],
);

export const devMagicLinks = pgTable('dev_magic_links', {
  email: text('email').primaryKey(),
  url: text('url').notNull(),
  token: text('token').notNull(),
  createdAt: text('created_at').notNull(),
});

export const devEmails = pgTable('dev_emails', {
  to: text('to').primaryKey(),
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull(),
});

export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    kind: text('kind', { enum: ['subdomain', 'custom'] }).notNull(),
    verified: boolean('verified').notNull().default(false),
  },
  (table) => [uniqueIndex('tenant_domains_domain_uidx').on(table.domain)],
);
