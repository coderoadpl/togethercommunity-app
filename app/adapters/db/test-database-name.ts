import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import type { Db } from './client.js';
import { runMigrations } from './migration-runner.js';
import * as dbSchema from './schema.js';

const POSTGRES_IDENTIFIER_LIMIT = 63;
const SUFFIX_LENGTH = 16;

export const uniqueTestDatabaseName = (base: string): string => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, SUFFIX_LENGTH);
  const availableBaseLength = POSTGRES_IDENTIFIER_LIMIT - suffix.length - 1;
  return `${base.slice(0, availableBaseLength)}_${suffix}`;
};

type TestDatabase = {
  db: Db;
  url: string;
  makeTemplate: () => Promise<string>;
  close: () => Promise<void>;
};

const withAdminClient = async (
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

const dropDatabase = async (baseUrl: string, databaseName: string): Promise<void> => {
  await withAdminClient(baseUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)}`);
  });
};

export const createTestDatabase = async (
  base: string,
  baseUrl: string,
  templateName = process.env['TOGETHER_TEST_DATABASE_TEMPLATE'],
): Promise<TestDatabase> => {
  const databaseName = uniqueTestDatabaseName(base);
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  const templateClause = templateName ? ` TEMPLATE ${pg.escapeIdentifier(templateName)}` : '';
  await withAdminClient(baseUrl, async (client) => {
    await client.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}${templateClause}`);
  });

  const pool = new pg.Pool({ connectionString: url.toString() });
  let idleError: Error | null = null;
  const captureIdleError = (error: Error): void => {
    idleError ??= error;
  };
  pool.on('error', captureIdleError);
  const db = drizzle(pool, { schema: dbSchema });

  try {
    if (!templateName) await runMigrations({ connectionString: url.toString(), migrationsFolder: 'drizzle' });
  } catch (error) {
    await pool.end();
    await dropDatabase(baseUrl, databaseName);
    throw error;
  }

  let poolClosed = false;
  const closePool = async (): Promise<void> => {
    if (poolClosed) return;
    poolClosed = true;
    await pool.end();
  };
  let closed = false;
  return {
    db,
    url: url.toString(),
    makeTemplate: async () => {
      await closePool();
      await withAdminClient(baseUrl, async (client) => {
        await client.query(`ALTER DATABASE ${pg.escapeIdentifier(databaseName)} ALLOW_CONNECTIONS false`);
      });
      return databaseName;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await closePool();
      await dropDatabase(baseUrl, databaseName);
      pool.removeListener('error', captureIdleError);
      if (idleError !== null) throw idleError;
    },
  };
};
