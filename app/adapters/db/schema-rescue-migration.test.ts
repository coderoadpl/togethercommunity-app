import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createHealthPort } from './repositories.js';
import * as dbSchema from './schema.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

const isJournalEntry = (value: unknown): value is JournalEntry =>
  typeof value === 'object'
  && value !== null
  && 'idx' in value
  && typeof value.idx === 'number'
  && 'version' in value
  && typeof value.version === 'string'
  && 'when' in value
  && typeof value.when === 'number'
  && 'tag' in value
  && typeof value.tag === 'string'
  && 'breakpoints' in value
  && typeof value.breakpoints === 'boolean';

const readJournal = (): Journal => {
  const value: unknown = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  if (
    typeof value !== 'object'
    || value === null
    || !('version' in value)
    || typeof value.version !== 'string'
    || !('dialect' in value)
    || typeof value.dialect !== 'string'
    || !('entries' in value)
    || !Array.isArray(value.entries)
    || !value.entries.every(isJournalEntry)
  ) {
    throw new Error('The drizzle journal is unreadable');
  }
  return { version: value.version, dialect: value.dialect, entries: value.entries };
};

const journal = readJournal();
const expected = journal.entries.length;
const migration0080When = journal.entries[80]?.when;
if (migration0080When === undefined) throw new Error('Migration 0080 is missing');

const temporaryFolders: string[] = [];
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const buildPartialFolder = (
  maxPrefix: number,
  mutateEntries?: (entries: JournalEntry[]) => JournalEntry[],
): string => {
  const folder = mkdtempSync(join(tmpdir(), 'together-schema-rescue-'));
  temporaryFolders.push(folder);
  mkdirSync(join(folder, 'meta'));
  for (const file of readdirSync('drizzle')) {
    const prefix = /^(\d{4})_.*\.sql$/.exec(file)?.[1];
    if (prefix !== undefined && Number(prefix) <= maxPrefix) {
      copyFileSync(join('drizzle', file), join(folder, file));
    }
  }
  const entries = journal.entries.slice(0, maxPrefix + 1).map((entry) => ({ ...entry }));
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: journal.version,
      dialect: journal.dialect,
      entries: mutateEntries?.(entries) ?? entries,
    }),
  );
  return folder;
};

const withDatabase = async (
  base: string,
  run: (pool: pg.Pool) => Promise<void>,
): Promise<void> => {
  const databaseName = uniqueTestDatabaseName(base);
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    await run(pool);
  } finally {
    await pool.end();
    const cleanup = new pg.Client({ connectionString: baseDatabaseUrl });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)} WITH (FORCE)`);
    await cleanup.end();
  }
};

const migrationRows = async (pool: pg.Pool): Promise<Array<{ hash: string; created_at: string }>> => {
  const result = await pool.query<{ hash: string; created_at: string }>(
    'select hash, created_at from drizzle.__drizzle_migrations order by created_at',
  );
  return result.rows;
};

const expectRescuedSchema = async (pool: pg.Pool): Promise<void> => {
  const column = await pool.query<{ count: number }>(`
    select count(*)::int as count
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_api_keys'
      and column_name = 'expires_at'
  `);
  const table = await pool.query<{ name: string | null }>(
    "select to_regclass('public.import_audit_events')::text as name",
  );
  const constraints = await pool.query<{ count: number }>(`
    select count(*)::int as count
    from pg_constraint
    where conrelid = 'public.import_audit_events'::regclass
      and conname in (
        'import_audit_events_tenant_id_tenants_id_fk',
        'import_audit_events_api_key_id_tenant_api_keys_id_fk'
      )
  `);
  const indexes = await pool.query<{ count: number }>(`
    select count(*)::int as count
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'import_audit_events'
      and indexname in (
        'import_audit_events_tenant_api_key_at_idx',
        'import_audit_events_tenant_kind_import_key_at_idx'
      )
  `);

  expect(column.rows[0]?.count).toBe(1);
  expect(table.rows[0]?.name).toBe('import_audit_events');
  expect(constraints.rows[0]?.count).toBe(2);
  expect(indexes.rows[0]?.count).toBe(2);
};

afterAll(() => {
  for (const folder of temporaryFolders) rmSync(folder, { recursive: true, force: true });
});

describe('schema rescue migration', () => {
  it('converges a production-like database that skipped 0080', async () => {
    await withDatabase('together_schema_rescue_prod', async (pool) => {
      const prodMigrations = buildPartialFolder(79, (entries) =>
        entries.map((entry) => entry.idx === 79
          ? { ...entry, when: migration0080When + 60_000 }
          : entry));
      await migrate(drizzle(pool), { migrationsFolder: prodMigrations });

      const missingColumn = await pool.query<{ count: number }>(`
        select count(*)::int as count
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tenant_api_keys'
          and column_name = 'expires_at'
      `);
      const missingTable = await pool.query<{ name: string | null }>(
        "select to_regclass('public.import_audit_events')::text as name",
      );
      expect(missingColumn.rows[0]?.count).toBe(0);
      expect(missingTable.rows[0]?.name).toBeNull();
      expect(await migrationRows(pool)).toHaveLength(80);

      const health = createHealthPort(drizzle(pool, { schema: dbSchema }));
      expect(await health.schemaStatus()).toEqual({
        expectedMigrations: expected,
        appliedMigrations: 80,
        schemaCurrent: false,
      });

      await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });

      const rows = await migrationRows(pool);
      expect(rows).toHaveLength(expected - 1);
      expect(rows.some((row) => Number(row.created_at) === migration0080When)).toBe(false);
      await expectRescuedSchema(pool);
      expect(await health.schemaStatus()).toEqual({
        expectedMigrations: expected,
        appliedMigrations: expected - 1,
        schemaCurrent: true,
      });
    });
  }, 60_000);

  it('is a no-op on a staging-like database where 0080 already converged the schema', async () => {
    await withDatabase('together_schema_rescue_staging', async (pool) => {
      const stagingMigrations = buildPartialFolder(80);
      await migrate(drizzle(pool), { migrationsFolder: stagingMigrations });
      await expectRescuedSchema(pool);

      await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });

      expect(await migrationRows(pool)).toHaveLength(expected);
      await expectRescuedSchema(pool);
      expect(await createHealthPort(drizzle(pool, { schema: dbSchema })).schemaStatus()).toEqual({
        expectedMigrations: expected,
        appliedMigrations: expected,
        schemaCurrent: true,
      });
    });
  }, 60_000);

  it('is a no-op after 0080 on a fresh database and remains migrator-idempotent', async () => {
    await withDatabase('together_schema_rescue_fresh', async (pool) => {
      await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
      expect(await migrationRows(pool)).toHaveLength(expected);
      await expectRescuedSchema(pool);

      await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });

      expect(await migrationRows(pool)).toHaveLength(expected);
      await expectRescuedSchema(pool);
    });
  }, 60_000);
});
