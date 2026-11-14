import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { DELETED_MEMBER_DISPLAY, memberTombstone, ok } from '#core/domain/index.js';
import type { MetaCapiJobOutcome } from '#core/server/meta-capi-ports.js';
import { dispatchMetaCapi } from '#core/server/usecases/meta-capi.js';
import { createMemberErasureRepository, createTenantDirectory, createTenantRepository } from './repositories.js';
import { createMetaCapiRepository } from './meta-capi.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createTestDatabase } from './test-database-name.js';
import * as schema from './schema.js';
import { members, metaCapiConsentEvidence, metaCapiEvents, metaCapiOutbox, orders, products, tenants, user } from './schema.js';
import type { Db } from './client.js';

const now = '2026-11-01T10:00:00.000Z';
const capture = { at: now, ip: '192.0.2.1', userAgent: 'Browser', fbp: 'fb.1.1793527200000.123', textVersion: 'a'.repeat(64), textSnapshot: '{"body":"Consent"}' };
let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase('together_meta_capi', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: now, analyticsMetaCapiEnabled: true, analyticsMetaPixelId: '1234567890', privacyUrl: 'https://example.org/privacy' })));
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'buyer', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', createdAt: now });
  await database.db.insert(products).values({ id: 'book', tenantId: 'workspace', slug: 'book', type: 'digital_download', title: 'Book', description: '', priceCents: 9900, currency: 'PLN', published: true, createdAt: now });
});
afterAll(async () => { await database?.close(); });
const makeOrder = async (id: string, tenantId = 'workspace', memberId = 'buyer', productId = 'book') => {
  await database.db.insert(orders).values({ id, tenantId, memberId, productId, kind: 'one_time', status: 'paid',
    amountCents: 9900, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: `cs_live_${id}` }, paidAt: now, createdAt: now });
  return { sessionId: `cs_live_${id}` };
};
const readersAt = (origin: string) => (connection: Db) => ({ tenants: createTenantRepository(connection),
  secrets: { resolve: async () => ok('test-token') }, resolveOrigin: async () => origin });
const repository = () => createMetaCapiRepository(database.db, readersAt('https://workspace.example.org'));
const sent = (id: string): MetaCapiJobOutcome => ({ event: { tenantId: 'workspace', transactionId: id, orderId: id, consentAt: now,
  eventTime: now, sentAt: now, recordedAt: now, status: 'sent', fbtraceId: 'trace', error: null, fieldsSent: ['user_data.em'] } });

