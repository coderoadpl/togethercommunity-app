import { sql } from 'drizzle-orm';
import { bigserial, boolean, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import type {
  AccessItem,
  Campaign,
  Chapter,
  CheckoutConsentCapture,
  BillingData,
  InvoiceEvent,
  KsefInvoiceData,
  CouponScope,
  ConsentDocumentRef,
  ConsentDocumentVersionRef,
  ConsentEvidence,
  EmailEventType,
  EmailEventMailKind,
  LessonBlock,
  HeuristicSignal,
  SchedulerRunKind,
  SchedulerRunStatus,
  SchedulerRunTotals,
  SchedulerRunTrigger,
} from '#core/domain/index.js';

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
    ogTitle: text('og_title'),
    ogDescription: text('og_description'),
    ogImageUrl: text('og_image_url'),
    supportEmail: text('support_email'),
    supportUrl: text('support_url'),
    termsUrl: text('terms_url'),
    privacyUrl: text('privacy_url'),
    autoIssueInvoices: boolean('auto_issue_invoices').notNull().default(false),
    autoIssueInvoiceScope: text('auto_issue_invoice_scope', { enum: ['b2b_only', 'all'] })
      .notNull()
      .default('b2b_only'),
    invoiceVatRatePercent: integer('invoice_vat_rate_percent'),
    invoiceVatMode: text('invoice_vat_mode', { enum: ['rate', 'exempt'] }).notNull().default('rate'),
    invoiceExemptionBasisKind: text('invoice_exemption_basis_kind', {
      enum: ['art_113_1', 'art_113_9', 'art_43_1', 'other_statute', 'other'],
    }),
    invoiceExemptionBasis: text('invoice_exemption_basis'),
    invoicingProvider: text('invoicing_provider', { enum: ['ifirma', 'ksef'] }).notNull().default('ifirma'),
    invoiceSellerName: text('invoice_seller_name'),
    invoiceSellerAddress: text('invoice_seller_address'),
  },
  (table) => [
    uniqueIndex('tenants_slug_uidx').on(table.slug),
    check('tenants_invoice_vat_mode_check', sql`${table.invoiceVatMode} IN ('rate', 'exempt')`),
  ],
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
    bannedAt: text('banned_at'),
    bannedReason: text('banned_reason'),
    bannedByUserId: text('banned_by_user_id'),
  },
  (table) => [
    index('members_tenantId_idx').on(table.tenantId),
    index('members_userId_idx').on(table.userId),
    uniqueIndex('members_tenant_user_uidx').on(table.tenantId, table.userId),
    uniqueIndex('members_tenant_legacy_uidx')
      .on(table.tenantId, table.legacyId)
      .where(sql`${table.legacyId} is not null`),
    index('members_tenant_banned_idx')
      .on(table.tenantId, table.bannedAt)
      .where(sql`${table.bannedAt} is not null`),
  ],
);

export const memberEvents = pgTable(
  'member_events',
  {
    id: text('id').primaryKey(),
    sequence: bigserial('sequence', { mode: 'number' }),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('member_events_tenant_member_occurred_idx')
      .on(table.tenantId, table.memberId, table.occurredAt, table.sequence),
  ],
);

