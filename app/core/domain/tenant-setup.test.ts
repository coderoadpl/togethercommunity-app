import { describe, expect, it } from 'vitest';

import {
  computeTenantSetupReadiness,
  tenantSetupProgress,
  type TenantSetupFacts,
} from './tenant-setup.js';

const facts = (overrides: Partial<TenantSetupFacts> = {}): TenantSetupFacts => ({
  stripeConfigured: false,
  emailSendingConfigured: false,
  storageConfigured: false,
  legalTermsConfigured: false,
  publicHomeConfigured: false,
  billingPortalConfigured: false,
  videoConfigured: false,
  brandingConfigured: false,
  invoicingConfigured: false,
  ...overrides,
});

const REQUIRED_FACTS: Partial<TenantSetupFacts> = {
  stripeConfigured: true,
  emailSendingConfigured: true,
  storageConfigured: true,
  legalTermsConfigured: true,
  publicHomeConfigured: true,
};

describe('computeTenantSetupReadiness', () => {
  it('emits every item with a tier and a panel deep link', () => {
    const readiness = computeTenantSetupReadiness(facts());

    expect(readiness.items).toHaveLength(9);
    expect(readiness.items.map((item) => `${item.route}#${item.hash}`)).toEqual([
      '/panel/integrations#stripe',
      '/panel/integrations#email',
      '/panel/integrations#storage',
      '/panel/settings#legal',
      '/panel/settings#public-access',
      '/panel/integrations#stripe',
      '/panel/integrations#video',
      '/panel/settings#brand',
      '/panel/integrations#invoicing',
    ]);
    expect(readiness.items.filter((item) => item.tier === 'required').map((item) => item.id)).toEqual([
      'stripe',
      'email_sending',
      'storage',
      'legal_terms',
      'public_home',
    ]);
    expect(readiness.items.filter((item) => item.tier === 'optional').map((item) => item.id)).toEqual([
      'billing_portal',
      'video',
      'branding',
      'invoicing',
    ]);
  });

  it('maps each fact onto its own item', () => {
    const readiness = computeTenantSetupReadiness(facts({ storageConfigured: true, videoConfigured: true }));

    expect(
      Object.fromEntries(readiness.items.map((item) => [item.id, item.configured])),
    ).toEqual({
      stripe: false,
      email_sending: false,
      storage: true,
      legal_terms: false,
      public_home: false,
      billing_portal: false,
      video: true,
      branding: false,
      invoicing: false,
    });
  });
});

describe('tenantSetupProgress', () => {
  it('counts every item and reports required work as outstanding', () => {
    const progress = tenantSetupProgress(computeTenantSetupReadiness(facts({ videoConfigured: true })));

    expect(progress).toEqual({ configured: 1, total: 9, requiredComplete: false });
  });

  it('reports required work as complete while optional items stay open', () => {
    const progress = tenantSetupProgress(computeTenantSetupReadiness(facts(REQUIRED_FACTS)));

    expect(progress).toEqual({ configured: 5, total: 9, requiredComplete: true });
  });
});
