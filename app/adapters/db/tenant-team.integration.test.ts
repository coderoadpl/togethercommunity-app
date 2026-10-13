import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TenantAuditEventInput } from '#core/domain/index.js';

import { createTenantTeamRepository } from './repositories.js';
import { tenantAdmins, tenantAuditEvents, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const at = '2026-10-13T12:00:00.000Z';
const audit = (
  id: string,
  userId: string,
  kind: 'team.admin_added' | 'team.admin_removed' = 'team.admin_added',
): TenantAuditEventInput => ({
  id, tenantId: 'acme', kind, actorUserId: 'owner', actorEmail: 'owner@example.test',
  subjectMemberId: null, reason: userId, at,
});

beforeAll(async () => {
  database = await createTestDatabase(
    'together_tenant_team_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together',
  );
  await database.db.insert(tenants).values([
    { id: 'acme', slug: 'acme', name: 'Acme', createdAt: at },
    { id: 'studio', slug: 'studio', name: 'Studio', createdAt: at },
  ]);
  await database.db.insert(user).values([
    { id: 'owner', email: 'owner@example.test', name: 'Owner' },
    { id: 'admin', email: 'admin@example.test', name: 'Administrator' },
    { id: 'shared-admin', email: 'shared@example.test', name: 'Shared administrator' },
    { id: 'concurrent-admin', email: 'concurrent@example.test', name: 'Concurrent administrator' },
    { id: 'rollback-admin', email: 'rollback@example.test', name: 'Rollback administrator' },
  ]);
  await database.db.insert(tenantAdmins).values([
    { id: 'acme-owner', tenantId: 'acme', userId: 'owner', role: 'owner' },
    { id: 'studio-admin', tenantId: 'studio', userId: 'shared-admin', role: 'admin' },
  ]);
});

afterAll(async () => { await database?.close(); });

describe('tenant team storage', () => {
  it('lists joined user details only for the selected tenant', async () => {
    const repository = createTenantTeamRepository(database.db);
    expect(await repository.list('acme')).toEqual([
      { userId: 'owner', email: 'owner@example.test', name: 'Owner', role: 'owner' },
    ]);
    expect(await repository.list('studio')).toEqual([
      { userId: 'shared-admin', email: 'shared@example.test', name: 'Shared administrator', role: 'admin' },
    ]);
    expect(await repository.list('missing')).toEqual([]);
  });

  it('adds an administrator idempotently without downgrading an owner', async () => {
    const repository = createTenantTeamRepository(database.db);
    expect(await repository.addAdmin('acme', 'admin', 'first-admin-grant', audit('admin-added', 'admin'))).toBe(true);
    expect(await repository.addAdmin('acme', 'admin', 'duplicate-admin-grant', audit('duplicate-admin-added', 'admin'))).toBe(false);
    expect(await repository.addAdmin('acme', 'owner', 'owner-downgrade', audit('owner-downgraded', 'owner'))).toBe(false);
    expect(await repository.list('acme')).toEqual([
      { userId: 'owner', email: 'owner@example.test', name: 'Owner', role: 'owner' },
      { userId: 'admin', email: 'admin@example.test', name: 'Administrator', role: 'admin' },
    ]);
    expect(await database.db.select().from(tenantAuditEvents)).toEqual([audit('admin-added', 'admin')]);
  });

  it('creates exactly one grant for concurrent additions', async () => {
    const repository = createTenantTeamRepository(database.db);
    const results = await Promise.all([
      repository.addAdmin('acme', 'concurrent-admin', 'concurrent-grant-one', audit('concurrent-audit-one', 'concurrent-admin')),
      repository.addAdmin('acme', 'concurrent-admin', 'concurrent-grant-two', audit('concurrent-audit-two', 'concurrent-admin')),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await database.db.select().from(tenantAdmins).where(and(
      eq(tenantAdmins.tenantId, 'acme'),
      eq(tenantAdmins.userId, 'concurrent-admin'),
    ));
    expect(rows).toHaveLength(1);
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.reason, 'concurrent-admin'))).toHaveLength(1);
  });

  it('removes only administrators in the selected tenant', async () => {
    const repository = createTenantTeamRepository(database.db);
    expect(await repository.addAdmin('acme', 'shared-admin', 'acme-shared-admin', audit('shared-admin-added', 'shared-admin'))).toBe(true);
    expect(await repository.removeAdmin('acme', 'shared-admin', audit('shared-admin-removed', 'shared-admin', 'team.admin_removed'))).toBe(true);
    expect(await repository.removeAdmin('acme', 'shared-admin', audit('duplicate-removal', 'shared-admin', 'team.admin_removed'))).toBe(false);
    expect(await repository.removeAdmin('acme', 'owner', audit('owner-removal', 'owner', 'team.admin_removed'))).toBe(false);
    expect(await repository.removeAdmin('missing', 'shared-admin', audit('missing-removal', 'shared-admin', 'team.admin_removed'))).toBe(false);
    expect(await repository.list('studio')).toEqual([
      { userId: 'shared-admin', email: 'shared@example.test', name: 'Shared administrator', role: 'admin' },
    ]);
    expect(await repository.list('acme')).toContainEqual({
      userId: 'owner', email: 'owner@example.test', name: 'Owner', role: 'owner',
    });
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.kind, 'team.admin_removed')))
      .toEqual([audit('shared-admin-removed', 'shared-admin', 'team.admin_removed')]);
  });

  it('rolls back an administrator grant when recording its audit event fails', async () => {
    const repository = createTenantTeamRepository(database.db);
    const existingAudit = audit('add-collision', 'owner');
    await database.db.insert(tenantAuditEvents).values(existingAudit);
    await expect(repository.addAdmin('acme', 'rollback-admin', 'rollback-grant', audit('add-collision', 'rollback-admin')))
      .rejects.toThrow();
    expect((await repository.list('acme')).some((member) => member.userId === 'rollback-admin')).toBe(false);
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.id, 'add-collision')))
      .toEqual([existingAudit]);
  });

  it('rolls back an administrator removal when recording its audit event fails', async () => {
    const repository = createTenantTeamRepository(database.db);
    const addedAudit = audit('remove-collision', 'rollback-admin');
    expect(await repository.addAdmin('acme', 'rollback-admin', 'rollback-grant', addedAudit)).toBe(true);
    await expect(repository.removeAdmin('acme', 'rollback-admin', audit('remove-collision', 'rollback-admin', 'team.admin_removed')))
      .rejects.toThrow();
    expect(await repository.list('acme')).toContainEqual({
      userId: 'rollback-admin', email: 'rollback@example.test', name: 'Rollback administrator', role: 'admin',
    });
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.id, 'remove-collision')))
      .toEqual([addedAudit]);
  });
});
