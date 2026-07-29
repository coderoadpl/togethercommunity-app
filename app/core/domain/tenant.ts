import { z } from 'zod';

import { staffRoleSchema } from './identity.js';

export const tenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  contentVersion: z.number().int().positive(),
});

export type Tenant = z.infer<typeof tenantSchema>;

export const RESERVED_TENANT_SLUGS = [
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'blog',
  'cdn',
  'dashboard',
  'dev',
  'docs',
  'ftp',
  'help',
  'login',
  'mail',
  'panel',
  'prod',
  'smtp',
  'staging',
  'static',
  'status',
  'support',
  'www',
] as const;

export const isReservedTenantSlug = (slug: string): boolean =>
  RESERVED_TENANT_SLUGS.some((reserved) => reserved === slug);

/** BYO pointer: an absolute URL or a root-relative path served by the app itself. */
export const brandingAssetUrlSchema = z.union([z.string().url(), z.string().regex(/^\/\S+$/)]);

export const accentColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const tenantBrandingSchema = z.object({
  logoUrl: brandingAssetUrlSchema.nullable().default(null),
  accentColor: accentColorSchema.nullable().default(null),
  faviconUrl: brandingAssetUrlSchema.nullable().default(null),
});

export type TenantBranding = z.output<typeof tenantBrandingSchema>;

export const EMPTY_TENANT_BRANDING: TenantBranding = {
  logoUrl: null,
  accentColor: null,
  faviconUrl: null,
};

const OG_TITLE_MAX_LENGTH = 70;
const OG_DESCRIPTION_MAX_LENGTH = 200;

const tenantSocialSchema = z.object({
  ogTitle: z.string().max(OG_TITLE_MAX_LENGTH).nullable().default(null),
  ogDescription: z.string().max(OG_DESCRIPTION_MAX_LENGTH).nullable().default(null),
  ogImageUrl: brandingAssetUrlSchema.nullable().default(null),
});

export const tenantSettingsSchema = z.object({
  billingPortalUrl: z.string().url().nullable(),
  bunnyStreamLibraryId: z.string().nullable(),
  logoUrl: brandingAssetUrlSchema.nullable().default(null),
  accentColor: accentColorSchema.nullable().default(null),
  faviconUrl: brandingAssetUrlSchema.nullable().default(null),
  supportEmail: z.string().email().nullable().default(null),
  supportConfigured: z.boolean().optional(),
  supportUrl: z.string().url().nullable().default(null),
  termsUrl: z.string().url().nullable().default(null),
  privacyUrl: z.string().url().nullable().default(null),
  autoIssueInvoices: z.boolean().optional(),
  autoIssueInvoiceScope: z.enum(['b2b_only', 'all']).optional(),
  invoiceVatRatePercent: z.union([z.literal(5), z.literal(8), z.literal(23)]).nullable().optional(),
  invoicingProvider: z.enum(['ifirma', 'ksef']).optional(),
  invoiceSellerName: z.string().nullable().optional(),
  invoiceSellerAddress: z.string().nullable().optional(),
}).extend(tenantSocialSchema.shape);

export type TenantSettings = z.output<typeof tenantSettingsSchema>;

const clearableBrandingAssetUrl = z
  .union([brandingAssetUrlSchema, z.literal('')])
  .nullable()
  .transform((value) => (value === '' || value === null ? null : value))
  .optional();

const clearableUrl = z
  .union([z.string().url(), z.literal('')])
  .nullable()
  .transform((value) => (value === '' || value === null ? null : value))
  .optional();

const clearableEmail = z
  .union([z.string().email(), z.literal('')])
  .nullable()
  .transform((value) => (value === '' || value === null ? null : value))
  .optional();

const clearableText = (max: number) => z
  .union([z.string().trim().max(max), z.literal('')])
  .nullable()
  .transform((value) => (value === '' || value === null ? null : value))
  .optional();

