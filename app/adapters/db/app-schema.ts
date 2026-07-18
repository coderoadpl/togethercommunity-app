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
    billingPortalUrl: text('billing_portal_url'),
    bunnyStreamLibraryId: text('bunny_stream_library_id'),
    onboardingDismissedAt: text('onboarding_dismissed_at'),
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

export const productPrices = pgTable(
  'product_prices',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['one_time', 'recurring'] }).notNull(),
    interval: text('interval', { enum: ['month', 'year'] }),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('product_prices_tenantId_idx').on(table.tenantId),
    index('product_prices_tenant_product_idx').on(table.tenantId, table.productId),
  ],
);

export const orders = pgTable(
  'orders',
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
    priceId: text('price_id').references(() => productPrices.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['one_time', 'recurring'] }).notNull(),
    status: text('status', { enum: ['paid', 'pending', 'failed', 'refunded'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    provider: text('provider', { enum: ['stripe', 'simulated'] }).notNull(),
    providerObjectIds: jsonb('provider_object_ids')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('orders_tenant_created_idx').on(table.tenantId, table.createdAt.desc()),
    index('orders_tenant_member_idx').on(table.tenantId, table.memberId),
    index('orders_tenant_product_idx').on(table.tenantId, table.productId),
  ],
);

export const memberSubscriptions = pgTable(
  'member_subscriptions',
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
    priceId: text('price_id')
      .notNull()
      .references(() => productPrices.id, { onDelete: 'restrict' }),
    provider: text('provider', { enum: ['stripe', 'simulated'] }).notNull(),
    providerSubscriptionId: text('provider_subscription_id'),
    status: text('status', { enum: ['active', 'past_due', 'canceled'] }).notNull(),
    currentPeriodEnd: text('current_period_end').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('member_subscriptions_tenantId_idx').on(table.tenantId),
    index('member_subscriptions_tenant_member_idx').on(table.tenantId, table.memberId),
    uniqueIndex('member_subscriptions_provider_sub_uidx')
      .on(table.tenantId, table.providerSubscriptionId)
      .where(sql`${table.providerSubscriptionId} is not null`),
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
    source: text('source', { enum: ['simulated', 'manual', 'stripe'] }).notNull(),
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

export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    maskedPreview: text('masked_preview').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('tenant_secrets_tenantId_idx').on(table.tenantId),
    uniqueIndex('tenant_secrets_tenant_key_uidx').on(table.tenantId, table.key),
  ],
);

export const processedPaymentEvents = pgTable(
  'processed_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    objectId: text('object_id').notNull(),
    processedAt: text('processed_at').notNull(),
  },
  (table) => [
    index('processed_events_tenantId_idx').on(table.tenantId),
    uniqueIndex('processed_events_object_type_uidx').on(table.objectId, table.type),
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
    moduleOrder: jsonb('module_order').$type<string[]>().notNull().default([]),
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
    durationMinutes: integer('duration_minutes'),
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

export const posts = pgTable(
  'posts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contextKind: text('context_kind', { enum: ['lesson'] }).notNull(),
    contextId: text('context_id').notNull(),
    parentPostId: text('parent_post_id'),
    rootPostId: text('root_post_id').notNull(),
    authorUserId: text('author_user_id').notNull(),
    authorDisplay: text('author_display').notNull(),
    authorIsStaff: boolean('author_is_staff').notNull().default(false),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    editedAt: text('edited_at'),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('posts_tenant_context_created_idx').on(
      table.tenantId,
      table.contextKind,
      table.contextId,
      table.createdAt,
    ),
    index('posts_tenant_root_idx').on(table.tenantId, table.rootPostId),
  ],
);

export const threadSubscriptions = pgTable(
  'thread_subscriptions',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    rootPostId: text('root_post_id').notNull(),
    createdAt: text('created_at').notNull(),
    mutedAt: text('muted_at'),
  },
  (table) => [
    index('thread_subscriptions_tenant_root_idx').on(table.tenantId, table.rootPostId),
    uniqueIndex('thread_subscriptions_tenant_user_root_uidx').on(
      table.tenantId,
      table.userId,
      table.rootPostId,
    ),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id').notNull(),
    kind: text('kind', { enum: ['thread-reply'] }).notNull(),
    payload: jsonb('payload').notNull(),
    readAt: text('read_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('notifications_tenant_recipient_read_created_idx').on(
      table.tenantId,
      table.recipientUserId,
      table.readAt,
      table.createdAt.desc(),
    ),
  ],
);

export const entityVersions = pgTable(
  'entity_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entityKind: text('entity_kind', {
      enum: ['course', 'course_module', 'course_lesson', 'product'],
    }).notNull(),
    entityId: text('entity_id').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by'),
  },
  (table) => [
    index('entity_versions_tenant_entity_created_idx').on(
      table.tenantId,
      table.entityKind,
      table.entityId,
      table.createdAt.desc(),
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
