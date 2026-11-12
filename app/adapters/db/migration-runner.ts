import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import pg from 'pg';

import { lockNotAvailable } from './pg-errors.js';

const JOURNAL = 'public.__drizzle_migrations';
const LEGACY_JOURNAL = 'drizzle.__drizzle_migrations';
const LOCK_NAME = 'together:migrations';
const DEFAULT_LOCK_WAIT_MS = 300_000;
const RECOVERY_DOC = 'docs/deployment-environments.md#migration-journal';

export interface MigrationRunOptions {
  connectionString: string;
  migrationsFolder: string;
  lockWaitMs?: number;
}

export interface MigrationRunResult {
  applied: number;
  copiedJournalRows: number | null;
}

interface JournalTablesRow {
  current: boolean;
  legacy: boolean;
}

interface CountRow {
  count: number;
}

interface CreatedAtRow {
  created_at: string | null;
}

interface SettingRow {
  value: string;
}

const firstRow = <T extends pg.QueryResultRow>(result: pg.QueryResult<T>, query: string): T => {
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Migration query returned no row: ${query}`);
  return row;
};

const acquireRunLock = async (client: pg.Client, lockWaitMs: number): Promise<void> => {
  const previous = firstRow(
    await client.query<SettingRow>("select current_setting('lock_timeout') as value"),
    'lock_timeout',
  ).value;
  await client.query("select set_config('lock_timeout', $1, true)", [`${String(lockWaitMs)}ms`]);
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [LOCK_NAME]);
  } catch (error) {
    if (lockNotAvailable(error)) {
      throw new Error(
        `Another migration run held the migration lock for more than ${String(lockWaitMs)} ms; nothing was applied. Run one migrator at a time.`,
        { cause: error },
      );
    }
    throw error;
  }
  await client.query("select set_config('lock_timeout', $1, true)", [previous]);
};

const journalTables = async (client: pg.Client): Promise<JournalTablesRow> =>
  firstRow(
    await client.query<JournalTablesRow>(`
      select
        exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = '__drizzle_migrations' and c.relkind in ('r', 'p')
        ) as current,
        exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'drizzle' and c.relname = '__drizzle_migrations' and c.relkind in ('r', 'p')
        ) as legacy
    `),
    'journal tables',
  );

const ensureJournal = async (client: pg.Client): Promise<number | null> => {
  const tables = await journalTables(client);
  if (tables.current) return null;
  await client.query(
    `CREATE TABLE ${JOURNAL} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  if (!tables.legacy) return null;
  const copied = await client.query(
    `insert into ${JOURNAL} (id, hash, created_at)
     select id, hash, created_at from ${LEGACY_JOURNAL} order by id`,
  );
  await client.query(
    `select setval(pg_get_serial_sequence('${JOURNAL}', 'id'), max(id))
     from ${JOURNAL} having max(id) is not null`,
  );
  return copied.rowCount ?? 0;
};

const refuseUntrackedSchema = async (client: pg.Client): Promise<void> => {
  const journalRows = firstRow(
    await client.query<CountRow>(`select count(*)::int as count from ${JOURNAL}`),
    'journal rows',
  ).count;
  if (journalRows > 0) return;
  const tables = firstRow(
    await client.query<CountRow>(`
      select count(*)::int as count
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> '__drizzle_migrations'
    `),
    'application tables',
  ).count;
  if (tables === 0) return;
  throw new Error(
    `The database has ${String(tables)} application tables but no migration journal, so migration 0000 would run against existing tables. Restore the database together with ${JOURNAL} or start from an empty database; see ${RECOVERY_DOC}.`,
  );
};

const journalStatement = (statement: string): string =>
  statement.replaceAll(LEGACY_JOURNAL, JOURNAL);

const applyPending = async (
  client: pg.Client,
  migrations: readonly MigrationMeta[],
): Promise<number> => {
  const last = (
    await client.query<CreatedAtRow>(
      `select created_at from ${JOURNAL} order by created_at desc limit 1`,
    )
  ).rows[0];
  let applied = 0;
  for (const migration of migrations) {
    if (last !== undefined && Number(last.created_at) >= migration.folderMillis) continue;
    for (const statement of migration.sql) await client.query(journalStatement(statement));
    await client.query(`insert into ${JOURNAL} ("hash", "created_at") values ($1, $2)`, [
      migration.hash,
      migration.folderMillis,
    ]);
    applied += 1;
  }
  return applied;
};

export const runMigrations = async (options: MigrationRunOptions): Promise<MigrationRunResult> => {
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  if (!Number.isInteger(lockWaitMs) || lockWaitMs < 1) {
    throw new Error('The migration lock wait must be a positive whole number of milliseconds');
  }
  const migrations = readMigrationFiles({ migrationsFolder: options.migrationsFolder });
  const client = new pg.Client({ connectionString: options.connectionString });
  // A dropped connection also rejects the pending query, which is what reports the failure.
  client.on('error', () => undefined);
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      await acquireRunLock(client, lockWaitMs);
      const copiedJournalRows = await ensureJournal(client);
      await refuseUntrackedSchema(client);
      const applied = await applyPending(client, migrations);
      await client.query('COMMIT');
      return { applied, copiedJournalRows };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
};