describe('durable Meta consent and outbox', () => {
  it('atomically records the first choice and one outbox row across concurrent decisions', async () => {
    const access = await makeOrder('concurrent');
    const repo = repository();
    await Promise.all(Array.from({ length: 5 }, () => repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }))));
    await repo.decide('workspace', access, async () => ok({ decision: 'denied', capture }));
    expect((await repo.findOrder('workspace', access))?.consent).toEqual({ consent: 'granted', withdrawnAt: null });
    expect(await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'concurrent'))).toHaveLength(1);
    expect(await database.db.select().from(metaCapiConsentEvidence).where(eq(metaCapiConsentEvidence.orderId, 'concurrent'))).toHaveLength(1);
    const send = vi.fn(async () => sent('concurrent'));
    await Promise.all([repo.processNext('workspace', now, send), repo.processNext('workspace', now, send)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await repo.listEvents('workspace')).toMatchObject([{ transactionId: 'concurrent', status: 'sent' }]);
    expect(await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'concurrent'))).toHaveLength(0);
  });
  it('withdraws before a retry and prevents regranting or mutating an existing sent receipt', async () => {
    const access = await makeOrder('withdraw');
    const repo = repository();
    await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }));
    await repo.processNext('workspace', now, async () => ({ retryAt: '2026-11-01T10:01:00.000Z' }));
    await repo.decide('workspace', access, async () => ok({ decision: 'withdrawn', capture }));
    await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }));
    const send = vi.fn(async () => sent('withdraw'));
    await repo.processNext('workspace', '2026-11-01T10:02:00.000Z', send);
    expect(send).not.toHaveBeenCalled();
    expect((await repo.findOrder('workspace', access))?.consent.withdrawnAt).toBe(now);
    const sentAccess = await makeOrder('alreadysent');
    await repo.decide('workspace', sentAccess, async () => ok({ decision: 'granted', capture }));
    await repo.processNext('workspace', now, async () => sent('alreadysent'));
    await repo.decide('workspace', sentAccess, async () => ok({ decision: 'withdrawn', capture }));
    expect((await database.db.select().from(metaCapiEvents).where(eq(metaCapiEvents.transactionId, 'alreadysent')))[0]?.status).toBe('sent');
  });
  it('enforces tenant and member ownership and the order-link credential', async () => {
    const access = await makeOrder('ownership');
    const repo = repository();
    expect(await repo.findOrder('other', access)).toBeNull();
    expect(await repo.decide('other', access, async () => ok({ decision: 'granted', capture }))).toMatchObject({ ok: false });
    expect(await repo.findOrder('workspace', { orderId: 'ownership', memberId: 'stranger' })).toBeNull();
    const row = (await database.db.select().from(orders).where(eq(orders.id, 'ownership')))[0];
    expect(row).toBeDefined();
    expect((await repo.findOrder('workspace', { orderToken: row?.verificationToken ?? '' }))?.order.id).toBe('ownership');
    expect(await repo.listEvents('other')).toEqual([]);
    await expect(database.db.insert(metaCapiOutbox).values({ tenantId: 'other', orderId: 'ownership', availableAt: now, consentAt: now, textVersion: 'version', textSnapshot: '{}' })).rejects.toThrow();
  });
  it('never creates a pending send for a refusal and retains its evidence', async () => {
    const access = await makeOrder('denied');
    const repo = repository();
    await repo.decide('workspace', access, async () => ok({ decision: 'denied', capture }));
    expect(await repo.listMemberConsents('workspace', 'buyer')).toContainEqual({ orderId: 'denied', consent: 'denied', consentAt: now, withdrawnAt: null });
    expect(await repo.listMemberConsents('other', 'buyer')).toEqual([]);
    expect(await repo.listMemberConsents('workspace', 'stranger')).toEqual([]);
    expect(await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'denied'))).toEqual([]);
    expect((await database.db.select().from(metaCapiEvents).where(eq(metaCapiEvents.transactionId, 'denied')))[0]).toMatchObject({ status: 'blocked', fieldsSent: [] });
    expect((await database.db.select().from(metaCapiConsentEvidence).where(eq(metaCapiConsentEvidence.orderId, 'denied')))[0]).toMatchObject({ textSnapshot: capture.textSnapshot, source: 'return-page' });
  });
});

const erase = async (memberId: string) => {
  const tombstone = memberTombstone(memberId);
  return createMemberErasureRepository(database.db, { compute: () => 'email-hmac' }).pseudonymize('workspace', {
    memberId, deletedAt: now, tombstoneEmail: tombstone.email, severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
  });
};
const memberOrder = async (id: string, tenantId = 'workspace') => {
  await database.db.insert(user).values({ id, name: 'Buyer', email: id + '@example.org' });
  await database.db.insert(members).values({ id, tenantId, userId: id, email: id + '@example.org', createdAt: now });
  await database.db.insert(products).values({ id, tenantId, slug: id, type: 'digital_download', title: 'Book', description: '', priceCents: 9900, currency: 'PLN', published: true, createdAt: now });
  return makeOrder(id, tenantId, id, id);
};
const dispatchHarness = (repo = repository()) => {
  let time = now;
  const send = vi.fn(async () => ({ ok: true as const, fbtraceId: 'trace' }));
  const warn = vi.fn();
  const deps = { repository: repo, tenants: createTenantRepository(database.db), directory: createTenantDirectory(database.db),
    clock: { nowIso: () => time }, hash: { sha256: () => 'a'.repeat(64) }, secrets: { resolve: async () => ok('test-token') }, gateway: { send }, logger: { warn } };
  return { deps, send, warn, setTime: (value: string) => { time = value; } };
};

