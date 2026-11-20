import { readFileSync } from 'node:fs';

import { asc, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { organizationSecrets, organizations, tenantConfigSources, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const at = '2026-11-15T10:00:00.000Z';

describe('0161 organizations core migration', () => {
  it('leaves every existing tenant without an organization', async () => {
    const database = await createTestDatabase('together_organizations_migration', databaseUrl);
    try {
      await database.db.execute(sql.raw(`
        DROP TABLE tenant_config_sources;
        DROP TABLE organization_secrets;
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

describe('0157 organization settings, secrets and sources migration', () => {
  it('gives existing organizations the default settings and leaves the new tables empty', async () => {
    const database = await createTestDatabase('together_organization_settings_migration', databaseUrl);
    try {
      await database.db.execute(sql.raw(`
        DROP TABLE tenant_config_sources;
        DROP TABLE organization_secrets;
        ALTER TABLE organizations
          DROP COLUMN legal_name, DROP COLUMN legal_address, DROP COLUMN invoicing_provider,
          DROP COLUMN ksef_submission_mode, DROP COLUMN shipx_environment, DROP COLUMN shipx_sender;
      `));
      await database.db.execute(sql`
        INSERT INTO organizations (id, slug, name, created_at, updated_at) VALUES ('org-1', 'holding', 'Holding', ${at}, ${at})
      `);
      const migration = readFileSync('drizzle/0162_organization_settings_secrets_sources.sql', 'utf8');
      await database.db.transaction(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          await tx.execute(sql.raw(statement));
        }
      });

      expect(await database.db.select({
        legalName: organizations.legalName,
        invoicingProvider: organizations.invoicingProvider,
        ksefSubmissionMode: organizations.ksefSubmissionMode,
        shipxEnvironment: organizations.shipxEnvironment,
        shipxSender: organizations.shipxSender,
      }).from(organizations)).toEqual([
        { legalName: null, invoicingProvider: null, ksefSubmissionMode: 'automatic', shipxEnvironment: 'sandbox', shipxSender: null },
      ]);
      expect(await database.db.select().from(organizationSecrets)).toEqual([]);
      expect(await database.db.select().from(tenantConfigSources)).toEqual([]);
    } finally {
      await database.close();
    }
  });
});
