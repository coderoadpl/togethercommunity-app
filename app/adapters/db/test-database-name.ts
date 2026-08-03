import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import type { Db } from './client.js';
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
): Promise<TestDatabase> => {
  const databaseName = uniqueTestDatabaseName(base);
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  await withAdminClient(baseUrl, async (client) => {
    await client.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
  });

  const pool = new pg.Pool({ connectionString: url.toString() });
  let idleError: Error | null = null;
  const captureIdleError = (error: Error): void => {
    idleError ??= error;
  };
  pool.on('error', captureIdleError);
  const db = drizzle(pool, { schema: dbSchema });

  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
  } catch (error) {
    await pool.end();
    await dropDatabase(baseUrl, databaseName);
    throw error;
  }

  let closed = false;
  return {
    db,
    url: url.toString(),
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
      await dropDatabase(baseUrl, databaseName);
      pool.removeListener('error', captureIdleError);
      if (idleError !== null) throw idleError;
    },
  };
};
