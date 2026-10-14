import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TenantAuditEventInput } from '#core/domain/index.js';

import { createTenantTeamRepository } from './repositories.js';
import { tenantAdmins, tenantAdminInvitations, tenantAuditEvents, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const at = '2026-10-13T12:00:00.000Z';
const audit = (
  id: string,
  userId: string,
  kind: TenantAuditEventInput['kind'] = 'team.admin_invited',
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
    { id: 'owner', email: 'owner@example.test', name: 'Owner', emailVerified: true },
    { id: 'admin', email: 'admin@example.test', name: 'Administrator', emailVerified: true },
    { id: 'pending', email: 'pending@example.test', name: 'Private profile', emailVerified: false },
    { id: 'concurrent', email: 'concurrent@example.test', name: 'Concurrent', emailVerified: true },
    { id: 'revoked', email: 'revoked@example.test', name: 'Revoked', emailVerified: true },
    { id: 'changed', email: 'original@example.test', name: 'Changed', emailVerified: false },
    { id: 'rollback', email: 'rollback@example.test', name: 'Rollback', emailVerified: true },
  ]);
  await database.db.insert(tenantAdmins).values([
    { id: 'acme-owner', tenantId: 'acme', userId: 'owner', role: 'owner' },
    { id: 'studio-admin', tenantId: 'studio', userId: 'admin', role: 'admin' },
  ]);
});

afterAll(async () => { await database?.close(); });

