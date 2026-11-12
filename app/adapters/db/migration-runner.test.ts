import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate as previousReleaseMigrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MigrationCounts } from '#core/server/index.js';

import { runMigrations } from './migration-runner.js';
import { createHealthPort } from './repositories.js';
import * as dbSchema from './schema.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

const { spawnSync } = process.getBuiltinModule('node:child_process');
const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } =
  process.getBuiltinModule('node:fs');
const { tmpdir } = process.getBuiltinModule('node:os');
const { join } = process.getBuiltinModule('node:path');

const adminUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const pgToolsContainer = process.env['MIGRATION_TEST_PG_CONTAINER'];
const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
const expected = migrations.length;
const migration0080When = migrations[80]?.folderMillis;
if (migration0080When === undefined) throw new Error('Migration 0080 is missing');

type JournalEntry = { idx: number; when: number; tag: string };
type ExtraMigration = { tag: string; sql: string };
type JournalRow = { id: number; hash: string; created_at: string };

const isJournalEntry = (value: unknown): value is JournalEntry =>
  typeof value === 'object'
  && value !== null
  && 'idx' in value
  && typeof value.idx === 'number'
  && 'when' in value
  && typeof value.when === 'number'
  && 'tag' in value
  && typeof value.tag === 'string';

const journalEntries = ((): JournalEntry[] => {
  const value: unknown = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  if (
    typeof value !== 'object'
    || value === null
    || !('entries' in value)
    || !Array.isArray(value.entries)
    || !value.entries.every(isJournalEntry)
  ) {
    throw new Error('The drizzle journal is unreadable');
  }
  return value.entries;
})();

const roleName = uniqueTestDatabaseName('together_migration_runner_role');
const rolePassword = crypto.randomUUID();
const runtimeRoleName = uniqueTestDatabaseName('together_runtime_role');
const runtimeRolePassword = crypto.randomUUID();
const temporaryFolders: string[] = [];

const withClient = async <T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const databaseUrl = (database: string, asRole: boolean): string => {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  if (asRole) {
    url.username = roleName;
    url.password = rolePassword;
  }
  return url.toString();
};

const runtimeUrl = (database: string): string => {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  url.username = runtimeRoleName;
  url.password = runtimeRolePassword;
  return url.toString();
};

type RestrictedDatabase = { name: string; url: string; adminUrl: string };

const createRestrictedDatabase = async (base: string, allowCreate: boolean): Promise<RestrictedDatabase> => {
  const name = uniqueTestDatabaseName(base);
  await withClient(adminUrl, async (client) => {
    await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  });
  await withClient(databaseUrl(name, false), async (client) => {
    await client.query(`REVOKE CREATE ON DATABASE ${pg.escapeIdentifier(name)} FROM PUBLIC`);
    await client.query(`ALTER SCHEMA public OWNER TO ${pg.escapeIdentifier(roleName)}`);
    if (allowCreate) {
      await client.query(
        `GRANT CREATE ON DATABASE ${pg.escapeIdentifier(name)} TO ${pg.escapeIdentifier(roleName)}`,
      );
    }
  });
  return { name, url: databaseUrl(name, true), adminUrl: databaseUrl(name, false) };
};

const dropDatabase = async (name: string): Promise<void> => {
  await withClient(adminUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`);
  });
};

const withRestrictedDatabase = async (
  base: string,
  run: (database: RestrictedDatabase) => Promise<void>,
  options: { allowCreate?: boolean } = {},
): Promise<void> => {
  const database = await createRestrictedDatabase(base, options.allowCreate ?? false);
  try {
    await run(database);
  } finally {
    await dropDatabase(database.name);
  }
};

const revokeCreate = async (database: RestrictedDatabase): Promise<void> => {
  await withClient(database.adminUrl, async (client) => {
    await client.query(
      `REVOKE CREATE ON DATABASE ${pg.escapeIdentifier(database.name)} FROM ${pg.escapeIdentifier(roleName)}`,
    );
  });
};

const migrationFolder = (count: number, extras: readonly ExtraMigration[] = [], whenOf?: (entry: JournalEntry) => number): string => {
  const folder = mkdtempSync(join(tmpdir(), 'together-migration-runner-'));
  temporaryFolders.push(folder);
  mkdirSync(join(folder, 'meta'));
  const entries = journalEntries.slice(0, count).map((entry) => ({
    idx: entry.idx,
    when: whenOf?.(entry) ?? entry.when,
    tag: entry.tag,
  }));
  for (const entry of entries) copyFileSync(join('drizzle', `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  const lastWhen = entries.at(-1)?.when ?? 0;
  extras.forEach((extra, index) => {
    writeFileSync(join(folder, `${extra.tag}.sql`), extra.sql);
    entries.push({ idx: count + index, when: lastWhen + index + 1, tag: extra.tag });
  });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: entries.map((entry) => ({ ...entry, version: '7', breakpoints: true })),
    }),
  );
  return folder;
};

