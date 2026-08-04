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
  emailVerified: true,
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
    findSole: async () => tenants.length === 1 ? tenants[0] ?? null : null,
    hasAny: async () => tenants.length > 0,
    findSettings: async () => ({
      name: 'Acme', socialLinks: [],
      billingPortalUrl: null, bunnyStreamLibraryId: null, logoUrl: null,
      accentColor: null, faviconUrl: null, ogTitle: null, ogDescription: null,
      ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
      privacyUrl: null,
    }),
    updateSettings: async (_tenantId, settings) => settings,
    createTenantWithOwnerGrant: async (input, options) => {
      if (options?.requireEmpty === true && tenants.length > 0) return null;
      const tenant: Tenant = {
        id: input.tenant.id,
        slug: input.tenant.slug,
        name: input.tenant.name,
        status: 'active',
        plan: 'self_hosted',
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
      value: {
        id: 't-new', slug: 'new-co', name: 'New Co', status: 'active', plan: 'self_hosted', contentVersion: 1,
      },
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

  it('allows an unverified account to create the first workspace atomically', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity: { ...identity, emailVerified: false } },
      { slug: 'new-co', name: 'New Co' },
      deps(store.repo),
    );

    expect(result).toMatchObject({ ok: true, value: { slug: 'new-co' } });
    expect(store.ownerGrants).toHaveLength(1);
  });

  it('requires verification from an unverified account after the first workspace', async () => {
    const existing: Tenant = {
      id: 't-acme', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1,
    };
    const store = fakeTenants([existing]);

    const result = await createTenant(
      { identity: { ...identity, emailVerified: false } },
      { slug: 'new-co', name: 'New Co' },
      deps(store.repo),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'tenant:create requires a verified email address' },
    });
    expect(store.tenants).toEqual([existing]);
  });

  it('denies a principal without the tenant:create capability', async () => {
    const store = fakeTenants();
    const result = await createTenant(
      { identity, capabilities: ['tenant:list-own'] },
      { slug: 'new-co', name: 'New Co' },
      { ...deps(store.repo), tenantCreationMode: 'bootstrap' },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'forbidden', message: 'tenant:create is not permitted' },
    });
    expect(store.tenants).toEqual([]);
  });

  it('allows production bootstrap only while the tenant store is empty', async () => {
    const store = fakeTenants();
    const bootstrapDeps = { ...deps(store.repo), tenantCreationMode: 'bootstrap' as const };

    const first = await createTenant(
      { identity },
      { slug: 'first-workspace', name: 'First Workspace' },
      bootstrapDeps,
    );
    const second = await createTenant(
      { identity },
      { slug: 'second-workspace', name: 'Second Workspace' },
      bootstrapDeps,
    );

    expect(first).toMatchObject({ ok: true, value: { slug: 'first-workspace' } });
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'forbidden', message: 'Tenant creation is closed after the first workspace' },
    });
    expect(store.tenants).toHaveLength(1);
    expect(store.ownerGrants).toHaveLength(1);
  });

  it('rejects slug conflicts before creating records', async () => {
    const existing: Tenant = {
      id: 't-acme', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1,
    };
    const store = fakeTenants([existing]);

    const result = await createTenant(
      { identity },
      { slug: 'acme', name: 'Acme Duplicate' },
      deps(store.repo),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: 'Tenant "acme" already exists' },
    });
    expect(store.tenants).toEqual([existing]);
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
