import { describe, expect, it } from 'vitest';

import { tenantSettingsSchema, updateTenantSettingsInputSchema } from './tenant.js';

describe('updateTenantSettingsInputSchema', () => {
  it('leaves omitted fields undefined so the use-case can keep the stored value', () => {
    const parsed = updateTenantSettingsInputSchema.parse({});
    expect('billingPortalUrl' in parsed).toBe(false);
    expect('bunnyStreamLibraryId' in parsed).toBe(false);
  });

  it('treats an empty string as an explicit clear (null)', () => {
    expect(updateTenantSettingsInputSchema.parse({ billingPortalUrl: '' })).toEqual({ billingPortalUrl: null });
    expect(updateTenantSettingsInputSchema.parse({ bunnyStreamLibraryId: '' })).toEqual({ bunnyStreamLibraryId: null });
  });

  it('passes null through as a clear', () => {
    expect(updateTenantSettingsInputSchema.parse({ billingPortalUrl: null })).toEqual({ billingPortalUrl: null });
  });

  it('keeps a valid billing-portal URL and trims a library id', () => {
    expect(updateTenantSettingsInputSchema.parse({ billingPortalUrl: 'https://billing.example.com' })).toEqual({
      billingPortalUrl: 'https://billing.example.com',
    });
    expect(updateTenantSettingsInputSchema.parse({ bunnyStreamLibraryId: '  lib-1  ' })).toEqual({
      bunnyStreamLibraryId: 'lib-1',
    });
  });

  it('rejects a malformed billing-portal URL rather than storing garbage', () => {
    expect(updateTenantSettingsInputSchema.safeParse({ billingPortalUrl: 'not-a-url' }).success).toBe(false);
  });

  it('accepts supported domestic VAT rates and rejects arbitrary rates', () => {
    expect(updateTenantSettingsInputSchema.parse({ invoiceVatRatePercent: 8 })).toEqual({
      invoiceVatRatePercent: 8,
    });
    expect(updateTenantSettingsInputSchema.safeParse({ invoiceVatRatePercent: 12 }).success).toBe(false);
  });
});

describe('tenantSettingsSchema', () => {
  it('accepts a fully-cleared settings row', () => {
    expect(tenantSettingsSchema.parse({ billingPortalUrl: null, bunnyStreamLibraryId: null })).toEqual({
      billingPortalUrl: null,
      bunnyStreamLibraryId: null,
      logoUrl: null,
      accentColor: null,
      faviconUrl: null,
      termsUrl: null,
      privacyUrl: null,
    });
  });
});
