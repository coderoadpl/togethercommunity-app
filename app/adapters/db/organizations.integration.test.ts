import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Organization } from '#core/domain/index.js';

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

  it('round-trips an organization and refuses a second one with the same slug', async () => {
    const repository = createOrganizationRepository(database.db);

    expect(await repository.create(organization('org-1', 'holding'))).toEqual(organization('org-1', 'holding'));
    expect(await repository.create(organization('org-2', 'holding'))).toBeNull();
    expect(await repository.findById('org-1')).toEqual(organization('org-1', 'holding'));
    expect(await repository.findBySlug('holding')).toEqual(organization('org-1', 'holding'));
    expect(await repository.findById('org-2')).toBeNull();
  });

  it('round-trips members once per organization and user', async () => {
    await createOrganizationRepository(database.db).create(organization('org-members', 'members'));
    await createOrganizationRepository(database.db).create(organization('org-other', 'other'));
    const repository = createOrganizationMemberRepository(database.db);
    const owner = { id: 'member-owner', userId: 'user-owner', role: 'owner' as const, createdAt: at, createdByUserId: 'operator' };
    const admin = { id: 'member-admin', userId: 'user-admin', role: 'admin' as const, createdAt: later, createdByUserId: 'user-owner' };

    expect(await repository.add('org-members', owner)).toBe(true);
    expect(await repository.add('org-members', admin)).toBe(true);
    expect(await repository.add('org-members', { ...admin, id: 'member-duplicate', role: 'owner' })).toBe(false);
    expect(await repository.add('org-other', { ...owner, id: 'member-other' })).toBe(true);

    expect(await repository.find('org-members', 'user-admin')).toEqual({ ...admin, organizationId: 'org-members' });
    expect(await repository.find('org-other', 'user-admin')).toBeNull();
    expect(await repository.list('org-members')).toEqual([
      { ...owner, organizationId: 'org-members' },
      { ...admin, organizationId: 'org-members' },
    ]);
    expect(await repository.listForUser('user-owner')).toEqual([
      { ...owner, organizationId: 'org-members' },
      { ...owner, id: 'member-other', organizationId: 'org-other' },
    ]);
  });

  it('round-trips audit events newest first within one organization', async () => {
    await createOrganizationRepository(database.db).create(organization('org-audit', 'audit'));
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

    await repository.record('org-audit', created);
    await repository.record('org-audit', secret);
    await repository.record('org-members', { ...created, id: 'audit-elsewhere' });

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

    await createOrganizationRepository(database.db).create(organization('org-link', 'link'));
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

  it('links and unlinks only for a direct workspace owner who owns the organization, auditing both sides in one transaction', async () => {
    await createOrganizationRepository(database.db).create(organization('org-ws', 'workspaces'));
    await createOrganizationRepository(database.db).create(organization('org-ws-other', 'workspaces-other'));
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
    const members = createOrganizationMemberRepository(database.db);
    for (const [userId, role] of [['ws-owner', 'owner'], ['ws-admin', 'owner'], ['ws-org-admin', 'admin']] as const) {
      await members.add('org-ws', { id: `org-ws-${userId}`, userId, role, createdAt: at, createdByUserId: 'operator' });
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

    expect(await repository.unlink('ws-own', change('ws-admin', 'g', false))).toEqual({ status: 'workspace_owner_required' });
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
    await createOrganizationRepository(database.db).create(organization('org-team', 'team'));
    await database.db.insert(user).values([
      { id: 'team-owner', email: 'team-owner@example.test', name: 'Team owner', emailVerified: true },
      { id: 'team-second', email: 'team-second@example.test', name: 'Team second', emailVerified: true },
      { id: 'team-third', email: 'team-third@example.test', name: 'Team third', emailVerified: true },
      { id: 'team-pending', email: 'team-pending@example.test', name: 'Team pending', emailVerified: false },
    ]);
    const repository = createOrganizationMemberRepository(database.db);
    await repository.add('org-team', { id: 'team-m-owner', userId: 'team-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
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
    const roles = async () => (await repository.list('org-team')).map((row) => [row.userId, row.role]);

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
    await createOrganizationRepository(database.db).create(organization('org-race', 'race'));
    await database.db.insert(user).values([
      { id: 'race-a', email: 'race-a@example.test', name: 'Race A', emailVerified: true },
      { id: 'race-b', email: 'race-b@example.test', name: 'Race B', emailVerified: true },
    ]);
    const repository = createOrganizationMemberRepository(database.db);
    for (const userId of ['race-a', 'race-b']) {
      await repository.add('org-race', { id: `race-m-${userId}`, userId, role: 'owner', createdAt: at, createdByUserId: 'operator' });
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
      const owners = (await repository.list('org-race')).filter((row) => row.role === 'owner');
      expect(owners, `round ${round}`).toHaveLength(1);
      await database.db.delete(organizationMembers).where(eq(organizationMembers.organizationId, 'org-race'));
      for (const userId of ['race-a', 'race-b']) {
        await repository.add('org-race', { id: `race-m-${userId}`, userId, role: 'owner', createdAt: at, createdByUserId: 'operator' });
      }
    }
  });

  it('reads default settings, updates only changed fields with one audit row and compares the sender regardless of key order', async () => {
    const repository = createOrganizationRepository(database.db);
    await repository.create(organization('org-settings', 'settings'));
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
    await createOrganizationRepository(database.db).create(organization('org-secrets', 'secrets'));
    await createOrganizationRepository(database.db).create(organization('org-secrets-other', 'secrets-other'));
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
      .toEqual({ ...secret('s-1', 'ksef.token', '••••1111'), organizationId: 'org-secrets' });
    expect(await repository.set('org-secrets', { secret: secret('s-2', 'ksef.token', '••••2222'), group: 'invoicing', audit: audit('sa-2', 'secret.set') }))
      .toEqual({ ...secret('s-2', 'ksef.token', '••••2222'), id: 's-1', organizationId: 'org-secrets' });
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
      ['sa-1', 'secret.set', { key: 'ksef.token', maskedPreview: '••••1111', group: 'invoicing' }],
      ['sa-2', 'secret.set', { key: 'ksef.token', maskedPreview: '••••2222', group: 'invoicing' }],
      ['sa-3', 'secret.set', { key: 'smtp.password', maskedPreview: '••••3333', group: 'email_transport' }],
      ['sa-5', 'secret.deleted', { key: 'smtp.password', maskedPreview: '••••3333', group: 'email_transport' }],
      ['sa-7', 'secret.deleted', { key: 'ksef.token', maskedPreview: '••••2222', group: 'invoicing' }],
    ]);
  });

  it('refuses to unlink a workspace while it has a configuration source row and lists its sources', async () => {
    await createOrganizationRepository(database.db).create(organization('org-sources', 'sources'));
    await database.db.insert(tenants).values({ id: 'sources-ws', slug: 'sources-ws', name: 'Sources', createdAt: at });
    await database.db.insert(tenantAdmins).values({ id: 'sources-grant', tenantId: 'sources-ws', userId: 'sources-owner', role: 'owner' });
    await createOrganizationMemberRepository(database.db)
      .add('org-sources', { id: 'sources-member', userId: 'sources-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
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
      await createOrganizationRepository(database.db).create({ ...organization(organizationId, organizationId), maxWorkspaces: 1 });
      await database.db.insert(tenants).values(tenantIds.map((id) => ({ id, slug: id, name: id, createdAt: at })));
      await database.db.insert(tenantAdmins).values(tenantIds.map((id) => ({ id: `grant-${id}`, tenantId: id, userId: 'quota-owner', role: 'owner' as const })));
      await createOrganizationMemberRepository(database.db)
        .add(organizationId, { id: `${organizationId}-owner`, userId: 'quota-owner', role: 'owner', createdAt: at, createdByUserId: 'operator' });
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
});