/** Partial update: omitted fields keep their stored value; '' and null clear a field. */
export const updateTenantSettingsInputSchema = z.object({
  billingPortalUrl: clearableUrl,
  bunnyStreamLibraryId: z
    .string()
    .trim()
    .nullable()
    .transform((value) => (value === '' || value === null ? null : value))
    .optional(),
  logoUrl: clearableBrandingAssetUrl,
  accentColor: z
    .union([accentColorSchema, z.literal('')])
    .nullable()
    .transform((value) => (value === '' || value === null ? null : value))
    .optional(),
  faviconUrl: clearableBrandingAssetUrl,
  ogTitle: clearableText(OG_TITLE_MAX_LENGTH),
  ogDescription: clearableText(OG_DESCRIPTION_MAX_LENGTH),
  ogImageUrl: clearableBrandingAssetUrl,
  supportEmail: clearableEmail,
  supportUrl: clearableUrl,
  termsUrl: clearableUrl,
  privacyUrl: clearableUrl,
  autoIssueInvoices: z.boolean().optional(),
  autoIssueInvoiceScope: z.enum(['b2b_only', 'all']).optional(),
  invoiceVatRatePercent: z.union([z.literal(5), z.literal(8), z.literal(23)]).nullable().optional(),
  invoicingProvider: z.enum(['ifirma', 'ksef']).optional(),
  invoiceSellerName: z.string().trim().min(1).nullable().optional(),
  invoiceSellerAddress: z.string().trim().min(1).nullable().optional(),
});

export type UpdateTenantSettingsInput = z.input<typeof updateTenantSettingsInputSchema>;

export const resolveTenantSocial = (
  tenant: Tenant,
  settings: TenantSettings | null,
): { title: string; description: string | null; imageUrl: string | null } => ({
  title: settings?.ogTitle ?? tenant.name,
  description: settings?.ogDescription ?? null,
  imageUrl: settings?.ogImageUrl ?? settings?.logoUrl ?? null,
});

export const tenantSupportPublicSchema = z.object({
  url: z.string().url().nullable(),
});

export type TenantSupportPublic = z.infer<typeof tenantSupportPublicSchema>;

export const membershipSchema = z.object({
  tenant: tenantSchema,
  staffRole: staffRoleSchema,
});

export type Membership = z.infer<typeof membershipSchema>;

export const memberSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  tags: z.array(z.string()),
  marketingConsents: z.record(z.boolean()),
  externalCustomerIds: z.record(z.string()),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
  bannedAt: z.string().datetime().nullable().default(null),
  bannedReason: z.string().nullable().default(null),
  bannedByUserId: z.string().nullable().default(null),
});

export type Member = z.infer<typeof memberSchema>;

export const DELETED_MEMBER_DISPLAY = 'Konto usunięte';

/**
 * A ban is a reversible moderation state: the person keeps their account, their
 * grants, their history and read access, and staff can lift it. Erasure
 * (memberTombstone) is irreversible pseudonymization of an identity. Never
 * implement one in terms of the other.
 */
export const MAX_MEMBER_BAN_REASON_LENGTH = 500;

/**
 * Removal keeps the member row for order-history integrity (ustawa o
 * rachunkowości) and erases only the personal data: the e-mail and userId are
 * replaced with markers derived from the opaque member id, so the row can never
 * be traced back to the person nor matched by a future sign-in or purchase.
 */
export const memberTombstone = (memberId: string): { email: string; userId: string } => ({
  email: `deleted-${memberId}@anonymized.invalid`,
  userId: `deleted:${memberId}`,
});

export const memberWithProductIdsSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  tags: z.array(z.string()),
  marketingConsents: z.record(z.boolean()),
  externalCustomerIds: z.record(z.string()),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
  bannedAt: z.string().datetime().nullable().default(null),
  bannedReason: z.string().nullable().default(null),
  productIds: z.array(z.string()),
  activeProductIds: z.array(z.string()),
});

export type MemberWithProductIds = z.infer<typeof memberWithProductIdsSchema>;

export const memberExportFormatSchema = z.enum(['csv', 'json']);

export type MemberExportFormat = z.infer<typeof memberExportFormatSchema>;

export const memberExportFileSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  content: z.string(),
});

export type MemberExportFile = z.infer<typeof memberExportFileSchema>;

export const tenantDomainSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  domain: z.string(),
  kind: z.enum(['subdomain', 'custom']),
  verified: z.boolean(),
});

export type TenantDomain = z.infer<typeof tenantDomainSchema>;
