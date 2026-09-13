import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';

import * as schema from './schema.js';

export type DbDriver = 'node-postgres' | 'neon-http';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const normalizeDatabaseConnectionString = (connectionString: string): string =>
  connectionString.replace(/([?&]sslmode=)(?:require|prefer|verify-ca)(?=&|#|$)/gi, '$1verify-full');

export const createDb = (driver: DbDriver, connectionString: string): Db => {
  const normalizedConnectionString = normalizeDatabaseConnectionString(connectionString);
  switch (driver) {
    case 'neon-http':
      return drizzleNeonHttp(neon(normalizedConnectionString), { schema });
    case 'node-postgres':
      return drizzleNodePg(new pg.Pool({ connectionString: normalizedConnectionString }), { schema });
  }
};