const migrateWithPreviousRelease = async (url: string, migrationsFolder: string): Promise<void> => {
  const pool = new pg.Pool({ connectionString: url });
  try {
    await previousReleaseMigrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
};

const journalRows = async (url: string, schema: 'public' | 'drizzle'): Promise<JournalRow[]> =>
  withClient(url, async (client) =>
    (
      await client.query<JournalRow>(
        `select id, hash, created_at::text as created_at from ${schema}.__drizzle_migrations order by id`,
      )
    ).rows);

const relationExists = async (url: string, name: string): Promise<boolean> =>
  withClient(url, async (client) =>
    (await client.query<{ name: string | null }>('select to_regclass($1)::text as name', [name])).rows[0]?.name != null);

const schemaExists = async (url: string, name: string): Promise<boolean> =>
  withClient(url, async (client) =>
    (await client.query<{ count: number }>('select count(*)::int as count from pg_namespace where nspname = $1', [name]))
      .rows[0]?.count === 1);

const healthCounts = async (url: string): Promise<{ applied: number | null; current: boolean }> => {
  const pool = new pg.Pool({ connectionString: url });
  try {
    const health = createHealthPort(drizzle(pool, { schema: dbSchema }));
    const counts = await health.migrationCounts();
    const status = await health.schemaStatus();
    return { applied: counts.applied, current: status.schemaCurrent };
  } finally {
    await pool.end();
  }
};

const runtimeCounts = async (url: string, poolOptions: pg.PoolConfig = {}): Promise<MigrationCounts> => {
  const pool = new pg.Pool({ connectionString: url, ...poolOptions });
  try {
    return await createHealthPort(drizzle(pool, { schema: dbSchema })).migrationCounts();
  } finally {
    await pool.end();
  }
};

const waitForBackend = async (url: string, condition: string): Promise<void> => {
  await withClient(url, async (client) => {
    const deadline = Date.now() + 30_000;
    while (
      (await client.query(`select 1 from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and ${condition}`))
        .rowCount === 0
    ) {
      if (Date.now() > deadline) throw new Error(`No backend matched ${condition}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
};

const chainRows = (): Array<Pick<JournalRow, 'hash' | 'created_at'>> =>
  migrations.map((migration) => ({ hash: migration.hash, created_at: String(migration.folderMillis) }));

const withoutIds = (rows: readonly JournalRow[]): Array<Pick<JournalRow, 'hash' | 'created_at'>> =>
  rows.map(({ hash, created_at }) => ({ hash, created_at }));

const pgToolsAvailable =
  pgToolsContainer !== undefined
  || (spawnSync('pg_dump', ['--version']).status === 0 && spawnSync('pg_restore', ['--version']).status === 0);

const runPgTool = (tool: 'pg_dump' | 'pg_restore', url: string, args: readonly string[], input?: Buffer): Buffer => {
  const target = new URL(url);
  if (pgToolsContainer !== undefined) {
    target.hostname = '127.0.0.1';
    target.port = '5432';
  }
  const toolArgs = [...args, `--dbname=${target.toString()}`];
  const result = pgToolsContainer === undefined
    ? spawnSync(tool, toolArgs, { input, maxBuffer: 512 * 1024 * 1024 })
    : spawnSync('docker', ['exec', '-i', pgToolsContainer, tool, ...toolArgs], { input, maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${tool} exited with ${String(result.status)}: ${result.stderr.toString()}`);
  }
  return result.stdout;
};

beforeAll(async () => {
  await withClient(adminUrl, async (client) => {
    await client.query(
      `CREATE ROLE ${pg.escapeIdentifier(roleName)} LOGIN PASSWORD ${pg.escapeLiteral(rolePassword)}`,
    );
    await client.query(
      `CREATE ROLE ${pg.escapeIdentifier(runtimeRoleName)} LOGIN PASSWORD ${pg.escapeLiteral(runtimeRolePassword)}`,
    );
  });
});

afterAll(async () => {
  for (const folder of temporaryFolders) rmSync(folder, { recursive: true, force: true });
  await withClient(adminUrl, async (client) => {
    await client.query(`DROP ROLE IF EXISTS ${pg.escapeIdentifier(roleName)}`);
    await client.query(`DROP ROLE IF EXISTS ${pg.escapeIdentifier(runtimeRoleName)}`);
  });
});

describe('migration runner', () => {
  it('migrates a fresh database as a role without CREATE on the database, then applies nothing', async () => {
    await withRestrictedDatabase('together_runner_fresh', async (database) => {
      const canCreate = await withClient(database.url, async (client) =>
        (await client.query<{ allowed: boolean }>(
          "select has_database_privilege(current_database(), 'CREATE') as allowed",
        )).rows[0]?.allowed);
      expect(canCreate).toBe(false);

      await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }))
        .resolves.toEqual({ applied: expected, copiedJournalRows: null });
      await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }))
        .resolves.toEqual({ applied: 0, copiedJournalRows: null });

      expect(withoutIds(await journalRows(database.url, 'public'))).toEqual(chainRows());
      expect(await schemaExists(database.url, 'drizzle')).toBe(false);
      expect(await healthCounts(database.url)).toEqual({ applied: expected, current: true });
    });
  }, 120_000);

  it('moves a journal kept by the previous release into public row for row', async () => {
    await withRestrictedDatabase('together_runner_upgrade', async (database) => {
      await migrateWithPreviousRelease(database.url, 'drizzle');
      await revokeCreate(database);
      const legacyRows = await journalRows(database.url, 'drizzle');
      expect(legacyRows).toHaveLength(expected);

      await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }))
        .resolves.toEqual({ applied: 0, copiedJournalRows: expected });
      expect(await journalRows(database.url, 'public')).toEqual(legacyRows);

      await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }))
        .resolves.toEqual({ applied: 0, copiedJournalRows: null });
      expect(await journalRows(database.url, 'public')).toEqual(legacyRows);
      expect(await journalRows(database.url, 'drizzle')).toEqual(legacyRows);
      expect(await healthCounts(database.url)).toEqual({ applied: expected, current: true });

      const next = migrationFolder(expected, [
        { tag: `${String(expected).padStart(4, '0')}_runner_probe`, sql: 'CREATE TABLE runner_probe (id integer);' },
      ]);
      await expect(runMigrations({ connectionString: database.url, migrationsFolder: next }))
        .resolves.toEqual({ applied: 1, copiedJournalRows: null });
      expect((await journalRows(database.url, 'public')).at(-1)?.id).toBe(Math.max(...legacyRows.map((row) => row.id)) + 1);
      expect(await journalRows(database.url, 'drizzle')).toEqual(legacyRows);
    }, { allowCreate: true });
  }, 120_000);

  it('records the skipped 0080 row in public when a production-like journal is upgraded', async () => {
    await withRestrictedDatabase('together_runner_skipped_0080', async (database) => {
      const production = migrationFolder(80, [], (entry) =>
        entry.idx === 79 ? migration0080When + 60_000 : entry.when);
      await migrateWithPreviousRelease(database.url, production);
      await revokeCreate(database);
      const legacyRows = await journalRows(database.url, 'drizzle');
      expect(legacyRows).toHaveLength(80);

      await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }))
        .resolves.toEqual({ applied: expected - 81, copiedJournalRows: 80 });

      const rows = await journalRows(database.url, 'public');
      expect(rows).toHaveLength(expected);
      expect(rows.filter((row) => Number(row.created_at) === migration0080When)).toEqual([
        expect.objectContaining({ hash: migrations[80]?.hash }),
      ]);
      expect(await journalRows(database.url, 'drizzle')).toEqual(legacyRows);
      expect(await healthCounts(database.url)).toEqual({ applied: expected, current: true });
    }, { allowCreate: true });
  }, 120_000);

  it('runs a later migration that names the previous journal as written', async () => {
    await withRestrictedDatabase('together_runner_names_legacy', async (database) => {
      await migrateWithPreviousRelease(database.url, migrationFolder(100));
      await revokeCreate(database);
      const cleanup = migrationFolder(expected, [{
        tag: `${String(expected).padStart(4, '0')}_runner_legacy_cleanup`,
        sql: [
          'DELETE FROM drizzle.__drizzle_migrations;',
          "CREATE TABLE runner_probe (note text DEFAULT 'drizzle.__drizzle_migrations');",
        ].join('\n--> statement-breakpoint\n'),
      }]);

      await expect(runMigrations({ connectionString: database.url, migrationsFolder: cleanup }))
        .resolves.toEqual({ applied: expected - 99, copiedJournalRows: 100 });

      expect(await journalRows(database.url, 'drizzle')).toEqual([]);
      expect(await journalRows(database.url, 'public')).toHaveLength(expected + 1);
      expect(await withClient(database.url, async (client) =>
        (await client.query<{ value: string }>(
          "select pg_get_expr(adbin, adrelid) as value from pg_attrdef where adrelid = 'public.runner_probe'::regclass",
        )).rows[0]?.value)).toBe("'drizzle.__drizzle_migrations'::text");
      await expect(runMigrations({ connectionString: database.url, migrationsFolder: cleanup }))
        .resolves.toEqual({ applied: 0, copiedJournalRows: null });
    }, { allowCreate: true });
  }, 120_000);

  it('refuses to migrate when the previous journal holds rows the public journal lacks', async () => {
    await withRestrictedDatabase('together_runner_diverged', async (database) => {
      await migrateWithPreviousRelease(database.url, migrationFolder(100));
      await revokeCreate(database);
      await expect(runMigrations({ connectionString: database.url, migrationsFolder: migrationFolder(100) }))
        .resolves.toEqual({ applied: 0, copiedJournalRows: 100 });
      await withClient(database.adminUrl, async (client) => {
        await client.query(`GRANT CREATE ON DATABASE ${pg.escapeIdentifier(database.name)} TO ${pg.escapeIdentifier(roleName)}`);
      });
      const hotfix = migrationFolder(100, [{
        tag: '0100_runner_hotfix',
        sql: 'CREATE TABLE IF NOT EXISTS runner_probe (id integer);\n--> statement-breakpoint\nINSERT INTO runner_probe VALUES (1);',
      }]);
      await migrateWithPreviousRelease(database.url, hotfix);
      await revokeCreate(database);
      const publicRows = await journalRows(database.url, 'public');
      const hotfixRow = (await journalRows(database.url, 'drizzle')).at(-1);
      if (hotfixRow === undefined) throw new Error('The previous release recorded no hotfix row');
      const hotfixHash = readMigrationFiles({ migrationsFolder: hotfix }).at(-1)?.hash;
      expect(hotfixRow.hash).toBe(hotfixHash);
      const probeRows = async (): Promise<number | undefined> =>
        withClient(database.url, async (client) =>
          (await client.query<{ count: number }>('select count(*)::int as count from runner_probe')).rows[0]?.count);

      await expect(runMigrations({ connectionString: database.url, migrationsFolder: hotfix }))
        .rejects.toThrow(
          `drizzle.__drizzle_migrations holds 1 rows that public.__drizzle_migrations lacks, so an earlier release's migrator ran after the journal moved: id ${String(hotfixRow.id)} (created_at ${hotfixRow.created_at}, hash ${hotfixRow.hash.slice(0, 12)}, is migration 0100_runner_hotfix of this release). Nothing was applied, because this run could repeat those migrations. Reconcile the two journals as described in docs/deployment-environments.md#diverged-journals.`,
        );
      expect(await journalRows(database.url, 'public')).toEqual(publicRows);
      expect(await probeRows()).toBe(1);

      await withClient(database.url, async (client) => {
        await client.query(
          'INSERT INTO public.__drizzle_migrations (hash, created_at) SELECT hash, created_at FROM drizzle.__drizzle_migrations WHERE id IN ($1)',
          [hotfixRow.id],
        );
        await client.query(
          "insert into drizzle.__drizzle_migrations (hash, created_at) values ('written-by-another-branch', 1)",
        );
      });
      const foreignId = (await journalRows(database.url, 'drizzle')).at(-1)?.id;
      await expect(runMigrations({ connectionString: database.url, migrationsFolder: hotfix }))
        .rejects.toThrow(
          `id ${String(foreignId)} (created_at 1, hash written-by-a, matches no migration of this release)`,
        );

      await withClient(database.url, async (client) => {
        await client.query('DELETE FROM drizzle.__drizzle_migrations WHERE id IN ($1)', [foreignId]);
      });
      await expect(runMigrations({ connectionString: database.url, migrationsFolder: hotfix }))
        .resolves.toEqual({ applied: 0, copiedJournalRows: null });
      expect(await probeRows()).toBe(1);
    }, { allowCreate: true });
  }, 120_000);

  it('refuses a database that has application tables but no journal', async () => {
    await withRestrictedDatabase('together_runner_untracked', async (database) => {
      await withClient(database.url, async (client) => {
        await client.query('CREATE TABLE tenants (id text PRIMARY KEY)');
      });

      await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }))
        .rejects.toThrow(
          'The database has 1 application tables but no migration journal, so migration 0000 would run against existing tables. Restore the database together with public.__drizzle_migrations or start from an empty database; see docs/deployment-environments.md#migration-journal.',
        );
      expect(await relationExists(database.url, 'public.__drizzle_migrations')).toBe(false);
      expect(await relationExists(database.url, 'public.tenants')).toBe(true);
    });
  }, 60_000);

  it('leaves a run that dies after copying the journal for the next run to repair', async () => {
    await withRestrictedDatabase('together_runner_crash', async (database) => {
      await migrateWithPreviousRelease(database.url, migrationFolder(100));
      await revokeCreate(database);
      const legacyRows = await journalRows(database.url, 'drizzle');
      const stalled = migrationFolder(100, [{ tag: '0100_runner_stall', sql: 'SELECT pg_sleep(60);' }]);

      const crashed = runMigrations({ connectionString: database.url, migrationsFolder: stalled });
      const crashedOutcome = crashed.then(() => 'resolved', (error: unknown) => error);
      await withClient(database.adminUrl, async (client) => {
        const deadline = Date.now() + 30_000;
        for (;;) {
          const sleeping = await client.query<{ pid: number }>(
            "select pid from pg_stat_activity where datname = current_database() and query like 'SELECT pg_sleep(60)%'",
          );
          const pid = sleeping.rows[0]?.pid;
          if (pid !== undefined) {
            expect(await relationExists(database.adminUrl, 'public.__drizzle_migrations')).toBe(false);
            await client.query('select pg_terminate_backend($1)', [pid]);
            break;
          }
          if (Date.now() > deadline) throw new Error('The stalled migration never started');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
      expect(await crashedOutcome).toBeInstanceOf(Error);

      expect(await relationExists(database.url, 'public.__drizzle_migrations')).toBe(false);
      expect(await journalRows(database.url, 'drizzle')).toEqual(legacyRows);

      await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }))
        .resolves.toEqual({ applied: expected - 100, copiedJournalRows: 100 });
      expect((await journalRows(database.url, 'public')).slice(0, 100)).toEqual(legacyRows);
      expect(withoutIds(await journalRows(database.url, 'public'))).toEqual(chainRows());
    }, { allowCreate: true });
  }, 120_000);

  it('serializes two runners started together', async () => {
    await withRestrictedDatabase('together_runner_concurrent', async (database) => {
      const results = await Promise.all([
        runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }),
        runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle' }),
      ]);

      expect(results.map((result) => result.applied).toSorted((left, right) => left - right))
        .toEqual([0, expected]);
      expect(withoutIds(await journalRows(database.url, 'public'))).toEqual(chainRows());
    });
  }, 120_000);

  it('gives up with a clear message when another run holds the lock too long', async () => {
    await withRestrictedDatabase('together_runner_lock_wait', async (database) => {
      await withClient(database.adminUrl, async (holder) => {
        await holder.query('BEGIN');
        await holder.query("select pg_advisory_xact_lock(hashtextextended('together:migrations', 0))");

        await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle', lockWaitMs: 300 }))
          .rejects.toThrow(
            'Another migration run held the migration lock for more than 300 ms; nothing was applied. Run one migrator at a time.',
          );
        await holder.query('ROLLBACK');
      });
      expect(await relationExists(database.url, 'public.__drizzle_migrations')).toBe(false);
    });
  }, 60_000);

  it.each(['repeatable read', 'serializable'])(
    'lets a runner that waited for the lock see what the first one committed under a %s default',
    async (isolation) => {
      await withRestrictedDatabase('together_runner_isolation', async (database) => {
        await runMigrations({ connectionString: database.url, migrationsFolder: migrationFolder(1) });
        await withClient(database.adminUrl, async (client) => {
          await client.query(
            `ALTER DATABASE ${pg.escapeIdentifier(database.name)} SET default_transaction_isolation = ${pg.escapeLiteral(isolation)}`,
          );
        });
        const slow = migrationFolder(1, [{
          tag: '0001_runner_probe',
          sql: [
            'CREATE TABLE IF NOT EXISTS runner_probe (id integer);',
            'INSERT INTO runner_probe VALUES (1);',
            'SELECT pg_sleep(3);',
          ].join('\n--> statement-breakpoint\n'),
        }]);

        const first = runMigrations({ connectionString: database.url, migrationsFolder: slow });
        await waitForBackend(database.adminUrl, "query like '%SELECT pg_sleep(3)%'");
        const second = runMigrations({ connectionString: database.url, migrationsFolder: slow });
        await waitForBackend(database.adminUrl, "wait_event_type = 'Lock' and wait_event = 'advisory'");
        const results = await Promise.all([first, second]);

        expect(results.map((result) => result.applied)).toEqual([1, 0]);
        expect(await withClient(database.url, async (client) =>
          (await client.query<{ count: number }>('select count(*)::int as count from runner_probe')).rows[0]?.count))
          .toBe(1);
        expect(await journalRows(database.url, 'public')).toHaveLength(2);
      });
    },
    60_000,
  );

  it('keeps the documented lock message when the database sets a shorter statement timeout', async () => {
    await withRestrictedDatabase('together_runner_statement_timeout', async (database) => {
      await withClient(database.adminUrl, async (client) => {
        await client.query(`ALTER DATABASE ${pg.escapeIdentifier(database.name)} SET statement_timeout = '200ms'`);
      });
      await withClient(database.adminUrl, async (holder) => {
        await holder.query('BEGIN');
        await holder.query("select pg_advisory_xact_lock(hashtextextended('together:migrations', 0))");

        const started = Date.now();
        await expect(runMigrations({ connectionString: database.url, migrationsFolder: 'drizzle', lockWaitMs: 1000 }))
          .rejects.toThrow(
            'Another migration run held the migration lock for more than 1000 ms; nothing was applied. Run one migrator at a time.',
          );
        expect(Date.now() - started).toBeGreaterThanOrEqual(950);
        await holder.query('ROLLBACK');
      });
      expect(await relationExists(database.url, 'public.__drizzle_migrations')).toBe(false);
    });
  }, 60_000);

  it.skipIf(!pgToolsAvailable)(
    'applies nothing after a dump without the drizzle schema is restored by a role without CREATE on the database',
    async () => {
      await withRestrictedDatabase('together_runner_dump_source', async (source) => {
        await migrateWithPreviousRelease(source.url, 'drizzle');
        await revokeCreate(source);
        await runMigrations({ connectionString: source.url, migrationsFolder: 'drizzle' });
        const sourceRows = await journalRows(source.url, 'public');
        const dump = runPgTool('pg_dump', source.adminUrl, [
          '--format=custom',
          '--no-owner',
          '--no-acl',
          '--exclude-schema=drizzle',
        ]);

        await withRestrictedDatabase('together_runner_dump_target', async (target) => {
          runPgTool('pg_restore', target.url, ['--no-owner', '--no-acl', '--exit-on-error'], dump);

          expect(await schemaExists(target.url, 'drizzle')).toBe(false);
          expect(await journalRows(target.url, 'public')).toEqual(sourceRows);
          await expect(runMigrations({ connectionString: target.url, migrationsFolder: 'drizzle' }))
            .resolves.toEqual({ applied: 0, copiedJournalRows: null });
          expect(await journalRows(target.url, 'public')).toEqual(sourceRows);
          expect(await healthCounts(target.url)).toEqual({ applied: expected, current: true });
        });
      }, { allowCreate: true });
    },
    180_000,
  );
});

