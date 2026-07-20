import { z } from 'zod';

import { staffRoleSchema } from './identity.js';

export const tenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  contentVersion: z.number().int().positive(),
});

export type Tenant = z.infer<typeof tenantSchema>;

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

export const tenantSettingsSchema = z.object({
  billingPortalUrl: z.string().url().nullable(),
  bunnyStreamLibraryId: z.string().nullable(),
  logoUrl: brandingAssetUrlSchema.nullable().default(null),
  accentColor: accentColorSchema.nullable().default(null),
  faviconUrl: brandingAssetUrlSchema.nullable().default(null),
  termsUrl: z.string().url().nullable().default(null),
  privacyUrl: z.string().url().nullable().default(null),
});

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
  termsUrl: clearableUrl,
  privacyUrl: clearableUrl,
});

export type UpdateTenantSettingsInput = z.input<typeof updateTenantSettingsInputSchema>;

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
});

export type Member = z.infer<typeof memberSchema>;

export const DELETED_MEMBER_DISPLAY = 'Konto usunięte';

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
