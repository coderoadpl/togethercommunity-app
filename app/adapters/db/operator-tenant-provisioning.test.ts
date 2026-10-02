import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TenantAuditEventInput } from '#core/domain/index.js';

import { createTenantRepository } from './repositories.js';
import { tenantAdmins, tenantAuditEvents, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const at = '2026-10-01T12:00:00.000Z';
const input = (id: string, slug: string, owner = 'owner-1', auditId = id) => ({
  tenant: { id, slug, name: 'Acme', createdAt: at, defaultLanguage: 'en' as const },
  ownerGrant: { id: `grant-${id}`, userId: owner, staffRole: 'owner' as const },
  provisionAudit: {
    id: auditId, tenantId: id, kind: 'tenant_provisioned', actorUserId: 'operator-secret',
    actorEmail: 'operator@together.invalid', subjectMemberId: null, reason: null, at,
  } satisfies TenantAuditEventInput,
});
const options = { requireEmpty: false, idempotentOwner: true };

beforeAll(async () => {
  database = await createTestDatabase('together_operator_tenant_test', 'postgres://together:together@localhost:48912/together');
  await database.db.insert(user).values([
    { id: 'owner-1', name: 'Owner', email: 'owner@example.test', emailVerified: true },
    { id: 'owner-2', name: 'Another owner', email: 'another@example.test', emailVerified: true },
  ]);
});
afterAll(async () => { await database?.close(); });

describe('atomic operator provisioning', () => {
  it('serializes concurrent retries and records one owner and one audit event', async () => {
    const repo = createTenantRepository(database.db);
    const results = await Promise.all([
      repo.createTenantWithOwnerGrant(input('first', 'acme'), options),
      repo.createTenantWithOwnerGrant(input('second', 'acme'), options),
    ]);
    expect(results[0]).toEqual(results[1]);
    const tenant = results[0];
    expect(tenant).not.toBeNull();
    if (tenant === null || tenant === undefined) throw new Error('Missing tenant');
    expect(await database.db.select().from(tenantAdmins).where(eq(tenantAdmins.tenantId, tenant.id))).toHaveLength(1);
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.tenantId, tenant.id))).toHaveLength(1);
    expect(await repo.findSettings(tenant.id)).toMatchObject({ defaultLanguage: 'en' });
    expect(await repo.createTenantWithOwnerGrant(input('third', 'acme', 'owner-2'), options)).toBeNull();
    expect(await repo.createTenantWithOwnerGrant(input('bootstrap', 'bootstrap'), { requireEmpty: true })).toBeNull();
  });

  it('allows one winner when two owners race for the same slug', async () => {
    const repo = createTenantRepository(database.db);
    const results = await Promise.all([
      repo.createTenantWithOwnerGrant(input('race-one', 'studio', 'owner-1'), options),
      repo.createTenantWithOwnerGrant(input('race-two', 'studio', 'owner-2'), options),
    ]);
    expect(results.filter((tenant) => tenant !== null)).toHaveLength(1);
    expect(results.filter((tenant) => tenant === null)).toHaveLength(1);
  });

  it('rolls back tenant and grant if the audit insert fails', async () => {
    const repo = createTenantRepository(database.db);
    await repo.createTenantWithOwnerGrant(input('audit-base', 'audit-base'), options);
    await expect(repo.createTenantWithOwnerGrant(input('rollback', 'rollback', 'owner-1', 'audit-base'), options)).rejects.toThrow();
    expect(await repo.findBySlug('rollback')).toBeNull();
    expect(await database.db.select().from(tenantAdmins).where(eq(tenantAdmins.tenantId, 'rollback'))).toEqual([]);
  });

  it('rolls back the tenant if the existing owner disappears', async () => {
    const repo = createTenantRepository(database.db);
    expect(await repo.createTenantWithOwnerGrant(input('no-owner', 'no-owner', 'missing'), options)).toBeNull();
    expect(await database.db.select().from(tenants).where(eq(tenants.slug, 'no-owner'))).toEqual([]);
    expect(await database.db.select().from(tenantAuditEvents).where(eq(tenantAuditEvents.tenantId, 'no-owner'))).toEqual([]);
  });
});
