import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

describe('per-run test database template', () => {
  it('is cloned with the application journal in public and no legacy journal schema', async () => {
    expect(process.env['TOGETHER_TEST_DATABASE_TEMPLATE']).toEqual(expect.any(String));
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    const database = await createTestDatabase('together_template_journal', baseDatabaseUrl);
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      const journal = await client.query<{ hash: string; created_at: string }>(
        'select hash, created_at::text as created_at from public.__drizzle_migrations order by id',
      );
      expect(journal.rows).toEqual(
        migrations.map((migration) => ({ hash: migration.hash, created_at: String(migration.folderMillis) })),
      );
      const legacy = await client.query<{ count: number }>(
        "select count(*)::int as count from pg_namespace where nspname = 'drizzle'",
      );
      expect(legacy.rows[0]?.count).toBe(0);
    } finally {
      await client.end();
      await database.close();
    }
  });
});
