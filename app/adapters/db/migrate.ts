import { databaseHostFingerprint } from '#adapters/crypto/database-fingerprint.js';

import { normalizeDatabaseConnectionString } from './client.js';
import { MigrationRefusal, runMigrations } from './migration-runner.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const fingerprint = databaseHostFingerprint(connectionString) ?? 'unknown';
const environment = process.env['VERCEL_ENV'] ?? process.env['APP_ENV'] ?? 'unset';
console.log(`Migrating database ${fingerprint} (environment ${environment})`);

try {
  const result = await runMigrations({
    connectionString: normalizeDatabaseConnectionString(connectionString),
    migrationsFolder: 'drizzle',
  });
  if (result.copiedJournalRows !== null) {
    console.log(
      `Migration journal moved to public.__drizzle_migrations (${String(result.copiedJournalRows)} ${result.copiedJournalRows === 1 ? 'row' : 'rows'} copied from drizzle.__drizzle_migrations)`,
    );
  }
  console.log(`Migrations applied (${String(result.applied)} new)`);
} catch (error) {
  if (!(error instanceof MigrationRefusal)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
