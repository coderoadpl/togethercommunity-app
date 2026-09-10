import { describe, expect, it, vi } from 'vitest';

import type { Member, Membership, Tenant, TenantDomain } from '#core/domain/index.js';

import type { TenantAccessReader, TenantDomainRepository, TenantRepository } from '../ports.js';
import { tenantDomainFixture, tenantDomainRepositoryStub } from '../testing/tenant-domain-fakes.js';
import { resolveIdentity } from './resolve-identity.js';

const user = { sessionId: 's1', userId: 'u1', email: 'demo@example.com', name: 'Demo', emailVerified: true, image: null };

const acme: Membership = {
  tenant: {
    id: 't-acme', slug: 'acme', name: 'Acme Inc', status: 'active', plan: 'hosted', contentVersion: 1,
  },
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
  deletedAt: null,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
    dmOptOutAt: null,
};

const fakeTenantAccess = (memberships: Membership[], members: Member[] = []): TenantAccessReader => ({
  listTenantsForStaff: async () => memberships,
  listStaffForTenant: async () => [],
  findStaffGrant: async (_userId, lookup) =>
    memberships.find((m) =>
      'tenantId' in lookup ? m.tenant.id === lookup.tenantId : m.tenant.slug === lookup.tenantSlug,
    ) ?? null,
  findMember: async (tenantId) =>
    members.find((candidate) => candidate.tenantId === tenantId) ?? null,
});

const fakeDomains = (domains: TenantDomain[]): TenantDomainRepository =>
  tenantDomainRepositoryStub({
    findByDomain: async (domain) => domains.find((d) => d.domain === domain) ?? null,
    listVerifiedDomains: async () => domains,
    listByTenant: async (tenantId) => domains.filter((candidate) => candidate.tenantId === tenantId),
  });

const fakeTenants = (tenantList: Tenant[]): TenantRepository => ({
  findById: async (tenantId) => tenantList.find((tenant) => tenant.id === tenantId) ?? null,
  findBySlug: async (slug) => tenantList.find((tenant) => tenant.slug === slug) ?? null,
  findSole: async () => tenantList.length === 1 ? tenantList[0] ?? null : null,
  hasAny: async () => tenantList.length > 0,
  findSettings: async () => ({
    name: 'Acme', socialLinks: [],
    signInNotice: { enabled: false, text: '' },
    billingPortalUrl: null, bunnyStreamLibraryId: null, bunnyStreamCdnHostname: null, logoUrl: null, logoDarkUrl: null,
    accentColor: null,
    accentLight: null, faviconUrl: null, ogTitle: null, ogDescription: null,
    ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
    privacyUrl: null,
    defaultHomeSpaceId: null,
  }),
  updateSettings: async (_tenantId, settings) => settings,
  createTenantWithOwnerGrant: async (input) => ({
    id: input.tenant.id,
    slug: input.tenant.slug,
    name: input.tenant.name,
    status: 'active',
    plan: 'self_hosted',
    contentVersion: 1,
  }),
});

const deps = (
  memberships: Membership[],
  domains: TenantDomain[] = [],
  memberRows: Member[] = [],
  tenantRows: Tenant[] = [acme.tenant],
) => ({
  authPort: {
    getAuthenticatedUser: async () => user,
    ensureUser: vi.fn(async () => ({ userId: user.userId, created: false })),
    listSessions: async () => [],
    revokeSessions: async () => undefined,
    requestMagicLink: async () => undefined,
    createEnrollmentMagicLink: async () => ({ url: 'https://courses.example.org/sign-in' }),
  },
  ids: { nextId: () => 'staff-member' },
  clock: { nowIso: () => '2026-09-08T00:00:00.000Z' },
  tenantAccess: fakeTenantAccess(memberships, memberRows),
  members: {
    findById: async () => null,
    findByEmail: async (tenantId: string, email: string) => memberRows.find((row) => row.tenantId === tenantId && row.email === email) ?? null,
    listWithProductIds: async () => [],
    create: vi.fn(async (_tenantId: string, row: Member) => { memberRows.push(row); }),
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
    updateLanguage: async () => null,
    updateVideoAutoplay: async () => null,
    updateDisplayName: async () => null,
    updateDmOptOut: async () => null,
    setBanned: async () => null,
    delete: async () => false,
  },
  tenants: fakeTenants(tenantRows),
  tenantDomains: fakeDomains(domains),
  baseDomain: 'localhost',
  platformHost: 'start.localhost',
  singleTenantMode: false,
});

describe('resolveIdentity', () => {
  it.each(['owner', 'admin'] as const)('ensures one tenant membership for %s on entry', async (staffRole) => {
    const rows: Member[] = [];
    const dependencies = deps([{ ...acme, staffRole }], [], rows);
    const request = { host: 'acme.localhost:48730', tenantHeader: null };
    const first = await resolveIdentity(user, request, dependencies);
    const second = await resolveIdentity(user, request, dependencies);
    expect(first).toMatchObject({ ok: true, value: { userId: user.userId, staffRole, memberId: 'staff-member' } });
    expect(second).toEqual(first);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: acme.tenant.id, userId: user.userId, email: user.email });
    expect(dependencies.members.create).toHaveBeenCalledOnce();
  });

  it('preserves existing staff profile settings without creating a member', async () => {
    const dependencies = deps([acme], [], [{ ...member, language: 'en', videoAutoplay: false }]);
    expect(await resolveIdentity(user, { host: 'acme.localhost', tenantHeader: null }, dependencies))
      .toMatchObject({ ok: true, value: { memberId: member.id, memberDisplayName: 'Demo', memberLanguage: 'en', memberVideoAutoplay: false } });
    expect(dependencies.members.create).not.toHaveBeenCalled();
  });

  it('never enrolls a caller without a staff grant or on the platform host', async () => {
    const dependencies = deps([]);
    await resolveIdentity(user, { host: 'acme.localhost', tenantHeader: null }, dependencies);
    await resolveIdentity(user, { host: 'start.localhost', tenantHeader: null }, dependencies);
    expect(dependencies.members.create).not.toHaveBeenCalled();
    expect(dependencies.authPort.ensureUser).not.toHaveBeenCalled();
  });

  it('resolves an authorized user into the sole tenant without a configured base domain', async () => {
    const result = await resolveIdentity(user, { host: 'localhost:48730', tenantHeader: null }, {
      ...deps([acme]),
      singleTenantMode: true,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', tenantSlug: 'acme', staffRole: 'owner' },
    });
  });

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
    const domain: TenantDomain = tenantDomainFixture({
      id: 'd1',
      tenantId: 't-acme',
      domain: 'todo.example.com',
      kind: 'custom',
      verified: true,
    });
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

  it('uses the avatar from the resolved tenant membership instead of the auth user image', async () => {
    const avatarUrl = '/api/public/assets/avatar/00000000-0000-4000-8000-000000000001.webp';
    const result = await resolveIdentity(
      { ...user, image: 'https://images.example.org/provider.png' },
      { host: 'acme.localhost:4711', tenantHeader: null },
      deps([], [], [{ ...member, avatarUrl }]),
    );

    expect(result).toMatchObject({ ok: true, value: { image: avatarUrl } });
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
    expect(result).toMatchObject({ ok: true, value: { tenantId: null, image: null } });
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
