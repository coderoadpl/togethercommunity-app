import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uniqueTestDatabaseName } from './test-database-name.js';

const TEST_DB = uniqueTestDatabaseName('together_seed_integration_test');
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testDatabaseUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();
const { spawnSync } = process.getBuiltinModule('node:child_process');
const { join } = process.getBuiltinModule('node:path');
const tsxBin = join(process.cwd(), 'node_modules/.bin/tsx');
const recreateDatabase = async (): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  const migrationPool = new pg.Pool({ connectionString: testDatabaseUrl });
  try {
    await migrate(drizzle(migrationPool), { migrationsFolder: 'drizzle' });
  } finally {
    await migrationPool.end();
  }
};

const dropDatabase = async (): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
};

const runDatabaseScript = (script: 'seed.ts' | 'reseed.ts'): void => {
  const result = spawnSync(tsxBin, [`adapters/db/${script}`], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: 'seed-integration-secret-at-least-32-characters',
      SEED_BASE_TIME: '2026-07-15T08:00:00.000Z',
    },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
};

const rowCounts = async (client: pg.Client): Promise<Record<string, number>> => {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name: table } of tables.rows) {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "${table.replaceAll('"', '""')}"`,
    );
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
};

let client: pg.Client;

beforeEach(async () => {
  await recreateDatabase();
  client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
}, 60_000);

afterEach(async () => {
  await client.end();
});

afterAll(async () => {
  await dropDatabase();
}, 180_000);

