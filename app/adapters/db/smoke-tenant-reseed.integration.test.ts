import pg from 'pg';
import { verifyPassword } from 'better-auth/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { databaseHostFingerprint } from '#adapters/crypto/database-fingerprint.js';
import { SMOKE_TENANT_CREATOR_EMAIL, SMOKE_TENANT_MEMBER_EMAIL } from '#core/domain/index.js';

import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const { spawnSync } = process.getBuiltinModule('node:child_process');
const { join } = process.getBuiltinModule('node:path');
const tsxBin = join(process.cwd(), 'node_modules/.bin/tsx');
const DEMO_PASSWORD = 'demo-password-15';
const MEMBER_PASSWORD = 'production-only-member-password';
const CREATOR_PASSWORD = 'production-only-creator-password';

let testDatabaseUrl: string;
let closeTestDatabase: () => Promise<void>;
let client: pg.Client;

const runDatabaseScript = (
  script: 'seed.ts' | 'reseed-acme.ts',
  overrides: Record<string, string> = {},
) => spawnSync(tsxBin, [`adapters/db/${script}`], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    BETTER_AUTH_SECRET: 'seed-integration-secret-at-least-32-characters',
    SEED_BASE_TIME: '2026-07-15T08:00:00.000Z',
    ...overrides,
  },
});

const runSucceeds = (
  script: 'seed.ts' | 'reseed-acme.ts',
  overrides: Record<string, string> = {},
): void => {
  const result = runDatabaseScript(script, overrides);
  expect(result.status, result.stderr || result.stdout).toBe(0);
};

