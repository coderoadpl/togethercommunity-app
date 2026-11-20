import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Organization, OrganizationMember } from '#core/domain/index.js';

import {
  createOrganizationAuditRepository,
  createOrganizationMemberRepository,
  createOrganizationRepository,
  createOrganizationSecretRepository,
  createOrganizationWorkspaceRepository,
  createTenantConfigSourceRepository,
} from './organizations.js';
import { createTenantDirectory, createTenantRepository } from './repositories.js';
import {
  organizationAuditEvents,
  organizationMembers,
  organizationSecrets,
  organizations,
  tenantAdmins,
  tenantAuditEvents,
  tenantConfigSources,
  tenants,
  user,
} from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const at = '2026-11-15T10:00:00.000Z';
const later = '2026-11-15T11:00:00.000Z';

const hasRows = (result: unknown): boolean =>
  typeof result === 'object' && result !== null && 'rows' in result && Array.isArray(result.rows) && result.rows.length > 0;

const organization = (id: string, slug: string): Organization => ({
  id, slug, name: `Organization ${slug}`, status: 'active', maxWorkspaces: 3, createdAt: at, updatedAt: at,
});

describe('organization repositories', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    database = await createTestDatabase('together_organizations_test', databaseUrl);
    await database.db.insert(tenants).values([
      { id: 'acme', slug: 'acme', name: 'Acme', createdAt: at, invoiceSellerName: 'Acme Ltd' },
      { id: 'studio', slug: 'studio', name: 'Studio', createdAt: at },
    ]);
  });

  afterAll(async () => { await database?.close(); });

  const insertOrganization = async (value: Organization) => { await database.db.insert(organizations).values(value); };
  const insertMember = async (organizationId: string, member: Omit<OrganizationMember, 'organizationId'>) => {
    await database.db.insert(organizationMembers).values({ ...member, organizationId });
  };
  const memberRows = async (organizationId: string) => database.db.select().from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id));

  it('reads an organization by id and refuses a second one with the same slug', async () => {
    const repository = createOrganizationRepository(database.db);

    await insertOrganization(organization('org-1', 'holding'));
    await expect(insertOrganization(organization('org-2', 'holding'))).rejects.toThrow();
    expect(await repository.findById('org-1')).toEqual(organization('org-1', 'holding'));
    expect(await repository.findById('org-2')).toBeNull();
  });

  it('reads members once per organization and user', async () => {
    await insertOrganization(organization('org-members', 'members'));
    await insertOrganization(organization('org-other', 'other'));
    const repository = createOrganizationMemberRepository(database.db);
    const owner = { id: 'member-owner', userId: 'user-owner', role: 'owner' as const, createdAt: at, createdByUserId: 'operator' };
    const admin = { id: 'member-admin', userId: 'user-admin', role: 'admin' as const, createdAt: later, createdByUserId: 'user-owner' };

    await insertMember('org-members', owner);
    await insertMember('org-members', admin);
    await expect(insertMember('org-members', { ...admin, id: 'member-duplicate', role: 'owner' })).rejects.toThrow();
    await insertMember('org-other', { ...owner, id: 'member-other' });

    expect(await repository.find('org-members', 'user-admin')).toEqual({ ...admin, organizationId: 'org-members' });
    expect(await repository.find('org-other', 'user-admin')).toBeNull();
    expect(await repository.listForUser('user-owner')).toEqual([
      { ...owner, organizationId: 'org-members' },
      { ...owner, id: 'member-other', organizationId: 'org-other' },
    ]);
  });

  it('lists audit events newest first within one organization', async () => {
    await insertOrganization(organization('org-audit', 'audit'));
    const repository = createOrganizationAuditRepository(database.db);
    const created = {
      id: 'audit-created', kind: 'organization.created' as const, actorUserId: 'operator', actorEmail: 'operator@example.test',
      actorKeyId: null, subjectTenantId: null, subjectUserId: 'user-owner', data: { maxWorkspaces: 3 }, at,
    };
    const secret = {
      id: 'audit-secret', kind: 'secret.set' as const, actorUserId: 'user-owner', actorEmail: 'owner@example.test',
      actorKeyId: 'key-1', subjectTenantId: 'acme', subjectUserId: null,
      data: { key: 'ifirma.invoiceKey', preview: '••••abcd', groups: ['invoicing'], inherited: false, previous: null }, at: later,
    };

    await database.db.insert(organizationAuditEvents).values([
      { ...created, organizationId: 'org-audit' },
      { ...secret, organizationId: 'org-audit' },
      { ...created, id: 'audit-elsewhere', organizationId: 'org-members' },
    ]);

    expect(await repository.list('org-audit', { limit: 10 })).toEqual([
      { ...secret, organizationId: 'org-audit' },
      { ...created, organizationId: 'org-audit' },
    ]);
    expect(await repository.list('org-audit', { limit: 1 })).toEqual([{ ...secret, organizationId: 'org-audit' }]);
  });

  it('keeps tenant reads identical when a tenant is linked to an organization', async () => {
    const tenantRepository = createTenantRepository(database.db);
    const directory = createTenantDirectory(database.db);
    const read = async () => ({
      byId: await tenantRepository.findById('acme'),
      bySlug: await tenantRepository.findBySlug('acme'),
      settings: await tenantRepository.findSettings('acme'),
      directory: await directory.listAll(),
    });
    const before = await read();

    await insertOrganization(organization('org-link', 'link'));
    await database.db.update(tenants).set({ organizationId: 'org-link' }).where(eq(tenants.id, 'acme'));
    const after = await read();

    expect(after).toEqual(before);
    expect(after.byId).not.toHaveProperty('organizationId');
    expect(after.bySlug).not.toHaveProperty('organizationId');
    expect(after.settings).not.toHaveProperty('organizationId');
    expect(after.directory.every((tenant) => !('organizationId' in tenant))).toBe(true);
    expect(before.byId).toMatchObject({ id: 'acme', slug: 'acme', name: 'Acme', invoiceSellerName: 'Acme Ltd' });
  });

  it('refuses to delete an organization that still has workspaces', async () => {
    await expect(database.db.delete(organizations).where(eq(organizations.id, 'org-link'))).rejects.toThrow();
    expect(await createOrganizationRepository(database.db).findById('org-link')).not.toBeNull();
  });

  it('creates an organization with its owner and audit atomically, replays for the same owner and refuses others', async () => {
    await database.db.insert(user).values([
      { id: 'creator', email: 'creator@example.test', name: 'Creator', emailVerified: true },
      { id: 'rival', email: 'rival@example.test', name: 'Rival', emailVerified: true },
      { id: 'pending', email: 'pending@example.test', name: 'Pending', emailVerified: false },
    ]);
    const repository = createOrganizationRepository(database.db);
    const input = (id: string, userId: string) => ({
      organization: organization(id, 'created'),
      owner: { id: `${id}-owner`, userId, role: 'owner' as const, createdAt: at, createdByUserId: 'operator-secret' },
      audit: [{
        id: `${id}-audit`, kind: 'organization.created' as const, actorUserId: 'operator-secret', actorEmail: 'operator@together.invalid',
        actorKeyId: null, subjectTenantId: null, subjectUserId: null, data: { slug: 'created' }, at,
      }],
    });
    const rows = async () => ({
      organizations: await database.db.select().from(organizations).where(eq(organizations.slug, 'created')),
      members: await database.db.select().from(organizationMembers).where(eq(organizationMembers.organizationId, 'org-created')),
      audit: await database.db.select().from(organizationAuditEvents).where(eq(organizationAuditEvents.organizationId, 'org-created')),
    });

    expect(await repository.createWithOwner(input('org-pending', 'pending'))).toEqual({ status: 'owner_unverified' });
    expect(await repository.createWithOwner(input('org-created', 'creator'))).toEqual({ status: 'created', organization: organization('org-created', 'created') });
    expect(await repository.createWithOwner(input('org-replay', 'creator'))).toEqual({ status: 'existing', organization: organization('org-created', 'created') });
    expect(await repository.createWithOwner(input('org-rival', 'rival'))).toEqual({ status: 'conflict' });
    const stored = await rows();
    expect(stored.organizations.map((row) => row.id)).toEqual(['org-created']);
    expect(stored.members.map((row) => [row.userId, row.role])).toEqual([['creator', 'owner']]);
    expect(stored.audit.map((row) => row.id)).toEqual(['org-created-audit']);
  });

  it('sets the workspace limit with its audit row and lists member accounts', async () => {
    const repository = createOrganizationRepository(database.db);
    const audit = {
      id: 'audit-limits', kind: 'organization.updated' as const, actorUserId: 'operator-secret', actorEmail: 'operator@together.invalid',
      actorKeyId: null, subjectTenantId: null, subjectUserId: null, data: { maxWorkspaces: 7 }, at: later,
    };
    expect(await repository.setMaxWorkspaces('org-created', { maxWorkspaces: 7, updatedAt: later, audit }))
      .toEqual({ ...organization('org-created', 'created'), maxWorkspaces: 7, updatedAt: later });
    expect(await repository.setMaxWorkspaces('org-unknown', { maxWorkspaces: 7, updatedAt: later, audit: { ...audit, id: 'audit-unknown' } })).toBeNull();
    expect(await createOrganizationAuditRepository(database.db).list('org-created', { limit: 1 })).toEqual([{ ...audit, organizationId: 'org-created' }]);
    expect(await createOrganizationMemberRepository(database.db).listAccounts('org-created')).toEqual([
      { userId: 'creator', email: 'creator@example.test', role: 'owner', createdAt: at },
    ]);
  });

  it('links only for a direct workspace owner who owns the organization and unlinks for an organization owner, auditing both sides in one transaction', async () => {
    await insertOrganization(organization('org-ws', 'workspaces'));
    await insertOrganization(organization('org-ws-other', 'workspaces-other'));
    await database.db.insert(tenants).values([
      { id: 'ws-own', slug: 'ws-own', name: 'Own', createdAt: at },
      { id: 'ws-taken', slug: 'ws-taken', name: 'Taken', createdAt: at, organizationId: 'org-ws-other' },
    ]);
    await database.db.insert(tenantAdmins).values([
      { id: 'grant-owner', tenantId: 'ws-own', userId: 'ws-owner', role: 'owner' },
      { id: 'grant-admin', tenantId: 'ws-own', userId: 'ws-admin', role: 'admin' },
      { id: 'grant-org-admin', tenantId: 'ws-own', userId: 'ws-org-admin', role: 'owner' },
      { id: 'grant-taken', tenantId: 'ws-taken', userId: 'ws-owner', role: 'owner' },
    ]);
    for (const [userId, role] of [['ws-owner', 'owner'], ['ws-admin', 'owner'], ['ws-org-admin', 'admin']] as const) {
      await insertMember('org-ws', { id: `org-ws-${userId}`, userId, role, createdAt: at, createdByUserId: 'operator' });
    }
    const repository = createOrganizationWorkspaceRepository(database.db);
    const change = (actorUserId: string, id: string, linked: boolean) => ({
      organizationId: 'org-ws',
      actorUserId,
      organizationAudit: {
        id: `org-${id}`, kind: linked ? 'workspace.linked' as const : 'workspace.unlinked' as const, actorUserId,
        actorEmail: `${actorUserId}@example.test`, actorKeyId: null, subjectTenantId: 'ws-own', subjectUserId: null, data: {}, at,
      },
      tenantAudit: {
        id: `tenant-${id}`, kind: linked ? 'organization.linked' as const : 'organization.unlinked' as const, actorUserId,
        actorEmail: `${actorUserId}@example.test`, subjectMemberId: null, reason: 'org-ws', at,
      },
    });
    const linkOf = async (tenantId: string) =>
      (await database.db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.organizationId;
    const audits = async () => ({
      organization: (await database.db.select().from(organizationAuditEvents).where(eq(organizationAuditEvents.organizationId, 'org-ws'))).map((row) => row.id),
      tenant: (await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.tenantId, 'ws-own'))).map((row) => row.id),
    });
    const workspace = { id: 'ws-own', slug: 'ws-own', name: 'Own', status: 'active' };

    expect(await repository.link('ws-own', change('ws-admin', 'a', true))).toEqual({ status: 'workspace_owner_required' });
    expect(await repository.link('ws-own', change('ws-org-admin', 'b', true))).toEqual({ status: 'organization_owner_required' });
    expect(await repository.link('ws-missing', change('ws-owner', 'c', true))).toEqual({ status: 'workspace_owner_required' });
    expect(await repository.link('ws-taken', change('ws-owner', 'd', true))).toEqual({ status: 'linked_elsewhere' });
    expect(await audits()).toEqual({ organization: [], tenant: [] });
    expect(await linkOf('ws-taken')).toBe('org-ws-other');

    expect(await repository.link('ws-own', change('ws-owner', 'e', true))).toEqual({ status: 'linked', workspace });
    expect(await repository.link('ws-own', change('ws-owner', 'f', true))).toEqual({ status: 'already_linked', workspace });
    expect(await linkOf('ws-own')).toBe('org-ws');
    expect(await repository.list('org-ws')).toEqual([workspace]);
    expect(await repository.list('org-ws-other')).toEqual([{ id: 'ws-taken', slug: 'ws-taken', name: 'Taken', status: 'active' }]);
    expect(await audits()).toEqual({ organization: ['org-e'], tenant: ['tenant-e'] });

    expect(await repository.unlink('ws-own', change('ws-org-admin', 'g', false))).toEqual({ status: 'organization_owner_required' });
    expect(await repository.unlink('ws-own', change('ws-owner', 'h', false))).toEqual({ status: 'unlinked', workspace });
    expect(await repository.unlink('ws-own', change('ws-owner', 'i', false))).toEqual({ status: 'not_linked', workspace });
    expect(await linkOf('ws-own')).toBeNull();
    expect(await repository.list('org-ws')).toEqual([]);
    expect(await audits()).toEqual({ organization: ['org-e', 'org-h'], tenant: ['tenant-e', 'tenant-h'] });

    const duplicateAudit = change('ws-owner', 'e', true);
    await expect(repository.link('ws-own', { ...duplicateAudit, tenantAudit: { ...duplicateAudit.tenantAudit, id: 'tenant-fresh' } })).rejects.toThrow();
    expect(await linkOf('ws-own')).toBeNull();
    expect(await audits()).toEqual({ organization: ['org-e', 'org-h'], tenant: ['tenant-e', 'tenant-h'] });
  });

  it('adds, re-roles and removes members with their audit rows and never leaves the organization without an owner', async () => {
    await insertOrganization(organization('org-team', 'team'));
    await database.db.insert(user).values([
      { id: 'team-owner', email: 'team-owner@example.test', name: 'Team owner', emailVerified: true },
      { id: 'team-second', email: 'team-second@example.test', name: 'Team second', emailVerified: true },
      { id: 'team-third', email: 'team-third@example.test', name: 'Team third', emailVerified: true },
      { id: 'team-pending', email: 'team-pending@example.test', name: 'Team pending', emailVerified: false },
    ]);
    const repository = createOrganizationMemberRepository(database.db);
    await insertMember('org-team', { id: 'team-m-owner', userId: 'team-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
    let next = 0;
    const audit = (kind: 'member.added' | 'member.role_changed' | 'member.removed', actorUserId: string, subjectUserId: string) => ({
      id: `team-audit-${++next}`, kind, actorUserId, actorEmail: `${actorUserId}@example.test`, actorKeyId: null,
      subjectTenantId: null, subjectUserId, at: later,
    });
    const member = (userId: string, role: 'owner' | 'admin') =>
      ({ id: `team-m-${userId}`, userId, role, createdAt: later, createdByUserId: 'team-owner' });
    const audits = async () => (await database.db.select().from(organizationAuditEvents)
      .where(eq(organizationAuditEvents.organizationId, 'org-team')))
      .map((row) => [row.kind, row.actorUserId, row.subjectUserId, row.data]);
    const roles = async () => (await memberRows('org-team')).map((row) => [row.userId, row.role]);

    expect(await repository.addAccount('org-team', { actorUserId: 'team-owner', member: member('team-pending', 'admin'), audit: audit('member.added', 'team-owner', 'team-pending') }))
      .toEqual({ status: 'account_unverified' });
    expect(await repository.addAccount('org-team', { actorUserId: 'team-second', member: member('team-third', 'admin'), audit: audit('member.added', 'team-second', 'team-third') }))
      .toEqual({ status: 'organization_owner_required' });
    expect(await repository.addAccount('org-team', { actorUserId: 'team-owner', member: member('team-second', 'admin'), audit: audit('member.added', 'team-owner', 'team-second') }))
      .toEqual({ status: 'added', member: { userId: 'team-second', email: 'team-second@example.test', role: 'admin', createdAt: later } });
    expect(await repository.addAccount('org-team', { actorUserId: 'team-owner', member: { ...member('team-second', 'owner'), id: 'team-m-dup' }, audit: audit('member.added', 'team-owner', 'team-second') }))
      .toMatchObject({ status: 'already_member', member: { role: 'admin' } });
    expect(await repository.addAccount('org-team', { actorUserId: 'team-second', member: member('team-third', 'admin'), audit: audit('member.added', 'team-second', 'team-third') }))
      .toEqual({ status: 'organization_owner_required' });

    expect(await repository.changeRole('org-team', { actorUserId: 'team-owner', userId: 'team-owner', role: 'admin', audit: audit('member.role_changed', 'team-owner', 'team-owner') }))
      .toEqual({ status: 'last_owner' });
    expect(await repository.remove('org-team', { actorUserId: 'team-owner', userId: 'team-owner', audit: audit('member.removed', 'team-owner', 'team-owner') }))
      .toEqual({ status: 'last_owner' });
    expect(await repository.changeRole('org-team', { actorUserId: 'team-owner', userId: 'team-third', role: 'admin', audit: audit('member.role_changed', 'team-owner', 'team-third') }))
      .toEqual({ status: 'not_member' });
    expect(await repository.changeRole('org-team', { actorUserId: 'team-owner', userId: 'team-second', role: 'admin', audit: audit('member.role_changed', 'team-owner', 'team-second') }))
      .toMatchObject({ status: 'unchanged' });
    expect(await repository.changeRole('org-team', { actorUserId: 'team-owner', userId: 'team-second', role: 'owner', audit: audit('member.role_changed', 'team-owner', 'team-second') }))
      .toEqual({ status: 'changed', member: { userId: 'team-second', email: 'team-second@example.test', role: 'owner', createdAt: later } });
    expect(await repository.remove('org-team', { actorUserId: 'team-second', userId: 'team-owner', audit: audit('member.removed', 'team-second', 'team-owner') }))
      .toEqual({ status: 'removed', member: { userId: 'team-owner', email: 'team-owner@example.test', role: 'owner', createdAt: at } });
    expect(await repository.find('org-team', 'team-owner')).toBeNull();
    expect(await repository.remove('org-team', { actorUserId: 'team-second', userId: 'team-second', audit: audit('member.removed', 'team-second', 'team-second') }))
      .toEqual({ status: 'last_owner' });

    expect(await roles()).toEqual([['team-second', 'owner']]);
    expect(await audits()).toEqual([
      ['member.added', 'team-owner', 'team-second', { role: 'admin' }],
      ['member.role_changed', 'team-owner', 'team-second', { from: 'admin', to: 'owner' }],
      ['member.removed', 'team-second', 'team-owner', { role: 'owner' }],
    ]);
  });

  it('keeps one owner when two owners are demoted and removed concurrently', async () => {
    await insertOrganization(organization('org-race', 'race'));
    await database.db.insert(user).values([
      { id: 'race-a', email: 'race-a@example.test', name: 'Race A', emailVerified: true },
      { id: 'race-b', email: 'race-b@example.test', name: 'Race B', emailVerified: true },
    ]);
    const repository = createOrganizationMemberRepository(database.db);
    for (const userId of ['race-a', 'race-b']) {
      await insertMember('org-race', { id: `race-m-${userId}`, userId, role: 'owner', createdAt: at, createdByUserId: 'operator' });
    }
    const audit = (id: string, kind: 'member.role_changed' | 'member.removed', actorUserId: string, subjectUserId: string) => ({
      id, kind, actorUserId, actorEmail: `${actorUserId}@example.test`, actorKeyId: null, subjectTenantId: null, subjectUserId, at: later,
    });

    for (let round = 0; round < 5; round += 1) {
      const results = await Promise.all([
        repository.changeRole('org-race', { actorUserId: 'race-a', userId: 'race-a', role: 'admin', audit: audit(`race-${round}-a`, 'member.role_changed', 'race-a', 'race-a') }),
        repository.remove('org-race', { actorUserId: 'race-b', userId: 'race-b', audit: audit(`race-${round}-b`, 'member.removed', 'race-b', 'race-b') }),
      ]);
      expect(results.filter((result) => result.status === 'last_owner'), `round ${round}`).toHaveLength(1);
      const owners = (await memberRows('org-race')).filter((row) => row.role === 'owner');
      expect(owners, `round ${round}`).toHaveLength(1);
      await database.db.delete(organizationMembers).where(eq(organizationMembers.organizationId, 'org-race'));
      for (const userId of ['race-a', 'race-b']) {
        await insertMember('org-race', { id: `race-m-${userId}`, userId, role: 'owner', createdAt: at, createdByUserId: 'operator' });
      }
    }
  });

  it('reads default settings, updates only changed fields with one audit row and compares the sender regardless of key order', async () => {
    const repository = createOrganizationRepository(database.db);
    await insertOrganization(organization('org-settings', 'settings'));
    const audit = (id: string) => ({
      id, kind: 'organization.updated' as const, actorUserId: 'settings-owner', actorEmail: 'settings-owner@example.test',
      actorKeyId: null, subjectTenantId: null, subjectUserId: null, at: later,
    });
    const sender = {
      name: 'Warehouse', company: null, email: 'warehouse@example.test', phone: '500600700',
      street: 'Main', buildingNumber: '1', city: 'Warsaw', postCode: '00-001',
    };
    const reordered = {
      postCode: '00-001', city: 'Warsaw', buildingNumber: '1', street: 'Main',
      phone: '500600700', email: 'warehouse@example.test', company: null, name: 'Warehouse',
    };
    const defaults = {
      legalName: null, legalAddress: null, invoicingProvider: null, ksefSubmissionMode: 'automatic', shipxEnvironment: 'sandbox', shipxSender: null,
    };

    expect(await repository.findSettings('org-settings')).toEqual(defaults);
    expect(await repository.findSettings('org-unknown')).toBeNull();
    expect(await repository.updateSettings('org-unknown', { update: { legalName: 'Nobody' }, updatedAt: later, audit: audit('settings-unknown') })).toBeNull();
    expect(await repository.updateSettings('org-settings', {
      update: { name: 'Settings Group', legalName: 'Settings Ltd', invoicingProvider: 'ksef', shipxSender: sender },
      updatedAt: later,
      audit: audit('settings-1'),
    })).toEqual({
      status: 'updated',
      organization: { ...organization('org-settings', 'settings'), name: 'Settings Group', updatedAt: later },
      settings: { ...defaults, legalName: 'Settings Ltd', invoicingProvider: 'ksef', shipxSender: sender },
      changed: true,
    });
    expect(await repository.updateSettings('org-settings', {
      update: { legalName: 'Settings Ltd', shipxSender: reordered },
      updatedAt: '2026-11-15T12:00:00.000Z',
      audit: audit('settings-2'),
    })).toMatchObject({ organization: { updatedAt: later }, changed: false });
    expect(await repository.updateSettings('org-settings', {
      update: { invoicingProvider: null, shipxEnvironment: 'production' }, updatedAt: later, audit: audit('settings-3'),
    })).toMatchObject({ settings: { invoicingProvider: null, shipxEnvironment: 'production' }, changed: true });
    expect((await database.db.select().from(organizationAuditEvents).where(eq(organizationAuditEvents.organizationId, 'org-settings')))
      .map((row) => [row.id, row.data])).toEqual([
      ['settings-1', { fields: ['name', 'legalName', 'invoicingProvider', 'shipxSender'] }],
      ['settings-3', { fields: ['invoicingProvider', 'shipxEnvironment'] }],
    ]);
    await expect(database.db.execute(sql`UPDATE organizations SET shipx_environment = 'staging' WHERE id = 'org-settings'`)).rejects.toThrow();
  });

  it('upserts organization secrets with their audit rows and refuses deletion while a linked workspace inherits the group', async () => {
    await insertOrganization(organization('org-secrets', 'secrets'));
    await insertOrganization(organization('org-secrets-other', 'secrets-other'));
    await database.db.insert(tenants).values([
      { id: 'secrets-ws', slug: 'secrets-ws', name: 'Secrets workspace', createdAt: at, organizationId: 'org-secrets' },
      { id: 'secrets-foreign', slug: 'secrets-foreign', name: 'Foreign workspace', createdAt: at, organizationId: 'org-secrets-other' },
    ]);
    const repository = createOrganizationSecretRepository(database.db);
    const audit = (id: string, kind: 'secret.set' | 'secret.deleted') => ({
      id, kind, actorUserId: 'secrets-owner', actorEmail: 'secrets-owner@example.test',
      actorKeyId: null, subjectTenantId: null, subjectUserId: null, at: later,
    });
    const secret = (id: string, key: 'ksef.token' | 'smtp.password', preview: string) => ({
      id, key, ciphertext: `cipher-${id}`, iv: `iv-${id}`, authTag: `tag-${id}`, maskedPreview: preview, updatedAt: later,
    });

    expect(await repository.set('org-secrets', { secret: secret('s-1', 'ksef.token', '••••1111'), group: 'invoicing', audit: audit('sa-1', 'secret.set') }))
      .toEqual({ status: 'set', secret: { ...secret('s-1', 'ksef.token', '••••1111'), organizationId: 'org-secrets' } });
    expect(await repository.set('org-secrets', { secret: secret('s-2', 'ksef.token', '••••2222'), group: 'invoicing', audit: audit('sa-2', 'secret.set') }))
      .toEqual({ status: 'set', secret: { ...secret('s-2', 'ksef.token', '••••2222'), id: 's-1', organizationId: 'org-secrets' } });
    await repository.set('org-secrets', { secret: secret('s-3', 'smtp.password', '••••3333'), group: 'email_transport', audit: audit('sa-3', 'secret.set') });
    expect((await repository.listByOrganization('org-secrets')).map((row) => [row.key, row.maskedPreview])).toEqual([
      ['ksef.token', '••••2222'], ['smtp.password', '••••3333'],
    ]);
    expect(await repository.listByOrganization('org-secrets-other')).toEqual([]);

    await database.db.insert(tenantConfigSources).values([
      { tenantId: 'secrets-ws', configGroup: 'invoicing', source: 'organization', updatedAt: later, updatedByUserId: 'secrets-owner' },
      { tenantId: 'secrets-foreign', configGroup: 'email_transport', source: 'organization', updatedAt: later, updatedByUserId: 'secrets-owner' },
    ]);
    expect(await repository.delete('org-secrets', { key: 'ksef.token', group: 'invoicing', audit: audit('sa-4', 'secret.deleted') }))
      .toEqual({ status: 'config_inherited' });
    expect(await repository.delete('org-secrets', { key: 'smtp.password', group: 'email_transport', audit: audit('sa-5', 'secret.deleted') }))
      .toMatchObject({ status: 'deleted', secret: { key: 'smtp.password' } });
    expect(await repository.delete('org-secrets', { key: 'smtp.password', group: 'email_transport', audit: audit('sa-6', 'secret.deleted') }))
      .toEqual({ status: 'not_found' });
    expect((await repository.listByOrganization('org-secrets')).map((row) => row.key)).toEqual(['ksef.token']);

    await database.db.delete(tenantConfigSources).where(eq(tenantConfigSources.tenantId, 'secrets-ws'));
    expect(await repository.delete('org-secrets', { key: 'ksef.token', group: 'invoicing', audit: audit('sa-7', 'secret.deleted') }))
      .toMatchObject({ status: 'deleted' });
    expect(await database.db.select().from(organizationSecrets).where(eq(organizationSecrets.organizationId, 'org-secrets'))).toEqual([]);
    expect((await database.db.select().from(organizationAuditEvents).where(eq(organizationAuditEvents.organizationId, 'org-secrets')))
      .map((row) => [row.id, row.kind, row.data])).toEqual([
      ['sa-1', 'secret.set', { key: 'ksef.token', group: 'invoicing' }],
      ['sa-2', 'secret.set', { key: 'ksef.token', group: 'invoicing' }],
      ['sa-3', 'secret.set', { key: 'smtp.password', group: 'email_transport' }],
      ['sa-5', 'secret.deleted', { key: 'smtp.password', group: 'email_transport' }],
      ['sa-7', 'secret.deleted', { key: 'ksef.token', group: 'invoicing' }],
    ]);
  });

  it('refuses to unlink a workspace while it has a configuration source row and lists its sources', async () => {
    await insertOrganization(organization('org-sources', 'sources'));
    await database.db.insert(tenants).values({ id: 'sources-ws', slug: 'sources-ws', name: 'Sources', createdAt: at });
    await database.db.insert(tenantAdmins).values({ id: 'sources-grant', tenantId: 'sources-ws', userId: 'sources-owner', role: 'owner' });
    await insertMember('org-sources', { id: 'sources-member', userId: 'sources-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
    const workspaces = createOrganizationWorkspaceRepository(database.db);
    const sources = createTenantConfigSourceRepository(database.db);
    const change = (id: string, linked: boolean) => ({
      organizationId: 'org-sources',
      actorUserId: 'sources-owner',
      organizationAudit: {
        id: `sources-org-${id}`, kind: linked ? 'workspace.linked' as const : 'workspace.unlinked' as const, actorUserId: 'sources-owner',
        actorEmail: 'sources-owner@example.test', actorKeyId: null, subjectTenantId: 'sources-ws', subjectUserId: null, data: {}, at,
      },
      tenantAudit: {
        id: `sources-tenant-${id}`, kind: linked ? 'organization.linked' as const : 'organization.unlinked' as const, actorUserId: 'sources-owner',
        actorEmail: 'sources-owner@example.test', subjectMemberId: null, reason: 'org-sources', at,
      },
    });
    expect(await workspaces.link('sources-ws', change('a', true))).toMatchObject({ status: 'linked' });
    await database.db.insert(tenantConfigSources).values({
      tenantId: 'sources-ws', configGroup: 'telemetry', source: 'organization', updatedAt: later, updatedByUserId: 'sources-owner',
    });
    expect(await sources.listByTenant('sources-ws')).toEqual([
      { tenantId: 'sources-ws', group: 'telemetry', source: 'organization', updatedAt: later, updatedByUserId: 'sources-owner' },
    ]);
    expect(await sources.listByTenant('acme')).toEqual([]);

    expect(await workspaces.unlink('sources-ws', change('b', false))).toEqual({ status: 'config_sources_present' });
    expect((await database.db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, 'sources-ws')))[0]?.organizationId)
      .toBe('org-sources');
    expect((await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.tenantId, 'sources-ws'))).map((row) => row.id))
      .toEqual(['sources-tenant-a']);

    await database.db.delete(tenantConfigSources).where(eq(tenantConfigSources.tenantId, 'sources-ws'));
    expect(await workspaces.unlink('sources-ws', change('c', false))).toMatchObject({ status: 'unlinked' });
  });

  it('unlinks for either side, re-checking the authority and the source rows inside the transaction', async () => {
    await insertOrganization(organization('org-either', 'either'));
    await insertOrganization(organization('org-either-other', 'either-other'));
    await database.db.insert(tenants).values([
      { id: 'either-a', slug: 'either-a', name: 'Either A', createdAt: at, organizationId: 'org-either' },
      { id: 'either-b', slug: 'either-b', name: 'Either B', createdAt: at, organizationId: 'org-either' },
      { id: 'either-out', slug: 'either-out', name: 'Either out', createdAt: at },
      { id: 'either-elsewhere', slug: 'either-elsewhere', name: 'Either elsewhere', createdAt: at, organizationId: 'org-either-other' },
    ]);
    await database.db.insert(tenantAdmins).values([
      { id: 'either-grant-owner', tenantId: 'either-b', userId: 'either-ws-owner', role: 'owner' },
      { id: 'either-grant-admin', tenantId: 'either-b', userId: 'either-ws-admin', role: 'admin' },
    ]);
    await insertMember('org-either', { id: 'either-member', userId: 'either-org-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
    const repository = createOrganizationWorkspaceRepository(database.db);
    const audit = (actorUserId: string, tenantId: string, id: string) => ({
      organizationAudit: {
        id: `either-org-${id}`, kind: 'workspace.unlinked' as const, actorUserId, actorEmail: `${actorUserId}@example.test`,
        actorKeyId: null, subjectTenantId: tenantId, subjectUserId: null, data: {}, at,
      },
      tenantAudit: {
        id: `either-tenant-${id}`, kind: 'organization.unlinked' as const, actorUserId, actorEmail: `${actorUserId}@example.test`,
        subjectMemberId: null, at,
      },
    });
    const byOrganization = (actorUserId: string, tenantId: string, id: string) => {
      const audits = audit(actorUserId, tenantId, id);
      return { organizationId: 'org-either', actorUserId, ...audits, tenantAudit: { ...audits.tenantAudit, reason: 'org-either' } };
    };
    const byWorkspace = (actorUserId: string, tenantId: string, id: string) => ({ actorUserId, ...audit(actorUserId, tenantId, id) });
    const linkOf = async (tenantId: string) =>
      (await database.db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.organizationId;
    const auditRows = async () => ({
      organization: (await database.db.select().from(organizationAuditEvents).where(eq(organizationAuditEvents.organizationId, 'org-either')))
        .map(({ id, actorUserId, subjectTenantId }) => [id, actorUserId, subjectTenantId]),
      tenant: (await database.db.select().from(tenantAuditEvents))
        .filter((row) => row.tenantId.startsWith('either-'))
        .map(({ id, tenantId, reason }) => [id, tenantId, reason]),
    });

    expect(await repository.unlink('either-a', byOrganization('either-org-owner', 'either-a', 'a'))).toEqual({
      status: 'unlinked', workspace: { id: 'either-a', slug: 'either-a', name: 'Either A', status: 'active' },
    });
    for (const tenantId of ['either-a', 'either-out', 'either-elsewhere', 'either-missing']) {
      expect(await repository.unlink(tenantId, byOrganization('either-org-owner', tenantId, `refused-${tenantId}`)), tenantId)
        .toEqual({ status: 'not_in_organization' });
    }
    expect(await repository.unlink('either-b', byOrganization('either-ws-owner', 'either-b', 'not-member')))
      .toEqual({ status: 'organization_owner_required' });

    for (const actorUserId of ['either-ws-admin', 'either-org-owner']) {
      expect(await repository.unlinkAsWorkspaceOwner('either-b', byWorkspace(actorUserId, 'either-b', `refused-${actorUserId}`)), actorUserId)
        .toEqual({ status: 'workspace_owner_required' });
    }
    expect(await repository.unlinkAsWorkspaceOwner('either-missing', byWorkspace('either-ws-owner', 'either-missing', 'missing')))
      .toEqual({ status: 'workspace_owner_required' });

    await database.db.insert(tenantConfigSources).values({
      tenantId: 'either-b', configGroup: 'invoicing', source: 'organization', updatedAt: later, updatedByUserId: 'either-org-owner',
    });
    expect(await repository.unlinkAsWorkspaceOwner('either-b', byWorkspace('either-ws-owner', 'either-b', 'sourced')))
      .toEqual({ status: 'config_sources_present' });
    expect(await repository.unlink('either-b', byOrganization('either-org-owner', 'either-b', 'sourced-org')))
      .toEqual({ status: 'config_sources_present' });
    expect(await linkOf('either-b')).toBe('org-either');
    await database.db.delete(tenantConfigSources).where(eq(tenantConfigSources.tenantId, 'either-b'));

    const workspace = { id: 'either-b', slug: 'either-b', name: 'Either B', status: 'active' };
    expect(await repository.unlinkAsWorkspaceOwner('either-b', byWorkspace('either-ws-owner', 'either-b', 'b')))
      .toEqual({ status: 'unlinked', workspace, organizationId: 'org-either' });
    expect(await repository.unlinkAsWorkspaceOwner('either-b', byWorkspace('either-ws-owner', 'either-b', 'b-again')))
      .toEqual({ status: 'not_linked', workspace });
    expect(await linkOf('either-a')).toBeNull();
    expect(await linkOf('either-b')).toBeNull();
    expect(await linkOf('either-elsewhere')).toBe('org-either-other');
    expect(await auditRows()).toEqual({
      organization: [['either-org-a', 'either-org-owner', 'either-a'], ['either-org-b', 'either-ws-owner', 'either-b']],
      tenant: [['either-tenant-a', 'either-a', 'org-either'], ['either-tenant-b', 'either-b', 'org-either']],
    });
  });

  it('accepts only known groups and the organization source in the source table', async () => {
    const row = { tenantId: 'acme', configGroup: 'invoicing' as const, source: 'organization' as const, updatedAt: later, updatedByUserId: 'owner' };
    await expect(database.db.execute(sql`
      INSERT INTO tenant_config_sources (tenant_id, config_group, source, updated_at, updated_by_user_id)
      VALUES ('acme', 'invoicing', 'workspace', ${later}, 'owner')
    `)).rejects.toThrow();
    await expect(database.db.execute(sql`
      INSERT INTO tenant_config_sources (tenant_id, config_group, source, updated_at, updated_by_user_id)
      VALUES ('acme', 'branding', 'organization', ${later}, 'owner')
    `)).rejects.toThrow();
    await database.db.insert(tenantConfigSources).values(row);
    await expect(database.db.insert(tenantConfigSources).values(row)).rejects.toThrow();
    await database.db.delete(tenantConfigSources).where(eq(tenantConfigSources.tenantId, 'acme'));
  });

  describe('workspace limit on link', () => {
    const quotaOrganization = async (organizationId: string, tenantIds: string[]) => {
      await insertOrganization({ ...organization(organizationId, organizationId), maxWorkspaces: 1 });
      await database.db.insert(tenants).values(tenantIds.map((id) => ({ id, slug: id, name: id, createdAt: at })));
      await database.db.insert(tenantAdmins).values(tenantIds.map((id) => ({ id: `grant-${id}`, tenantId: id, userId: 'quota-owner', role: 'owner' as const })));
      await insertMember(organizationId, { id: `${organizationId}-owner`, userId: 'quota-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
    };
    const change = (organizationId: string, tenantId: string, id: string) => ({
      organizationId,
      actorUserId: 'quota-owner',
      organizationAudit: {
        id: `org-${id}`, kind: 'workspace.linked' as const, actorUserId: 'quota-owner', actorEmail: 'quota-owner@example.test',
        actorKeyId: null, subjectTenantId: tenantId, subjectUserId: null, data: {}, at,
      },
      tenantAudit: {
        id: `tenant-${id}`, kind: 'organization.linked' as const, actorUserId: 'quota-owner', actorEmail: 'quota-owner@example.test',
        subjectMemberId: null, reason: organizationId, at,
      },
    });
    const linkedTo = async (organizationId: string) =>
      (await database.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.organizationId, organizationId))).map((row) => row.id).sort();
    const auditIds = async (organizationId: string, tenantIds: string[]) => ({
      organization: (await database.db.select().from(organizationAuditEvents).where(eq(organizationAuditEvents.organizationId, organizationId)))
        .filter((row) => row.kind === 'workspace.linked').map((row) => row.id).sort(),
      tenant: (await database.db.select().from(tenantAuditEvents))
        .filter((row) => tenantIds.includes(row.tenantId)).map((row) => row.id).sort(),
    });

    it('refuses a link past max_workspaces without writing anything, keeps re-links idempotent and links after the limit is raised', async () => {
      await quotaOrganization('org-quota', ['quota-1', 'quota-2']);
      const repository = createOrganizationWorkspaceRepository(database.db);

      expect(await repository.link('quota-1', change('org-quota', 'quota-1', 'quota-a'))).toMatchObject({ status: 'linked' });
      expect(await repository.link('quota-1', change('org-quota', 'quota-1', 'quota-b'))).toMatchObject({ status: 'already_linked' });
      expect(await repository.link('quota-2', change('org-quota', 'quota-2', 'quota-c'))).toEqual({ status: 'workspace_quota_exceeded' });
      expect(await linkedTo('org-quota')).toEqual(['quota-1']);
      expect(await auditIds('org-quota', ['quota-1', 'quota-2'])).toEqual({ organization: ['org-quota-a'], tenant: ['tenant-quota-a'] });

      const raised = await createOrganizationRepository(database.db).setMaxWorkspaces('org-quota', {
        maxWorkspaces: 2,
        updatedAt: later,
        audit: {
          id: 'org-quota-limit', kind: 'organization.updated', actorUserId: 'operator-secret', actorEmail: 'operator@together.invalid', actorKeyId: null,
          subjectTenantId: null, subjectUserId: null, data: { maxWorkspaces: 2 }, at: later,
        },
      });
      expect(raised?.maxWorkspaces).toBe(2);
      expect(await repository.link('quota-2', change('org-quota', 'quota-2', 'quota-d'))).toMatchObject({ status: 'linked' });
      expect(await linkedTo('org-quota')).toEqual(['quota-1', 'quota-2']);
    });

    it('lets exactly one of two concurrent links take the last place', async () => {
      const repository = createOrganizationWorkspaceRepository(database.db);
      for (const round of [1, 2, 3, 4, 5]) {
        const organizationId = `org-race-${round}`;
        const tenantIds = [`race-${round}-a`, `race-${round}-b`];
        await quotaOrganization(organizationId, tenantIds);
        const results = await Promise.all(tenantIds.map((tenantId) => repository.link(tenantId, change(organizationId, tenantId, `race-${tenantId}`))));
        expect(results.map((result) => result.status).sort()).toEqual(['linked', 'workspace_quota_exceeded']);
        expect(await linkedTo(organizationId)).toHaveLength(1);
        expect((await auditIds(organizationId, tenantIds)).tenant).toHaveLength(1);
      }
    });
  });

  describe('organization write locking', () => {
    const workspaceChange = (organizationId: string, tenantId: string, actorUserId: string, id: string, linked: boolean) => ({
      organizationId,
      actorUserId,
      organizationAudit: {
        id: `org-${id}`, kind: linked ? 'workspace.linked' as const : 'workspace.unlinked' as const, actorUserId,
        actorEmail: `${actorUserId}@example.test`, actorKeyId: null, subjectTenantId: tenantId, subjectUserId: null, data: {}, at,
      },
      tenantAudit: {
        id: `tenant-${id}`, kind: linked ? 'organization.linked' as const : 'organization.unlinked' as const, actorUserId,
        actorEmail: `${actorUserId}@example.test`, subjectMemberId: null, reason: organizationId, at,
      },
    });
    const memberAudit = (id: string, kind: 'member.added' | 'member.role_changed' | 'member.removed', actorUserId: string, subjectUserId: string) => ({
      id, kind, actorUserId, actorEmail: `${actorUserId}@example.test`, actorKeyId: null, subjectTenantId: null, subjectUserId, at: later,
    });
    const linkOf = async (tenantId: string) =>
      (await database.db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.organizationId;

    it('serializes a workspace link with the removal or demotion of the linking owner into one of the two serial outcomes', async () => {
      await insertOrganization({ ...organization('org-order', 'order'), maxWorkspaces: 50 });
      await database.db.insert(user).values([
        { id: 'order-x', email: 'order-x@example.test', name: 'Order X', emailVerified: true },
        { id: 'order-y', email: 'order-y@example.test', name: 'Order Y', emailVerified: true },
      ]);
      await database.db.insert(tenants).values({ id: 'order-ws', slug: 'order-ws', name: 'Order', createdAt: at });
      await database.db.insert(tenantAdmins).values({ id: 'order-grant', tenantId: 'order-ws', userId: 'order-x', role: 'owner' });
      const workspaces = createOrganizationWorkspaceRepository(database.db);
      const members = createOrganizationMemberRepository(database.db);
      const reset = async () => {
        await database.db.update(tenants).set({ organizationId: null }).where(eq(tenants.id, 'order-ws'));
        await database.db.delete(organizationMembers).where(eq(organizationMembers.organizationId, 'org-order'));
        for (const userId of ['order-x', 'order-y']) {
          await insertMember('org-order', { id: `order-m-${userId}`, userId, role: 'owner', createdAt: at, createdByUserId: 'operator' });
        }
      };
      const roleOf = async (userId: string) => (await members.find('org-order', userId))?.role ?? null;

      for (let round = 0; round < 8; round += 1) {
        await reset();
        const [linked, removed] = await Promise.all([
          workspaces.link('order-ws', workspaceChange('org-order', 'order-ws', 'order-x', `order-remove-${round}`, true)),
          members.remove('org-order', { actorUserId: 'order-y', userId: 'order-x', audit: memberAudit(`order-remove-${round}`, 'member.removed', 'order-y', 'order-x') }),
        ]);
        expect(removed.status, `remove round ${round}`).toBe('removed');
        expect(['linked', 'organization_owner_required'], `remove round ${round}`).toContain(linked.status);
        expect(await linkOf('order-ws'), `remove round ${round}`).toBe(linked.status === 'linked' ? 'org-order' : null);
        expect(await roleOf('order-x'), `remove round ${round}`).toBeNull();
      }

      for (let round = 0; round < 8; round += 1) {
        await reset();
        const [linked, demoted] = await Promise.all([
          workspaces.link('order-ws', workspaceChange('org-order', 'order-ws', 'order-x', `order-demote-${round}`, true)),
          members.changeRole('org-order', {
            actorUserId: 'order-y', userId: 'order-x', role: 'admin', audit: memberAudit(`order-demote-${round}`, 'member.role_changed', 'order-y', 'order-x'),
          }),
        ]);
        expect(demoted.status, `demote round ${round}`).toBe('changed');
        expect(['linked', 'organization_owner_required'], `demote round ${round}`).toContain(linked.status);
        expect(await linkOf('order-ws'), `demote round ${round}`).toBe(linked.status === 'linked' ? 'org-order' : null);
        expect(await roleOf('order-x'), `demote round ${round}`).toBe('admin');
      }
    });

    it('refuses an organization write that acquires the organization lock after a suspension committed, and keeps the operator and workspace-side writes open', async () => {
      await insertOrganization({ ...organization('org-held', 'held'), maxWorkspaces: 10 });
      await database.db.insert(user).values([
        { id: 'held-owner', email: 'held-owner@example.test', name: 'Held owner', emailVerified: true },
        { id: 'held-admin', email: 'held-admin@example.test', name: 'Held admin', emailVerified: true },
        { id: 'held-candidate', email: 'held-candidate@example.test', name: 'Held candidate', emailVerified: true },
      ]);
      await database.db.insert(tenants).values([
        { id: 'held-in', slug: 'held-in', name: 'Held in', createdAt: at, organizationId: 'org-held' },
        { id: 'held-out', slug: 'held-out', name: 'Held out', createdAt: at },
      ]);
      await database.db.insert(tenantAdmins).values([
        { id: 'held-grant-in', tenantId: 'held-in', userId: 'held-owner', role: 'owner' },
        { id: 'held-grant-out', tenantId: 'held-out', userId: 'held-owner', role: 'owner' },
      ]);
      await insertMember('org-held', { id: 'held-m-owner', userId: 'held-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
      await insertMember('org-held', { id: 'held-m-admin', userId: 'held-admin', role: 'admin', createdAt: at, createdByUserId: 'held-owner' });
      const secrets = createOrganizationSecretRepository(database.db);
      const secret = (id: string, key: 'ksef.token' | 'smtp.password') => ({
        id, key, ciphertext: `cipher-${id}`, iv: `iv-${id}`, authTag: `tag-${id}`, maskedPreview: '••••0000', updatedAt: later,
      });
      const secretAudit = (id: string, kind: 'secret.set' | 'secret.deleted') => ({
        id, kind, actorUserId: 'held-owner', actorEmail: 'held-owner@example.test', actorKeyId: null, subjectTenantId: null, subjectUserId: null, at: later,
      });
      await database.db.insert(organizationSecrets).values({ ...secret('held-s-1', 'smtp.password'), organizationId: 'org-held' });

      const organizationsRepository = createOrganizationRepository(database.db);
      const members = createOrganizationMemberRepository(database.db);
      const workspaces = createOrganizationWorkspaceRepository(database.db);
      const setStatus = async (status: 'active' | 'suspended') => {
        await database.db.update(organizations).set({ status }).where(eq(organizations.id, 'org-held'));
      };
      const snapshot = async () => JSON.stringify({
        organization: (await database.db.select({ name: organizations.name, legalName: organizations.legalName, updatedAt: organizations.updatedAt })
          .from(organizations).where(eq(organizations.id, 'org-held'))),
        members: (await memberRows('org-held')).map((row) => [row.userId, row.role]),
        secrets: (await database.db.select().from(organizationSecrets).where(eq(organizationSecrets.organizationId, 'org-held'))).map((row) => [row.key, row.ciphertext]),
        audit: (await database.db.select().from(organizationAuditEvents).where(eq(organizationAuditEvents.organizationId, 'org-held'))).map((row) => row.id),
        links: [await linkOf('held-in'), await linkOf('held-out')],
        tenantAudit: (await database.db.select().from(tenantAuditEvents)).filter((row) => row.tenantId.startsWith('held-')).map((row) => row.id),
      });
      const suspendDuring = async <T>(write: () => Promise<T>): Promise<T> => {
        let settled = false;
        const started: Array<Promise<T>> = [];
        await database.db.transaction(async (tx) => {
          await tx.update(organizations).set({ status: 'suspended' }).where(eq(organizations.id, 'org-held'));
          const pending = write().finally(() => { settled = true; });
          pending.catch(() => undefined);
          started.push(pending);
          for (let attempt = 0; attempt < 200 && !settled; attempt += 1) {
            const waiting = await database.db.execute(sql`SELECT pid FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
            if (hasRows(waiting)) break;
            await new Promise((resolve) => { setTimeout(resolve, 10); });
          }
        });
        const [pending] = started;
        if (pending === undefined) throw new Error('write did not start');
        return pending;
      };
      const writes: Array<[string, () => Promise<{ status: string } | null>]> = [
        ['settings', () => organizationsRepository.updateSettings('org-held', {
          update: { legalName: 'Held Ltd' }, updatedAt: later,
          audit: { id: 'held-a-settings', kind: 'organization.updated', actorUserId: 'held-owner', actorEmail: 'held-owner@example.test', actorKeyId: null, subjectTenantId: null, subjectUserId: null, at: later },
        })],
        ['secret set', () => secrets.set('org-held', { secret: secret('held-s-2', 'ksef.token'), group: 'invoicing', audit: secretAudit('held-sa-2', 'secret.set') })],
        ['secret delete', () => secrets.delete('org-held', { key: 'smtp.password', group: 'email_transport', audit: secretAudit('held-sa-3', 'secret.deleted') })],
        ['member add', () => members.addAccount('org-held', {
          actorUserId: 'held-owner',
          member: { id: 'held-m-candidate', userId: 'held-candidate', role: 'admin', createdAt: later, createdByUserId: 'held-owner' },
          audit: memberAudit('held-a-add', 'member.added', 'held-owner', 'held-candidate'),
        })],
        ['member role', () => members.changeRole('org-held', {
          actorUserId: 'held-owner', userId: 'held-admin', role: 'owner', audit: memberAudit('held-a-role', 'member.role_changed', 'held-owner', 'held-admin'),
        })],
        ['member remove', () => members.remove('org-held', {
          actorUserId: 'held-owner', userId: 'held-admin', audit: memberAudit('held-a-remove', 'member.removed', 'held-owner', 'held-admin'),
        })],
        ['link', () => workspaces.link('held-out', workspaceChange('org-held', 'held-out', 'held-owner', 'held-link', true))],
        ['unlink', () => workspaces.unlink('held-in', workspaceChange('org-held', 'held-in', 'held-owner', 'held-unlink', false))],
      ];

      const before = await snapshot();
      for (const [label, write] of writes) {
        expect(await suspendDuring(write), label).toEqual({ status: 'organization_suspended' });
        expect(await snapshot(), label).toBe(before);
        await setStatus('active');
      }

      await setStatus('suspended');
      expect(await organizationsRepository.setMaxWorkspaces('org-held', {
        maxWorkspaces: 4, updatedAt: later,
        audit: { id: 'held-a-limit', kind: 'organization.updated', actorUserId: 'operator', actorEmail: 'operator@together.invalid', actorKeyId: null, subjectTenantId: null, subjectUserId: null, data: { maxWorkspaces: 4 }, at: later },
      })).toMatchObject({ status: 'suspended', maxWorkspaces: 4 });
      expect(await workspaces.unlinkAsWorkspaceOwner('held-in', {
        actorUserId: 'held-owner',
        organizationAudit: { ...workspaceChange('org-held', 'held-in', 'held-owner', 'held-ws-unlink', false).organizationAudit },
        tenantAudit: { id: 'tenant-held-ws-unlink', kind: 'organization.unlinked', actorUserId: 'held-owner', actorEmail: 'held-owner@example.test', subjectMemberId: null, at },
      })).toMatchObject({ status: 'unlinked', organizationId: 'org-held' });
      expect(await linkOf('held-in')).toBeNull();
    });

    it('refuses a workspace-side unlink whose workspace moved to another organization while it waited for the organization lock', async () => {
      await insertOrganization(organization('org-move-a', 'move-a'));
      await insertOrganization(organization('org-move-b', 'move-b'));
      await database.db.insert(tenants).values({ id: 'move-ws', slug: 'move-ws', name: 'Move', createdAt: at, organizationId: 'org-move-a' });
      await database.db.insert(tenantAdmins).values({ id: 'move-grant', tenantId: 'move-ws', userId: 'move-ws-owner', role: 'owner' });
      await insertMember('org-move-a', { id: 'move-m-a', userId: 'move-a-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
      await insertMember('org-move-b', { id: 'move-m-b', userId: 'move-ws-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
      const workspaces = createOrganizationWorkspaceRepository(database.db);
      const workspaceSide = (id: string) => ({
        actorUserId: 'move-ws-owner',
        organizationAudit: workspaceChange('org-move-a', 'move-ws', 'move-ws-owner', id, false).organizationAudit,
        tenantAudit: { id: `tenant-${id}`, kind: 'organization.unlinked' as const, actorUserId: 'move-ws-owner', actorEmail: 'move-ws-owner@example.test', subjectMemberId: null, at },
      });
      const auditOf = async (organizationId: string) => (await database.db.select().from(organizationAuditEvents)
        .where(eq(organizationAuditEvents.organizationId, organizationId))).map((row) => [row.id, row.kind]);

      let waited = false;
      const started: Array<ReturnType<typeof workspaces.unlinkAsWorkspaceOwner>> = [];
      await database.db.transaction(async (tx) => {
        await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, 'org-move-a')).for('no key update');
        const pending = workspaces.unlinkAsWorkspaceOwner('move-ws', workspaceSide('move-ws-side'));
        pending.catch(() => undefined);
        started.push(pending);
        for (let attempt = 0; attempt < 200 && !waited; attempt += 1) {
          waited = hasRows(await database.db.execute(sql`SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`));
          if (!waited) await new Promise((resolve) => { setTimeout(resolve, 10); });
        }
        const moving = createOrganizationWorkspaceRepository(tx);
        expect(await moving.unlink('move-ws', workspaceChange('org-move-a', 'move-ws', 'move-a-owner', 'move-unlink-a', false)))
          .toMatchObject({ status: 'unlinked' });
        expect(await moving.link('move-ws', workspaceChange('org-move-b', 'move-ws', 'move-ws-owner', 'move-link-b', true)))
          .toMatchObject({ status: 'linked' });
      });
      expect(waited).toBe(true);
      const [raced] = started;
      if (raced === undefined) throw new Error('workspace-side unlink did not start');

      expect(await raced).toEqual({ status: 'linked_elsewhere' });
      expect(await linkOf('move-ws')).toBe('org-move-b');
      expect(await auditOf('org-move-a')).toEqual([['org-move-unlink-a', 'workspace.unlinked']]);
      expect(await auditOf('org-move-b')).toEqual([['org-move-link-b', 'workspace.linked']]);
      expect((await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.tenantId, 'move-ws'))).map((row) => row.id).toSorted())
        .toEqual(['tenant-move-link-b', 'tenant-move-unlink-a']);

      expect(await workspaces.unlinkAsWorkspaceOwner('move-ws', workspaceSide('move-ws-retry')))
        .toMatchObject({ status: 'unlinked', organizationId: 'org-move-b' });
      expect(await linkOf('move-ws')).toBeNull();
    });
  });
});