describe('demo seed lifecycle', () => {
  it('seeds a fresh migrated database', async () => {
    runDatabaseScript('seed.ts');

    const tenants = await client.query<{ id: string }>('SELECT id FROM tenants ORDER BY id');
    const creators = await client.query<{ email: string }>(
      `SELECT email FROM "user" WHERE email LIKE 'creator%@together.dev' ORDER BY email`,
    );
    const creatorTimestamp = await client.query<{ created_at: string }>(
      `SELECT created_at::text FROM "user" WHERE email = 'creator@together.dev'`,
    );
    const accountTimestamp = await client.query<{ created_at: string }>(
      `SELECT a.created_at::text
       FROM account a
       JOIN "user" u ON u.id = a.user_id
       WHERE u.email = 'creator@together.dev'`,
    );

    expect(tenants.rows.map(({ id }) => id)).toEqual([
      'tenant-acme',
      'tenant-akademia',
      'tenant-studio',
    ]);
    expect(creators.rows.map(({ email }) => email)).toEqual([
      'creator2@together.dev',
      'creator3@together.dev',
      'creator@together.dev',
    ]);
    expect(creatorTimestamp.rows[0]?.created_at).toBe('2026-07-15 08:00:00');
    expect(accountTimestamp.rows[0]?.created_at).toBe('2026-07-15 08:00:00');
  }, 180_000);

  it('does not add rows when the seed is repeated', async () => {
    runDatabaseScript('seed.ts');
    const firstCounts = await rowCounts(client);

    runDatabaseScript('seed.ts');

    expect(await rowCounts(client)).toEqual(firstCounts);
  }, 180_000);

  it('restores the canonical demo state through reseed', async () => {
    runDatabaseScript('seed.ts');
    await client.query(
      `INSERT INTO courses (id, tenant_id, name, description, created_at)
       VALUES ('AUDYT-kurs', 'tenant-studio', 'AUDYT kurs', '', NOW())`,
    );
    await client.query(
      `UPDATE courses
       SET module_order = '["module-js-projekty","module-js-podstawy","module-js-dom"]'::jsonb
       WHERE id = 'course-js'`,
    );
    await client.query(
      `UPDATE member_course_progress
       SET completed_lesson_ids = '["lesson-js-projekt-1"]'::jsonb,
           last_viewed_lesson_id = 'lesson-js-projekt-1'
       WHERE id = 'progress-member-studio-aktywny'`,
    );
    await client.query(
      `INSERT INTO tenants (id, slug, name, created_at)
       VALUES ('AUDYT-tenant', 'audyt-tenant', 'AUDYT tenant', NOW()::text)`,
    );
    await client.query(
      `INSERT INTO scheduler_runs (
         id, kind, trigger, started_at, status, totals, created_at
       ) VALUES
         (
           'AUDYT-scheduler-run', 'marketing_tick', 'manual', NOW(), 'completed', '{}'::jsonb, NOW()
         ),
         (
           'AUDYT-shared-scheduler-run', 'marketing_tick', 'manual', NOW(), 'completed',
           '{}'::jsonb, NOW()
         ),
         (
           'AUDYT-tenantless-scheduler-run', 'outbox_dispatch', 'scheduled', NOW(), 'running',
           '{}'::jsonb, NOW()
         )`,
    );
    await client.query(
      `INSERT INTO scheduler_run_tenants (
         id, run_id, tenant_id, campaigns_touched, batch_size, sent, failed, skipped,
         budget_computed, budget_used, errors, created_at
       ) VALUES
         (
           'AUDYT-scheduler-run-tenant', 'AUDYT-scheduler-run', 'tenant-studio', 0, 0, 0, 0, 0,
           0, 0, '[]'::jsonb, NOW()
         ),
         (
           'AUDYT-shared-scheduler-run-demo-tenant', 'AUDYT-shared-scheduler-run',
           'tenant-studio', 0, 0, 0, 0, 0, 0, 0, '[]'::jsonb, NOW()
         ),
         (
           'AUDYT-shared-scheduler-run-non-demo-tenant', 'AUDYT-shared-scheduler-run',
           'AUDYT-tenant', 0, 0, 0, 0, 0, 0, 0, '[]'::jsonb, NOW()
         )`,
    );
    await client.query(
      `INSERT INTO email_events (
         id, tenant_id, mail_kind, ref_id, type, occurred_at, created_at
       ) VALUES (
         'AUDYT-email-event', 'tenant-studio', 'transactional', 'AUDYT-email', 'sent', NOW(), NOW()
       )`,
    );

    runDatabaseScript('reseed.ts');

    const auditCourse = await client.query(
      `SELECT id FROM courses WHERE id = 'AUDYT-kurs'`,
    );
    const course = await client.query<{ module_order: string[] }>(
      `SELECT module_order FROM courses WHERE id = 'course-js'`,
    );
    const progress = await client.query<{
      completed_lesson_ids: string[];
      last_viewed_lesson_id: string;
    }>(
      `SELECT completed_lesson_ids, last_viewed_lesson_id
       FROM member_course_progress
       WHERE id = 'progress-member-studio-aktywny'`,
    );
    const staleSchedulerRun = await client.query(
      `SELECT id FROM scheduler_runs WHERE id = 'AUDYT-scheduler-run'`,
    );
    const tenantlessSchedulerRun = await client.query(
      `SELECT id FROM scheduler_runs WHERE id = 'AUDYT-tenantless-scheduler-run'`,
    );
    const sharedSchedulerRun = await client.query(
      `SELECT id FROM scheduler_runs WHERE id = 'AUDYT-shared-scheduler-run'`,
    );
    const sharedSchedulerRunTenants = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id
       FROM scheduler_run_tenants
       WHERE run_id = 'AUDYT-shared-scheduler-run'
       ORDER BY tenant_id`,
    );
    const staleEmailEvent = await client.query(
      `SELECT id FROM email_events WHERE id = 'AUDYT-email-event'`,
    );

    expect(auditCourse.rowCount).toBe(0);
    expect(course.rows).toEqual([{ module_order: [] }]);
    expect(progress.rows).toEqual([
      {
        completed_lesson_ids: ['lesson-js-zmienne-1', 'lesson-js-zmienne-2'],
        last_viewed_lesson_id: 'lesson-js-funkcje-1',
      },
    ]);
    expect(staleSchedulerRun.rowCount).toBe(0);
    expect(tenantlessSchedulerRun.rowCount).toBe(0);
    expect(sharedSchedulerRun.rows).toEqual([{ id: 'AUDYT-shared-scheduler-run' }]);
    expect(sharedSchedulerRunTenants.rows).toEqual([{ tenant_id: 'AUDYT-tenant' }]);
    expect(staleEmailEvent.rowCount).toBe(0);
  }, 180_000);
});
