import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const { spawnSync } = process.getBuiltinModule('node:child_process');
const { join } = process.getBuiltinModule('node:path');
const tsxBin = join(process.cwd(), 'node_modules/.bin/tsx');
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

    expect(auditCourse.rowCount).toBe(0);
    expect(course.rows).toEqual([{ module_order: [] }]);
    expect(progress.rows).toEqual([
      {
        completed_lesson_ids: ['lesson-js-zmienne-1', 'lesson-js-zmienne-2'],
        last_viewed_lesson_id: 'lesson-js-funkcje-1',
      },
    ]);
  }, 180_000);
});