describe('readiness journal check', () => {
  const runtimeRole = (): string => pg.escapeIdentifier(runtimeRoleName);

  it('reports a missing journal on a database that was never migrated', async () => {
    await withRestrictedDatabase('together_ready_missing', async (database) => {
      expect(await runtimeCounts(runtimeUrl(database.name))).toEqual({ expected, applied: null, journal: 'missing' });
    });
  }, 60_000);

  it('reports a journal the runtime role may not read as unreadable until it holds the documented grants', async () => {
    await withRestrictedDatabase('together_ready_grants', async (database) => {
      await runMigrations({ connectionString: database.url, migrationsFolder: migrationFolder(1) });
      await withClient(database.url, async (client) => {
        await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      });

      expect(await runtimeCounts(runtimeUrl(database.name))).toEqual({ expected, applied: null, journal: 'unreadable' });

      await withClient(database.url, async (client) => {
        await client.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole()}`);
      });
      expect(await runtimeCounts(runtimeUrl(database.name))).toEqual({ expected, applied: null, journal: 'unreadable' });

      await withClient(database.url, async (client) => {
        await client.query(`GRANT SELECT ON public.__drizzle_migrations TO ${runtimeRole()}`);
      });
      expect(await runtimeCounts(runtimeUrl(database.name))).toEqual({ expected, applied: 1 });
    });
  }, 60_000);

  it('reports a journal read that times out or finds no free connection as unreadable', async () => {
    await withRestrictedDatabase('together_ready_timeout', async (database) => {
      await runMigrations({ connectionString: database.url, migrationsFolder: migrationFolder(1) });
      await withClient(database.url, async (client) => {
        await client.query(`GRANT SELECT ON public.__drizzle_migrations TO ${runtimeRole()}`);
      });

      await withClient(database.url, async (holder) => {
        await holder.query('BEGIN');
        await holder.query('LOCK TABLE public.__drizzle_migrations IN ACCESS EXCLUSIVE MODE');
        expect(await runtimeCounts(runtimeUrl(database.name), { statement_timeout: 300 }))
          .toEqual({ expected, applied: null, journal: 'unreadable' });
        await holder.query('ROLLBACK');
      });

      const pool = new pg.Pool({ connectionString: runtimeUrl(database.name), max: 1, connectionTimeoutMillis: 300 });
      try {
        const busy = await pool.connect();
        try {
          expect(await createHealthPort(drizzle(pool, { schema: dbSchema })).migrationCounts())
            .toEqual({ expected, applied: null, journal: 'unreadable' });
        } finally {
          busy.release();
        }
        expect(await createHealthPort(drizzle(pool, { schema: dbSchema })).migrationCounts())
          .toEqual({ expected, applied: 1 });
      } finally {
        await pool.end();
      }
    });
  }, 60_000);
});
