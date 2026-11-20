import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  capabilitiesForPrincipal,
  type OrganizationRole,
  type StaffGrantSource,
  type StaffRole,
} from '#core/domain/index.js';
import { authorize, authorizeOrganization, authorizeTenant } from '#core/server/authorize.js';
import type { Ctx, OrganizationCtx } from '#core/server/context.js';
import type { AuthPort } from '#core/server/ports.js';
import { removeOrganizationMember } from '#core/server/usecases/organization-members.js';
import {
  linkOrganizationWorkspace,
  unlinkOrganizationWorkspace,
  unlinkWorkspaceFromOrganization,
} from '#core/server/usecases/organization-workspaces.js';
import { resolveIdentity } from '#core/server/usecases/resolve-identity.js';
import { authenticateShopManagementKey } from '#core/server/usecases/shop-machine-auth.js';
import { createTenantApiKey } from '#core/server/usecases/api-keys.js';
import { createShopManagementKey } from '#core/server/usecases/shop-management-keys.js';
import { addTenantAdmin, listTenantTeam, removeTenantAdmin, type TenantTeamDeps } from '#core/server/usecases/tenant-team.js';

import { createApiKeyCrypto } from '../auth/api-key-crypto.js';
import { createShopManagementKeyRateLimitRepository, createShopManagementKeyRepository } from './shop-management-keys.js';
import {
  createOrganizationMemberRepository,
  createOrganizationRepository,
  createOrganizationWorkspaceRepository,
} from './organizations.js';
import {
  createAccountIdentityReader,
  createMemberRepository,
  createTenantAccessReader,
  createTenantApiKeyRepository,
  createTenantDomainRepository,
  createTenantRepository,
  createTenantTeamRepository,
} from './repositories.js';
import {
  organizationMembers,
  organizations,
  tenantAdminInvitations,
  tenantAdmins,
  tenantConfigSources,
  tenants,
  user,
} from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const at = '2026-11-15T10:00:00.000Z';
const NOW = '2026-11-15T12:00:00.000Z';
const IN_A_WEEK = '2026-11-22T12:00:00.000Z';

type Grant = { staffRole: StaffRole; source: StaffGrantSource } | null;
type Case = {
  direct: StaffRole | null;
  organization: OrganizationRole | null;
  link: 'linked' | 'unlinked' | 'other_organization' | 'suspended_organization';
  expected: Grant;
};

const direct = (staffRole: StaffRole): Grant => ({ staffRole, source: 'direct' });
const derived = (staffRole: StaffRole): Grant => ({ staffRole, source: 'organization' });

const LINKED: ReadonlyArray<[StaffRole | null, OrganizationRole | null, Grant]> = [
  [null, null, null],
  [null, 'admin', derived('admin')],
  [null, 'owner', derived('owner')],
  ['admin', null, direct('admin')],
  ['admin', 'admin', direct('admin')],
  ['admin', 'owner', derived('owner')],
  ['owner', null, direct('owner')],
  ['owner', 'admin', direct('owner')],
  ['owner', 'owner', direct('owner')],
];

const DIRECT_ONLY: ReadonlyArray<[StaffRole | null, OrganizationRole | null, Grant]> = LINKED.map(
  ([directRole, organizationRole]) => [directRole, organizationRole, directRole === null ? null : direct(directRole)],
);

const CASES: Case[] = [
  ...LINKED.map(([d, o, expected]) => ({ direct: d, organization: o, link: 'linked' as const, expected })),
  ...DIRECT_ONLY.map(([d, o, expected]) => ({ direct: d, organization: o, link: 'unlinked' as const, expected })),
  ...DIRECT_ONLY.filter(([, o]) => o !== null)
    .map(([d, o, expected]) => ({ direct: d, organization: o, link: 'other_organization' as const, expected })),
  ...DIRECT_ONLY.filter(([, o]) => o !== null)
    .map(([d, o, expected]) => ({ direct: d, organization: o, link: 'suspended_organization' as const, expected })),
];

const caseName = (entry: Case) => `${entry.direct ?? 'none'}-${entry.organization ?? 'none'}-${entry.link}`;

const authPortFor = (accounts: ReadonlyArray<{ userId: string; email: string; emailVerified: boolean }>): AuthPort => ({
  initialize: async () => undefined,
  findUserByEmail: async (email) => {
    const account = accounts.find((candidate) => candidate.email === email);
    return account === undefined ? null : { userId: account.userId, emailVerified: account.emailVerified };
  },
  getAuthenticatedUser: async () => null,
  listSessions: async () => [],
  revokeSessions: async () => undefined,
  ensureUser: async (email) => ({ userId: accounts.find((candidate) => candidate.email === email)?.userId ?? email, created: false }),
  requestMagicLink: async () => undefined,
  createEnrollmentMagicLink: async () => ({ url: 'https://togethercommunity.app/sign-in' }),
});

