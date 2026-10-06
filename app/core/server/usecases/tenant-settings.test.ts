import { describe, expect, it } from 'vitest';

import type { Identity, Space, TenantSettings } from '#core/domain/index.js';

import type { SpaceRepository } from '../ports.js';

import { getTenantSettings, updateTenantSettings, type TenantSettingsDeps } from './tenant-settings.js';

const settings: TenantSettings = {
  name: 'Alpha',
  socialLinks: [],
  signInNotice: { enabled: false, text: '' },
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null,
  logoUrl: null,
  logoDarkUrl: null,
  accentColor: null,
  accentLight: null,
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
  tenantAccess: staffRole === null ? 'member' : 'staff',
  tenantId: 'tenant-1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole,
  memberId: staffRole === null ? 'member-1' : null,
image: null,
memberDisplayName: null,
memberBannedAt: null,
memberDmOptOutAt: null,
memberLanguage: null,
memberVideoAutoplay: false,
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
  products: { bumpContentVersion: async () => undefined },
  personalisationMaxBytes: 20 * 1024 * 1024,
};

describe('getTenantSettings', () => {
  it('exposes support availability without exposing the private recipient to members', async () => {
    expect(await getTenantSettings({ identity: identity(null) }, deps)).toEqual({
      ok: true,
      value: {
        settings: { ...settings, supportEmail: null, supportConfigured: true },
        personalisationMaxBytes: null,
      },
    });
  });

  it('keeps the support recipient visible to staff settings', async () => {
    expect(await getTenantSettings({ identity: identity('admin') }, deps)).toEqual({
      ok: true,
      value: {
        settings: { ...settings, supportConfigured: true },
        personalisationMaxBytes: deps.personalisationMaxBytes,
      },
    });
  });

  it('returns the personalisation limit only for staff settings readers', async () => {
    const limit = 12_345;
    const configured = { ...deps, personalisationMaxBytes: limit };
    const impersonatedMember = {
      identity: identity(null),
      impersonation: {
        id: 'impersonation-1',
        subjectMemberId: 'member-1',
        subjectName: 'Member',
        actorUserId: 'owner-1',
        actorEmail: 'owner@example.test',
        actorName: 'Owner',
        actorStaffRole: 'owner' as const,
        expiresAt: '1998-07-12T12:00:00.000Z',
      },
    };
    const apiKey = { identity: { ...identity(null), memberId: null, tenantAccess: 'none' as const }, capabilities: ['tenant:settings:read' as const] };
    const worker = { identity: { ...identity(null), memberId: null, tenantAccess: 'none' as const }, capabilities: ['tenant:settings:read' as const] };

    await expect(getTenantSettings({ identity: identity(null) }, configured))
      .resolves.toMatchObject({ ok: true, value: { personalisationMaxBytes: null } });
    await expect(getTenantSettings(impersonatedMember, configured))
      .resolves.toMatchObject({ ok: true, value: { personalisationMaxBytes: null } });
    await expect(getTenantSettings(apiKey, configured))
      .resolves.toMatchObject({ ok: true, value: { personalisationMaxBytes: null } });
    await expect(getTenantSettings(worker, configured))
      .resolves.toMatchObject({ ok: true, value: { personalisationMaxBytes: null } });
    await expect(getTenantSettings({ identity: identity('admin') }, configured))
      .resolves.toMatchObject({ ok: true, value: { personalisationMaxBytes: limit } });
  });

  it.each([null, 'admin'] as const)('omits telemetry store settings for role %s', async (role) => {
    const result = await getTenantSettings({ identity: identity(role) }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected tenant settings');
    expect(result.value.settings).toMatchObject({ name: settings.name });
    expect(result.value.settings).not.toHaveProperty('telemetryStore');
  });
});

describe('updateTenantSettings', () => {
  const adminCtx = {
    identity: identity('admin'),
    capabilities: ['tenant:settings:write' as const],
  };

  it('stores, preserves and clears the optional light accent', async () => {
    const saved = await updateTenantSettings(adminCtx, { accentLight: '#786000' }, deps);
    expect(saved).toMatchObject({ ok: true, value: { accentLight: '#786000', accentColor: null } });
    const configured = { ...deps, tenants: { ...deps.tenants, findSettings: async () => ({ ...settings, accentLight: '#786000' }) } };
    expect(await updateTenantSettings(adminCtx, { name: 'Acme' }, configured))
      .toMatchObject({ ok: true, value: { accentLight: '#786000' } });
    expect(await updateTenantSettings(adminCtx, { accentLight: '' }, configured))
      .toMatchObject({ ok: true, value: { accentLight: null } });
    expect(await updateTenantSettings(adminCtx, { accentLight: 'yellow' }, deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('invalidates public caches after storing settings', async () => {
    const contentVersionBumps: string[] = [];
    const result = await updateTenantSettings(adminCtx, { accentColor: '#0E7490' }, {
      ...deps,
      products: {
        bumpContentVersion: async (tenantId) => {
          contentVersionBumps.push(tenantId);
        },
      },
    });

    expect(result).toMatchObject({ ok: true, value: { accentColor: '#0E7490' } });
    expect(contentVersionBumps).toEqual(['tenant-1']);
  });

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

  it('stores both logo variants and clears only the one sent empty', async () => {
    let current: TenantSettings = settings;
    const statefulDeps: TenantSettingsDeps = {
      ...deps,
      tenants: {
        ...deps.tenants,
        findSettings: async () => current,
        updateSettings: async (_tenantId, next) => {
          current = next;
          return next;
        },
      },
    };

    expect(await updateTenantSettings(adminCtx, {
      logoUrl: '/api/public/assets/logo/light.png',
      logoDarkUrl: '/api/public/assets/logo-dark/dark.png',
    }, statefulDeps)).toMatchObject({
      ok: true,
      value: {
        logoUrl: '/api/public/assets/logo/light.png',
        logoDarkUrl: '/api/public/assets/logo-dark/dark.png',
      },
    });

    expect(await updateTenantSettings(adminCtx, { logoDarkUrl: '' }, statefulDeps)).toMatchObject({
      ok: true,
      value: { logoUrl: '/api/public/assets/logo/light.png', logoDarkUrl: null },
    });
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
