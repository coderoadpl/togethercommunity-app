import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { erasedMemberImports, memberEvents, members, processedPaymentEvents, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const NOW = '1998-07-14T10:00:00.000Z';
const ACME = 'tenant-acme';
const lease = { workerId: 'worker-existing', now: NOW, leaseExpiresAt: '1998-07-14T10:05:00.000Z' };

describe('tenant-scoped conflict migration', () => {
  it('preserves existing tombstones, payment leases, and member history when replacing global keys', async () => {
    const testDatabase = await createTestDatabase('together_conflict_migration_test', databaseUrl);
    const migrationDb = testDatabase.db;
    try {
      await migrationDb.insert(tenants).values({ id: ACME, slug: 'acme', name: 'Acme', createdAt: NOW });
      await migrationDb.insert(members).values({
        id: 'member-existing', tenantId: ACME, userId: 'user-existing', email: 'member@example.test', createdAt: NOW,
      });
      await migrationDb.execute(sql`ALTER TABLE erased_member_imports DROP CONSTRAINT erased_member_imports_tenant_id_member_id_pk, ADD PRIMARY KEY (member_id)`);
      await migrationDb.execute(sql`ALTER TABLE processed_events DROP CONSTRAINT processed_events_tenant_id_id_pk, ADD PRIMARY KEY (id)`);
      await migrationDb.execute(sql`ALTER TABLE member_events DROP CONSTRAINT member_events_tenant_id_id_pk, ADD PRIMARY KEY (id)`);
      await migrationDb.insert(erasedMemberImports).values({
        tenantId: ACME, memberId: 'member-existing', legacyId: 'legacy-existing', emailHmac: 'existing-hmac', erasedAt: NOW,
      });
      await migrationDb.insert(processedPaymentEvents).values({
        id: 'event-existing', tenantId: ACME, type: 'invoice.paid', objectId: 'invoice-existing',
        processedAt: NOW, status: 'processing', workerId: lease.workerId,
        claimedAt: lease.now, leaseExpiresAt: lease.leaseExpiresAt,
      });
      await migrationDb.insert(memberEvents).values({
        id: 'history-existing', tenantId: ACME, memberId: 'member-existing', type: 'banned',
        payload: { actorUserId: 'owner', reason: null }, occurredAt: NOW,
      });
      const before = {
        tombstones: await migrationDb.select().from(erasedMemberImports),
        payments: await migrationDb.select().from(processedPaymentEvents),
        history: await migrationDb.select().from(memberEvents),
      };
      const migration = readFileSync('drizzle/0108_tenant_scoped_conflicts.sql', 'utf8');
      await migrationDb.transaction(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          await tx.execute(sql.raw(statement));
        }
      });
      expect(await migrationDb.select().from(erasedMemberImports)).toEqual(before.tombstones);
      expect(await migrationDb.select().from(processedPaymentEvents)).toEqual(before.payments);
      expect(await migrationDb.select().from(memberEvents)).toEqual(before.history);
    } finally {
      await testDatabase.close();
    }
  });
});
