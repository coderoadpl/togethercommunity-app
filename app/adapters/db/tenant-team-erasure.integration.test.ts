import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, memberTombstone } from '#core/domain/index.js';

import { createMemberErasureRepository } from './repositories.js';
import { members, tenantAdminInvitations, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const now = '2026-10-13T12:00:00.000Z';
const erasureInput = (memberId: string) => {
  const tombstone = memberTombstone(memberId);
  return {
    memberId, deletedAt: now, tombstoneEmail: tombstone.email,
    severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
  };
};
const invitation = (tenantId: string, userId: string) => ({
  id: `${tenantId}-${userId}`, tenantId, userId, email: `${userId}@example.test`, invitedAt: now,
});

beforeAll(async () => {
  database = await createTestDatabase(
    'together_team_erasure_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together',
  );
  await database.db.insert(tenants).values(['acme', 'studio'].map((id) => ({
    id, slug: id, name: id, createdAt: now,
  })));
  await database.db.insert(user).values(['orphan', 'invited', 'shared', 'unrelated', 'direct'].map((id) => ({
    id, email: `${id}@example.test`, name: id,
  })));
  await database.db.insert(members).values([
    { id: 'orphan-member', tenantId: 'acme', userId: 'orphan', email: 'orphan@example.test', createdAt: now },
    { id: 'invited-member', tenantId: 'acme', userId: 'invited', email: 'invited@example.test', createdAt: now },
    { id: 'shared-acme', tenantId: 'acme', userId: 'shared', email: 'shared@example.test', createdAt: now },
    { id: 'shared-studio', tenantId: 'studio', userId: 'shared', email: 'shared@example.test', createdAt: now },
  ]);
  await database.db.insert(tenantAdminInvitations).values([
    invitation('acme', 'orphan'),
    invitation('acme', 'invited'), invitation('studio', 'invited'),
    invitation('acme', 'shared'), invitation('studio', 'shared'),
    invitation('acme', 'unrelated'), invitation('studio', 'direct'),
  ]);
});

afterAll(async () => { await database?.close(); });

describe('pending team invitation erasure', () => {
  it('deletes and counts only the tenant invitation when erasure deletes the orphaned auth user', async () => {
    const repository = createMemberErasureRepository(database.db, { compute: (_, value) => value });
    expect(await repository.pseudonymize('acme', erasureInput('orphan-member'))).toMatchObject({
      authUserErased: true, deletedTeamInvitations: 1,
    });
    expect(await database.db.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.userId, 'orphan'))).toEqual([]);
    expect(await database.db.select().from(user).where(eq(user.id, 'orphan'))).toEqual([]);
    expect(await database.db.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.userId, 'unrelated')))
      .toEqual([invitation('acme', 'unrelated')]);
    expect(await repository.pseudonymize('acme', erasureInput('orphan-member'))).toMatchObject({
      alreadyDeleted: true, deletedTeamInvitations: 0,
    });
  });

  it('retains the auth user and another tenant invitation without exposing it in the count', async () => {
    const repository = createMemberErasureRepository(database.db, { compute: (_, value) => value });
    expect(await repository.pseudonymize('acme', erasureInput('invited-member'))).toMatchObject({
      authUserErased: false, deletedTeamInvitations: 1,
    });
    expect(await database.db.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.userId, 'invited')))
      .toEqual([invitation('studio', 'invited')]);
    expect(await database.db.select().from(user).where(eq(user.id, 'invited'))).toHaveLength(1);
    expect(await repository.pseudonymize('acme', erasureInput('invited-member'))).toMatchObject({
      alreadyDeleted: true, deletedTeamInvitations: 0,
    });
    expect(await database.db.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.userId, 'invited')))
      .toEqual([invitation('studio', 'invited')]);
  });

  it('deletes and counts the selected tenant invitation while retaining a shared auth user', async () => {
    const repository = createMemberErasureRepository(database.db, { compute: (_, value) => value });
    expect(await repository.pseudonymize('acme', erasureInput('shared-acme'))).toMatchObject({
      authUserErased: false, deletedTeamInvitations: 1,
    });
    expect(await database.db.select().from(tenantAdminInvitations).where(and(
      eq(tenantAdminInvitations.tenantId, 'acme'), eq(tenantAdminInvitations.userId, 'shared'),
    ))).toEqual([]);
    expect(await database.db.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.userId, 'shared')))
      .toEqual([invitation('studio', 'shared')]);
    expect(await database.db.select().from(user).where(eq(user.id, 'shared'))).toHaveLength(1);
  });

  it('cascades pending invitation deletion when the auth user is deleted directly', async () => {
    await database.db.delete(user).where(eq(user.id, 'direct'));
    expect(await database.db.select().from(tenantAdminInvitations).where(eq(tenantAdminInvitations.userId, 'direct'))).toEqual([]);
    await expect(database.db.insert(tenantAdminInvitations).values(invitation('studio', 'direct'))).rejects.toThrow();
  });
});