describe('Meta privacy and failure isolation', () => {
  it('redacts a failed outbox insert and rolls back consent with its identifiers', async () => {
    const access = await makeOrder('insertfailure');
    const repo = repository();
    await database.db.execute(sql`CREATE FUNCTION reject_meta_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Private capture: % % %', NEW.ip, NEW.user_agent, NEW.fbp USING ERRCODE = '57014'; END;
    $$`);
    await database.db.execute(sql`CREATE TRIGGER reject_meta_insert BEFORE INSERT ON meta_capi_outbox
      FOR EACH ROW EXECUTE FUNCTION reject_meta_insert()`);
    try {
      const error: unknown = await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }))
        .catch((cause: unknown) => cause);
      if (!(error instanceof Error)) throw new Error('Expected an outbox insertion failure');
      expect(error.message).toBe('Meta CAPI database operation failed');
      expect(error.cause).toEqual(new Error('PostgreSQL SQLSTATE 57014'));
      for (const identifier of [access.sessionId, capture.ip, capture.userAgent, capture.fbp]) {
        expect(error.stack).not.toContain(identifier);
        expect(String(error.cause)).not.toContain(identifier);
        if (error.cause instanceof Error) {
          expect(error.cause.stack).not.toContain(identifier);
          expect(error.cause.cause).toBeUndefined();
        }
      }
      expect((await repo.findOrder('workspace', access))?.consent.consent).toBe('undecided');
      expect(await database.db.select().from(metaCapiConsentEvidence).where(eq(metaCapiConsentEvidence.orderId, 'insertfailure'))).toEqual([]);
      expect(await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'insertfailure'))).toEqual([]);
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_meta_insert ON meta_capi_outbox`);
      await database.db.execute(sql`DROP FUNCTION reject_meta_insert()`);
    }
  });
  it('withdraws and deletes pending identifiers during erasure without changing another tenant', async () => {
    const access = await memberOrder('erased');
    const other = await memberOrder('retained', 'other');
    const repo = repository();
    await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }));
    await repo.decide('other', other, async () => ok({ decision: 'granted', capture }));
    await erase('erased');
    expect((await repo.findOrder('workspace', access))?.consent.withdrawnAt).toBe(now);
    expect(await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'erased'))).toEqual([]);
    const evidence = await database.db.select().from(metaCapiConsentEvidence).where(eq(metaCapiConsentEvidence.orderId, 'erased'));
    expect(evidence).toHaveLength(2);
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: 'granted', source: 'return-page', textVersion: capture.textVersion, textSnapshot: capture.textSnapshot }),
      expect.objectContaining({ decision: 'withdrawn', source: 'member-erasure', textVersion: capture.textVersion, textSnapshot: capture.textSnapshot }),
    ]));
    expect((await repo.findOrder('other', other))?.consent).toEqual({ consent: 'granted', withdrawnAt: null });
    const dispatch = dispatchHarness(repo);
    await dispatchMetaCapi(dispatch.deps);
    expect(dispatch.send).toHaveBeenCalledTimes(1);
    expect(await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }))).toMatchObject({ ok: false });
    expect(await repo.listEvents('other')).toMatchObject([{ transactionId: 'retained', status: 'sent' }]);
  });
  it('defensively blocks a job whose member was deleted outside the erasure transaction', async () => {
    const access = await memberOrder('deleteddefensive');
    const repo = repository();
    await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }));
    await database.db.update(members).set({ deletedAt: now }).where(and(eq(members.tenantId, 'workspace'), eq(members.id, 'deleteddefensive')));
    const dispatch = dispatchHarness(repo);
    await dispatchMetaCapi(dispatch.deps);
    expect(dispatch.send).not.toHaveBeenCalled();
    expect(await repo.listEvents('workspace')).toContainEqual(expect.objectContaining({ transactionId: 'deleteddefensive', status: 'blocked' }));
  });
  it('backs off a poisoned first row, sends the next job and tenant, and terminates after four attempts', async () => {
    const warn = vi.fn();
    const repo = createMetaCapiRepository(database.db, readersAt('https://example.org'), { warn });
    for (const id of ['poison', 'following']) {
      const access = await makeOrder(id);
      await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }));
    }
    const other = await memberOrder('nexttenant', 'other');
    await repo.decide('other', other, async () => ok({ decision: 'granted', capture }));
    await database.db.update(metaCapiOutbox).set({ availableAt: '2026-11-01T09:00:00.000Z' }).where(eq(metaCapiOutbox.orderId, 'poison'));
    await database.db.execute(sql`UPDATE orders SET lines = '[{"private":"buyer@example.org"}]'::jsonb WHERE id = 'poison' AND tenant_id = 'workspace'`);
    const dispatch = dispatchHarness(repo);
    expect(await dispatchMetaCapi(dispatch.deps)).toEqual({ processed: 3 });
    expect(dispatch.send).toHaveBeenCalledTimes(2);
    const pending = await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'poison'));
    expect(pending[0]?.attempts).toBe(1);
    expect(new Date(pending[0]?.availableAt ?? '').toISOString()).toBe('2026-11-01T10:01:00.000Z');
    for (const at of ['2026-11-01T10:01:00.000Z', '2026-11-01T10:03:00.000Z', '2026-11-01T10:07:00.000Z']) {
      dispatch.setTime(at); await dispatchMetaCapi(dispatch.deps);
    }
    expect(await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'poison'))).toEqual([]);
    expect(await repo.listEvents('workspace')).toContainEqual(expect.objectContaining({ transactionId: 'poison', status: 'failed', error: 'job_processing_failed', fieldsSent: [] }));
    expect(warn.mock.calls).toEqual(Array.from({ length: 4 }, () => ['[meta-capi] job_processing_failed']));
    expect(dispatch.send).toHaveBeenCalledTimes(2);
  });
  it('holds the order lock across send so erasure cannot finish mid-delivery', async () => {
    const access = await memberOrder('racing');
    const repo = repository();
    await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }));
    let signalEntered: () => void = () => undefined;
    let signalRelease: () => void = () => undefined;
    const entered = { promise: new Promise<void>((resolve) => { signalEntered = () => { resolve(); }; }), resolve: () => signalEntered() };
    const release = { promise: new Promise<void>((resolve) => { signalRelease = () => { resolve(); }; }), resolve: () => signalRelease() };
    const sending = repo.processNext('workspace', now, async () => { entered.resolve(); await release.promise; return sent('racing'); });
    await entered.promise;
    let erased = false;
    const erasure = erase('racing').then(() => { erased = true; });
    try {
      await vi.waitFor(async () => {
        const rows = await database.db.execute(sql`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%meta_capi_consent_withdrawn_at%'`);
        expect(rows).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ pid: expect.any(Number) })]) });
      });
      expect(erased).toBe(false);
    } finally { release.resolve(); await sending; await erasure; }
    expect((await repo.findOrder('workspace', access))?.consent.withdrawnAt).toBe(now);
    expect((await repo.listEvents('workspace')).find((event) => event.transactionId === 'racing')?.status).toBe('sent');
    const send = vi.fn(async () => sent('racing'));
    await repo.processNext('workspace', now, send);
    expect(send).not.toHaveBeenCalled();
  });
});

