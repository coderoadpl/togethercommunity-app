import { describe, expect, it } from 'vitest';

import type { Identity, Membership, TenantCreationMode } from '#core/domain/index.js';

import { listMyTenants } from './tenants.js';

const identity: Identity = {
  userId: 'user-1',
  email: 'creator@example.test',
  name: 'Creator',
  emailVerified: true,
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
};

const membership: Membership = {
  tenant: {
    id: 'tenant-1',
    slug: 'studio',
    name: 'Studio',
    status: 'active',
    plan: 'hosted',
    contentVersion: 1,
  },
  staffRole: 'owner',
};

const deps = (hasAny: boolean, tenantCreationMode: TenantCreationMode) => ({
  tenantAccess: {
    listTenantsForStaff: async () => [membership],
    listStaffForTenant: async () => [],
    findStaffGrant: async () => null,
    findMember: async () => null,
  },
  tenants: { hasAny: async () => hasAny },
  tenantCreationMode,
});

describe('listMyTenants', () => {
  it.each([
    ['open', false, true],
    ['open', true, true],
    ['bootstrap', false, true],
    ['bootstrap', true, false],
    ['closed', false, false],
  ] as const)('reports the create verdict in %s mode', async (mode, hasAny, allowed) => {
    const result = await listMyTenants({ identity }, deps(hasAny, mode));
    expect(result).toEqual({
      ok: true,
      value: { tenants: [membership], canCreateTenant: allowed },
    });
  });

  it('allows an unverified account to create the first workspace', async () => {
    const result = await listMyTenants(
      { identity: { ...identity, emailVerified: false } },
      deps(false, 'open'),
    );
    expect(result).toEqual({
      ok: true,
      value: { tenants: [membership], canCreateTenant: true },
    });
  });

  it('requires verification from an unverified account after bootstrap', async () => {
    const result = await listMyTenants(
      { identity: { ...identity, emailVerified: false } },
      deps(true, 'open'),
    );
    expect(result).toEqual({
      ok: true,
      value: { tenants: [membership], canCreateTenant: false },
    });
  });

  it('reports the same principal denial used by creation', async () => {
    const result = await listMyTenants(
      { identity, capabilities: ['tenant:list-own'] },
      {
        tenantAccess: { listTenantsForStaff: async () => [] },
        tenants: { hasAny: async () => false },
        tenantCreationMode: 'open',
      },
    );

    expect(result).toEqual({ ok: true, value: { tenants: [], canCreateTenant: false } });
  });
});
