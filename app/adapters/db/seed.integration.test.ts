import pg from 'pg';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SMOKE_TENANT_CREATOR_EMAIL } from '#core/domain/index.js';

import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const { spawnSync } = process.getBuiltinModule('node:child_process');
const { join } = process.getBuiltinModule('node:path');
const tsxBin = join(process.cwd(), 'node_modules/.bin/tsx');
const DEMO_PASSWORD = 'demo-password-15';
const PREVIOUS_DEMO_PASSWORD = 'demo1234';
const passwordedCreators = (column: string): string =>
  `(${column} LIKE 'creator%@together.dev' OR ${column} = '${SMOKE_TENANT_CREATOR_EMAIL}')`;
let testDatabaseUrl: string;
let closeTestDatabase: () => Promise<void>;

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
  const testDatabase = await createTestDatabase('together_seed_integration_test', baseDatabaseUrl);
  testDatabaseUrl = testDatabase.url;
  closeTestDatabase = testDatabase.close;
  client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
}, 60_000);

afterEach(async () => {
  await client.end();
  await closeTestDatabase();
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
      'creator3@together.dev',
      'creator@together.dev',
    ]);
    expect(creatorTimestamp.rows[0]?.created_at).toBe('2026-07-15 08:00:00');
    expect(accountTimestamp.rows[0]?.created_at).toBe('2026-07-15 08:00:00');
  }, 180_000);

  it('seeds a public course, a publicly readable space and the tenant home space', async () => {
    runDatabaseScript('seed.ts');

    const publicCourses = await client.query<{ id: string }>(
      `SELECT id FROM courses WHERE publicly_visible ORDER BY id`,
    );
    const publicSpaces = await client.query<{ id: string }>(
      `SELECT id FROM spaces WHERE public_read_only ORDER BY id`,
    );
    const homeSpace = await client.query<{ default_home_space_id: string | null }>(
      `SELECT default_home_space_id FROM tenants WHERE id = 'tenant-studio'`,
    );

    expect(publicCourses.rows.map(({ id }) => id)).toEqual(['course-js']);
    expect(publicSpaces.rows.map(({ id }) => id)).toEqual(['space-studio-spolecznosc']);
    expect(homeSpace.rows).toEqual([{ default_home_space_id: 'space-studio-spolecznosc' }]);
  }, 180_000);

  it('converges existing creator credentials without adding rows when repeated', async () => {
    runDatabaseScript('seed.ts');
    const firstCounts = await rowCounts(client);
    const previousHash = await hashPassword(PREVIOUS_DEMO_PASSWORD);
    await client.query(
      `UPDATE account
       SET password = $1
       WHERE provider_id = 'credential'
         AND user_id IN (SELECT id FROM "user" WHERE ${passwordedCreators('email')})`,
      [previousHash],
    );

    runDatabaseScript('seed.ts');

    expect(await rowCounts(client)).toEqual(firstCounts);
    const credentials = await client.query<{ password: string }>(
      `SELECT a.password
       FROM account a
       JOIN "user" u ON u.id = a.user_id
       WHERE a.provider_id = 'credential' AND ${passwordedCreators('u.email')}
       ORDER BY u.email`,
    );
    expect(credentials.rows).toHaveLength(3);
    for (const { password } of credentials.rows) {
      await expect(
        verifyPassword({ hash: password, password: DEMO_PASSWORD }),
      ).resolves.toBe(true);
      await expect(
        verifyPassword({ hash: password, password: PREVIOUS_DEMO_PASSWORD }),
      ).resolves.toBe(false);
    }
  }, 180_000);

  it('keeps seeding idempotent when an existing creator has only a social account', async () => {
    runDatabaseScript('seed.ts');
    const firstCounts = await rowCounts(client);
    await client.query(
      `UPDATE account
       SET account_id = 'google-creator', provider_id = 'google', password = NULL
       WHERE user_id = (SELECT id FROM "user" WHERE email = 'creator@together.dev')
         AND provider_id = 'credential'`,
    );

    runDatabaseScript('seed.ts');

    expect(await rowCounts(client)).toEqual(firstCounts);
    const socialAccount = await client.query<{ password: string | null; provider_id: string }>(
      `SELECT password, provider_id
       FROM account
       WHERE user_id = (SELECT id FROM "user" WHERE email = 'creator@together.dev')`,
    );
    expect(socialAccount.rows).toEqual([{ password: null, provider_id: 'google' }]);
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
