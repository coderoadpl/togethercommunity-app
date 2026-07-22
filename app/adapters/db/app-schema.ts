import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import type {
  AccessItem,
  Campaign,
  Chapter,
  ConsentDocumentRef,
  ConsentDocumentVersionRef,
  ConsentEvidence,
  LessonBlock,
} from '@core/domain/index.js';

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
    logoUrl: text('logo_url'),
    accentColor: text('accent_color'),
    faviconUrl: text('favicon_url'),
    termsUrl: text('terms_url'),
    privacyUrl: text('privacy_url'),
  },
  (table) => [uniqueIndex('tenants_slug_uidx').on(table.slug)],
);

export const consents = pgTable(
  'consents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    email: text('email'),
    source: text('source', { enum: ['register', 'checkout'] }).notNull(),
    termsUrl: text('terms_url'),
    privacyUrl: text('privacy_url'),
    acceptedAt: text('accepted_at').notNull(),
  },
  (table) => [index('consents_tenant_email_idx').on(table.tenantId, table.email)],
);

export const tenantDocuments = pgTable(
  'tenant_documents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('tenant_documents_tenant_slug_uidx').on(table.tenantId, table.slug)],
);

export const tenantDocumentVersions = pgTable(
  'tenant_document_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull().references(() => tenantDocuments.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdBy: text('created_by'),
  },
  (table) => [
    uniqueIndex('tenant_document_versions_tenant_document_version_uidx')
      .on(table.tenantId, table.documentId, table.version),
  ],
);

export const consentDefinitions = pgTable(
  'consent_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    kind: text('kind', { enum: ['required_terms', 'optional_marketing'] }).notNull(),
    channel: text('channel', { enum: ['email'] }).notNull(),
    doubleOptIn: boolean('double_opt_in').notNull().default(true),
    documentRef: jsonb('document_ref').$type<ConsentDocumentRef>().notNull(),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('consent_definitions_tenant_key_uidx').on(table.tenantId, table.key)],
);

export const consentDefinitionVersions = pgTable(
  'consent_definition_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    definitionId: text('definition_id').notNull().references(() => consentDefinitions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    label: text('label').notNull(),
    documentVersionRef: jsonb('document_version_ref').$type<ConsentDocumentVersionRef>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdBy: text('created_by'),
  },
  (table) => [
    uniqueIndex('consent_definition_versions_tenant_definition_version_uidx')
      .on(table.tenantId, table.definitionId, table.version),
  ],
);

export const marketingConsents = pgTable(
  'marketing_consents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: text('member_id'),
    email: text('email').notNull(),
    definitionId: text('definition_id').notNull().references(() => consentDefinitions.id, { onDelete: 'restrict' }),
    definitionVersion: integer('definition_version').notNull(),
    wordingSnapshot: text('wording_snapshot').notNull(),
    documentRefSnapshot: jsonb('document_ref_snapshot').$type<ConsentDocumentVersionRef>().notNull(),
    status: text('status', { enum: ['granted', 'confirmed', 'withdrawn'] }).notNull(),
    previousId: text('previous_id'),
    source: text('source', { enum: ['checkout', 'panel', 'import', 'api', 'preference_page'] }).notNull(),
    evidence: jsonb('evidence').$type<ConsentEvidence>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('marketing_consents_tenant_email_definition_occurred_idx')
      .on(table.tenantId, table.email, table.definitionId, table.occurredAt.desc()),
  ],
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
    deletedAt: text('deleted_at'),
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
      .references(() => members.id, { onDelete: 'no action' }),
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
      .references(() => members.id, { onDelete: 'no action' }),
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
      .references(() => members.id, { onDelete: 'no action' }),
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
    contextKind: text('context_kind', { enum: ['lesson', 'space'] }).notNull(),
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

export const spaces = pgTable(
  'spaces',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    visibility: text('visibility', { enum: ['members', 'product'] }).notNull(),
    productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
    position: integer('position').notNull().default(0),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('spaces_tenantId_idx').on(table.tenantId),
    uniqueIndex('spaces_tenant_slug_uidx').on(table.tenantId, table.slug),
  ],
);

export const postReactions = pgTable(
  'post_reactions',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('post_reactions_tenant_post_idx').on(table.tenantId, table.postId),
    uniqueIndex('post_reactions_post_user_emoji_uidx').on(table.postId, table.userId, table.emoji),
  ],
);

export const spaceSubscriptions = pgTable(
  'space_subscriptions',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('space_subscriptions_tenant_space_idx').on(table.tenantId, table.spaceId),
    uniqueIndex('space_subscriptions_tenant_user_space_uidx').on(
      table.tenantId,
      table.userId,
      table.spaceId,
    ),
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
    kind: text('kind', { enum: ['thread-reply', 'space-post', 'lesson-question'] }).notNull(),
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
  headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
  messageId: text('message_id'),
  createdAt: text('created_at').notNull(),
});

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    to: text('to').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['queued', 'sending', 'sent', 'failed'] }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }).notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [index('email_outbox_dispatch_idx').on(table.status, table.nextAttemptAt)],
);

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

