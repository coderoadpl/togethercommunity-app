import { describe, expect, it } from 'vitest';

import type { Identity, Space, TenantSettings } from '#core/domain/index.js';

import type { SpaceRepository } from '../ports.js';

import { getTenantSettings, updateTenantSettings, type TenantSettingsDeps } from './tenant-settings.js';

const settings: TenantSettings = {
  name: 'Alpha',
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
  supportEmail: 'private@creator.test',
  supportUrl: null,
  termsUrl: null,
  privacyUrl: null,
  defaultHomeSpaceId: null,
};

const space = (overrides: Partial<Space> = {}): Space => ({
  id: 'space-1',
  tenantId: 'tenant-1',
  slug: 'community',
  name: 'Community',
  description: null,
  visibility: 'members',
  productIds: [],
  publicReadOnly: true,
  position: 0,
  archivedAt: null,
  createdAt: '2026-07-15T10:00:00.000Z',
  ...overrides,
});

const spaceRepo = (stored: Space | null): SpaceRepository => ({
  list: async () => (stored === null ? [] : [stored]),
  findById: async (_tenantId, id) => (stored !== null && stored.id === id ? stored : null),
  findBySlug: async () => null,
  create: async () => undefined,
  update: async () => null,
  setArchived: async () => null,
  delete: async () => false,
  stats: async () => new Map(),
});

const identity = (staffRole: 'admin' | null): Identity => ({
  userId: 'user-1',
  email: 'user@example.com',
  name: 'User',
  emailVerified: true,
  tenantId: 'tenant-1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole,
  memberId: staffRole === null ? 'member-1' : null,
image: null,
memberDisplayName: null,
memberBannedAt: null,
memberDmOptOutAt: null,
});

const deps: TenantSettingsDeps = {
  tenants: {
    findById: async () => null,
    findBySlug: async () => null,
    findSole: async () => null,
    hasAny: async () => false,
    findSettings: async () => settings,
    updateSettings: async (_tenantId, next) => next,
    createTenantWithOwnerGrant: async () => {
      throw new Error('not used');
    },
  },
  spaces: spaceRepo(space()),
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

  it('round-trips the display name and social links while keeping the slug outside settings', async () => {
    const result = await updateTenantSettings(adminCtx, {
      name: 'Alpha Studio',
      socialLinks: [
        { label: 'Instagram', url: 'https://instagram.com/alpha' },
        { label: 'YouTube', url: 'https://youtube.com/@alpha' },
      ],
    }, deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        name: 'Alpha Studio',
        socialLinks: [
          { label: 'Instagram', url: 'https://instagram.com/alpha' },
          { label: 'YouTube', url: 'https://youtube.com/@alpha' },
        ],
      },
    });
    expect(result.ok && 'slug' in result.value).toBe(false);
  });

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

  it('rejects clearing the basis through a partial update while exempt', async () => {
    const exemptDeps: TenantSettingsDeps = {
      ...deps,
      tenants: {
        ...deps.tenants,
        findSettings: async () => ({
          ...settings,
          invoiceVatMode: 'exempt',
          invoiceVatRatePercent: null,
          invoiceExemptionBasisKind: 'art_113_1',
          invoiceExemptionBasis: 'art. 113 ust. 1',
        }),
      },
    };

    expect(await updateTenantSettings(adminCtx, {
      invoiceExemptionBasis: '',
    }, exemptDeps)).toMatchObject({
      ok: false,
      error: { code: 'invoice_exemption_basis_missing' },
    });
  });

  it('accepts a publicly readable active space as the tenant home space', async () => {
    expect(await updateTenantSettings(adminCtx, { defaultHomeSpaceId: 'space-1' }, deps)).toMatchObject({
      ok: true,
      value: { defaultHomeSpaceId: 'space-1' },
    });
  });

  it('clears the tenant home space with an empty value', async () => {
    expect(await updateTenantSettings(adminCtx, { defaultHomeSpaceId: '' }, deps)).toMatchObject({
      ok: true,
      value: { defaultHomeSpaceId: null },
    });
  });

  it.each([
    ['unknown', null],
    ['non-public', space({ publicReadOnly: false })],
    ['archived', space({ archivedAt: '2026-07-16T10:00:00.000Z' })],
  ])('rejects a %s space as the tenant home space', async (_label, stored) => {
    expect(
      await updateTenantSettings(adminCtx, { defaultHomeSpaceId: 'space-1' }, { ...deps, spaces: spaceRepo(stored) }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('clears exemption fields when switching back to a VAT rate', async () => {
    const exemptDeps: TenantSettingsDeps = {
      ...deps,
      tenants: {
        ...deps.tenants,
        findSettings: async () => ({
          ...settings,
          invoiceVatMode: 'exempt',
          invoiceVatRatePercent: null,
          invoiceExemptionBasisKind: 'art_113_1',
          invoiceExemptionBasis: 'art. 113 ust. 1',
        }),
      },
    };

    expect(await updateTenantSettings(adminCtx, {
      invoiceVatMode: 'rate',
      invoiceVatRatePercent: 23,
    }, exemptDeps)).toMatchObject({
      ok: true,
      value: {
        invoiceVatMode: 'rate',
        invoiceVatRatePercent: 23,
        invoiceExemptionBasisKind: null,
        invoiceExemptionBasis: null,
      },
    });
  });
});
