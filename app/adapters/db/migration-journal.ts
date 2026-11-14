import pg from 'pg';

import { normalizeDatabaseConnectionString } from './client.js';

export interface MigrationJournalState {
  tables: number;
  journalRows: number;
}

interface CountRow {
  count: number;
}

interface JournalTableRow {
  name: string | null;
}

const readCount = (rows: readonly CountRow[]): number => rows[0]?.count ?? 0;

const JOURNAL_TABLES = ['public.__drizzle_migrations', 'drizzle.__drizzle_migrations'] as const;

export const migrationJournalState = async (
  connectionString: string,
): Promise<MigrationJournalState> => {
  const pool = new pg.Pool({ connectionString: normalizeDatabaseConnectionString(connectionString) });
  try {
    const tables = await pool.query<CountRow>(
      `
        select count(*)::int as count
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
          and table_name <> '__drizzle_migrations'
      `,
    );
    for (const journal of JOURNAL_TABLES) {
      const journalTable = await pool.query<JournalTableRow>(
        `select to_regclass($1)::text as name`,
        [journal],
      );
      if (journalTable.rows[0]?.name === null || journalTable.rows[0]?.name === undefined) continue;
      const journalRows = await pool.query<CountRow>(`select count(*)::int as count from ${journal}`);
      return { tables: readCount(tables.rows), journalRows: readCount(journalRows.rows) };
    }
    return { tables: readCount(tables.rows), journalRows: 0 };
  } finally {
    await pool.end();
  }
};
