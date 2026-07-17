import { z } from 'zod';

import { staffRoleSchema } from './identity.js';

export const tenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  contentVersion: z.number().int().positive(),
});

export type Tenant = z.infer<typeof tenantSchema>;

export const tenantSettingsSchema = z.object({
  billingPortalUrl: z.string().url().nullable(),
  bunnyStreamLibraryId: z.string().nullable(),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/** Partial update: omitted fields keep their stored value; '' and null clear a field. */
export const updateTenantSettingsInputSchema = z.object({
  billingPortalUrl: z
    .union([z.string().url(), z.literal('')])
    .nullable()
    .transform((value) => (value === '' || value === null ? null : value))
    .optional(),
  bunnyStreamLibraryId: z
    .string()
    .trim()
    .nullable()
    .transform((value) => (value === '' || value === null ? null : value))
    .optional(),
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
});

export type Member = z.infer<typeof memberSchema>;

export const memberWithProductIdsSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  tags: z.array(z.string()),
  marketingConsents: z.record(z.boolean()),
  externalCustomerIds: z.record(z.string()),
  createdAt: z.string(),
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