export const erasedMemberImports = pgTable(
  'erased_member_imports',
  {
    memberId: text('member_id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: text('legacy_id'),
    emailHmac: text('email_hmac').notNull(),
    erasedAt: text('erased_at').notNull(),
  },
  (table) => [
    index('erased_member_imports_tenant_email_hmac_idx').on(table.tenantId, table.emailHmac),
    uniqueIndex('erased_member_imports_tenant_legacy_uidx')
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
    type: text('type', { enum: ['course', 'digital_download', 'membership'] }).notNull().default('course'),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    coverUrl: text('cover_url'),
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull(),
    published: boolean('published').notNull().default(false),
    accessItems: jsonb('access_items').$type<AccessItem[]>().notNull().default([]),
    checkoutConsentDefinitionIds: jsonb('checkout_consent_definition_ids').$type<string[]>().notNull().default([]),
    legacyId: text('legacy_id'),
    // ISO 8601 string; the domain speaks ISO strings, not driver-specific Dates.
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('products_tenantId_idx').on(table.tenantId),
    uniqueIndex('products_tenant_slug_uidx').on(table.tenantId, table.slug),
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

export const productDownloadAssets = pgTable(
  'product_download_assets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status', { enum: ['pending', 'ready'] }).notNull().default('pending'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('product_download_assets_tenant_product_idx').on(table.tenantId, table.productId),
    uniqueIndex('product_download_assets_tenant_storage_key_uidx').on(table.tenantId, table.storageKey),
  ],
);

export const coupons = pgTable(
  'coupons',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    kind: text('kind', { enum: ['percent', 'amount'] }).notNull(),
    value: integer('value').notNull(),
    currency: text('currency'),
    scope: jsonb('scope').$type<CouponScope>().notNull(),
    appliesTo: text('applies_to', { enum: ['one_time', 'recurring', 'both'] }).notNull(),
    recurringDuration: text('recurring_duration', {
      enum: ['first_invoice', 'forever'],
    }).notNull().default('first_invoice'),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    maxRedemptions: integer('max_redemptions'),
    maxRedemptionsPerMember: integer('max_redemptions_per_member'),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    partnerLabel: text('partner_label'),
    stripeCouponId: text('stripe_coupon_id'),
    stripePromotionCodeId: text('stripe_promotion_code_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('coupons_tenant_code_uidx').on(table.tenantId, sql`upper(${table.code})`),
    index('coupons_tenant_partner_created_idx').on(
      table.tenantId,
      table.partnerLabel,
      table.createdAt.desc(),
      table.id,
    ),
    index('coupons_tenant_created_idx').on(table.tenantId, table.createdAt.desc(), table.id),
  ],
);

export const couponEvents = pgTable(
  'coupon_events',
  {
    id: text('id').primaryKey(),
    sequence: bigserial('sequence', { mode: 'number' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    couponId: text('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    type: text('type', { enum: ['created', 'archived'] }).notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('coupon_events_tenant_coupon_occurred_idx').on(
      table.tenantId,
      table.couponId,
      table.occurredAt,
      table.sequence,
    ),
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
    couponId: text('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
    discountCents: integer('discount_cents').notNull().default(0),
    billing: jsonb('billing').$type<BillingData>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('orders_tenant_created_idx').on(table.tenantId, table.createdAt.desc()),
    index('orders_tenant_member_idx').on(table.tenantId, table.memberId),
    index('orders_tenant_product_idx').on(table.tenantId, table.productId),
    index('orders_tenant_coupon_created_idx').on(table.tenantId, table.couponId, table.createdAt.desc()),
    uniqueIndex('orders_tenant_provider_checkout_uidx')
      .on(table.tenantId, table.provider, sql`(${table.providerObjectIds}->>'checkoutSession')`)
      .where(sql`${table.providerObjectIds} ? 'checkoutSession'`),
    uniqueIndex('orders_tenant_provider_invoice_uidx')
      .on(table.tenantId, table.provider, sql`(${table.providerObjectIds}->>'invoice')`)
      .where(sql`${table.providerObjectIds} ? 'invoice'`),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    status: text('status', {
      enum: ['requested', 'queued', 'submitting', 'processing', 'issued', 'delivered', 'failed', 'conflict'],
    }).notNull(),
    provider: text('provider').notNull(),
    providerInvoiceId: text('provider_invoice_id'),
    invoiceNumber: text('invoice_number'),
    pdfUrl: text('pdf_url'),
    error: text('error'),
    issuedAt: text('issued_at'),
    createdAt: text('created_at').notNull(),
    ksef: jsonb('ksef').$type<KsefInvoiceData>(),
  },
  (table) => [
    index('invoices_tenant_order_idx').on(table.tenantId, table.orderId),
    uniqueIndex('invoices_tenant_order_current_uidx')
      .on(table.tenantId, table.orderId)
      .where(sql`${table.status} <> 'failed'`),
  ],
);

export const invoiceEvents = pgTable(
  'invoice_events',
  {
    sequence: bigserial('sequence', { mode: 'number' }).primaryKey(),
    id: text('id').notNull().unique(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'restrict' }),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    type: text('type', {
      enum: [
        'requested',
        'provider_created',
        'issued',
        'delivered',
        'failed',
        'skipped',
        'refreshed',
        'frozen',
        'session_opened',
        'send_started',
        'submitted',
        'correlated',
        'processing',
        'upo_stored',
        'numbering_conflict',
      ],
    }).notNull(),
    error: text('error'),
    meta: jsonb('meta').$type<InvoiceEvent['meta']>().notNull().default({}),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('invoice_events_tenant_order_occurred_idx').on(
      table.tenantId,
      table.orderId,
      table.occurredAt,
      table.sequence,
    ),
  ],
);

export const ksefNumberSequences = pgTable(
  'ksef_number_sequences',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceType: text('invoice_type', { enum: ['VAT'] }).notNull(),
    year: integer('year').notNull(),
    nextValue: integer('next_value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('ksef_number_sequences_tenant_type_year_uidx')
      .on(table.tenantId, table.invoiceType, table.year),
  ],
);

export const ksefNumberAllocations = pgTable(
  'ksef_number_allocations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceType: text('invoice_type', { enum: ['VAT'] }).notNull(),
    year: integer('year').notNull(),
    sequence: integer('sequence').notNull(),
    p2: text('p2').notNull(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    allocatedAt: text('allocated_at').notNull(),
  },
  (table) => [
    uniqueIndex('ksef_number_allocations_tenant_type_sequence_uidx')
      .on(table.tenantId, table.invoiceType, table.year, table.sequence),
    uniqueIndex('ksef_number_allocations_tenant_type_p2_uidx')
      .on(table.tenantId, table.invoiceType, table.p2),
    uniqueIndex('ksef_number_allocations_tenant_order_uidx')
      .on(table.tenantId, table.orderId),
  ],
);

export const fiscalArtifacts = pgTable(
  'fiscal_artifacts',
  {
    key: text('key').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['fa3', 'upo'] }).notNull(),
    content: text('content').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('fiscal_artifacts_tenant_invoice_kind_uidx')
      .on(table.tenantId, table.invoiceId, table.kind),
  ],
);

export const ksefSubmissionJobs = pgTable(
  'ksef_submission_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['queued', 'running', 'completed', 'failed'] })
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lockedAt: text('locked_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('ksef_submission_jobs_invoice_uidx').on(table.invoiceId),
    index('ksef_submission_jobs_dispatch_idx').on(table.status, table.nextAttemptAt),
    uniqueIndex('ksef_submission_jobs_one_running_per_tenant_uidx')
      .on(table.tenantId)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    couponId: text('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'no action' }),
    email: text('email').notNull(),
    discountCents: integer('discount_cents').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('coupon_redemptions_order_uidx').on(table.orderId),
    index('coupon_redemptions_tenant_coupon_created_idx').on(
      table.tenantId,
      table.couponId,
      table.createdAt.desc(),
      table.id,
    ),
    index('coupon_redemptions_tenant_coupon_member_idx').on(
      table.tenantId,
      table.couponId,
      table.memberId,
    ),
  ],
);

export const couponRedemptionEvents = pgTable(
  'coupon_redemption_events',
  {
    id: text('id').primaryKey(),
    sequence: bigserial('sequence', { mode: 'number' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    redemptionId: text('redemption_id')
      .notNull()
      .references(() => couponRedemptions.id, { onDelete: 'restrict' }),
    couponId: text('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    type: text('type', { enum: ['redeemed'] }).notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('coupon_redemption_events_tenant_redemption_occurred_idx').on(
      table.tenantId,
      table.redemptionId,
      table.occurredAt,
      table.sequence,
    ),
  ],
);

export const couponCheckoutSessions = pgTable(
  'coupon_checkout_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    couponId: text('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    providerSessionId: text('provider_session_id'),
    memberEmail: text('member_email').notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    priceId: text('price_id').references(() => productPrices.id, { onDelete: 'set null' }),
    originalCents: integer('original_cents').notNull(),
    discountCents: integer('discount_cents').notNull(),
    finalCents: integer('final_cents').notNull(),
    currency: text('currency').notNull(),
    startedAt: text('started_at').notNull(),
  },
  (table) => [
    index('coupon_checkout_sessions_tenant_coupon_started_idx').on(
      table.tenantId,
      table.couponId,
      table.startedAt.desc(),
      table.id,
    ),
  ],
);

export const productPriceHistory = pgTable(
  'product_price_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    priceId: text('price_id').references(() => productPrices.id, { onDelete: 'set null' }),
    amountCents: integer('amount_cents').notNull(),
    effectiveFrom: text('effective_from').notNull(),
  },
  (table) => [
    index('product_price_history_lookup_idx').on(
      table.tenantId,
      table.productId,
      table.priceId,
      table.effectiveFrom.desc(),
    ),
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
    couponId: text('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
    couponDiscountCents: integer('coupon_discount_cents').notNull().default(0),
    couponRecurringDuration: text('coupon_recurring_duration', {
      enum: ['first_invoice', 'forever'],
    }),
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
    status: text('status').notNull().default('processed'),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'string' }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'string' }),
    workerId: text('worker_id'),
  },
  (table) => [
    index('processed_events_tenantId_idx').on(table.tenantId),
    uniqueIndex('processed_events_object_type_uidx').on(table.objectId, table.type),
    index('processed_events_lease_idx').on(table.status, table.leaseExpiresAt),
  ],
);

export const memberErasureRequests = pgTable(
  'member_erasure_requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['open', 'cancelled', 'completed', 'rejected'] }).notNull(),
    reason: text('reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'string' }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'string' }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
    resolvedByUserId: text('resolved_by_user_id'),
    resolutionNote: text('resolution_note'),
  },
  (table) => [
    uniqueIndex('member_erasure_requests_open_uidx')
      .on(table.tenantId, table.memberId)
      .where(sql`${table.status} = 'open'`),
    index('member_erasure_requests_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.requestedAt,
    ),
  ],
);

export const memberErasureRequestEvents = pgTable(
  'member_erasure_request_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestId: text('request_id')
      .notNull()
      .references(() => memberErasureRequests.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['requested', 'cancelled', 'completed', 'rejected'] }).notNull(),
    actorUserId: text('actor_user_id'),
    meta: jsonb('meta'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('member_erasure_request_events_request_idx').on(
      table.tenantId,
      table.requestId,
      table.occurredAt,
    ),
  ],
);

