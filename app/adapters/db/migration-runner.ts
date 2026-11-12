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
const DEFAULT_FENCE_LOCK_WAIT_MS = 3_000;
const RECOVERY_DOC = 'docs/deployment-environments.md#migration-journal';
const DIVERGED_JOURNALS_DOC = 'docs/deployment-environments.md#diverged-journals';
const JOURNAL_FENCE_DOC = 'docs/deployment-environments.md#journal-fence';
const LEGACY_JOURNAL_FENCE = 'migration_journal_moved_to_public';
// NOT VALID keeps the copied rows; every row inserted afterwards fails, so an earlier release's
// migrator rolls back the migrations it ran in the same transaction.
const FENCE_STATEMENT = `ALTER TABLE ${LEGACY_JOURNAL} ADD CONSTRAINT ${LEGACY_JOURNAL_FENCE} CHECK (false) NOT VALID`;
const NAMED_ROWS_LIMIT = 10;

export interface MigrationRunOptions {
  connectionString: string;
  migrationsFolder: string;
  lockWaitMs?: number;
  fenceLockWaitMs?: number;
}

export interface MigrationRunResult {
  applied: number;
  copiedJournalRows: number | null;
  fencedLegacyJournal: boolean;
}

interface JournalStepResult {
  copiedJournalRows: number | null;
  fencedLegacyJournal: boolean;
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

interface LegacyFenceRow {
  fenced: boolean;
  owned: boolean;
  owner: string;
  runner: string;
}

interface LegacyRow {
  id: number;
  hash: string;
  created_at: string | null;
}

export class MigrationRefusal extends Error {
  override readonly name = 'MigrationRefusal';
}

const counted = (count: number, one: string, other: string): string =>
  `${String(count)} ${count === 1 ? one : other}`;

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

const waitingAtMost = async (
  client: pg.Client,
  waitMs: number,
  query: { text: string; values?: unknown[] },
  refusal: string,
): Promise<void> => {
  const previous = firstRow(
    await client.query<TimeoutsRow>(
      "select current_setting('lock_timeout') as lock_timeout, current_setting('statement_timeout') as statement_timeout",
    ),
    'timeouts',
  );
  await client.query(
    "select set_config('lock_timeout', $1, true), set_config('statement_timeout', '0', true)",
    [`${String(waitMs)}ms`],
  );
  try {
    await client.query(query.text, query.values);
  } catch (error) {
    if (lockNotAvailable(error)) throw new MigrationRefusal(refusal, { cause: error });
    throw error;
  }
  await client.query(
    "select set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)",
    [previous.lock_timeout, previous.statement_timeout],
  );
};

const acquireRunLock = async (client: pg.Client, lockWaitMs: number): Promise<void> => {
  await waitingAtMost(
    client,
    lockWaitMs,
    { text: 'select pg_advisory_xact_lock(hashtextextended($1, 0))', values: [LOCK_NAME] },
    `Another migration run held the migration lock for more than ${String(lockWaitMs)} ms; nothing was applied. Run one migrator at a time.`,
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

const legacyFence = async (client: pg.Client): Promise<LegacyFenceRow> =>
  firstRow(
    await client.query<LegacyFenceRow>(
      `select
         exists (select 1 from pg_constraint where conrelid = c.oid and conname = $1) as fenced,
         pg_has_role(c.relowner, 'USAGE') as owned,
         pg_get_userbyid(c.relowner) as owner,
         current_user as runner
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'drizzle' and c.relname = '__drizzle_migrations'`,
      [LEGACY_JOURNAL_FENCE],
    ),
    'legacy journal fence',
  );

const fenceLegacyJournal = async (client: pg.Client, fenceLockWaitMs: number): Promise<boolean> => {
  const state = await legacyFence(client);
  if (state.fenced) return false;
  if (!state.owned) {
    throw new MigrationRefusal(
      `${LEGACY_JOURNAL} belongs to ${state.owner}, not to ${state.runner}, so this run cannot stop an earlier release's migrator from writing to it. Nothing was applied. Run the migration as ${state.owner}, or have ${state.owner} run "${FENCE_STATEMENT}" and then run it again; see ${JOURNAL_FENCE_DOC}.`,
    );
  }
  await waitingAtMost(
    client,
    fenceLockWaitMs,
    { text: FENCE_STATEMENT },
    `Another session kept ${LEGACY_JOURNAL} in use for more than ${String(fenceLockWaitMs)} ms, so this run could not fence it. Nothing was changed. Run the migration again; see ${JOURNAL_FENCE_DOC}.`,
  );
  return true;
};

const describeLegacyRow =(row: LegacyRow, migrations: readonly Migration[]): string => {
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
  throw new MigrationRefusal(
    `${LEGACY_JOURNAL} holds ${counted(rows.length, 'row', 'rows')} that ${JOURNAL} lacks, so an earlier release's migrator ran after the journal moved: ${named.join('; ')}${more}. Nothing was applied, because this run could repeat those migrations. Reconcile the two journals as described in ${DIVERGED_JOURNALS_DOC}.`,
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
  throw new MigrationRefusal(
    `The database has ${counted(tables, 'application table', 'application tables')} but no migration journal, so migration 0000 would run against existing tables. Restore the database together with ${JOURNAL} or start from an empty database; see ${RECOVERY_DOC}.`,
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

const positiveWait = (value: number, what: string): number => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`The ${what} must be a positive whole number of milliseconds`);
  }
  return value;
};

const serialized = async <T>(client: pg.Client, lockWaitMs: number, work: () => Promise<T>): Promise<T> => {
  // Under a repeatable read or serializable default the snapshot would predate the lock, and a
  // session-level lock taken before BEGIN would not survive a transaction-mode pooler.
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    await acquireRunLock(client, lockWaitMs);
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

const prepareJournal = async (
  client: pg.Client,
  migrations: readonly Migration[],
  fenceLockWaitMs: number,
): Promise<JournalStepResult> => {
  const tables = await journalTables(client);
  const fencedLegacyJournal = tables.legacy && await fenceLegacyJournal(client, fenceLockWaitMs);
  const copiedJournalRows = await ensureJournal(client, tables);
  if (tables.legacy) await refuseDivergedLegacyJournal(client, migrations);
  await refuseUntrackedSchema(client);
  return { copiedJournalRows, fencedLegacyJournal };
};

const migratePrepared = async (client: pg.Client, migrations: readonly Migration[]): Promise<number> => {
  const tables = await journalTables(client);
  if (!tables.current || (tables.legacy && !(await legacyFence(client)).fenced)) {
    throw new MigrationRefusal(
      `${JOURNAL} or the fence on ${LEGACY_JOURNAL} changed after this run prepared the journal; no migration was applied. Run the migration again.`,
    );
  }
  if (tables.legacy) await refuseDivergedLegacyJournal(client, migrations);
  await refuseUntrackedSchema(client);
  return applyPending(client, migrations);
};

export const runMigrations = async (options: MigrationRunOptions): Promise<MigrationRunResult> => {
  const lockWaitMs = positiveWait(options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS, 'migration lock wait');
  const fenceLockWaitMs = positiveWait(options.fenceLockWaitMs ?? DEFAULT_FENCE_LOCK_WAIT_MS, 'journal fence lock wait');
  const migrations = readMigrations(options.migrationsFolder);
  const client = new pg.Client({ connectionString: options.connectionString });
  // A dropped connection also rejects the pending query, which is what reports the failure.
  client.on('error', () => undefined);
  await client.connect();
  try {
    // The fence commits before any migration runs, so neither a deadlock with an earlier release's
    // migrator nor a failed migration can roll it back, and its exclusive lock is held only briefly.
    const journal = await serialized(client, lockWaitMs, () => prepareJournal(client, migrations, fenceLockWaitMs));
    const applied = await serialized(client, lockWaitMs, () => migratePrepared(client, migrations));
    return { applied, ...journal };
  } finally {
    await client.end();
  }
};
