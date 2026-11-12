import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';

import { lockNotAvailable } from './pg-errors.js';

const { readFileSync } = process.getBuiltinModule('node:fs');
const { join } = process.getBuiltinModule('node:path');

const JOURNAL = 'public.__drizzle_migrations';
const LEGACY_JOURNAL = 'drizzle.__drizzle_migrations';
const LEGACY_JOURNAL_WRITER_TAG = '0105_record_skipped_0080';
const LOCK_NAME = 'together:migrations';
const DEFAULT_LOCK_WAIT_MS = 300_000;
const RECOVERY_DOC = 'docs/deployment-environments.md#migration-journal';
const DIVERGED_JOURNALS_DOC = 'docs/deployment-environments.md#diverged-journals';
const NAMED_ROWS_LIMIT = 10;

export interface MigrationRunOptions {
  connectionString: string;
  migrationsFolder: string;
  lockWaitMs?: number;
}

export interface MigrationRunResult {
  applied: number;
  copiedJournalRows: number | null;
}

interface Migration {
  tag: string;
  sql: readonly string[];
  hash: string;
  folderMillis: number;
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

interface TimeoutsRow {
  lock_timeout: string;
  statement_timeout: string;
}

interface LegacyRow {
  id: number;
  hash: string;
  created_at: string | null;
}

const firstRow = <T extends pg.QueryResultRow>(result: pg.QueryResult<T>, query: string): T => {
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Migration query returned no row: ${query}`);
  return row;
};

const journalTags = (migrationsFolder: string): string[] => {
  const value: unknown = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
  const entries: unknown = typeof value === 'object' && value !== null && 'entries' in value ? value.entries : null;
  if (!Array.isArray(entries)) throw new Error(`The migration journal in ${migrationsFolder} lists no entries`);
  return entries.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || !('tag' in entry) || typeof entry.tag !== 'string') {
      throw new Error(`The migration journal in ${migrationsFolder} has an entry without a tag`);
    }
    return entry.tag;
  });
};

const readMigrations = (migrationsFolder: string): Migration[] => {
  const tags = journalTags(migrationsFolder);
  return readMigrationFiles({ migrationsFolder }).map((migration, index) => {
    const tag = tags[index];
    if (tag === undefined) throw new Error(`The migration journal in ${migrationsFolder} changed while it was read`);
    return { tag, sql: migration.sql, hash: migration.hash, folderMillis: migration.folderMillis };
  });
};

const acquireRunLock = async (client: pg.Client, lockWaitMs: number): Promise<void> => {
  const previous = firstRow(
    await client.query<TimeoutsRow>(
      "select current_setting('lock_timeout') as lock_timeout, current_setting('statement_timeout') as statement_timeout",
    ),
    'timeouts',
  );
  await client.query(
    "select set_config('lock_timeout', $1, true), set_config('statement_timeout', '0', true)",
    [`${String(lockWaitMs)}ms`],
  );
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
  await client.query(
    "select set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)",
    [previous.lock_timeout, previous.statement_timeout],
  );
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

const ensureJournal = async (client: pg.Client, tables: JournalTablesRow): Promise<number | null> => {
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

const describeLegacyRow = (row: LegacyRow, migrations: readonly Migration[]): string => {
  const source = migrations.find((migration) => migration.hash === row.hash);
  const origin = source === undefined ? 'matches no migration of this release' : `is migration ${source.tag} of this release`;
  return `id ${String(row.id)} (created_at ${row.created_at ?? 'null'}, hash ${row.hash.slice(0, 12)}, ${origin})`;
};

const refuseDivergedLegacyJournal = async (
  client: pg.Client,
  migrations: readonly Migration[],
): Promise<void> => {
  const rows = (
    await client.query<LegacyRow>(`
      select legacy.id, legacy.hash, legacy.created_at::text as created_at
      from ${LEGACY_JOURNAL} legacy
      where legacy.created_at > (select coalesce(max(created_at), 0) from ${JOURNAL})
         or not exists (select 1 from ${JOURNAL} moved where moved.hash = legacy.hash)
      order by legacy.id
    `)
  ).rows;
  if (rows.length === 0) return;
  const named = rows.slice(0, NAMED_ROWS_LIMIT).map((row) => describeLegacyRow(row, migrations));
  const more = rows.length > NAMED_ROWS_LIMIT ? `, and ${String(rows.length - NAMED_ROWS_LIMIT)} more` : '';
  throw new Error(
    `${LEGACY_JOURNAL} holds ${String(rows.length)} rows that ${JOURNAL} lacks, so an earlier release's migrator ran after the journal moved: ${named.join('; ')}${more}. Nothing was applied, because this run could repeat those migrations. Reconcile the two journals as described in ${DIVERGED_JOURNALS_DOC}.`,
  );
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

const statementsOf = (migration: Migration): readonly string[] =>
  migration.tag === LEGACY_JOURNAL_WRITER_TAG
    ? migration.sql.map((statement) => statement.replaceAll(LEGACY_JOURNAL, JOURNAL))
    : migration.sql;

const applyPending = async (
  client: pg.Client,
  migrations: readonly Migration[],
): Promise<number> => {
  const last = (
    await client.query<CreatedAtRow>(
      `select created_at from ${JOURNAL} order by created_at desc limit 1`,
    )
  ).rows[0];
  let applied = 0;
  for (const migration of migrations) {
    if (last !== undefined && Number(last.created_at) >= migration.folderMillis) continue;
    for (const statement of statementsOf(migration)) await client.query(statement);
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
  const migrations = readMigrations(options.migrationsFolder);
  const client = new pg.Client({ connectionString: options.connectionString });
  // A dropped connection also rejects the pending query, which is what reports the failure.
  client.on('error', () => undefined);
  await client.connect();
  try {
    // Under a repeatable read or serializable default the snapshot would predate the lock, and a
    // session-level lock taken before BEGIN would not survive a transaction-mode pooler.
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
      await acquireRunLock(client, lockWaitMs);
      const tables = await journalTables(client);
      const copiedJournalRows = await ensureJournal(client, tables);
      if (tables.legacy) await refuseDivergedLegacyJournal(client, migrations);
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
