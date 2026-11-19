import { readFileSync } from 'node:fs';

import { asc, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const at = '2026-11-15T10:00:00.000Z';

describe('0161 organizations core migration', () => {
  it('leaves every existing tenant without an organization', async () => {
    const database = await createTestDatabase('together_organizations_migration', databaseUrl);
    try {
      await database.db.execute(sql.raw(`
        DROP TABLE provider_customer_owners;
        DROP TABLE organization_audit_events;
        DROP TABLE organization_members;
        ALTER TABLE tenants DROP COLUMN organization_id;
        DROP TABLE organizations;
      `));
      await database.db.execute(sql`
        INSERT INTO tenants (id, slug, name, created_at, invoicing_provider)
        VALUES ('acme', 'acme', 'Acme', ${at}, 'ifirma'), ('studio', 'studio', 'Studio', ${at}, NULL)
      `);
      const migration = readFileSync('drizzle/0161_organizations_core.sql', 'utf8');
      await database.db.transaction(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          await tx.execute(sql.raw(statement));
        }
      });

      expect(await database.db.select({ id: tenants.id, organizationId: tenants.organizationId })
        .from(tenants).orderBy(asc(tenants.id))).toEqual([
        { id: 'acme', organizationId: null },
        { id: 'studio', organizationId: null },
      ]);
    } finally {
      await database.close();
    }
  });
});