export const checkoutConsentCaptures = pgTable(
  'checkout_consent_captures',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    capture: jsonb('capture').$type<CheckoutConsentCapture>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('checkout_consent_captures_tenant_created_idx').on(table.tenantId, table.createdAt)],
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

export const lessonAttachments = pgTable(
  'lesson_attachments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => courseLessons.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status', { enum: ['pending', 'ready'] }).notNull().default('pending'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('lesson_attachments_tenant_lesson_idx').on(table.tenantId, table.lessonId),
    uniqueIndex('lesson_attachments_tenant_storage_key_uidx').on(table.tenantId, table.storageKey),
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
    pinnedAt: text('pinned_at'),
  },
  (table) => [
    index('posts_tenant_context_created_idx').on(
      table.tenantId,
      table.contextKind,
      table.contextId,
      table.createdAt,
    ),
    index('posts_tenant_root_idx').on(table.tenantId, table.rootPostId),
    index('posts_tenant_context_pinned_idx')
      .on(table.tenantId, table.contextKind, table.contextId, table.pinnedAt.desc())
      .where(sql`${table.pinnedAt} is not null`),
  ],
);

export const postReports = pgTable(
  'post_reports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    reporterUserId: text('reporter_user_id'),
    reporterDisplay: text('reporter_display'),
    source: text('source', { enum: ['member', 'heuristic'] }).notNull(),
    reason: text('reason', { enum: ['spam', 'harassment', 'off-topic', 'illegal', 'other'] }).notNull(),
    note: text('note'),
    signals: jsonb('signals').$type<HeuristicSignal[]>(),
    status: text('status', { enum: ['open', 'dismissed', 'resolved'] }).notNull(),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
    resolvedByUserId: text('resolved_by_user_id'),
  },
  (table) => [
    uniqueIndex('post_reports_tenant_post_reporter_uidx')
      .on(table.tenantId, table.postId, table.reporterUserId)
      .where(sql`${table.reporterUserId} is not null`),
    uniqueIndex('post_reports_tenant_post_heuristic_uidx')
      .on(table.tenantId, table.postId)
      .where(sql`${table.source} = 'heuristic'`),
    index('post_reports_tenant_status_created_idx')
      .on(table.tenantId, table.status, table.createdAt.desc(), table.id),
  ],
);

