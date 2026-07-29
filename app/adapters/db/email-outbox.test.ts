import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, internal, ok, type Member, type ProductGrant } from '#core/domain/index.js';
import { dispatchEmailBatch } from '#core/server/index.js';

import type { Db } from './client.js';
import { createEmailOutboxRepository, createEnrollmentTransactionPort, createPlatformTransactionalPool } from './email-outbox.js';
import { createEmailEventRepository } from './email-events.js';
import { createSchedulerRunRepository } from './scheduler-runs.js';
import { emailOutbox, members, productGrants, products, schedulerRuns, tenantTransactionalEmailPools, tenants } from './schema.js';
import * as dbSchema from './schema.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

const TEST_DB = uniqueTestDatabaseName('together_email_outbox_test');
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();

const NOW = '2026-07-21T12:00:00.000Z';
let db: Db;
let dbPool: pg.Pool;

afterAll(async () => {
  await dbPool.end();
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
  dbPool = new pg.Pool({ connectionString: testUrl });
  db = drizzle(dbPool, { schema: dbSchema });
  await db.insert(tenants).values({ id: 'tenant-outbox', slug: 'outbox', name: 'Outbox', createdAt: NOW });
  await db.insert(products).values({ id: 'product-outbox', tenantId: 'tenant-outbox', title: 'Course', description: '', priceCents: 0, currency: 'PLN', published: true, accessItems: [], createdAt: NOW });
}, 60000);

beforeEach(async () => {
  await db.delete(emailOutbox);
  await db.delete(tenantTransactionalEmailPools);
  await db.delete(schedulerRuns);
  await db.delete(productGrants);
  await db.delete(members);
});

let schedulerRunId = 0;
const instrumentation = () => ({
  ids: { nextId: () => `scheduler-run-${String(++schedulerRunId)}` },
  runs: createSchedulerRunRepository(db),
  trigger: 'manual' as const,
});

const payload = (url = 'https://example.test/sign-in') => ({
  kind: 'magic-link' as const,
  language: 'en',
  tenantName: 'Together',
  url,
});

const enqueue = async (id: string, now = NOW, tenantId: string | null = null) => {
  const result = await createEmailOutboxRepository(db).enqueue({ id, tenantId, to: `${id}@example.test`, payload: payload(`https://example.test/${id}`), now });
  expect(result.ok).toBe(true);
};

