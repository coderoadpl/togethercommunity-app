import pg from 'pg';
import { assertSafeE2eDatabaseReset, resolveE2eDatabaseUrl } from './e2e-config.js';
import { SmokeFailure } from './smoke-failure.js';
import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';
import { run, tsxBin } from './server-harness.js';
const SMOKE_DB = uniqueTestDatabaseName('together_smoke_test');
export const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
assertSafeE2eDatabaseReset(baseDatabaseUrl, SMOKE_DB, process.env);
const smokeUrlObject = new URL(baseDatabaseUrl);
smokeUrlObject.pathname = `/${SMOKE_DB}`;
export const smokeDatabaseUrl = smokeUrlObject.toString();
const fail = (message: string): never => { throw new SmokeFailure(message); };
function assert(condition: boolean, message: string): asserts condition { if (!condition) fail(message); }
export const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${SMOKE_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${SMOKE_DB}`);
  } catch (cause) {
    fail(
      `Could not prepare the smoke database "${SMOKE_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

export const dropDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${SMOKE_DB} WITH (FORCE)`);
  } finally {
    await client.end();
  }
};

export const migrateAndSeed = async (databaseUrl: string, seedEnv: NodeJS.ProcessEnv = {}): Promise<void> => {
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: databaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { ...seedEnv, DATABASE_URL: databaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};
