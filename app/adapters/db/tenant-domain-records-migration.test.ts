import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { tenantDomains, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const migration = readFileSync(join(process.cwd(), 'drizzle/0103_tenant_domain_records.sql'), 'utf8');

describe('domain records migration', () => {
  it('preserves existing ownership challenges and defaults empty records safely', async () => {
    const { db, close } = await createTestDatabase('together_domain_records_migration', databaseUrl);
    try {
      await db.insert(tenants).values({
        id: 'tenant-records', slug: 'records', name: 'Records', createdAt: '2026-09-01T00:00:00.000Z',
      });
      const ownership = { type: 'TXT' as const, name: '_vercel.courses.example.org', value: 'challenge' };
      await db.insert(tenantDomains).values([
        { id: 'custom-records', tenantId: 'tenant-records', domain: 'courses.example.org', kind: 'custom', verification: [ownership] },
        { id: 'empty-records', tenantId: 'tenant-records', domain: 'workspace.example.org', kind: 'subdomain' },
      ]);
      await db.execute(sql`ALTER TABLE tenant_domains DROP COLUMN records, DROP COLUMN provider_verified`);
      for (const statement of migration.split('--> statement-breakpoint')) {
        await db.execute(sql.raw(statement));
      }
      const rows = await db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, 'tenant-records'));
      expect(rows.find((row) => row.id === 'custom-records')).toMatchObject({
        verification: [ownership], records: [{ ...ownership, purpose: 'ownership' }], providerVerified: false,
      });
      expect(rows.find((row) => row.id === 'empty-records')?.records).toEqual([]);
    } finally {
      await close();
    }
  });
});