it('keeps an older active grant withdrawable ahead of more than 100 newer decisions', async () => {
  const access = await memberOrder('activeconsents');
  const repo = repository();
  await repo.decide('workspace', access, async () => ok({ decision: 'granted', capture }));
  const withdrawnAccess = await makeOrder('withdrawnconsent', 'workspace', 'activeconsents', 'activeconsents');
  await repo.decide('workspace', withdrawnAccess, async () => ok({ decision: 'granted', capture }));
  await repo.decide('workspace', withdrawnAccess, async () => ok({ decision: 'withdrawn', capture }));
  const ids = Array.from({ length: 101 }, (_, index) => `newdenial${String(index).padStart(3, '0')}`);
  await database.db.insert(orders).values(ids.map((id) => ({ id, tenantId: 'workspace', memberId: 'activeconsents', productId: 'activeconsents',
    kind: 'one_time' as const, status: 'paid' as const, amountCents: 100, currency: 'PLN', provider: 'stripe' as const,
    providerObjectIds: {}, createdAt: '2026-11-02T10:00:00.000Z', metaCapiConsent: 'denied' as const, metaCapiConsentAt: now })));
  const consents = await repo.listMemberConsents('workspace', 'activeconsents');
  expect(consents).toHaveLength(100);
  expect(consents.map(({ orderId }) => orderId)).toEqual(['activeconsents', ...[...ids].reverse().slice(0, 99)]);
  expect(consents[0]).toMatchObject({ consent: 'granted', withdrawnAt: null });
  const orderId = consents[0]?.orderId;
  if (!orderId) throw new Error('Missing active consent');
  expect(await repo.decide('workspace', { orderId, memberId: 'activeconsents' }, async () => ok({ decision: 'withdrawn', capture })))
    .toEqual(ok({ consent: 'granted', withdrawnAt: now }));
  expect((await repo.findOrder('workspace', access))?.consent.withdrawnAt).toBe(now);
  expect(await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, orderId))).toEqual([]);
  expect((await repo.listMemberConsents('workspace', 'activeconsents')).map((row) => row.orderId)).toEqual([...ids].reverse().slice(0, 100));
});

