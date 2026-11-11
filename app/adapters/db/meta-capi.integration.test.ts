import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ok } from '#core/domain/index.js';
import type { MetaCapiJobOutcome } from '#core/server/meta-capi-ports.js';
import { createMetaCapiRepository } from './meta-capi.js';
import { createTestDatabase } from './test-database-name.js';
import { members, metaCapiConsentEvidence, metaCapiEvents, metaCapiOutbox, orders, products, tenants, user } from './schema.js';

const now = '2026-11-01T10:00:00.000Z';
const capture = { at: now, ip: '192.0.2.1', userAgent: 'Browser', fbp: 'fb.1.1793527200000.123', textVersion: 'a'.repeat(64), textSnapshot: '{"body":"Consent"}' };
let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase('together_meta_capi', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: now })));
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'buyer', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', createdAt: now });
  await database.db.insert(products).values({ id: 'book', tenantId: 'workspace', slug: 'book', type: 'digital_download', title: 'Book', description: '', priceCents: 9900, currency: 'PLN', published: true, createdAt: now });
});
afterAll(async () => { await database?.close(); });
const makeOrder = async (id: string) => {
  await database.db.insert(orders).values({ id, tenantId: 'workspace', memberId: 'buyer', productId: 'book', kind: 'one_time', status: 'paid',
    amountCents: 9900, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: `cs_live_${id}` }, paidAt: now, createdAt: now });
  return { sessionId: `cs_live_${id}` };
};
const repository = () => createMetaCapiRepository(database.db, async () => 'https://workspace.example.org');
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
