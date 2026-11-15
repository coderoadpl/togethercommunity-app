import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Organization } from '#core/domain/index.js';

import {
  createOrganizationAuditRepository,
  createOrganizationMemberRepository,
  createOrganizationRepository,
} from './organizations.js';
import { createTenantDirectory, createTenantRepository } from './repositories.js';
import { organizations, tenants } from './schema.js';
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
});