it('normalizes offset timestamps and applies stable bounded event and consent ordering', async () => {
  const access = await memberOrder('lists');
  const repo = repository();
  await repo.decide('workspace', access, async () => ok({ decision: 'denied', capture: { ...capture, at: '2026-11-01T12:00:00+02:00' } }));
  expect((await repo.findOrder('workspace', access))?.consentAt).toBe(now);
  const ids = Array.from({ length: 101 }, (_, index) => `list${String(index).padStart(3, '0')}`);
  await database.db.insert(orders).values(ids.map((id) => ({ id, tenantId: 'workspace', memberId: 'lists', productId: 'lists',
    kind: 'one_time' as const, status: 'paid' as const, amountCents: 100, currency: 'PLN', provider: 'stripe' as const,
    providerObjectIds: {}, createdAt: '2026-11-02T10:00:00.000Z', metaCapiConsent: 'denied' as const, metaCapiConsentAt: now })));
  await database.db.insert(metaCapiEvents).values(ids.map((id) => ({ tenantId: 'workspace', orderId: id, transactionId: id,
    consentAt: now, eventTime: now, recordedAt: '2026-11-02T12:00:00+02:00', sentAt: null, status: 'blocked' as const, fieldsSent: [] })));
  const expected = [...ids].reverse().slice(0, 100);
  expect((await repo.listMemberConsents('workspace', 'lists')).map((row) => row.orderId)).toEqual(expected);
  const events = await repo.listEvents('workspace');
  expect(events.map((row) => row.transactionId)).toEqual(expected);
  expect(events[0]?.recordedAt).toBe('2026-11-02T10:00:00.000Z');
});

it('records a withdrawal with the consent text the buyer granted, falling back to the request text without a grant', async () => {
  const repo = repository();
  const shown = { ...capture, textVersion: 'b'.repeat(64), textSnapshot: '{"body":"Shown consent in Polish"}' };
  const request = { ...capture, textVersion: 'c'.repeat(64), textSnapshot: '{"body":"Default consent"}' };
  const granted = await makeOrder('withdrawgranted');
  await repo.decide('workspace', granted, async () => ok({ decision: 'granted', capture: shown }));
  await repo.decide('workspace', granted, async () => ok({ decision: 'withdrawn', capture: request }));
  const ungranted = await makeOrder('withdrawungranted');
  await repo.decide('workspace', ungranted, async () => ok({ decision: 'withdrawn', capture: request }));
  const withdrawal = async (orderId: string) => (await database.db.select().from(metaCapiConsentEvidence)
    .where(and(eq(metaCapiConsentEvidence.orderId, orderId), eq(metaCapiConsentEvidence.decision, 'withdrawn'))))[0];
  expect(await withdrawal('withdrawgranted')).toMatchObject({ textVersion: shown.textVersion, textSnapshot: shown.textSnapshot });
  expect(await withdrawal('withdrawungranted')).toMatchObject({ textVersion: request.textVersion, textSnapshot: request.textSnapshot });
});

it('lists each tenant with a due outbox row once and skips tenants whose rows are not due yet', async () => {
  const early = '2026-10-30T00:00:00.000Z';
  await memberOrder('dueother', 'other');
  for (const id of ['duefirst', 'duesecond']) await makeOrder(id);
  const rows = [['workspace', 'duefirst', early], ['workspace', 'duesecond', early], ['other', 'dueother', '2026-10-30T12:00:00.000Z']] as const;
  await database.db.insert(metaCapiOutbox).values(rows.map(([tenantId, orderId, availableAt]) => ({ tenantId, orderId, availableAt, consentAt: early, textVersion: 'version', textSnapshot: '{}' })));
  try {
    expect(await repository().listDueTenantIds('2026-10-30T06:00:00.000Z')).toEqual(['workspace']);
    expect((await repository().listDueTenantIds('2026-10-30T12:00:00.000Z')).sort()).toEqual(['other', 'workspace']);
    expect(await repository().listDueTenantIds('2026-10-29T23:59:59.000Z')).toEqual([]);
  } finally {
    await database.db.delete(metaCapiOutbox).where(sql`${metaCapiOutbox.orderId} in ('duefirst', 'duesecond', 'dueother')`);
  }
});

it('looks up a return-page session through the checkout-session index', async () => {
  const access = await makeOrder('indexed');
  const pool = new pg.Pool({ connectionString: database.url });
  const queries: { query: string; params: unknown[] }[] = [];
  try {
    const logged = drizzle(pool, { schema, logger: { logQuery: (query, params) => { queries.push({ query, params }); } } });
    expect((await createMetaCapiRepository(logged, readersAt('https://workspace.example.org')).findOrder('workspace', access))?.order.id).toBe('indexed');
    const lookup = queries.find(({ query }) => query.includes('checkoutSession'));
    if (lookup === undefined) throw new Error('Missing checkout-session lookup');
    const client = await pool.connect();
    try {
      await client.query('SET enable_seqscan = off');
      const plan = await client.query(`EXPLAIN ${lookup.query}`, lookup.params);
      expect(JSON.stringify(plan.rows)).toContain('orders_tenant_provider_checkout_uidx');
    } finally { client.release(); }
  } finally { await pool.end(); }
});
