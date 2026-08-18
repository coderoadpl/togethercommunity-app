import { z } from 'zod';

const TENANT_SETUP_ITEM_IDS = [
  'stripe',
  'email_sending',
  'storage',
  'legal_terms',
  'public_home',
  'billing_portal',
  'video',
  'branding',
  'invoicing',
] as const;

const tenantSetupItemIdSchema = z.enum(TENANT_SETUP_ITEM_IDS);

export type TenantSetupItemId = z.infer<typeof tenantSetupItemIdSchema>;

const tenantSetupTierSchema = z.enum(['required', 'optional']);

export type TenantSetupTier = z.infer<typeof tenantSetupTierSchema>;

const TENANT_SETUP_TIERS: Record<TenantSetupItemId, TenantSetupTier> = {
  stripe: 'required',
  email_sending: 'required',
  storage: 'required',
  legal_terms: 'required',
  public_home: 'required',
  billing_portal: 'optional',
  video: 'optional',
  branding: 'optional',
  invoicing: 'optional',
};

const TENANT_SETUP_TARGETS: Record<TenantSetupItemId, { route: string; hash: string }> = {
  stripe: { route: '/panel/integrations', hash: 'stripe' },
  email_sending: { route: '/panel/integrations', hash: 'email' },
  storage: { route: '/panel/integrations', hash: 'storage' },
  legal_terms: { route: '/panel/settings', hash: 'legal' },
  public_home: { route: '/panel/settings', hash: 'public-access' },
  billing_portal: { route: '/panel/integrations', hash: 'stripe' },
  video: { route: '/panel/integrations', hash: 'video' },
  branding: { route: '/panel/settings', hash: 'brand' },
  invoicing: { route: '/panel/integrations', hash: 'invoicing' },
};

const tenantSetupItemSchema = z.object({
  id: tenantSetupItemIdSchema,
  tier: tenantSetupTierSchema,
  configured: z.boolean(),
  route: z.string(),
  hash: z.string(),
});

export type TenantSetupItem = z.infer<typeof tenantSetupItemSchema>;

export const tenantSetupReadinessSchema = z.object({
  items: z.array(tenantSetupItemSchema),
});

export type TenantSetupReadiness = z.infer<typeof tenantSetupReadinessSchema>;

export interface TenantSetupFacts {
  stripeConfigured: boolean;
  emailSendingConfigured: boolean;
  storageConfigured: boolean;
  legalTermsConfigured: boolean;
  publicHomeConfigured: boolean;
  billingPortalConfigured: boolean;
  videoConfigured: boolean;
  brandingConfigured: boolean;
  invoicingConfigured: boolean;
}

export const computeTenantSetupReadiness = (facts: TenantSetupFacts): TenantSetupReadiness => {
  const configuredById: Record<TenantSetupItemId, boolean> = {
    stripe: facts.stripeConfigured,
    email_sending: facts.emailSendingConfigured,
    storage: facts.storageConfigured,
    legal_terms: facts.legalTermsConfigured,
    public_home: facts.publicHomeConfigured,
    billing_portal: facts.billingPortalConfigured,
    video: facts.videoConfigured,
    branding: facts.brandingConfigured,
    invoicing: facts.invoicingConfigured,
  };
  return {
    items: TENANT_SETUP_ITEM_IDS.map((id) => ({
      id,
      tier: TENANT_SETUP_TIERS[id],
      configured: configuredById[id],
      ...TENANT_SETUP_TARGETS[id],
    })),
  };
};

export const tenantSetupProgress = (
  readiness: TenantSetupReadiness,
): { configured: number; total: number; requiredComplete: boolean } => ({
  configured: readiness.items.filter((item) => item.configured).length,
  total: readiness.items.length,
  requiredComplete: readiness.items.every((item) => item.tier === 'optional' || item.configured),
});
