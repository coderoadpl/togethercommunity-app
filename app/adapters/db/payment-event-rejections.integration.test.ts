import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPaymentEventRejectionRepository } from './payment-event-rejections.js';
import { members, orders, paymentEventRejections, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-11-20T10:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const rejection = (eventId: string, seenAt: string, reasonMessage = 'Checkout snapshot not found') => ({
  eventId,
  eventType: 'checkout.session.completed',
  checkoutSessionId: `cs_${eventId}`,
  reasonCode: 'validation' as const,
  reasonMessage,
  seenAt,
});

beforeAll(async () => {
  database = await createTestDatabase('together_payment_event_rejections', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: 'tenant-acme', slug: 'acme', name: 'Acme', createdAt: now },
    { id: 'tenant-studio', slug: 'studio', name: 'Studio', createdAt: now },
  ]);
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  for (const tenantId of ['tenant-acme', 'tenant-studio']) {
    await database.db.insert(members).values({ id: `member-${tenantId}`, tenantId, userId: 'buyer', email: 'buyer@example.org', createdAt: now });
    await database.db.insert(products).values({
      id: `product-${tenantId}`, tenantId, description: '', slug: 'course', title: 'Course', priceCents: 4900, currency: 'PLN', published: true, createdAt: now,
    });
  }
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
  await database.db.delete(paymentEventRejections);
  await database.db.delete(orders);
});

const insertOrder = (tenantId: string, checkoutSession: string, mode: 'live' | 'test') => database.db.insert(orders).values({
  id: `order-${tenantId}-${checkoutSession}-${mode}`, tenantId, mode, memberId: `member-${tenantId}`, productId: `product-${tenantId}`, kind: 'one_time',
  status: 'paid', amountCents: 4900, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession }, createdAt: now,
});

describe('payment event rejection repository', () => {
  it('creates the record on the first refusal and counts later refusals of the same event', async () => {
    const repository = createPaymentEventRejectionRepository(database.db);

    const first = await repository.record('tenant-acme', rejection('evt_1', now));
    const third = await repository.record('tenant-acme', rejection('evt_1', '2026-11-20T11:00:00.000Z'))
      .then(() => repository.record('tenant-acme', rejection('evt_1', '2026-11-20T12:00:00.000Z', 'Checkout total does not match its lines')));

    expect(first).toEqual({
      tenantId: 'tenant-acme', eventId: 'evt_1', eventType: 'checkout.session.completed', checkoutSessionId: 'cs_evt_1',
      reasonCode: 'validation', reasonMessage: 'Checkout snapshot not found',
      firstSeenAt: now, lastSeenAt: now, attempts: 1, resolvedAt: null,
    });
    expect(third).toMatchObject({
      firstSeenAt: now, lastSeenAt: '2026-11-20T12:00:00.000Z', attempts: 3, reasonMessage: 'Checkout total does not match its lines',
    });
    expect(await database.db.select().from(paymentEventRejections)).toHaveLength(1);
  });

  it('keeps the earliest first sighting, the latest last sighting and the latest reason when refusals arrive out of order', async () => {
    const repository = createPaymentEventRejectionRepository(database.db);
    const later = '2026-11-20T12:00:00.000Z';

    await repository.record('tenant-acme', { ...rejection('evt_late', later, 'Checkout total does not match its lines'), eventType: 'checkout.session.async_payment_succeeded' });
    const recorded = await repository.record('tenant-acme', rejection('evt_late', now));

    expect(recorded).toMatchObject({
      firstSeenAt: now, lastSeenAt: later, attempts: 2,
      eventType: 'checkout.session.async_payment_succeeded', reasonMessage: 'Checkout total does not match its lines',
    });
  });

  it('keeps the same event id of two workspaces apart', async () => {
    const repository = createPaymentEventRejectionRepository(database.db);

    await repository.record('tenant-acme', rejection('evt_shared', now));
    await repository.record('tenant-studio', rejection('evt_shared', now));
    await repository.resolve('tenant-studio', 'evt_shared', '2026-11-20T11:00:00.000Z');

    expect(await repository.listUnresolved('tenant-acme', 10)).toMatchObject([{ tenantId: 'tenant-acme', eventId: 'evt_shared', attempts: 1 }]);
    expect(await repository.listUnresolved('tenant-studio', 10)).toEqual([]);
  });

  it('resolves once, lists only unresolved records newest first, and reopens a resolved record that is refused again', async () => {
    const repository = createPaymentEventRejectionRepository(database.db);
    await repository.record('tenant-acme', rejection('evt_old', now));
    await repository.record('tenant-acme', rejection('evt_new', '2026-11-20T11:00:00.000Z'));
    await repository.record('tenant-acme', rejection('evt_done', now));

    await repository.resolve('tenant-acme', 'evt_done', '2026-11-20T12:00:00.000Z');
    await repository.resolve('tenant-acme', 'evt_done', '2026-11-20T13:00:00.000Z');

    expect((await repository.listUnresolved('tenant-acme', 10)).map((row) => row.eventId)).toEqual(['evt_new', 'evt_old']);
    expect((await repository.listUnresolved('tenant-acme', 1)).map((row) => row.eventId)).toEqual(['evt_new']);
    const [done] = await database.db.select().from(paymentEventRejections).where(eq(paymentEventRejections.eventId, 'evt_done'));
    expect(done?.resolvedAt === null ? null : new Date(done?.resolvedAt ?? '').toISOString()).toBe('2026-11-20T12:00:00.000Z');

    expect(await repository.record('tenant-acme', rejection('evt_done', '2026-11-20T14:00:00.000Z'))).toMatchObject({ attempts: 2, resolvedAt: null });
  });

  it('leaves out an unresolved record whose checkout session now has a live order of the same workspace', async () => {
    const repository = createPaymentEventRejectionRepository(database.db);
    await repository.record('tenant-acme', rejection('evt_ordered', now));
    await repository.record('tenant-acme', rejection('evt_test_order', now));
    await repository.record('tenant-acme', rejection('evt_other_workspace', now));
    await repository.record('tenant-acme', { ...rejection('evt_no_session', now), checkoutSessionId: null });
    await insertOrder('tenant-acme', 'cs_evt_ordered', 'live');
    await insertOrder('tenant-acme', 'cs_evt_test_order', 'test');
    await insertOrder('tenant-studio', 'cs_evt_other_workspace', 'live');

    expect((await repository.listUnresolved('tenant-acme', 10)).map((row) => row.eventId).sort()).toEqual([
      'evt_no_session', 'evt_other_workspace', 'evt_test_order',
    ]);
  });

  it('leaves an unknown event alone on resolve', async () => {
    const repository = createPaymentEventRejectionRepository(database.db);

    await repository.resolve('tenant-acme', 'evt_missing', now);

    expect(await database.db.select().from(paymentEventRejections)).toEqual([]);
  });
});
