import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { databaseHostFingerprint } from '#adapters/crypto/database-fingerprint.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const fingerprint = databaseHostFingerprint(connectionString) ?? 'unknown';
const environment = process.env['VERCEL_ENV'] ?? process.env['APP_ENV'] ?? 'unset';
console.log(`Migrating database ${fingerprint} (environment ${environment})`);

const pool = new pg.Pool({ connectionString });

await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
console.log('Migrations applied');
await pool.end();
