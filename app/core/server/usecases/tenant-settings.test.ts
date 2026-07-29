import { describe, expect, it } from 'vitest';

import type { Identity, TenantSettings } from '#core/domain/index.js';

import { getTenantSettings, updateTenantSettings, type TenantSettingsDeps } from './tenant-settings.js';

const settings: TenantSettings = {
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  logoUrl: null,
  accentColor: null,
  faviconUrl: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  supportEmail: 'private@creator.test',
  supportUrl: null,
  termsUrl: null,
  privacyUrl: null,
};

const identity = (staffRole: 'admin' | null): Identity => ({
  userId: 'user-1',
  email: 'user@example.com',
  name: 'User',
  tenantId: 'tenant-1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole,
  memberId: staffRole === null ? 'member-1' : null,
});

const deps: TenantSettingsDeps = {
  tenants: {
    findById: async () => null,
    findBySlug: async () => null,
    findSettings: async () => settings,
    updateSettings: async (_tenantId, next) => next,
    createTenantWithOwnerGrant: async () => {
      throw new Error('not used');
    },
  },
};

describe('getTenantSettings', () => {
  it('exposes support availability without exposing the private recipient to members', async () => {
    expect(await getTenantSettings({ identity: identity(null) }, deps)).toEqual({
      ok: true,
      value: { ...settings, supportEmail: null, supportConfigured: true },
    });
  });

  it('keeps the support recipient visible to staff settings', async () => {
    expect(await getTenantSettings({ identity: identity('admin') }, deps)).toEqual({
      ok: true,
      value: { ...settings, supportConfigured: true },
    });
  });
});

describe('updateTenantSettings', () => {
  const adminCtx = {
    identity: identity('admin'),
    capabilities: ['tenant:settings:write' as const],
  };

  it('rejects an exempt mode without a legal basis', async () => {
    expect(await updateTenantSettings(adminCtx, {
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: null,
      invoiceExemptionBasis: null,
    }, deps)).toMatchObject({
      ok: false,
      error: { code: 'invoice_exemption_basis_missing' },
    });
  });

  it('stores a coherent exempt treatment', async () => {
    expect(await updateTenantSettings(adminCtx, {
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: 'art_113_1',
      invoiceExemptionBasis: 'art. 113 ust. 1',
    }, deps)).toMatchObject({
      ok: true,
      value: {
        invoiceVatMode: 'exempt',
        invoiceVatRatePercent: null,
        invoiceExemptionBasisKind: 'art_113_1',
        invoiceExemptionBasis: 'art. 113 ust. 1',
      },
    });
  });
});
