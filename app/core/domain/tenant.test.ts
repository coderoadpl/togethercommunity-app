import { describe, expect, it } from 'vitest';

import {
  resolveInvoiceVat,
  resolveTenantSocial,
  tenantSettingsSchema,
  updateTenantSettingsInputSchema,
} from './tenant.js';

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

  it('accepts partial exemption updates and validates individual field bounds', () => {
    expect(updateTenantSettingsInputSchema.safeParse({ invoiceVatMode: 'exempt' }).success).toBe(true);
    expect(updateTenantSettingsInputSchema.safeParse({
      invoiceVatMode: 'exempt',
      invoiceExemptionBasisKind: 'art_43_1',
      invoiceExemptionBasis: 'art. 43 ust. 1 pkt 2',
    }).success).toBe(true);
    expect(updateTenantSettingsInputSchema.safeParse({
      invoiceVatMode: 'exempt',
      invoiceExemptionBasisKind: 'other',
      invoiceExemptionBasis: 'x'.repeat(257),
    }).success).toBe(false);
  });
});

describe('resolveInvoiceVat', () => {
  const base = tenantSettingsSchema.parse({ billingPortalUrl: null, bunnyStreamLibraryId: null });

  it('distinguishes configured, unset, and incomplete treatments', () => {
    expect(resolveInvoiceVat({ ...base, invoiceVatRatePercent: 23 })).toEqual({
      ok: true,
      treatment: { kind: 'rate', percent: 23 },
    });
    expect(resolveInvoiceVat(base)).toEqual({ ok: false, reason: 'unset' });
    expect(resolveInvoiceVat({ ...base, invoiceVatMode: null, invoiceVatRatePercent: 23 })).toEqual({
      ok: false,
      reason: 'unset',
    });
    expect(resolveInvoiceVat({ ...base, invoiceVatMode: 'exempt' })).toEqual({
      ok: false,
      reason: 'exempt_basis_missing',
    });
    expect(resolveInvoiceVat({
      ...base,
      invoiceVatMode: 'exempt',
      invoiceExemptionBasisKind: 'other_statute',
      invoiceExemptionBasis: '§ 1 rozporządzenia',
    })).toEqual({
      ok: true,
      treatment: {
        kind: 'exempt',
        basisKind: 'other_statute',
        basis: '§ 1 rozporządzenia',
      },
    });
  });
});

describe('resolveTenantSocial', () => {
  const tenant = { id: 'tenant-1', slug: 'acme', name: 'Acme', contentVersion: 1 };

  it('falls back to the tenant name and logo', () => {
    expect(resolveTenantSocial(tenant, {
      billingPortalUrl: null,
      bunnyStreamLibraryId: null,
      logoUrl: '/logo.svg',
      accentColor: null,
      faviconUrl: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      supportEmail: null,
      supportUrl: null,
      termsUrl: null,
      privacyUrl: null,
    })).toEqual({
      title: 'Acme',
      description: null,
      imageUrl: '/logo.svg',
    });
  });

  it('prefers configured social metadata', () => {
    expect(resolveTenantSocial(tenant, {
      billingPortalUrl: null,
      bunnyStreamLibraryId: null,
      logoUrl: '/logo.svg',
      accentColor: null,
      faviconUrl: null,
      ogTitle: 'Acme Academy',
      ogDescription: 'Learn with Acme',
      ogImageUrl: 'https://cdn.example.com/social.png',
      supportEmail: null,
      supportUrl: null,
      termsUrl: null,
      privacyUrl: null,
    })).toEqual({
      title: 'Acme Academy',
      description: 'Learn with Acme',
      imageUrl: 'https://cdn.example.com/social.png',
    });
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
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      supportEmail: null,
      supportUrl: null,
      termsUrl: null,
      privacyUrl: null,
    });
  });
});