export const emailLayouts = pgTable(
  'email_layouts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    bodyHtml: text('body_html').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('email_layouts_tenant_name_uidx').on(table.tenantId, table.name)],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    bodySource: text('body_source').notNull(),
    layoutId: text('layout_id').references(() => emailLayouts.id, { onDelete: 'set null' }),
    consentDefinitionId: text('consent_definition_id').notNull().references(() => consentDefinitions.id, { onDelete: 'restrict' }),
    audienceFilter: jsonb('audience_filter').$type<Campaign['audienceFilter']>(),
    status: text('status', { enum: ['draft', 'scheduled', 'running', 'paused', 'cancelled', 'finished'] }).notNull(),
    sendAt: timestamp('send_at', { withTimezone: true, mode: 'string' }),
    snapshotMaxMemberId: text('snapshot_max_member_id'),
    cursorMemberId: text('cursor_member_id'),
    toSend: integer('to_send').notNull().default(0),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
    lockedBy: text('locked_by'),
    errorCount: integer('error_count').notNull().default(0),
    pausedReason: text('paused_reason'),
    audienceNameSnapshot: text('audience_name_snapshot'),
    consentLabelSnapshot: text('consent_label_snapshot'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('campaigns_tenant_status_send_at_idx').on(table.tenantId, table.status, table.sendAt),
    index('campaigns_lease_idx').on(table.status, table.lockedUntil),
  ],
);

export const campaignSends = pgTable(
  'campaign_sends',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['broadcast', 'api'] }).notNull(),
    memberId: text('member_id').references(() => members.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    consentRowId: text('consent_row_id').notNull().references(() => marketingConsents.id, { onDelete: 'restrict' }),
    unsubscribeTokenId: text('unsubscribe_token_id'),
    status: text('status', { enum: ['pending', 'sending', 'sent', 'failed', 'skipped'] }).notNull(),
    skipReason: text('skip_reason', { enum: ['suppressed', 'unsubscribed', 'not_consented', 'pending_confirmation'] }),
    sesMessageId: text('ses_message_id'),
    deliveryStatus: text('delivery_status', { enum: ['delivered', 'bounced', 'complained'] }),
    deliveryOccurredAt: timestamp('delivery_occurred_at', { withTimezone: true, mode: 'string' }),
    idempotencySource: text('idempotency_source'),
    renderedBodyPurgedAt: timestamp('rendered_body_purged_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('campaign_sends_tenant_campaign_status_idx').on(table.tenantId, table.campaignId, table.status),
    uniqueIndex('campaign_sends_ses_message_id_uidx')
      .on(table.sesMessageId)
      .where(sql`${table.sesMessageId} is not null`),
    uniqueIndex('campaign_sends_tenant_campaign_email_uidx')
      .on(table.tenantId, table.campaignId, table.email)
      .where(sql`${table.campaignId} is not null and ${table.source} = 'broadcast'`),
  ],
);

export const suppressions = pgTable(
  'suppressions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email'),
    emailHmac: text('email_hmac').notNull(),
    reason: text('reason', { enum: ['hard_bounce', 'complaint', 'manual', 'unsubscribe_global', 'erasure'] }).notNull(),
    sourceRef: text('source_ref'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    liftedAt: timestamp('lifted_at', { withTimezone: true, mode: 'string' }),
    liftedBy: text('lifted_by'),
  },
  (table) => [
    uniqueIndex('suppressions_tenant_email_hmac_active_uidx')
      .on(table.tenantId, table.emailHmac)
      .where(sql`${table.liftedAt} is null`),
  ],
);

export const unsubscribeTokens = pgTable(
  'unsubscribe_tokens',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    email: text('email').notNull(),
    memberId: text('member_id').references(() => members.id, { onDelete: 'set null' }),
    campaignSendId: text('campaign_send_id').references(() => campaignSends.id, { onDelete: 'set null' }),
    scope: text('scope').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [uniqueIndex('unsubscribe_tokens_token_uidx').on(table.token)],
);

export const consentConfirmationTokens = pgTable(
  'consent_confirmation_tokens',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    marketingConsentRowId: text('marketing_consent_row_id').notNull().references(() => marketingConsents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('consent_confirmation_tokens_token_uidx').on(table.token),
    index('consent_confirmation_tokens_expiry_idx').on(table.expiresAt),
  ],
);

export const tenantSesSettings = pgTable(
  'tenant_ses_settings',
  {
    tenantId: text('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name').notNull(),
    identity: text('identity').notNull(),
    identityVerifiedAt: timestamp('identity_verified_at', { withTimezone: true, mode: 'string' }),
    configurationSet: text('configuration_set'),
    snsTopicArn: text('sns_topic_arn'),
    webhookToken: text('webhook_token').notNull(),
    quotaRatePerSec: doublePrecision('quota_rate_per_sec').notNull().default(0),
    quotaDaily: integer('quota_daily').notNull().default(0),
    quotaRefreshedAt: timestamp('quota_refreshed_at', { withTimezone: true, mode: 'string' }),
    inSandbox: boolean('in_sandbox').notNull().default(true),
    webhookVerifiedAt: timestamp('webhook_verified_at', { withTimezone: true, mode: 'string' }),
    footerLegalName: text('footer_legal_name').notNull().default(''),
    footerAddress: text('footer_address').notNull().default(''),
    broadcastsEnabled: boolean('broadcasts_enabled').notNull().default(false),
  },
  (table) => [uniqueIndex('tenant_ses_settings_webhook_token_uidx').on(table.webhookToken)],
);

export const marketingIdempotencyKeys = pgTable(
  'marketing_idempotency_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestMethod: text('request_method').notNull(),
    requestPath: text('request_path').notNull(),
    requestHash: text('request_hash').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'string' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('marketing_idempotency_keys_tenant_key_uidx').on(table.tenantId, table.key),
    index('marketing_idempotency_keys_expiry_idx').on(table.expiresAt),
  ],
);