describe('derived workspace roles', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let nextId = 0;
  const ids = { nextId: () => `id-${++nextId}` };
  const clock = { nowIso: () => NOW };

  beforeAll(async () => {
    database = await createTestDatabase('together_derived_staff_grants_test', databaseUrl);
  });

  afterAll(async () => { await database?.close(); });

  const createOrganization = async (id: string, status: 'active' | 'suspended' = 'active') => {
    await database.db.insert(organizations).values({ id, slug: id, name: `Organization ${id}`, status, maxWorkspaces: 10, createdAt: at, updatedAt: at });
  };
  const addMember = async (organizationId: string, userId: string, role: OrganizationRole) => {
    await database.db.insert(organizationMembers).values({ id: `om-${organizationId}-${userId}`, organizationId, userId, role, createdAt: at, createdByUserId: 'operator' });
  };
  const addTenant = async (id: string, organizationId: string | null, status: 'active' | 'suspended' = 'active') => {
    await database.db.insert(tenants).values({ id, slug: id, name: `Workspace ${id}`, createdAt: at, organizationId, status });
  };
  const addGrant = async (tenantId: string, userId: string, role: StaffRole) => {
    await database.db.insert(tenantAdmins).values({ id: `ta-${tenantId}-${userId}`, tenantId, userId, role });
  };

  describe('effective staff grant lookup', () => {
    const subject = 'combo-subject';

    beforeAll(async () => {
      await createOrganization('combo-elsewhere');
      for (const [index, entry] of CASES.entries()) {
        const organizationId = `combo-org-${index}`;
        await createOrganization(organizationId, entry.link === 'suspended_organization' ? 'suspended' : 'active');
        if (entry.organization !== null) await addMember(organizationId, subject, entry.organization);
        const linkedTo = entry.link === 'unlinked' ? null : entry.link === 'other_organization' ? 'combo-elsewhere' : organizationId;
        await addTenant(`combo-ws-${index}`, linkedTo);
        if (entry.direct !== null) await addGrant(`combo-ws-${index}`, subject, entry.direct);
      }
    });

    it.each(CASES.map((entry, index) => ({ ...entry, index, name: caseName(entry) })))(
      'returns the effective role and source for $name',
      async ({ index, expected }) => {
        const reader = createTenantAccessReader(database.db);
        const tenantId = `combo-ws-${index}`;
        const tenant = { id: tenantId, slug: tenantId, name: `Workspace ${tenantId}`, status: 'active', plan: 'self_hosted', contentVersion: 1 };
        const membership = expected === null ? null : { tenant, ...expected };

        expect(await reader.findStaffGrant(subject, { tenantId })).toEqual(membership);
        expect(await reader.findStaffGrant(subject, { tenantSlug: tenantId })).toEqual(membership);
        expect(await reader.findStaffGrant('combo-stranger', { tenantId })).toBeNull();
      },
    );

    it('lists exactly the workspaces with an effective grant, once each, with the same role and source', async () => {
      const reader = createTenantAccessReader(database.db);
      const expected = CASES.flatMap((entry, index) => entry.expected === null
        ? []
        : [{ tenantId: `combo-ws-${index}`, ...entry.expected }]);

      const listed = (await reader.listTenantsForStaff(subject))
        .map(({ tenant, staffRole, source }) => ({ tenantId: tenant.id, staffRole, source }));

      expect([...listed].sort((left, right) => left.tenantId.localeCompare(right.tenantId)))
        .toEqual([...expected].sort((left, right) => left.tenantId.localeCompare(right.tenantId)));
    });

    it('keeps the staff list of a workspace direct-only', async () => {
      await database.db.insert(user).values({ id: subject, email: 'combo-subject@example.test', name: 'Subject', emailVerified: true });
      const reader = createTenantAccessReader(database.db);
      const derivedOnly = CASES.findIndex((entry) => entry.direct === null && entry.organization === 'owner' && entry.link === 'linked');
      const both = CASES.findIndex((entry) => entry.direct === 'admin' && entry.organization === 'owner' && entry.link === 'linked');

      expect(await reader.listStaffForTenant(`combo-ws-${derivedOnly}`)).toEqual([]);
      expect(await reader.listStaffForTenant(`combo-ws-${both}`)).toEqual([
        { userId: subject, email: 'combo-subject@example.test', staffRole: 'admin', language: null },
      ]);
    });

    it('keeps the tenant status handling of the direct path for a derived grant', async () => {
      await createOrganization('status-org');
      await addMember('status-org', 'status-org-owner', 'owner');
      await addTenant('status-ws', 'status-org', 'suspended');
      await addGrant('status-ws', 'status-direct-owner', 'owner');
      const reader = createTenantAccessReader(database.db);

      expect(await reader.findStaffGrant('status-direct-owner', { tenantId: 'status-ws' }))
        .toMatchObject({ tenant: { status: 'suspended' }, staffRole: 'owner', source: 'direct' });
      expect(await reader.findStaffGrant('status-org-owner', { tenantId: 'status-ws' }))
        .toMatchObject({ tenant: { status: 'suspended' }, staffRole: 'owner', source: 'organization' });
    });
  });

  describe('requests resolved through the effective grant', () => {
    const accounts = [
      { userId: 'flow-actor', email: 'flow-actor@example.test', emailVerified: true },
      { userId: 'flow-org-owner', email: 'flow-org-owner@example.test', emailVerified: true },
      { userId: 'flow-org-admin', email: 'flow-org-admin@example.test', emailVerified: true },
      { userId: 'flow-key-owner', email: 'flow-key-owner@example.test', emailVerified: true },
      { userId: 'flow-ws-owner', email: 'flow-ws-owner@example.test', emailVerified: true },
    ];
    const authPort = authPortFor(accounts);
    const accountOf = (userId: string) => {
      const account = accounts.find((candidate) => candidate.userId === userId);
      if (account === undefined) throw new Error(`Unknown account ${userId}`);
      return account;
    };

    const ctxFor = async (userId: string, tenantSlug: string): Promise<Ctx> => {
      const account = accountOf(userId);
      const identity = await resolveIdentity(
        { sessionId: `session-${userId}`, userId, email: account.email, name: userId, emailVerified: true, image: null },
        { host: 'localhost', tenantHeader: tenantSlug },
        {
          authPort,
          members: createMemberRepository(database.db),
          ids,
          clock,
          tenantDomains: createTenantDomainRepository(database.db),
          tenantAccess: createTenantAccessReader(database.db),
          tenants: createTenantRepository(database.db),
          baseDomain: 'togethercommunity.app',
          platformHost: null,
          singleTenantMode: false,
        },
      );
      if (!identity.ok) throw new Error(identity.error.message);
      return { identity: identity.value };
    };

    const organizationCtx = async (userId: string, organizationId: string): Promise<OrganizationCtx> => {
      const membership = await createOrganizationMemberRepository(database.db).find(organizationId, userId);
      const organization = await createOrganizationRepository(database.db).findById(organizationId);
      return {
        identity: { userId, email: accountOf(userId).email, emailVerified: true },
        membership: membership === null || organization === null
          ? null
          : { organizationId, role: membership.role, organizationStatus: organization.status },
      };
    };

    const teamDeps = (): TenantTeamDeps => ({
      team: createTenantTeamRepository(database.db),
      authPort,
      tenants: createTenantRepository(database.db),
      tenantDomains: createTenantDomainRepository(database.db),
      ids,
      clock,
      appBaseUrl: 'https://togethercommunity.app',
      baseDomain: 'togethercommunity.app',
      singleTenantMode: false,
    });

    const workspaceDeps = () => ({ organizationWorkspaces: createOrganizationWorkspaceRepository(database.db), ids, clock });
    const memberDeps = () => ({ organizationMembers: createOrganizationMemberRepository(database.db), authPort, ids, clock });
    const keyDeps = () => ({
      shopManagementKeys: createShopManagementKeyRepository(database.db),
      apiKeyCrypto: createApiKeyCrypto(),
      ids,
      clock,
      shopManagementKeysSwitch: 'enabled' as const,
    });
    const apiKeyDeps = () => ({ tenantApiKeys: createTenantApiKeyRepository(database.db), apiKeyCrypto: createApiKeyCrypto(), ids, clock });
    const machineDeps = () => ({
      shopManagementKeys: createShopManagementKeyRepository(database.db),
      apiKeyCrypto: createApiKeyCrypto(),
      accountIdentities: createAccountIdentityReader(database.db),
      tenantAccess: createTenantAccessReader(database.db),
      shopManagementKeyRateLimits: createShopManagementKeyRateLimitRepository(database.db),
      clock,
    });
    const shopTenant = (id: string) => ({ id, slug: id, name: `Workspace ${id}` });

    beforeAll(async () => {
      await database.db.insert(user).values(accounts.map(({ userId, email, emailVerified }) => ({ id: userId, email, name: userId, emailVerified })));
      await createOrganization('flow-org');
      await addMember('flow-org', 'flow-actor', 'owner');
      await addMember('flow-org', 'flow-org-owner', 'owner');
      await addMember('flow-org', 'flow-org-admin', 'admin');
      await addMember('flow-org', 'flow-key-owner', 'owner');
      for (const tenantId of ['flow-linked', 'flow-unlinked', 'flow-removal', 'flow-unlink', 'flow-key-removal', 'flow-key-unlink']) {
        await addTenant(tenantId, null);
        await addGrant(tenantId, 'flow-actor', 'owner');
      }
      await addGrant('flow-linked', 'flow-ws-owner', 'admin');
      for (const tenantId of ['flow-linked', 'flow-removal', 'flow-unlink', 'flow-key-removal', 'flow-key-unlink']) {
        const linked = await linkOrganizationWorkspace(await organizationCtx('flow-actor', 'flow-org'), { organizationId: 'flow-org', tenantId }, workspaceDeps());
        expect(linked).toMatchObject({ ok: true, value: { changed: true } });
      }
    });

    it('lets an organization owner write workspace settings only in linked workspaces', async () => {
      expect(authorizeTenant(await ctxFor('flow-org-owner', 'flow-linked'), 'tenant:settings:write')).toEqual({ ok: true, value: 'flow-linked' });
      expect(authorizeTenant(await ctxFor('flow-org-owner', 'flow-unlinked'), 'tenant:settings:write'))
        .toMatchObject({ ok: false, error: { code: 'forbidden' } });

      const admin = await ctxFor('flow-org-admin', 'flow-linked');
      expect(admin.identity).toMatchObject({ tenantAccess: 'staff', staffRole: 'admin' });
      expect(authorizeTenant(admin, 'tenant:settings:write')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    });

    it('lists linked workspaces among the organization owner\'s workspaces', async () => {
      const listed = await createTenantAccessReader(database.db).listTenantsForStaff('flow-org-owner');
      expect(listed.map(({ tenant, staffRole, source }) => [tenant.id, staffRole, source]).sort())
        .toEqual(['flow-key-removal', 'flow-key-unlink', 'flow-linked', 'flow-removal', 'flow-unlink'].map((id) => [id, 'owner', 'organization']));
    });

    it('never grants an organization capability through a workspace role', async () => {
      const organizationCapabilities = CAPABILITIES.filter((capability) => capability.startsWith('organization:'));
      expect(organizationCapabilities.length).toBeGreaterThan(0);
      for (const principal of ['owner', 'admin', 'member', 'authenticated'] as const) {
        expect(capabilitiesForPrincipal(principal).filter((capability) => capability.startsWith('organization:'))).toEqual([]);
      }
      const workspaceOwner = await ctxFor('flow-ws-owner', 'flow-linked');
      const derivedOwner = await ctxFor('flow-org-owner', 'flow-linked');
      for (const capability of organizationCapabilities) {
        expect(authorize(workspaceOwner, capability), capability).toMatchObject({ code: 'forbidden' });
        expect(authorize(derivedOwner, capability), capability).toMatchObject({ code: 'forbidden' });
      }
      expect(authorizeOrganization(await organizationCtx('flow-ws-owner', 'flow-org'), 'flow-org', 'organization:read'))
        .toMatchObject({ ok: false, error: { code: 'not_found' } });
    });

    it('shows organization staff read-only in the team list and refuses to remove an organization-only user', async () => {
      const owner = await ctxFor('flow-actor', 'flow-linked');
      const team = await listTenantTeam(owner, teamDeps());
      expect(team).toEqual({
        ok: true,
        value: {
          members: [
            { userId: 'flow-actor', email: 'flow-actor@example.test', name: 'flow-actor', role: 'owner', status: 'active' },
            { userId: 'flow-ws-owner', email: 'flow-ws-owner@example.test', name: 'flow-ws-owner', role: 'admin', status: 'active' },
          ],
          organization: {
            id: 'flow-org',
            slug: 'flow-org',
            name: 'Organization flow-org',
            members: [
              { userId: 'flow-actor', email: 'flow-actor@example.test', name: 'flow-actor', role: 'owner', source: 'organization' },
              { userId: 'flow-key-owner', email: 'flow-key-owner@example.test', name: 'flow-key-owner', role: 'owner', source: 'organization' },
              { userId: 'flow-org-owner', email: 'flow-org-owner@example.test', name: 'flow-org-owner', role: 'owner', source: 'organization' },
              { userId: 'flow-org-admin', email: 'flow-org-admin@example.test', name: 'flow-org-admin', role: 'admin', source: 'organization' },
            ],
          },
        },
      });
      expect(await listTenantTeam(await ctxFor('flow-actor', 'flow-unlinked'), teamDeps()))
        .toMatchObject({ ok: true, value: { organization: null } });

      expect(await removeTenantAdmin(owner, { userId: 'flow-org-admin' }, teamDeps()))
        .toMatchObject({ ok: false, error: { code: 'organization_managed' } });
      expect(await removeTenantAdmin(owner, { userId: 'flow-stranger' }, teamDeps()))
        .toMatchObject({ ok: false, error: { code: 'not_found' } });
      expect((await ctxFor('flow-org-admin', 'flow-linked')).identity.staffRole).toBe('admin');
    });

    it('still removes a direct admin grant of a user who also holds a derived role', async () => {
      await addGrant('flow-linked', 'flow-org-admin', 'admin');
      const owner = await ctxFor('flow-actor', 'flow-linked');

      expect(await removeTenantAdmin(owner, { userId: 'flow-org-admin' }, teamDeps()))
        .toEqual({ ok: true, value: { userId: 'flow-org-admin' } });
      expect(await database.db.select().from(tenantAdmins)
        .where(and(eq(tenantAdmins.tenantId, 'flow-linked'), eq(tenantAdmins.userId, 'flow-org-admin')))).toEqual([]);
      expect((await ctxFor('flow-org-admin', 'flow-linked')).identity).toMatchObject({ tenantAccess: 'staff', staffRole: 'admin' });
    });

    it('revokes derived workspace access on the next request after the member is removed', async () => {
      await addMember('flow-org', 'flow-removed', 'owner');
      accounts.push({ userId: 'flow-removed', email: 'flow-removed@example.test', emailVerified: true });
      await database.db.insert(user).values({ id: 'flow-removed', email: 'flow-removed@example.test', name: 'flow-removed', emailVerified: true });
      expect(authorizeTenant(await ctxFor('flow-removed', 'flow-removal'), 'tenant:settings:write')).toEqual({ ok: true, value: 'flow-removal' });

      const removed = await removeOrganizationMember(
        await organizationCtx('flow-actor', 'flow-org'),
        { organizationId: 'flow-org', email: 'flow-removed@example.test' },
        memberDeps(),
      );
      expect(removed).toMatchObject({ ok: true, value: { changed: true } });

      const next = await ctxFor('flow-removed', 'flow-removal');
      expect(next.identity).toMatchObject({ staffRole: null, tenantAccess: 'member' });
      expect(authorizeTenant(next, 'tenant:settings:write')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    });

    it('revokes derived workspace access on the next request after the workspace is unlinked', async () => {
      expect(authorizeTenant(await ctxFor('flow-org-owner', 'flow-unlink'), 'tenant:settings:write')).toEqual({ ok: true, value: 'flow-unlink' });

      const unlinked = await unlinkOrganizationWorkspace(await organizationCtx('flow-actor', 'flow-org'), { organizationId: 'flow-org', tenantId: 'flow-unlink' }, workspaceDeps());
      expect(unlinked).toMatchObject({ ok: true, value: { changed: true } });

      expect(authorizeTenant(await ctxFor('flow-org-owner', 'flow-unlink'), 'tenant:settings:write'))
        .toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(authorizeTenant(await ctxFor('flow-actor', 'flow-unlink'), 'tenant:settings:write')).toEqual({ ok: true, value: 'flow-unlink' });
    });

    const issueShopKey = async (userId: string, tenantId: string) => {
      const created = await createShopManagementKey(
        await ctxFor(userId, tenantId),
        { name: 'Shop backend', scopes: ['shop:catalog:read'], expiresAt: IN_A_WEEK },
        keyDeps(),
      );
      if (!created.ok) throw new Error(created.error.message);
      expect(created.value.apiKey).toMatchObject({ issuedByUserId: userId });
      return created.value.secret;
    };

    it('accepts a shop key issued by an organization-derived owner until the owner leaves the organization', async () => {
      const secret = await issueShopKey('flow-key-owner', 'flow-key-removal');
      const first = await authenticateShopManagementKey(shopTenant('flow-key-removal'), secret, 'shop:catalog:read', machineDeps());
      expect(first.result).toMatchObject({ ok: true, value: { ctx: { identity: { userId: 'flow-key-owner', staffRole: 'owner', tenantId: 'flow-key-removal' } } } });

      const removed = await removeOrganizationMember(
        await organizationCtx('flow-actor', 'flow-org'),
        { organizationId: 'flow-org', email: 'flow-key-owner@example.test' },
        memberDeps(),
      );
      expect(removed).toMatchObject({ ok: true });

      const next = await authenticateShopManagementKey(shopTenant('flow-key-removal'), secret, 'shop:catalog:read', machineDeps());
      expect(next.result).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } });
    });

    it('refuses a shop key issued by an organization-derived owner once the workspace is unlinked', async () => {
      const secret = await issueShopKey('flow-org-owner', 'flow-key-unlink');
      const first = await authenticateShopManagementKey(shopTenant('flow-key-unlink'), secret, 'shop:catalog:read', machineDeps());
      expect(first.result).toMatchObject({ ok: true, value: { ctx: { identity: { userId: 'flow-org-owner', staffRole: 'owner' } } } });

      const unlinked = await unlinkOrganizationWorkspace(await organizationCtx('flow-actor', 'flow-org'), { organizationId: 'flow-org', tenantId: 'flow-key-unlink' }, workspaceDeps());
      expect(unlinked).toMatchObject({ ok: true, value: { changed: true } });

      const next = await authenticateShopManagementKey(shopTenant('flow-key-unlink'), secret, 'shop:catalog:read', machineDeps());
      expect(next.result).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } });
    });

    it('refuses a shop key issued by an organization-derived owner once the organization is suspended', async () => {
      await createOrganization('flow-suspend-org');
      await addMember('flow-suspend-org', 'flow-actor', 'owner');
      await addMember('flow-suspend-org', 'flow-org-owner', 'owner');
      await addTenant('flow-key-suspend', null);
      await addGrant('flow-key-suspend', 'flow-actor', 'owner');
      const linked = await linkOrganizationWorkspace(
        await organizationCtx('flow-actor', 'flow-suspend-org'),
        { organizationId: 'flow-suspend-org', tenantId: 'flow-key-suspend' },
        workspaceDeps(),
      );
      expect(linked).toMatchObject({ ok: true, value: { changed: true } });
      const secret = await issueShopKey('flow-org-owner', 'flow-key-suspend');
      const first = await authenticateShopManagementKey(shopTenant('flow-key-suspend'), secret, 'shop:catalog:read', machineDeps());
      expect(first.result).toMatchObject({ ok: true, value: { ctx: { identity: { userId: 'flow-org-owner', staffRole: 'owner' } } } });

      await database.db.update(organizations).set({ status: 'suspended' }).where(eq(organizations.id, 'flow-suspend-org'));

      const next = await authenticateShopManagementKey(shopTenant('flow-key-suspend'), secret, 'shop:catalog:read', machineDeps());
      expect(next.result).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } });
    });

    describe('artefacts that outlive the request', () => {
      const tenantId = 'flow-lasting';
      const teamRows = async () => ({
        admins: (await database.db.select({ userId: tenantAdmins.userId, role: tenantAdmins.role }).from(tenantAdmins)
          .where(eq(tenantAdmins.tenantId, tenantId))).sort((left, right) => left.userId.localeCompare(right.userId)),
        invitations: (await database.db.select({ userId: tenantAdminInvitations.userId }).from(tenantAdminInvitations)
          .where(eq(tenantAdminInvitations.tenantId, tenantId))).map(({ userId }) => userId).sort(),
      });

      beforeAll(async () => {
        for (const userId of ['flow-invitee', 'flow-invitee-direct']) {
          accounts.push({ userId, email: `${userId}@example.test`, emailVerified: true });
          await database.db.insert(user).values({ id: userId, email: `${userId}@example.test`, name: userId, emailVerified: true });
        }
        await addTenant(tenantId, null);
        await addGrant(tenantId, 'flow-actor', 'owner');
        await addGrant(tenantId, 'flow-ws-owner', 'admin');
        const linked = await linkOrganizationWorkspace(await organizationCtx('flow-actor', 'flow-org'), { organizationId: 'flow-org', tenantId }, workspaceDeps());
        expect(linked).toMatchObject({ ok: true, value: { changed: true } });
      });

      it('refuses a legacy API key to an owner whose role comes only from the organization and still lets them issue a shop key', async () => {
        const derivedOwner = await ctxFor('flow-org-owner', tenantId);
        expect(derivedOwner.identity).toMatchObject({ staffRole: 'owner', staffGrantSource: 'organization' });

        expect(await createTenantApiKey(derivedOwner, { name: 'Legacy integration' }, apiKeyDeps()))
          .toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await createTenantApiKeyRepository(database.db).listByTenant(tenantId)).toEqual([]);

        const secret = await issueShopKey('flow-org-owner', tenantId);
        expect((await authenticateShopManagementKey(shopTenant(tenantId), secret, 'shop:catalog:read', machineDeps())).result)
          .toMatchObject({ ok: true });
      });

      it('refuses team changes to an owner whose role comes only from the organization', async () => {
        const derivedOwner = await ctxFor('flow-org-owner', tenantId);
        const before = await teamRows();

        expect(await listTenantTeam(derivedOwner, teamDeps())).toMatchObject({ ok: true });
        expect(await addTenantAdmin(derivedOwner, { email: 'flow-invitee@example.test' }, teamDeps()))
          .toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await removeTenantAdmin(derivedOwner, { userId: 'flow-ws-owner' }, teamDeps()))
          .toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await teamRows()).toEqual(before);
        expect(before.admins).toContainEqual({ userId: 'flow-ws-owner', role: 'admin' });
      });

      it('leaves a direct owner who also owns the organization able to create legacy keys and change the team', async () => {
        const owner = await ctxFor('flow-actor', tenantId);
        expect(owner.identity).toMatchObject({ staffRole: 'owner', staffGrantSource: 'direct' });

        const created = await createTenantApiKey(owner, { name: 'Direct integration' }, apiKeyDeps());
        expect(created).toMatchObject({ ok: true, value: { apiKey: { name: 'Direct integration' } } });
        expect(await addTenantAdmin(owner, { email: 'flow-invitee-direct@example.test' }, teamDeps()))
          .toEqual({ ok: true, value: { status: 'invitation_sent' } });
        expect((await teamRows()).invitations).toEqual(['flow-invitee-direct']);
        expect(await removeTenantAdmin(owner, { userId: 'flow-ws-owner' }, teamDeps()))
          .toEqual({ ok: true, value: { userId: 'flow-ws-owner' } });
        expect((await teamRows()).admins).toEqual([{ userId: 'flow-actor', role: 'owner' }]);
      });
    });

    describe('unlinking from either side', () => {
      const addAccount = async (userId: string) => {
        const account = { userId, email: `${userId}@example.test`, emailVerified: true };
        accounts.push(account);
        await database.db.insert(user).values({ id: userId, email: account.email, name: userId, emailVerified: true });
      };
      const linkedWorkspace = async (tenantId: string, linkedBy = 'flow-actor') => {
        await addTenant(tenantId, null);
        await addGrant(tenantId, linkedBy, 'owner');
        const linked = await linkOrganizationWorkspace(await organizationCtx(linkedBy, 'flow-org'), { organizationId: 'flow-org', tenantId }, workspaceDeps());
        expect(linked).toMatchObject({ ok: true, value: { changed: true } });
      };
      const linkOf = async (tenantId: string) =>
        (await database.db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.organizationId;
      const expectDerivedRolesGone = async (tenantId: string) => {
        for (const userId of ['flow-org-owner', 'flow-org-admin']) {
          expect(await createTenantAccessReader(database.db).findStaffGrant(userId, { tenantId }), userId).toBeNull();
          expect((await ctxFor(userId, tenantId)).identity, userId).toMatchObject({ staffRole: null });
        }
        expect(authorizeTenant(await ctxFor('flow-org-owner', tenantId), 'tenant:settings:write'))
          .toMatchObject({ ok: false, error: { code: 'forbidden' } });
      };

      it('lets a direct owner who never belonged to the organization unlink through the workspace and ends every derived role on the next request', async () => {
        await linkedWorkspace('flow-solo');
        await addAccount('flow-solo-owner');
        await addGrant('flow-solo', 'flow-solo-owner', 'owner');
        expect((await ctxFor('flow-org-owner', 'flow-solo')).identity).toMatchObject({ staffRole: 'owner', staffGrantSource: 'organization' });
        expect((await ctxFor('flow-org-admin', 'flow-solo')).identity).toMatchObject({ staffRole: 'admin', staffGrantSource: 'organization' });

        const owner = await ctxFor('flow-solo-owner', 'flow-solo');
        expect(owner.identity).toMatchObject({ staffRole: 'owner', staffGrantSource: 'direct' });
        expect(await unlinkWorkspaceFromOrganization(owner, workspaceDeps())).toEqual({
          ok: true, value: { workspace: { id: 'flow-solo', slug: 'flow-solo', name: 'Workspace flow-solo', status: 'active' }, changed: true },
        });
        expect(await linkOf('flow-solo')).toBeNull();
        await expectDerivedRolesGone('flow-solo');
        expect(await unlinkWorkspaceFromOrganization(await ctxFor('flow-solo-owner', 'flow-solo'), workspaceDeps()))
          .toMatchObject({ ok: true, value: { changed: false } });
      });

      it('lets a direct owner removed from the organization unlink through the workspace', async () => {
        await addAccount('flow-leaver');
        await addMember('flow-org', 'flow-leaver', 'owner');
        await linkedWorkspace('flow-leave', 'flow-leaver');
        const removed = await removeOrganizationMember(
          await organizationCtx('flow-actor', 'flow-org'),
          { organizationId: 'flow-org', email: 'flow-leaver@example.test' },
          memberDeps(),
        );
        expect(removed).toMatchObject({ ok: true, value: { changed: true } });
        expect(await unlinkOrganizationWorkspace(await organizationCtx('flow-leaver', 'flow-org'), { organizationId: 'flow-org', tenantId: 'flow-leave' }, workspaceDeps()))
          .toMatchObject({ ok: false, error: { code: 'not_found' } });

        expect(await unlinkWorkspaceFromOrganization(await ctxFor('flow-leaver', 'flow-leave'), workspaceDeps()))
          .toMatchObject({ ok: true, value: { changed: true } });
        expect(await linkOf('flow-leave')).toBeNull();
        await expectDerivedRolesGone('flow-leave');
      });

      it('lets an organization owner without a direct grant unlink through the organization', async () => {
        await linkedWorkspace('flow-org-side');
        expect(await createTenantAccessReader(database.db).findStaffGrant('flow-org-owner', { tenantId: 'flow-org-side' }))
          .toMatchObject({ staffRole: 'owner', source: 'organization' });

        const unlinked = await unlinkOrganizationWorkspace(
          await organizationCtx('flow-org-owner', 'flow-org'),
          { organizationId: 'flow-org', tenantId: 'flow-org-side' },
          workspaceDeps(),
        );
        expect(unlinked).toMatchObject({ ok: true, value: { workspace: { id: 'flow-org-side' }, changed: true } });
        expect(await linkOf('flow-org-side')).toBeNull();
        await expectDerivedRolesGone('flow-org-side');
      });

      it('refuses the workspace route to an owner whose role is derived from the organization, even with a forged direct source', async () => {
        await linkedWorkspace('flow-derived');
        const derivedOwner = await ctxFor('flow-org-owner', 'flow-derived');
        expect(derivedOwner.identity).toMatchObject({ staffRole: 'owner', staffGrantSource: 'organization' });

        expect(await unlinkWorkspaceFromOrganization(derivedOwner, workspaceDeps())).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await unlinkWorkspaceFromOrganization({ identity: { ...derivedOwner.identity, staffGrantSource: 'direct' } }, workspaceDeps()))
          .toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await linkOf('flow-derived')).toBe('flow-org');
      });

      it('refuses to unlink from either side while a configuration group takes the organization source', async () => {
        await linkedWorkspace('flow-sourced');
        await database.db.insert(tenantConfigSources).values({
          tenantId: 'flow-sourced', configGroup: 'telemetry', source: 'organization', updatedAt: NOW, updatedByUserId: 'flow-actor',
        });

        expect(await unlinkWorkspaceFromOrganization(await ctxFor('flow-actor', 'flow-sourced'), workspaceDeps()))
          .toMatchObject({ ok: false, error: { code: 'conflict' } });
        expect(await unlinkOrganizationWorkspace(
          await organizationCtx('flow-org-owner', 'flow-org'),
          { organizationId: 'flow-org', tenantId: 'flow-sourced' },
          workspaceDeps(),
        )).toMatchObject({ ok: false, error: { code: 'conflict' } });
        expect(await linkOf('flow-sourced')).toBe('flow-org');
        expect(await createTenantAccessReader(database.db).findStaffGrant('flow-org-owner', { tenantId: 'flow-sourced' }))
          .toMatchObject({ staffRole: 'owner', source: 'organization' });
      });
    });
  });
});
