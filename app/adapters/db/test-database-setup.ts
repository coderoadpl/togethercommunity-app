import pg from 'pg';

import { runMigrations } from './migration-runner.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  delete process.env['TOGETHER_TEST_DATABASE_TEMPLATE'];
  const baseUrl = process.env['DATABASE_URL'];
  if (!baseUrl) return;

  const databaseName = uniqueTestDatabaseName('together_test_template');
  const identifier = pg.escapeIdentifier(databaseName);
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${identifier}`);
    try {
      await runMigrations({ connectionString: url.toString(), migrationsFolder: 'drizzle' });
      await admin.query(`ALTER DATABASE ${identifier} ALLOW_CONNECTIONS false`);
    } catch (error) {
      await admin.query(`DROP DATABASE ${identifier}`);
      throw error;
    }
  } finally {
    await admin.end();
  }

  process.env['TOGETHER_TEST_DATABASE_TEMPLATE'] = databaseName;
  return async () => {
    if (process.env['TOGETHER_TEST_DATABASE_TEMPLATE'] === databaseName) {
      delete process.env['TOGETHER_TEST_DATABASE_TEMPLATE'];
    }
    const cleanup = new pg.Client({ connectionString: baseUrl });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE ${identifier}`);
    } finally {
      await cleanup.end();
    }
  };
}
