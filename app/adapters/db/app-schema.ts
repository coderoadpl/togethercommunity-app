import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

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
    // ISO 8601 string; the domain speaks ISO strings, not driver-specific Dates.
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('products_tenantId_idx').on(table.tenantId)],
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
  ],
);

export const devMagicLinks = pgTable('dev_magic_links', {
  email: text('email').primaryKey(),
  url: text('url').notNull(),
  token: text('token').notNull(),
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
