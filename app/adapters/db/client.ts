import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';

import { serializeErrorChain } from '#core/server/log-safety.js';

import * as schema from './schema.js';

export type DbDriver = 'node-postgres' | 'neon-http';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const normalizeDatabaseConnectionString = (connectionString: string): string =>
  connectionString.replace(/([?&]sslmode=)(?:require|prefer|verify-ca)(?=&|#|$)/gi, '$1verify-full');

export const createDb = (
  driver: DbDriver,
  connectionString: string,
  options?: { connectionTimeoutMillis?: number; idleTimeoutMillis?: number; max?: number },
): Db => {
  const normalizedConnectionString = normalizeDatabaseConnectionString(connectionString);
  switch (driver) {
    case 'neon-http':
      return drizzleNeonHttp(neon(normalizedConnectionString), { schema });
    case 'node-postgres': {
      const pool = new pg.Pool({
        connectionString: normalizedConnectionString,
        idleTimeoutMillis: 30_000,
        keepAlive: true,
        connectionTimeoutMillis: 10_000,
        allowExitOnIdle: true,
        ...options,
      });
      pool.on('error', (error) => {
        console.error(`[database-pool] Idle client removed: ${serializeErrorChain(error)} total=${String(pool.totalCount)} idle=${String(pool.idleCount)} waiting=${String(pool.waitingCount)}`);
      });
      return drizzleNodePg(pool, { schema });
    }
  }
};
