import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ImportUsersMutation } from '#core/server/index.js';

import type { Db } from './client.js';
import { createTestDatabase } from './test-database-name.js';
import {
  account,
  importAuditEvents,
  members,
  tenantApiKeys,
  tenants,
  user,
} from './schema.js';
import { createImportUsersRepository } from './users-import.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-users-import';

let db: Db;
let closeTestDatabase: () => Promise<void>;

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_users_import_test', baseDatabaseUrl);
  db = testDatabase.db;
  closeTestDatabase = testDatabase.close;
  await db.insert(tenants).values({
    id: TENANT_ID,
    slug: 'users-import',
    name: 'Users Import',
    createdAt: NOW,
  });
  await db.insert(tenantApiKeys).values({
    id: 'import-key',
    tenantId: TENANT_ID,
    name: 'Import',
    keyHash: 'users-import-key-hash',
    scopes: ['import:users'],
    createdAt: NOW,
    expiresAt: '1998-08-20T10:00:00.000Z',
  });
}, 60_000);

afterAll(async () => {
  await closeTestDatabase();
});

const memberMutation = (): Extract<ImportUsersMutation, { kind: 'member' }> => ({
  kind: 'member',
  action: 'created',
  resource: {
    id: 'member-source',
    tenantId: TENANT_ID,
    userId: 'user-source',
    email: 'user@example.test',
    displayName: 'Imported User',
    legacyId: 'legacy-user',
    createdAt: '1992-01-01T00:00:00.000Z',
  },
  authUser: {
    action: 'create',
    name: 'Imported User',
    emailVerified: false,
  },
  event: {
    id: 'audit-member-created',
    tenantId: TENANT_ID,
    apiKeyId: 'import-key',
    kind: 'member',
    importKey: 'member-source',
    resourceId: 'member-source',
    action: 'created',
    payloadHash: 'a'.repeat(64),
    at: NOW,
  },
});

describe('users import repository', () => {
  it('commits an unverified auth identity, member, and audit without a credential', async () => {
    const repository = createImportUsersRepository(db);
    const result = await repository.commit(TENANT_ID, memberMutation());
    const [authUser] = await db.select().from(user).where(eq(user.id, 'user-source'));
    const [credential] = await db.select().from(account).where(eq(account.userId, 'user-source'));
    const [member] = await db.select().from(members).where(eq(members.id, 'member-source'));
    const [audit] = await db
      .select()
      .from(importAuditEvents)
      .where(eq(importAuditEvents.id, 'audit-member-created'));

    expect(result).toBe('saved');
    expect(authUser).toMatchObject({ email: 'user@example.test', emailVerified: false });
    expect(credential).toBeUndefined();
    expect(member).toMatchObject({
      userId: 'user-source',
      displayName: 'Imported User',
      legacyId: 'legacy-user',
    });
    expect(audit).toMatchObject({ kind: 'member', resourceId: 'member-source' });
    expect(await repository.findAuthUserByEmail(TENANT_ID, 'USER@example.test')).toMatchObject({
      id: 'user-source',
      hasCredentialAccount: false,
      credentialPassword: null,
    });
  });

  it('does not resolve or adopt an auth user that belongs only to another tenant', async () => {
    const repository = createImportUsersRepository(db);
    await db.insert(tenants).values({
      id: 'tenant-users-import-other',
      slug: 'users-import-other',
      name: 'Users Import Other',
      createdAt: NOW,
    });
    await db.insert(user).values({
      id: 'foreign-user',
      name: 'Foreign User',
      email: 'foreign@example.test',
      emailVerified: true,
    });
    await db.insert(members).values({
      id: 'foreign-member',
      tenantId: 'tenant-users-import-other',
      userId: 'foreign-user',
      email: 'foreign@example.test',
      displayName: 'Foreign User',
      createdAt: NOW,
    });

    expect(await repository.findAuthUserByEmail(TENANT_ID, 'foreign@example.test')).toBeNull();
    expect(await repository.findAuthUserByEmail(
      'tenant-users-import-other',
      'foreign@example.test',
    )).toMatchObject({ id: 'foreign-user' });

    const attempted = memberMutation();
    const conflict = await repository.commit(TENANT_ID, {
      ...attempted,
      resource: {
        ...attempted.resource,
        id: 'member-foreign-attempt',
        userId: 'new-user-for-foreign-email',
        email: 'foreign@example.test',
      },
      event: {
        ...attempted.event,
        id: 'audit-foreign-attempt',
        importKey: 'member-foreign-attempt',
        resourceId: 'member-foreign-attempt',
      },
    });

    expect(conflict).toBe('conflict');
    expect(await repository.findMemberById(TENANT_ID, 'member-foreign-attempt')).toBeNull();
  });
});
