import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { memberEventSchema } from '#core/domain/index.js';

import { uniqueTestDatabaseName } from './test-database-name.js';

const TEST_DB = uniqueTestDatabaseName('together_member_event_migration_test');
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();
const NOW = '1998-08-03T10:00:00.000Z';

let pool: pg.Pool;
let partialMigrations: string;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  partialMigrations = mkdtempSync(join(tmpdir(), 'together-member-events-'));
  mkdirSync(join(partialMigrations, 'meta'));
  for (const file of readdirSync('drizzle')) {
    const prefix = /^(\d{4})_.*\.sql$/.exec(file)?.[1];
    if (prefix !== undefined && Number(prefix) <= 62) {
      copyFileSync(join('drizzle', file), join(partialMigrations, file));
    }
  }
  const journal: unknown = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  if (typeof journal !== 'object' || journal === null || !('entries' in journal)) {
    throw new Error('The drizzle journal is unreadable');
  }
  const { entries } = journal;
  if (!Array.isArray(entries)) throw new Error('The drizzle journal has no entries');
  writeFileSync(
    join(partialMigrations, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: entries.slice(0, 63) }),
  );

  pool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle(pool), { migrationsFolder: partialMigrations });
}, 60_000);

afterAll(async () => {
  await pool.end();
  rmSync(partialMigrations, { recursive: true, force: true });
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

describe('member event migration', () => {
  it('backfills existing member history into registry-valid events', async () => {
    await pool.query(
      `insert into tenants (id, slug, name, created_at) values ('tenant-history', 'history', 'History', $1)`,
      [NOW],
    );
    await pool.query(
      `insert into members (id, tenant_id, user_id, email, created_at) values ('member-history', 'tenant-history', 'user-history', 'member@example.test', $1)`,
      [NOW],
    );
    await pool.query(
      `insert into products (id, tenant_id, title, description, price_cents, currency, created_at) values ('product-history', 'tenant-history', 'Course', '', 4900, 'PLN', $1)`,
      [NOW],
    );
    await pool.query(
      `insert into product_prices (id, tenant_id, product_id, kind, interval, amount_cents, currency, created_at) values ('price-history', 'tenant-history', 'product-history', 'recurring', 'month', 4900, 'PLN', $1)`,
      [NOW],
    );
    await pool.query(
      `insert into courses (id, tenant_id, name, description, created_at) values ('course-history', 'tenant-history', 'Course', '', $1)`,
      [NOW],
    );
    await pool.query(
      `insert into orders (id, tenant_id, member_id, product_id, kind, status, amount_cents, currency, provider, provider_object_ids, created_at) values ('order-history', 'tenant-history', 'member-history', 'product-history', 'recurring', 'paid', 4900, 'PLN', 'stripe', '{}', $1)`,
      [NOW],
    );
    await pool.query(
      `insert into product_grants (id, tenant_id, member_id, product_id, source, starts_at, expires_at, created_at) values ('grant-history', 'tenant-history', 'member-history', 'product-history', 'stripe', $1, null, $1)`,
      [NOW],
    );
    await pool.query(
      `insert into member_subscriptions (id, tenant_id, member_id, product_id, price_id, provider, provider_subscription_id, status, current_period_end, created_at, updated_at) values ('subscription-history', 'tenant-history', 'member-history', 'product-history', 'price-history', 'stripe', 'sub_history', 'active', '1998-09-03T10:00:00.000Z', $1, $1)`,
      [NOW],
    );
    await pool.query(
      `insert into member_course_progress (id, tenant_id, member_id, course_id, completed_lesson_ids, updated_at) values ('progress-history', 'tenant-history', 'member-history', 'course-history', '["lesson-history"]', $1)`,
      [NOW],
    );
    await pool.query(
      `insert into email_outbox (id, tenant_id, kind, "to", payload, status, next_attempt_at, created_at, sent_at, transport) values ('email-history', 'tenant-history', 'magic-link', ' MEMBER@example.test ', '{"kind":"magic-link","language":"en","tenantName":"History","url":"https://example.test/sign-in"}', 'sent', $1, $1, $1, 'platform')`,
      [NOW],
    );
    await pool.query(
      `insert into member_events (id, tenant_id, member_id, type, reason, actor_user_id, occurred_at) values ('ban-history', 'tenant-history', 'member-history', 'banned', 'spam', 'owner-history', $1)`,
      [NOW],
    );

    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });

    const result = await pool.query<{
      id: string;
      type: string;
      payload: unknown;
      occurred_at: string;
    }>(
      `select id, type, payload, occurred_at from member_events where tenant_id = 'tenant-history' and member_id = 'member-history' order by id`,
    );
    const events = result.rows.map((row) => memberEventSchema.parse({
      id: row.id,
      tenantId: 'tenant-history',
      memberId: 'member-history',
      type: row.type,
      payload: row.payload,
      occurredAt: row.occurred_at,
    }));

    expect(events.map((event) => event.type)).toEqual([
      'banned',
      'email-sent',
      'grant',
      'lesson-completion',
      'purchase',
      'subscription-change',
    ]);
    expect(events.find((event) => event.type === 'banned')).toMatchObject({
      payload: { reason: 'spam', actorUserId: 'owner-history' },
    });
    expect(events.find((event) => event.type === 'email-sent')).toMatchObject({
      payload: { subject: 'Sign in to History' },
    });
  }, 60_000);
});