describe('email outbox database adapter', () => {
  it('atomically reserves only the remaining platform pool capacity', async () => {
    await db.insert(tenantTransactionalEmailPools).values({
      tenantId: 'tenant-outbox',
      sent: 998,
      reserved: 0,
    });
    const pool = createPlatformTransactionalPool(db);

    const reservations = await Promise.all(
      Array.from({ length: 5 }, () => pool.reserve('tenant-outbox', 1000)),
    );

    expect(reservations.filter(Boolean)).toHaveLength(2);
    expect(await pool.usage('tenant-outbox')).toEqual({ sent: 998, reserved: 2 });
    await Promise.all([pool.settle('tenant-outbox', true), pool.settle('tenant-outbox', false)]);
    expect(await pool.usage('tenant-outbox')).toEqual({ sent: 999, reserved: 0 });
  });

  it('reclaims platform reservations abandoned by a crashed dispatcher', async () => {
    await db.insert(tenantTransactionalEmailPools).values({
      tenantId: 'tenant-outbox',
      sent: 999,
      reserved: 1,
      reservedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    });
    const pool = createPlatformTransactionalPool(db);

    expect(await pool.usage('tenant-outbox')).toEqual({ sent: 999, reserved: 0 });
    expect(await pool.reserve('tenant-outbox', 1000)).toBe(true);
    expect(await pool.reserve('tenant-outbox', 1000)).toBe(false);
  });

  it('keeps an abandoned reservation ageing while later sends reserve and settle', async () => {
    await db.insert(tenantTransactionalEmailPools).values({
      tenantId: 'tenant-outbox',
      sent: 0,
      reserved: 1,
      reservedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
    });
    const pool = createPlatformTransactionalPool(db);

    expect(await pool.reserve('tenant-outbox', 1000)).toBe(true);
    await pool.settle('tenant-outbox', true);

    const [row] = await db.select({
      stillAgeing: sql<boolean>`${tenantTransactionalEmailPools.reservedAt} < now() - interval '13 minutes'`,
    }).from(tenantTransactionalEmailPools)
      .where(eq(tenantTransactionalEmailPools.tenantId, 'tenant-outbox'));

    expect(row?.stillAgeing).toBe(true);
    expect(await pool.usage('tenant-outbox')).toEqual({ sent: 1, reserved: 1 });
  });

  it('rolls member, grant, and outbox writes back together', async () => {
    const member: Member = { id: 'member-rollback', tenantId: 'tenant-outbox', userId: 'user-rollback', email: 'rollback@example.test', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null, bannedAt: null, bannedReason: null, bannedByUserId: null };
    const grant: ProductGrant = { id: 'grant-rollback', tenantId: 'tenant-outbox', memberId: member.id, productId: 'product-outbox', source: 'manual', startsAt: NOW, expiresAt: null, legacyId: null, createdAt: NOW };
    const result = await createEnrollmentTransactionPort(db).run(async (transaction) => {
      await transaction.members.create('tenant-outbox', member);
      await transaction.grants.createGrant('tenant-outbox', grant);
      await transaction.emailOutbox.enqueue({ id: 'email-rollback', tenantId: 'tenant-outbox', to: member.email, payload: payload(), now: NOW });
      return err(internal('forced rollback'));
    });
    expect(result).toEqual(err(internal('forced rollback')));
    expect(await db.select().from(members).where(eq(members.id, member.id))).toEqual([]);
    expect(await db.select().from(productGrants).where(eq(productGrants.id, grant.id))).toEqual([]);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.id, 'email-rollback'))).toEqual([]);
  });

  it('reclaims stale sending rows without touching fresh leases or exceeding the attempts cap', async () => {
    await Promise.all([
      enqueue('stale-sending'),
      enqueue('fresh-sending'),
      enqueue('exhausted-sending', NOW, 'tenant-outbox'),
    ]);
    const staleAt = new Date(Date.parse(NOW) - 16 * 60 * 1000).toISOString();
    await db
      .update(emailOutbox)
      .set({ status: 'sending', nextAttemptAt: staleAt })
      .where(eq(emailOutbox.id, 'stale-sending'));
    await db
      .update(emailOutbox)
      .set({ status: 'sending', nextAttemptAt: NOW })
      .where(eq(emailOutbox.id, 'fresh-sending'));
    await db
      .update(emailOutbox)
      .set({ status: 'sending', attempts: 2, nextAttemptAt: staleAt })
      .where(eq(emailOutbox.id, 'exhausted-sending'));

    const sent: string[] = [];
    const result = await dispatchEmailBatch({
      emailOutbox: createEmailOutboxRepository(db, 3),
      events: createEmailEventRepository(db),
      email: {
        send: async (message) => {
          sent.push(message.to);
          return ok({ messageId: message.to, transport: 'platform' as const });
        },
      },
      clock: { nowIso: () => NOW },
      logger: console,
      batchSize: 10,
      attemptsCap: 3,
      backoffBaseMs: 1000,
      backoffCapMs: 10000,
      ...instrumentation(),
    });

    expect(result).toEqual(ok({ attemptsMade: 1, sentCount: 1, failedCount: 0 }));
    expect(sent).toEqual(['stale-sending@example.test']);
    const rows = await db.select().from(emailOutbox);
    expect(rows.find((row) => row.id === 'stale-sending')).toMatchObject({
      status: 'sent',
      attempts: 1,
    });
    const fresh = rows.find((row) => row.id === 'fresh-sending');
    expect(fresh).toMatchObject({
      status: 'sending',
      attempts: 0,
    });
    expect(new Date(fresh?.nextAttemptAt ?? '').toISOString()).toBe(NOW);
    expect(rows.find((row) => row.id === 'exhausted-sending')).toMatchObject({
      status: 'failed',
      attempts: 3,
    });
    await expect(
      createEmailOutboxRepository(db, 3).hasPendingForTenant?.('tenant-outbox'),
    ).resolves.toBe(false);
  });

  it('never sends a row twice when dispatchers race', async () => {
    await enqueue('race-one');
    const sent: string[] = [];
    const deps = {
      emailOutbox: createEmailOutboxRepository(db),
      events: createEmailEventRepository(db),
      email: { send: async (message: { to: string }) => { sent.push(message.to); return ok({ messageId: message.to, transport: 'platform' as const }); } },
      clock: { nowIso: () => NOW },
      logger: console,
      batchSize: 10,
      attemptsCap: 3,
      backoffBaseMs: 1000,
      backoffCapMs: 10000,
      ...instrumentation(),
    };
    await Promise.all([dispatchEmailBatch(deps), dispatchEmailBatch(deps)]);
    expect(sent.filter((to) => to === 'race-one@example.test')).toHaveLength(1);
  });

  it('limits a claim to the configured batch size', async () => {
    await Promise.all(Array.from({ length: 5 }, (_, index) => enqueue(`rate-${String(index)}`)));
    const result = await dispatchEmailBatch({
      emailOutbox: createEmailOutboxRepository(db),
      events: createEmailEventRepository(db),
      email: { send: async (message: { to: string }) => ok({ messageId: message.to, transport: 'platform' as const }) },
      clock: { nowIso: () => NOW },
      logger: console,
      batchSize: 2,
      attemptsCap: 3,
      backoffBaseMs: 1000,
      backoffCapMs: 10000,
      ...instrumentation(),
    });
    expect(result).toEqual(ok({ attemptsMade: 2, sentCount: 2, failedCount: 0 }));
  });

  it('backs off exponentially and logs a terminal failure at the attempts cap', async () => {
    const id = 'terminal-failure';
    await enqueue(id);
    let now = NOW;
    const logger = { error: vi.fn() };
    const deps = {
      emailOutbox: createEmailOutboxRepository(db),
      events: createEmailEventRepository(db),
      email: { send: async () => err(internal('sender unavailable')) },
      clock: { nowIso: () => now },
      logger,
      batchSize: 1,
      attemptsCap: 3,
      backoffBaseMs: 1000,
      backoffCapMs: 10000,
      ...instrumentation(),
    };
    const nextTimes: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await dispatchEmailBatch(deps);
      const row = (await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];
      expect(row).toBeDefined();
      nextTimes.push(row?.nextAttemptAt ?? '');
      now = row === undefined ? now : new Date(row.nextAttemptAt).toISOString();
    }
    expect(Date.parse(nextTimes[1] ?? '') - Date.parse(nextTimes[0] ?? '')).toBe(2000);
    const row = (await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 3, lastError: 'sender unavailable' });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
