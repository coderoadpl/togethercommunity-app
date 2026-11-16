import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outOfStockRefundJob, type Identity } from '#core/domain/index.js';
import { getOrder } from '#core/server/index.js';

import { createOrderRefundJobRepository } from './order-refund-jobs.js';
import { createOrderRepository } from './repositories.js';
import { members, orderRefundJobs, orders, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-11-15T10:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const staffOf = (tenantId: string): Identity => ({
  userId: `staff-${tenantId}`, email: `staff@${tenantId}.example.com`, name: 'Staff', emailVerified: true, tenantAccess: 'staff',
  tenantId, tenantSlug: tenantId, tenantName: tenantId, staffRole: 'owner', memberId: null, image: null, memberDisplayName: null,
  memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const insertOrder = (tenantId: string, id: string, cancelReason: 'out_of_stock' | null) => database.db.insert(orders).values({
  id, tenantId, memberId: `member-${tenantId}`, productId: `product-${tenantId}`, kind: 'one_time', status: 'paid', amountCents: 4099,
  currency: 'PLN', provider: 'stripe', providerObjectIds: { paymentIntent: `pi_${id}` }, cancelReason, createdAt: now,
});

const insertJob = (tenantId: string, orderId: string, over: Partial<typeof orderRefundJobs.$inferInsert> = {}) => database.db.insert(orderRefundJobs).values({
  ...outOfStockRefundJob({ id: orderId, tenantId, amountCents: 4099, currency: 'PLN', providerObjectIds: { paymentIntent: `pi_${orderId}` } }, { id: `job-${orderId}`, now }),
  ...over,
});

const jobRows = () => database.db.select().from(orderRefundJobs).orderBy(asc(orderRefundJobs.id));

beforeAll(async () => {
  database = await createTestDatabase('together_order_refund_jobs', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: 'tenant-a', slug: 'tenant-a', name: 'Workspace A', createdAt: now },
    { id: 'tenant-b', slug: 'tenant-b', name: 'Workspace B', createdAt: now },
  ]);
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  for (const tenantId of ['tenant-a', 'tenant-b']) {
    await database.db.insert(members).values({ id: `member-${tenantId}`, tenantId, userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
    await database.db.insert(products).values({
      id: `product-${tenantId}`, tenantId, type: 'physical', description: '', slug: 'poster', title: 'Poster', priceCents: 4099, currency: 'PLN', published: true, createdAt: now,
    });
  }
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
  await database.db.delete(orderRefundJobs);
  await database.db.delete(orders);
  await insertOrder('tenant-a', 'order-a', 'out_of_stock');
  await insertOrder('tenant-b', 'order-b', 'out_of_stock');
  await insertOrder('tenant-b', 'order-b-kept', null);
  await insertJob('tenant-a', 'order-a');
  await insertJob('tenant-b', 'order-b', { status: 'blocked_permission', nextAttemptAt: '2026-11-15T11:00:00.000Z' });
});

describe('order refund jobs of two workspaces', () => {
  it('finds a job only through the workspace that owns its order', async () => {
    const repository = createOrderRefundJobRepository(database.db);

    expect(await repository.findByOrderId('tenant-b', 'order-a')).toBeNull();
    expect(await repository.findByOrderId('tenant-a', 'order-b')).toBeNull();
    expect(await repository.findByOrderId('tenant-a', 'order-a')).toMatchObject({ tenantId: 'tenant-a', orderId: 'order-a', status: 'pending' });
    expect(await repository.findByOrderId('tenant-b', 'order-b')).toMatchObject({ tenantId: 'tenant-b', orderId: 'order-b', status: 'blocked_permission' });
  });

  it('releases a claimed job through another workspace as null and leaves the job untouched', async () => {
    const repository = createOrderRefundJobRepository(database.db);
    const claim = await repository.claimDue({ now: '2026-11-15T10:01:00.000Z', leaseMs: 600_000 });
    if (claim === null) throw new Error('Expected the job of workspace A to be due');
    expect(claim.job).toMatchObject({ tenantId: 'tenant-a', orderId: 'order-a', status: 'running' });
    const before = await jobRows();

    expect(await repository.release('tenant-b', claim.job.id, claim.lease, {
      status: 'succeeded', providerRefundId: 're_foreign', now: '2026-11-15T10:02:00.000Z',
    })).toBeNull();

    expect(await jobRows()).toStrictEqual(before);
    expect(await repository.release('tenant-a', claim.job.id, claim.lease, { status: 'succeeded', transientFailureStreak: 2, now: '2026-11-15T10:02:00.000Z' }))
      .toMatchObject({ tenantId: 'tenant-a', status: 'succeeded', lockedAt: null, transientFailureStreak: 2 });
  });

  it('resolves a job externally only through the workspace that owns its order', async () => {
    const repository = createOrderRefundJobRepository(database.db);
    const before = await jobRows();

    expect(await repository.resolveExternally('tenant-b', 'order-a', '2026-11-15T10:02:00.000Z')).toBeNull();
    expect(await repository.resolveExternally('tenant-a', 'order-b', '2026-11-15T10:02:00.000Z')).toBeNull();

    expect(await jobRows()).toStrictEqual(before);
  });

  it('resolves externally only a job that never called Stripe or one that failed for good', async () => {
    const repository = createOrderRefundJobRepository(database.db);
    const resolve = (orderId: string) => repository.resolveExternally('tenant-a', orderId, '2026-11-15T10:02:00.000Z');
    await database.db.delete(orderRefundJobs).where(eq(orderRefundJobs.orderId, 'order-a'));
    for (const id of ['order-attempted', 'order-submitted', 'order-failed']) await insertOrder('tenant-a', id, 'out_of_stock');
    await insertJob('tenant-a', 'order-a');
    await insertJob('tenant-a', 'order-attempted', { attempts: 1, lastError: 'Request aborted due to timeout being reached (5000ms)' });
    await insertJob('tenant-a', 'order-submitted', { status: 'submitted', attempts: 1, providerRefundId: 're_ours' });
    await insertJob('tenant-a', 'order-failed', { status: 'failed', attempts: 19, nextAttemptAt: null });

    expect(await resolve('order-attempted')).toBeNull();
    expect(await resolve('order-submitted')).toBeNull();
    expect(await repository.resolveExternally('tenant-b', 'order-b', '2026-11-15T10:02:00.000Z')).toBeNull();
    expect(await resolve('order-a')).toMatchObject({ status: 'resolved_externally', nextAttemptAt: null });
    expect(await resolve('order-failed')).toMatchObject({ status: 'resolved_externally' });
    expect((await jobRows()).map((row) => [row.orderId, row.status])).toStrictEqual([
      ['order-a', 'resolved_externally'], ['order-attempted', 'pending'], ['order-b', 'blocked_permission'], ['order-failed', 'resolved_externally'], ['order-submitted', 'submitted'],
    ]);
  });

  it('refuses to queue a job for another workspace\'s order', async () => {
    const repository = createOrderRefundJobRepository(database.db);
    await database.db.delete(orderRefundJobs).where(eq(orderRefundJobs.orderId, 'order-a'));
    const foreign = outOfStockRefundJob({ id: 'order-a', tenantId: 'tenant-b', amountCents: 4099, currency: 'PLN', providerObjectIds: {} }, { id: 'job-foreign', now });

    await expect(repository.enqueue('tenant-b', foreign)).rejects.toThrow();
    expect(await repository.findByOrderId('tenant-a', 'order-a')).toBeNull();
  });

  it('shows each workspace only the refund status of its own cancelled orders in the order list', async () => {
    const repository = createOrderRepository(database.db);

    const listOf = async (tenantId: string) => (await repository.list(tenantId, { page: 1, pageSize: 100 })).orders
      .map((order) => ({ id: order.id, refundJobStatus: order.refundJobStatus }))
      .toSorted((left, right) => left.id.localeCompare(right.id));

    expect(await listOf('tenant-a')).toStrictEqual([{ id: 'order-a', refundJobStatus: 'pending' }]);
    expect(await listOf('tenant-b')).toStrictEqual([
      { id: 'order-b', refundJobStatus: 'blocked_permission' },
      { id: 'order-b-kept', refundJobStatus: undefined },
    ]);
  });

  it('answers GET /api/orders/:id with not found for another workspace\'s order and with its own refund job otherwise', async () => {
    const deps = { orders: createOrderRepository(database.db), refundJobs: createOrderRefundJobRepository(database.db) };

    const foreign = await getOrder({ identity: staffOf('tenant-b') }, 'order-a', deps);
    expect(foreign).toMatchObject({ ok: false, error: { code: 'not_found' } });

    const own = await getOrder({ identity: staffOf('tenant-b') }, 'order-b', deps);
    expect(own).toMatchObject({ ok: true, value: { order: { id: 'order-b' }, refundJob: { status: 'blocked_permission', idempotencyKey: 'oos-refund-order-b' } } });

    const kept = await getOrder({ identity: staffOf('tenant-b') }, 'order-b-kept', deps);
    expect(kept).toMatchObject({ ok: true, value: { order: { id: 'order-b-kept' }, refundJob: null } });
  });
});