export const postReportEvents = pgTable(
  'post_report_events',
  {
    id: text('id').primaryKey(),
    sequence: bigserial('sequence', { mode: 'number' }),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    reportId: text('report_id').notNull().references(() => postReports.id, { onDelete: 'restrict' }),
    postId: text('post_id').notNull(),
    type: text('type', { enum: ['opened', 'dismissed', 'post_removed'] }).notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('post_report_events_tenant_report_occurred_idx')
      .on(table.tenantId, table.reportId, table.occurredAt, table.sequence),
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
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
    sesMessageId: text('ses_message_id'),
    transport: text('transport', { enum: ['tenant-ses', 'smtp', 'resend', 'platform'] }),
    deliveryStatus: text('delivery_status', { enum: ['delivered', 'bounced', 'complained'] }),
    deliveryOccurredAt: timestamp('delivery_occurred_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('email_outbox_dispatch_idx').on(table.status, table.nextAttemptAt),
    index('email_outbox_tenant_created_id_idx').on(table.tenantId, table.createdAt, table.id),
    index('email_outbox_tenant_normalized_to_created_id_idx')
      .on(table.tenantId, sql`lower(btrim(${table.to}))`, table.createdAt, table.id),
    uniqueIndex('email_outbox_ses_message_id_uidx')
      .on(table.sesMessageId)
      .where(sql`${table.sesMessageId} is not null`),
  ],
);

export const tenantTransactionalEmailPools = pgTable('tenant_transactional_email_pools', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  sent: integer('sent').notNull().default(0),
  reserved: integer('reserved').notNull().default(0),
  reservedAt: timestamp('reserved_at', { withTimezone: true, mode: 'string' }),
});

