import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, internal, ok, type Member, type ProductGrant } from '@core/domain/index.js';
import { dispatchEmailBatch } from '@core/server/index.js';

import { createDb, type Db } from './client.js';
import { createEmailOutboxRepository, createEnrollmentTransactionPort } from './email-outbox.js';
import { createEmailEventRepository } from './email-events.js';
import { emailOutbox, members, productGrants, products, tenants } from './schema.js';

const TEST_DB = 'together_email_outbox_test';
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();

const NOW = '2026-07-21T12:00:00.000Z';
let db: Db;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
  db = createDb('node-postgres', testUrl);
  await db.insert(tenants).values({ id: 'tenant-outbox', slug: 'outbox', name: 'Outbox', createdAt: NOW });
  await db.insert(products).values({ id: 'product-outbox', tenantId: 'tenant-outbox', title: 'Course', description: '', priceCents: 0, currency: 'PLN', published: true, accessItems: [], createdAt: NOW });
}, 60000);

beforeEach(async () => {
  await db.delete(emailOutbox);
  await db.delete(productGrants);
  await db.delete(members);
});

const payload = (url = 'https://example.test/sign-in') => ({
  kind: 'magic-link' as const,
  language: 'en',
  tenantName: 'Together',
  url,
});

const enqueue = async (id: string, now = NOW) => {
  const result = await createEmailOutboxRepository(db).enqueue({ id, tenantId: null, to: `${id}@example.test`, payload: payload(`https://example.test/${id}`), now });
  expect(result.ok).toBe(true);
};

describe('email outbox database adapter', () => {
  it('rolls member, grant, and outbox writes back together', async () => {
    const member: Member = { id: 'member-rollback', tenantId: 'tenant-outbox', userId: 'user-rollback', email: 'rollback@example.test', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null };
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

  it('never sends a row twice when dispatchers race', async () => {
    await enqueue('race-one');
    const sent: string[] = [];
    const deps = {
      emailOutbox: createEmailOutboxRepository(db),
      events: createEmailEventRepository(db),
      email: { send: async (message: { to: string }) => { sent.push(message.to); return ok({ messageId: message.to }); } },
      clock: { nowIso: () => NOW },
      logger: console,
      batchSize: 10,
      attemptsCap: 3,
      backoffBaseMs: 1000,
      backoffCapMs: 10000,
    };
    await Promise.all([dispatchEmailBatch(deps), dispatchEmailBatch(deps)]);
    expect(sent.filter((to) => to === 'race-one@example.test')).toHaveLength(1);
  });

  it('limits a claim to the configured batch size', async () => {
    await Promise.all(Array.from({ length: 5 }, (_, index) => enqueue(`rate-${String(index)}`)));
    const result = await dispatchEmailBatch({
      emailOutbox: createEmailOutboxRepository(db),
      events: createEmailEventRepository(db),
      email: { send: async (message: { to: string }) => ok({ messageId: message.to }) },
      clock: { nowIso: () => NOW },
      logger: console,
      batchSize: 2,
      attemptsCap: 3,
      backoffBaseMs: 1000,
      backoffCapMs: 10000,
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
    };
    const nextTimes: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await dispatchEmailBatch(deps);
      const row = (await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];
      expect(row).toBeDefined();
      nextTimes.push(row?.nextAttemptAt ?? '');
      now = row?.nextAttemptAt ?? now;
    }
    expect(Date.parse(nextTimes[1] ?? '') - Date.parse(nextTimes[0] ?? '')).toBe(2000);
    const row = (await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 3, lastError: 'sender unavailable' });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
