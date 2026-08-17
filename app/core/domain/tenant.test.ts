import { describe, expect, it } from 'vitest';

import {
  isReservedTenantSlug,
  resolveInvoiceVat,
  resolveTenantSocial,
  tenantSchema,
  tenantSettingsSchema,
  updateTenantSettingsInputSchema,
} from './tenant.js';

describe('isReservedTenantSlug', () => {
  it('reserves the platform host label', () => {
    expect(isReservedTenantSlug('start')).toBe(true);
    expect(isReservedTenantSlug('starter')).toBe(false);
  });
});

describe('tenantSchema', () => {
  it('requires declared lifecycle status and plan values', () => {
    const tenant = {
      id: 'tenant-1',
      slug: 'acme',
      name: 'Acme',
      status: 'active',
      plan: 'self_hosted',
      contentVersion: 1,
    };

    expect(tenantSchema.parse(tenant)).toEqual(tenant);
    expect(tenantSchema.safeParse({ ...tenant, status: 'deleted' }).success).toBe(false);
    expect(tenantSchema.safeParse({ ...tenant, plan: 'enterprise' }).success).toBe(false);
  });
});

describe('updateTenantSettingsInputSchema', () => {
  it('leaves omitted fields undefined so the use-case can keep the stored value', () => {
    const parsed = updateTenantSettingsInputSchema.parse({});
    expect('billingPortalUrl' in parsed).toBe(false);
    expect('bunnyStreamLibraryId' in parsed).toBe(false);
    expect('bunnyStreamCdnHostname' in parsed).toBe(false);
  });

  it('treats an empty string as an explicit clear (null)', () => {
    expect(updateTenantSettingsInputSchema.parse({ billingPortalUrl: '' })).toEqual({ billingPortalUrl: null });
    expect(updateTenantSettingsInputSchema.parse({ bunnyStreamLibraryId: '' })).toEqual({ bunnyStreamLibraryId: null });
    expect(updateTenantSettingsInputSchema.parse({ bunnyStreamCdnHostname: '' })).toEqual({
      bunnyStreamCdnHostname: null,
    });
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
    expect(updateTenantSettingsInputSchema.parse({ bunnyStreamCdnHostname: '  vz-demo.b-cdn.net  ' })).toEqual({
      bunnyStreamCdnHostname: 'vz-demo.b-cdn.net',
    });
  });

  it('rejects a malformed billing-portal URL rather than storing garbage', () => {
    expect(updateTenantSettingsInputSchema.safeParse({ billingPortalUrl: 'not-a-url' }).success).toBe(false);
  });

  it('accepts only a bare CDN hostname', () => {
    expect(updateTenantSettingsInputSchema.safeParse({ bunnyStreamCdnHostname: 'vz-demo.b-cdn.net' }).success).toBe(true);
    expect(updateTenantSettingsInputSchema.safeParse({ bunnyStreamCdnHostname: 'https://vz-demo.b-cdn.net' }).success).toBe(false);
    expect(updateTenantSettingsInputSchema.safeParse({ bunnyStreamCdnHostname: 'vz-demo.b-cdn.net/path' }).success).toBe(false);
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

  it('accepts a renamed tenant and social profiles without exposing a slug update', () => {
    expect(updateTenantSettingsInputSchema.parse({
      name: '  Acme Academy  ',
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@acme' }],
      slug: 'renamed-slug',
    })).toEqual({
      name: 'Acme Academy',
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@acme' }],
    });
  });

  it('rejects empty names, malformed profile urls and more than eight links', () => {
    expect(updateTenantSettingsInputSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(updateTenantSettingsInputSchema.safeParse({
      socialLinks: [{ label: 'YouTube', url: 'not-a-url' }],
    }).success).toBe(false);
    expect(updateTenantSettingsInputSchema.safeParse({
      socialLinks: [{ label: 'YouTube', url: 'javascript:alert(1)' }],
    }).success).toBe(false);
    expect(updateTenantSettingsInputSchema.safeParse({
      socialLinks: Array.from({ length: 9 }, (_, index) => ({
        label: `Profile ${String(index)}`,
        url: `https://social.example.com/${String(index)}`,
      })),
    }).success).toBe(false);
  });
});

describe('resolveInvoiceVat', () => {
  const base = tenantSettingsSchema.parse({
    name: 'Acme',
    billingPortalUrl: null,
    bunnyStreamLibraryId: null,
    bunnyStreamCdnHostname: null,
  });

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
  const tenant = {
    id: 'tenant-1', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1,
  } as const;

  it('falls back to the tenant name and logo', () => {
    expect(resolveTenantSocial(tenant, {
      name: 'Acme',
      socialLinks: [],
      billingPortalUrl: null,
      bunnyStreamLibraryId: null,
      bunnyStreamCdnHostname: null,
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
      defaultHomeSpaceId: null,
    })).toEqual({
      title: 'Acme',
      description: null,
      imageUrl: '/logo.svg',
    });
  });

  it('prefers configured social metadata', () => {
    expect(resolveTenantSocial(tenant, {
      name: 'Acme',
      socialLinks: [],
      billingPortalUrl: null,
      bunnyStreamLibraryId: null,
      bunnyStreamCdnHostname: null,
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
      defaultHomeSpaceId: null,
    })).toEqual({
      title: 'Acme Academy',
      description: 'Learn with Acme',
      imageUrl: 'https://cdn.example.com/social.png',
    });
  });
});

describe('tenantSettingsSchema', () => {
  it('accepts a fully-cleared settings row', () => {
    expect(tenantSettingsSchema.parse({
      name: 'Acme',
      billingPortalUrl: null,
      bunnyStreamLibraryId: null,
      bunnyStreamCdnHostname: null,
    })).toEqual({
      name: 'Acme',
      socialLinks: [],
      billingPortalUrl: null,
      bunnyStreamLibraryId: null,
      bunnyStreamCdnHostname: null,
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
      defaultHomeSpaceId: null,
    });
  });
});