const rowCounts = async (): Promise<Record<string, number>> => {
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

const idsOf = async (sql: string): Promise<string[]> => {
  const result = await client.query<{ id: string }>(sql);
  return result.rows.map(({ id }) => id);
};

const addForeignMember = async (): Promise<void> => {
  await client.query(
    `INSERT INTO members (id, tenant_id, user_id, email, display_name, created_at)
     VALUES ('member-acme-real', 'tenant-acme', 'user-real', 'kupujacy@gmail.com', 'Kupujący', NOW()::text)`,
  );
};

const addForeignMarketingConsent = async (): Promise<void> => {
  await client.query(
    `INSERT INTO consent_definitions (
       id, tenant_id, key, kind, channel, document_ref, created_at, updated_at
     ) VALUES (
       'consent-def-acme', 'tenant-acme', 'newsletter', 'optional_marketing', 'email',
       '{"documentId":"doc-acme","versionId":"doc-acme-v1"}'::jsonb, NOW(), NOW()
     )`,
  );
  await client.query(
    `INSERT INTO marketing_consents (
       id, tenant_id, email, definition_id, definition_version, wording_snapshot,
       document_ref_snapshot, status, source, evidence, occurred_at
     ) VALUES (
       'consent-acme-real', 'tenant-acme', 'zapisany@gmail.com', 'consent-def-acme', 1,
       'Zgoda marketingowa', '{"documentId":"doc-acme","versionId":"doc-acme-v1","version":1}'::jsonb,
       'granted', 'checkout', '{"ip":"127.0.0.1","userAgent":"seed","capturedAt":"2026-07-15T08:00:00.000Z"}'::jsonb,
       NOW()
     )`,
  );
};

beforeEach(async () => {
  const testDatabase = await createTestDatabase('together_acme_reseed_test', baseDatabaseUrl);
  testDatabaseUrl = testDatabase.url;
  closeTestDatabase = testDatabase.close;
  client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
  runSucceeds('seed.ts');
}, 180_000);

afterEach(async () => {
  await client.end();
  await closeTestDatabase();
}, 180_000);

describe('smoke tenant reseed', () => {
  it('rebuilds the smoke tenant and leaves the other demo tenants untouched', async () => {
    await client.query(
      `INSERT INTO courses (id, tenant_id, name, description, created_at)
       VALUES ('AUDYT-acme', 'tenant-acme', 'AUDYT acme', '', NOW()),
              ('AUDYT-studio', 'tenant-studio', 'AUDYT studio', '', NOW())`,
    );

    runSucceeds('reseed-acme.ts');

    expect(await idsOf(`SELECT id FROM courses WHERE tenant_id = 'tenant-acme' ORDER BY id`))
      .toEqual(['course-acme']);
    expect(await idsOf(`SELECT id FROM courses WHERE id = 'AUDYT-studio'`))
      .toEqual(['AUDYT-studio']);
    expect(await idsOf(`SELECT id FROM tenants ORDER BY id`))
      .toEqual(['tenant-acme', 'tenant-akademia', 'tenant-studio']);
    expect(await idsOf(
      `SELECT email AS id FROM members WHERE tenant_id = 'tenant-acme' ORDER BY email`,
    )).toEqual([SMOKE_TENANT_MEMBER_EMAIL, 'student2@together.dev']);
  }, 180_000);

  it('grants the smoke member access that is already active when the reseed commits', async () => {
    runSucceeds('reseed-acme.ts');

    expect(await idsOf(
      `SELECT id FROM product_grants WHERE tenant_id = 'tenant-acme' ORDER BY id`,
    )).toEqual(['grant-acme-smoke']);
    expect(await idsOf(
      `SELECT id FROM product_grants
       WHERE tenant_id = 'tenant-acme' AND starts_at::timestamptz <= NOW()
       ORDER BY id`,
    )).toEqual(['grant-acme-smoke']);
  }, 180_000);

  it('repeats without adding rows', async () => {
    runSucceeds('reseed-acme.ts');
    const firstCounts = await rowCounts();

    runSucceeds('reseed-acme.ts');

    expect(await rowCounts()).toEqual(firstCounts);
  }, 180_000);

  it('queues no e-mail while creating the fixture accounts', async () => {
    const queuedForFixture = async (): Promise<string[]> => idsOf(
      `SELECT "to" AS id
       FROM email_outbox
       WHERE ("to" LIKE '%@together.dev' OR "to" LIKE 'kontakt+smoke-%')
         AND tenant_id IS NULL
       ORDER BY "to"`,
    );

    expect(await queuedForFixture()).toEqual([]);

    runSucceeds('reseed-acme.ts');

    expect(await queuedForFixture()).toEqual([]);
  }, 180_000);

  it('refuses to wipe a tenant a real person joined', async () => {
    await addForeignMember();

    const result = runDatabaseScript('reseed-acme.ts');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('has a member outside @together.dev and the smoke accounts');
    expect(await idsOf(`SELECT id FROM members WHERE id = 'member-acme-real'`))
      .toEqual(['member-acme-real']);
  }, 180_000);

  it('refuses to erase a marketing consent left by a real person', async () => {
    await addForeignMarketingConsent();

    const result = runDatabaseScript('reseed-acme.ts');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('holds a marketing consent outside @together.dev and the smoke accounts');
    expect(await idsOf(
      `SELECT id FROM marketing_consents WHERE tenant_id = 'tenant-acme' ORDER BY id`,
    )).toEqual(['consent-acme-real']);
  }, 180_000);

  it('refuses the demo password when DATABASE_URL is the production database', async () => {
    const result = runDatabaseScript('reseed-acme.ts', {
      PRODUCTION_DATABASE_FINGERPRINT: databaseHostFingerprint(testDatabaseUrl) ?? '',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SMOKE_MEMBER_PASSWORD is required');
  }, 180_000);

  it('refuses to seed the creator without its own password', async () => {
    const result = runDatabaseScript('reseed-acme.ts', {
      PRODUCTION_DATABASE_FINGERPRINT: databaseHostFingerprint(testDatabaseUrl) ?? '',
      SMOKE_MEMBER_PASSWORD: MEMBER_PASSWORD,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SMOKE_CREATOR_PASSWORD is required');
  }, 180_000);

  it('seeds each smoke account with its own password against the production database', async () => {
    runSucceeds('reseed-acme.ts', {
      PRODUCTION_DATABASE_FINGERPRINT: databaseHostFingerprint(testDatabaseUrl) ?? '',
      SMOKE_MEMBER_PASSWORD: MEMBER_PASSWORD,
      SMOKE_CREATOR_PASSWORD: CREATOR_PASSWORD,
    });

    const hashFor = async (email: string): Promise<string> => {
      const credential = await client.query<{ password: string }>(
        `SELECT a.password
         FROM account a
         JOIN "user" u ON u.id = a.user_id
         WHERE a.provider_id = 'credential' AND u.email = $1`,
        [email],
      );
      return credential.rows[0]?.password ?? '';
    };

    const memberHash = await hashFor(SMOKE_TENANT_MEMBER_EMAIL);
    const creatorHash = await hashFor(SMOKE_TENANT_CREATOR_EMAIL);
    await expect(verifyPassword({ hash: memberHash, password: MEMBER_PASSWORD })).resolves.toBe(true);
    await expect(verifyPassword({ hash: memberHash, password: DEMO_PASSWORD })).resolves.toBe(false);
    await expect(verifyPassword({ hash: creatorHash, password: CREATOR_PASSWORD })).resolves.toBe(true);
    await expect(verifyPassword({ hash: creatorHash, password: MEMBER_PASSWORD })).resolves.toBe(false);
  }, 180_000);
});
