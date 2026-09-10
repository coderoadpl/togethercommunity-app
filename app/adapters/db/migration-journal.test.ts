import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { migrationJournalState } from './migration-journal.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const withAdminClient = async (
  operation: (client: pg.Client) => Promise<void>,
): Promise<void> => {
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  await client.connect();
  try {
    await operation(client);
  } finally {
    await client.end();
  }
};

const withClient = async (
  connectionString: string,
  operation: (client: pg.Client) => Promise<void>,
): Promise<void> => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await operation(client);
  } finally {
    await client.end();
  }
};

const withTemporaryDatabase = async (
  operation: (connectionString: string) => Promise<void>,
): Promise<void> => {
  const databaseName = uniqueTestDatabaseName('together_migration_journal_test');
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  await withAdminClient(async (client) => {
    await client.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
  });
  try {
    await operation(url.toString());
  } finally {
    await withAdminClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)}`);
    });
  }
};

describe('migration journal state', () => {
  it('reports an empty database', async () => {
    await withTemporaryDatabase(async (connectionString) => {
      await expect(migrationJournalState(connectionString)).resolves.toEqual({
        tables: 0,
        journalRows: 0,
      });
    });
  }, 60_000);

  it('reports tables without a migration journal', async () => {
    await withTemporaryDatabase(async (connectionString) => {
      await withClient(connectionString, async (client) => {
        await client.query('CREATE TABLE example (id text PRIMARY KEY)');
      });

      await expect(migrationJournalState(connectionString)).resolves.toEqual({
        tables: 1,
        journalRows: 0,
      });
    });
  }, 60_000);

  it('reports migration journal rows', async () => {
    await withTemporaryDatabase(async (connectionString) => {
      await withClient(connectionString, async (client) => {
        await client.query('CREATE TABLE example (id text PRIMARY KEY)');
        await client.query('CREATE SCHEMA drizzle');
        await client.query(
          `CREATE TABLE drizzle.__drizzle_migrations (
            id serial PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
          )`,
        );
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
           VALUES ('migration-journal-test', 1)`,
        );
      });

      await expect(migrationJournalState(connectionString)).resolves.toEqual({
        tables: 1,
        journalRows: 1,
      });
    });
  }, 60_000);
});