export const emailEvents = pgTable(
  'email_events',
  {
    id: text('id').primaryKey(),
    sequence: bigserial('sequence', { mode: 'number' }),
    tenantId: text('tenant_id').notNull(),
    mailKind: text('mail_kind').$type<EmailEventMailKind>().notNull(),
    refId: text('ref_id').notNull(),
    type: text('type').$type<EmailEventType>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
    meta: jsonb('meta').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('email_events_tenant_ref_occurred_idx').on(table.tenantId, table.refId, table.occurredAt, table.sequence),
    index('email_events_tenant_occurred_idx').on(table.tenantId, table.occurredAt, table.sequence),
  ],
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

export const schedulerRuns = pgTable(
  'scheduler_runs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<SchedulerRunKind>().notNull(),
    trigger: text('trigger').$type<SchedulerRunTrigger>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    durationMs: integer('duration_ms'),
    status: text('status').$type<SchedulerRunStatus>().notNull(),
    error: text('error'),
    totals: jsonb('totals').$type<SchedulerRunTotals>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('scheduler_runs_started_id_idx').on(table.startedAt, table.id),
    index('scheduler_runs_status_started_idx').on(table.status, table.startedAt),
  ],
);

export const schedulerRunTenants = pgTable(
  'scheduler_run_tenants',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => schedulerRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    campaignsTouched: integer('campaigns_touched').notNull(),
    batchSize: integer('batch_size').notNull(),
    sent: integer('sent').notNull(),
    failed: integer('failed').notNull(),
    skipped: integer('skipped').notNull(),
    budgetComputed: integer('budget_computed').notNull(),
    budgetUsed: integer('budget_used').notNull(),
    errors: jsonb('errors').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('scheduler_run_tenants_run_tenant_uidx').on(table.runId, table.tenantId),
    index('scheduler_run_tenants_tenant_run_idx').on(table.tenantId, table.runId),
  ],
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
    runId: text('run_id').references(() => schedulerRuns.id, { onDelete: 'set null' }),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['broadcast', 'api'] }).notNull(),
    memberId: text('member_id').references(() => members.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    subject: text('subject').notNull(),
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
    index('campaign_sends_tenant_created_id_idx').on(table.tenantId, table.createdAt, table.id),
    index('campaign_sends_tenant_email_created_id_idx').on(table.tenantId, table.email, table.createdAt, table.id),
    index('campaign_sends_tenant_run_created_id_idx').on(table.tenantId, table.runId, table.createdAt, table.id),
    index('campaign_sends_tenant_sent_at_idx').on(table.tenantId, table.sentAt),
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
    identityCheckedAt: timestamp('identity_checked_at', { withTimezone: true, mode: 'string' }),
    identityCheckError: text('identity_check_error'),
    configurationSet: text('configuration_set'),
    snsTopicArn: text('sns_topic_arn'),
    trackingEnabled: boolean('tracking_enabled').notNull().default(false),
    autoPauseOnCritical: boolean('auto_pause_on_critical').notNull().default(false),
    webhookToken: text('webhook_token').notNull(),
    quotaRatePerSec: doublePrecision('quota_rate_per_sec').notNull().default(0),
    quotaDaily: integer('quota_daily').notNull().default(0),
    quotaSentLast24Hours: integer('quota_sent_last_24_hours').notNull().default(0),
    quotaRefreshedAt: timestamp('quota_refreshed_at', { withTimezone: true, mode: 'string' }),
    inSandbox: boolean('in_sandbox').notNull().default(true),
    webhookVerifiedAt: timestamp('webhook_verified_at', { withTimezone: true, mode: 'string' }),
    footerLegalName: text('footer_legal_name').notNull().default(''),
    footerAddress: text('footer_address').notNull().default(''),
    broadcastsEnabled: boolean('broadcasts_enabled').notNull().default(false),
    reputationAlertStatus: text('reputation_alert_status', {
      enum: ['insufficient_data', 'ok', 'warn', 'critical'],
    }),
    reputationAlertedAt: timestamp('reputation_alerted_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (table) => [uniqueIndex('tenant_ses_settings_webhook_token_uidx').on(table.webhookToken)],
);

export const marketingThrottleBuckets = pgTable(
  'marketing_throttle_buckets',
  {
    tenantId: text('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
    tokens: doublePrecision('tokens').notNull(),
    lastRefillAt: timestamp('last_refill_at', { withTimezone: true, mode: 'string' }).notNull(),
    quotaSnapshotAt: timestamp('quota_snapshot_at', { withTimezone: true, mode: 'string' }).notNull(),
    reservedSinceSnapshot: integer('reserved_since_snapshot').notNull(),
  },
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
