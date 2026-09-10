import pg from 'pg';

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

export const migrationJournalState = async (
  connectionString: string,
): Promise<MigrationJournalState> => {
  const pool = new pg.Pool({ connectionString });
  try {
    const tables = await pool.query<CountRow>(
      `
        select count(*)::int as count
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
      `,
    );
    const journalTable = await pool.query<JournalTableRow>(
      `select to_regclass('drizzle.__drizzle_migrations')::text as name`,
    );
    if (journalTable.rows[0]?.name === null || journalTable.rows[0]?.name === undefined) {
      return { tables: readCount(tables.rows), journalRows: 0 };
    }
    const journalRows = await pool.query<CountRow>(
      `select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    return {
      tables: readCount(tables.rows),
      journalRows: readCount(journalRows.rows),
    };
  } finally {
    await pool.end();
  }
};