describe('tenant team invitations', () => {
  it('lists active user details only for the selected tenant', async () => {
    const repository = createTenantTeamRepository(database.db);
    expect(await repository.list('acme')).toEqual([
      { userId: 'owner', email: 'owner@example.test', name: 'Owner', role: 'owner', status: 'active' },
    ]);
    expect(await repository.list('missing')).toEqual([]);
  });

  it('invites idempotently without granting access or downgrading an owner', async () => {
    const repository = createTenantTeamRepository(database.db);
    expect(await repository.inviteAdmin('acme', 'pending', 'pending@example.test', 'pending-invitation', audit('pending-invited', 'pending'))).toBe(true);
    expect(await repository.inviteAdmin('acme', 'pending', 'pending@example.test', 'duplicate', audit('duplicate', 'pending'))).toBe(false);
    expect(await repository.inviteAdmin('acme', 'owner', 'owner@example.test', 'owner-invitation', audit('owner-invited', 'owner'))).toBe(false);
    expect(await repository.list('acme')).toContainEqual({
      userId: 'pending', email: 'pending@example.test', name: null, role: 'admin', status: 'invited', invitedAt: at,
    });
    expect(await repository.activateInvitation('acme', 'pending', 'pending-grant', audit('pending-activated', 'pending', 'team.admin_activated'))).toBe(false);
    expect(await database.db.select().from(tenantAdmins).where(eq(tenantAdmins.userId, 'pending'))).toEqual([]);
    expect(await database.db.select().from(tenantAuditEvents)).toEqual([audit('pending-invited', 'pending')]);
  });

  it('activates only a verified invitee in the selected tenant and audits once', async () => {
    const repository = createTenantTeamRepository(database.db);
    await repository.inviteAdmin('acme', 'admin', 'admin@example.test', 'admin-invitation', audit('admin-invited', 'admin'));
    expect(await repository.activateInvitation('studio', 'admin', 'wrong-tenant', audit('wrong-tenant', 'admin', 'team.admin_activated'))).toBe(false);
    expect(await repository.activateInvitation('acme', 'admin', 'admin-grant', audit('admin-activated', 'admin', 'team.admin_activated'))).toBe(true);
    expect(await repository.activateInvitation('acme', 'admin', 'duplicate-grant', audit('duplicate-activation', 'admin', 'team.admin_activated'))).toBe(false);
    expect(await repository.list('acme')).toContainEqual({
      userId: 'admin', email: 'admin@example.test', name: 'Administrator', role: 'admin', status: 'active',
    });
    expect(await database.db.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.userId, 'admin'))).toEqual([]);
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.kind, 'team.admin_activated')))
      .toEqual([audit('admin-activated', 'admin', 'team.admin_activated')]);
  });

  it('creates exactly one invitation and activation for concurrent requests', async () => {
    const repository = createTenantTeamRepository(database.db);
    const invitations = await Promise.all([
      repository.inviteAdmin('acme', 'concurrent', 'concurrent@example.test', 'concurrent-one', audit('invite-one', 'concurrent')),
      repository.inviteAdmin('acme', 'concurrent', 'concurrent@example.test', 'concurrent-two', audit('invite-two', 'concurrent')),
    ]);
    expect(invitations.filter(Boolean)).toHaveLength(1);
    const activations = await Promise.all([
      repository.activateInvitation('acme', 'concurrent', 'grant-one', audit('activate-one', 'concurrent', 'team.admin_activated')),
      repository.activateInvitation('acme', 'concurrent', 'grant-two', audit('activate-two', 'concurrent', 'team.admin_activated')),
    ]);
    expect(activations.filter(Boolean)).toHaveLength(1);
    expect(await database.db.select().from(tenantAdmins).where(and(
      eq(tenantAdmins.tenantId, 'acme'), eq(tenantAdmins.userId, 'concurrent'),
    ))).toHaveLength(1);
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.reason, 'concurrent'))).toHaveLength(2);
  });

  it('revokes an invitation before mailbox proof and cannot activate it afterward', async () => {
    const repository = createTenantTeamRepository(database.db);
    await repository.inviteAdmin('acme', 'revoked', 'revoked@example.test', 'revoked-invitation', audit('revoked-invited', 'revoked'));
    expect(await repository.revokeInvitation('studio', 'revoked', audit('wrong-revoke', 'revoked', 'team.invitation_revoked'))).toBe(false);
    expect(await repository.revokeInvitation('acme', 'revoked', audit('revoked', 'revoked', 'team.invitation_revoked'))).toBe(true);
    expect(await repository.activateInvitation('acme', 'revoked', 'revoked-grant', audit('revoked-activation', 'revoked', 'team.admin_activated'))).toBe(false);
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.kind, 'team.invitation_revoked')))
      .toEqual([audit('revoked', 'revoked', 'team.invitation_revoked')]);
  });

  it('does not activate an invitation after proving a different mailbox', async () => {
    const repository = createTenantTeamRepository(database.db);
    await repository.inviteAdmin('acme', 'changed', 'original@example.test', 'changed-invitation', audit('changed-invited', 'changed'));
    await database.db.update(user).set({ email: 'different@example.test', emailVerified: true }).where(eq(user.id, 'changed'));
    expect(await repository.activateInvitation('acme', 'changed', 'changed-grant', audit('changed-activated', 'changed', 'team.admin_activated'))).toBe(false);
    expect(await repository.list('acme')).toContainEqual({
      userId: 'changed', email: 'original@example.test', name: null, role: 'admin', status: 'invited', invitedAt: at,
    });
    expect(await database.db.select().from(tenantAdmins).where(eq(tenantAdmins.userId, 'changed'))).toEqual([]);
  });

  it('removes only active administrators in the selected tenant', async () => {
    const repository = createTenantTeamRepository(database.db);
    expect(await repository.removeAdmin('acme', 'admin', audit('admin-removed', 'admin', 'team.admin_removed'))).toBe(true);
    expect(await repository.removeAdmin('acme', 'admin', audit('duplicate-removal', 'admin', 'team.admin_removed'))).toBe(false);
    expect(await repository.removeAdmin('acme', 'owner', audit('owner-removal', 'owner', 'team.admin_removed'))).toBe(false);
    expect(await repository.list('studio')).toEqual([
      { userId: 'admin', email: 'admin@example.test', name: 'Administrator', role: 'admin', status: 'active' },
    ]);
  });

  it('rolls back invitation, activation and revocation if their audit event fails', async () => {
    const repository = createTenantTeamRepository(database.db);
    await database.db.insert(tenantAuditEvents).values(audit('collision', 'rollback'));
    await expect(repository.inviteAdmin('acme', 'rollback', 'rollback@example.test', 'rollback-invitation', audit('collision', 'rollback'))).rejects.toThrow();
    expect((await repository.list('acme')).some((member) => member.userId === 'rollback')).toBe(false);
    await repository.inviteAdmin('acme', 'rollback', 'rollback@example.test', 'rollback-invitation', audit('rollback-invited', 'rollback'));
    await expect(repository.activateInvitation('acme', 'rollback', 'rollback-grant', audit('collision', 'rollback', 'team.admin_activated'))).rejects.toThrow();
    await expect(repository.revokeInvitation('acme', 'rollback', audit('collision', 'rollback', 'team.invitation_revoked'))).rejects.toThrow();
    expect(await repository.list('acme')).toContainEqual({
      userId: 'rollback', email: 'rollback@example.test', name: null, role: 'admin', status: 'invited', invitedAt: at,
    });
    expect(await database.db.select().from(tenantAdmins).where(eq(tenantAdmins.userId, 'rollback'))).toEqual([]);
  });
});
