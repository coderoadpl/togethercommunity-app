import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Organization } from '#core/domain/index.js';

import {
  createOrganizationAuditRepository,
  createOrganizationMemberRepository,
  createOrganizationRepository,
  createOrganizationWorkspaceRepository,
} from './organizations.js';
import { createTenantDirectory, createTenantRepository } from './repositories.js';
import { organizationAuditEvents, organizationMembers, organizations, tenantAdmins, tenantAuditEvents, tenants, user } from './schema.js';
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
});
