import { describe, expect, it } from 'vitest';

import type { Member, Membership, Tenant, TenantDomain } from '@core/domain/index.js';

import type { TenantAccessReader, TenantDomainRepository, TenantRepository } from '../ports.js';
import { resolveIdentity } from './resolve-identity.js';

const user = { userId: 'u1', email: 'demo@example.com', name: 'Demo' };

const acme: Membership = {
  tenant: { id: 't-acme', slug: 'acme', name: 'Acme Inc', contentVersion: 1 },
  staffRole: 'owner',
};

const member: Member = {
  id: 'member-acme',
  tenantId: 't-acme',
  userId: 'u1',
  email: 'demo@example.com',
  displayName: 'Demo',
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '2026-07-11T00:00:00.000Z',
};

const fakeTenantAccess = (memberships: Membership[], members: Member[] = []): TenantAccessReader => ({
  listTenantsForStaff: async () => memberships,
  findStaffGrant: async (_userId, lookup) =>
    memberships.find((m) =>
      'tenantId' in lookup ? m.tenant.id === lookup.tenantId : m.tenant.slug === lookup.tenantSlug,
    ) ?? null,
  findMember: async (_userId, tenantId) =>
    members.find((candidate) => candidate.tenantId === tenantId) ?? null,
});

const fakeDomains = (domains: TenantDomain[]): TenantDomainRepository => ({
  findByDomain: async (domain) => domains.find((d) => d.domain === domain) ?? null,
  listVerifiedDomains: async () => domains,
});

const fakeTenants = (tenantList: Tenant[]): TenantRepository => ({
  findById: async (tenantId) => tenantList.find((tenant) => tenant.id === tenantId) ?? null,
  findBySlug: async (slug) => tenantList.find((tenant) => tenant.slug === slug) ?? null,
  findSettings: async () => ({ billingPortalUrl: null, bunnyStreamLibraryId: null, logoUrl: null, accentColor: null, faviconUrl: null }),
  updateSettings: async (_tenantId, settings) => settings,
  createTenantWithOwnerGrant: async (input) => ({
    id: input.tenant.id,
    slug: input.tenant.slug,
    name: input.tenant.name,
    contentVersion: 1,
  }),
});

const deps = (
  memberships: Membership[],
  domains: TenantDomain[] = [],
  memberRows: Member[] = [],
  tenantRows: Tenant[] = [acme.tenant],
) => ({
  tenantAccess: fakeTenantAccess(memberships, memberRows),
  members: {
    findById: async () => null,
    findByEmail: async () => null,
    listWithProductIds: async () => [],
    create: async () => undefined,
    updateEmail: async (tenantId: string, memberId: string, email: string) => {
      const existing = memberRows.find(
        (candidate) => candidate.tenantId === tenantId && candidate.id === memberId,
      );
      if (!existing) return null;
      const refreshed = { ...existing, email };
      const index = memberRows.indexOf(existing);
      memberRows[index] = refreshed;
      return refreshed;
    },
    delete: async () => false,
  },
  tenants: fakeTenants(tenantRows),
  tenantDomains: fakeDomains(domains),
  baseDomain: 'localhost',
});

describe('resolveIdentity', () => {
  it('rejects anonymous requests', async () => {
    const result = await resolveIdentity(null, { host: 'localhost', tenantHeader: null }, deps([]));
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('resolves tenant from subdomain', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'acme.localhost:4711', tenantHeader: null },
      deps([acme]),
    );
    expect(result).toMatchObject({ ok: true, value: { tenantSlug: 'acme', staffRole: 'owner' } });
  });

  it('resolves tenant from X-Tenant header on the base domain', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'localhost:4711', tenantHeader: 'acme' },
      deps([acme]),
    );
    expect(result).toMatchObject({ ok: true, value: { tenantId: 't-acme' } });
  });

  it('resolves tenant from a custom domain and requires membership', async () => {
    const domain: TenantDomain = {
      id: 'd1',
      tenantId: 't-acme',
      domain: 'todo.example.com',
      kind: 'custom',
      verified: true,
    };
    const okResult = await resolveIdentity(
      user,
      { host: 'todo.example.com', tenantHeader: null },
      deps([acme], [domain]),
    );
    expect(okResult).toMatchObject({ ok: true, value: { tenantId: 't-acme' } });

    const denied = await resolveIdentity(
      user,
      { host: 'todo.example.com', tenantHeader: null },
      deps([], [domain]),
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('resolves member-only identity without staff enumeration rights', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'acme.localhost:4711', tenantHeader: null },
      deps([], [], [member]),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', staffRole: null, memberId: 'member-acme' },
    });
  });

  it('refreshes a stale member email snapshot', async () => {
    const staleMember = { ...member, email: 'old@example.com' };
    const memberRows = [staleMember];

    const result = await resolveIdentity(
      user,
      { host: 'acme.localhost:4711', tenantHeader: null },
      deps([], [], memberRows),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', memberId: 'member-acme' },
    });
    expect(memberRows[0]?.email).toBe('demo@example.com');
  });

  it('returns tenant-less identity on the bare base domain', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'localhost:4711', tenantHeader: null },
      deps([acme]),
    );
    expect(result).toMatchObject({ ok: true, value: { tenantId: null } });
  });

  it('rejects unknown tenants', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'globex.localhost', tenantHeader: null },
      deps([acme]),
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'tenant_not_found',
        message: 'No tenant "globex" or you do not have access to it',
      },
    });
  });

  it('distinguishes unknown and inaccessible slug tenants', async () => {
    const absent = await resolveIdentity(
      user,
      { host: 'acme.localhost', tenantHeader: null },
      deps([], [], [], []),
    );
    const inaccessible = await resolveIdentity(
      user,
      { host: 'acme.localhost', tenantHeader: null },
      deps([]),
    );

    expect(absent).toMatchObject({
      ok: false,
      error: {
        code: 'tenant_not_found',
        message: 'No tenant "acme" or you do not have access to it',
      },
    });
    expect(inaccessible).toMatchObject({
      ok: false,
      error: {
        code: 'forbidden',
        message: 'You do not have access to this tenant',
      },
    });
  });
});
