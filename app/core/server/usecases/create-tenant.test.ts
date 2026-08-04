import { describe, expect, it } from 'vitest';

import type { Identity, Tenant } from '#core/domain/index.js';

import type { TenantRepository } from '../ports.js';
import { createTenant } from './create-tenant.js';

type OwnerGrant = {
  id: string;
  tenantId: string;
  userId: string;
  staffRole: 'owner';
};

const identity: Identity = {
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
  memberBannedAt: null,
};

const fakeTenants = (initialTenants: Tenant[] = []) => {
  const tenants = [...initialTenants];
  const ownerGrants: OwnerGrant[] = [];

  const repo: TenantRepository = {
    findById: async (tenantId) => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    findBySlug: async (slug) => tenants.find((tenant) => tenant.slug === slug) ?? null,
    findSettings: async () => ({
      name: 'Acme', socialLinks: [],
      billingPortalUrl: null, bunnyStreamLibraryId: null, logoUrl: null,
      accentColor: null, faviconUrl: null, ogTitle: null, ogDescription: null,
      ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
      privacyUrl: null,
    }),
    updateSettings: async (_tenantId, settings) => settings,
    createTenantWithOwnerGrant: async (input) => {
      const tenant = {
        id: input.tenant.id,
        slug: input.tenant.slug,
        name: input.tenant.name,
        contentVersion: 1,
      };
      tenants.push(tenant);
      ownerGrants.push({
        id: input.ownerGrant.id,
        tenantId: input.tenant.id,
        userId: input.ownerGrant.userId,
        staffRole: input.ownerGrant.staffRole,
      });
      return tenant;
    },
  };

  return { repo, tenants, ownerGrants };
};

const fakeIds = (ids: string[]) => ({
  nextId: () => {
    const next = ids.shift();
    if (!next) throw new Error('No fake ID available');
    return next;
  },
});

const deps = (repo: TenantRepository, ids: string[] = ['t-new', 'grant-new']) => ({
  tenants: repo,
  ids: fakeIds(ids),
  clock: { nowIso: () => '2026-07-11T00:00:00.000Z' },
  tenantCreationMode: 'open' as const,
});

describe('createTenant', () => {
  it('creates a tenant and grants the caller owner access', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity },
      { slug: 'new-co', name: 'New Co' },
      deps(store.repo),
    );

    expect(result).toEqual({
      ok: true,
      value: { id: 't-new', slug: 'new-co', name: 'New Co', contentVersion: 1 },
    });
    expect(store.ownerGrants).toEqual([
      {
        id: 'grant-new',
        tenantId: 't-new',
        userId: 'u1',
        staffRole: 'owner',
      },
    ]);
  });

  it('rejects tenant creation when instance policy is closed', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity },
      { slug: 'new-co', name: 'New Co' },
      { ...deps(store.repo), tenantCreationMode: 'closed' },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'forbidden', message: 'Tenant creation is closed on this instance' },
    });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('rejects slug conflicts before creating records', async () => {
    const store = fakeTenants([{ id: 't-acme', slug: 'acme', name: 'Acme', contentVersion: 1 }]);

    const result = await createTenant(
      { identity },
      { slug: 'acme', name: 'Acme Duplicate' },
      deps(store.repo),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: 'Tenant "acme" already exists' },
    });
    expect(store.tenants).toEqual([{ id: 't-acme', slug: 'acme', name: 'Acme', contentVersion: 1 }]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('validates slug and name before writing', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity },
      { slug: 'No Spaces', name: 'Invalid' },
      deps(store.repo),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Tenant slug must be 3-63 lowercase letters, numbers or hyphens' },
    });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('rejects tenant names that cannot be returned by the tenant schema', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity },
      { slug: 'new-co', name: 'A'.repeat(101) },
      deps(store.repo),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Tenant name must be 1-100 characters' },
    });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('rejects reserved slugs and accepts a normal product space slug', async () => {
    const reserved = fakeTenants();
    const rejected = await createTenant(
      { identity },
      { slug: 'api', name: 'API' },
      deps(reserved.repo),
    );

    expect(rejected).toMatchObject({ ok: false, error: { code: 'slug_reserved' } });
    expect(reserved.tenants).toEqual([]);

    const available = fakeTenants();
    const accepted = await createTenant(
      { identity },
      { slug: 'pracownia-oli', name: 'Pracownia Oli' },
      deps(available.repo),
    );

    expect(accepted).toMatchObject({ ok: true, value: { slug: 'pracownia-oli' } });
  });
});
