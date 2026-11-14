import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { err, ok, orderListItemSchema, shipxRejected, type ShipxSender, type TenantSecretKey } from '#core/domain/index.js';
import { createInpostShipment, type CreateInpostShipmentDeps, type OrderFulfilmentRepository, type ShipxShipmentRepository } from '#core/server/index.js';
import { createScriptedShipxClient, remoteShipment } from '#core/server/testing/shipx-fakes.js';
import { createInMemoryTenantDomainRepository } from '#core/server/testing/tenant-domain-fakes.js';
import { createProductRepository } from './repositories.js';
import { products, tenants } from './schema.js';
import { createShipxSettingsRepository, createShipxShipmentRepository } from './shipx.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-11-08T10:00:00.000Z';
const leaseExpiredBefore = '2026-11-08T09:58:30.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;

const sender: ShipxSender = {
  name: 'Anna Sender', company: null, email: 'shop@example.org', phone: '500600700',
  street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001',
};

const context = { environment: 'production', organizationId: '1234', actorUserId: 'staff' } as const;
const synced = { actorUserId: 'staff', event: null };
const audit = { actorUserId: 'staff', at: now };
const finished = { ...audit, outcome: 'pending' } as const;

beforeAll(async () => {
  database = await createTestDatabase('together_shipx', baseDatabaseUrl);
  await database.db.insert(tenants).values([
    { id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now },
    { id: 'other', slug: 'other', name: 'Other workspace', createdAt: now },
  ]);
  await database.db.insert(products).values({ id: 'stand', tenantId: 'workspace', type: 'physical', deliveryMethod: 'shipping', description: '', slug: 'stand', title: 'Printed stand', priceCents: 5899, currency: 'PLN', published: true, vatRate: 23, createdAt: now });
});

afterAll(async () => {
  await database.close();
});

const seedShipment = async (repository: ShipxShipmentRepository, orderId: string, shipxShipmentId: string) => {
  await repository.acquire('workspace', { id: `seed-${orderId}`, orderId, token: `seed-${orderId}`, ...context, now, leaseExpiredBefore });
  await repository.update('workspace', orderId, `seed-${orderId}`, { shipxShipmentId, status: 'offers_prepared', updatedAt: now }, synced);
  await repository.finishOperation('workspace', orderId, `seed-${orderId}`, finished);
};

const readRow = async (repository: ShipxShipmentRepository, orderId: string) => {
  const row = await repository.findByOrder('workspace', orderId);
  if (row === null) throw new Error(`No shipment row for ${orderId}`);
  return row;
};

describe('ShipX shipment repository', () => {
  it('acquires an order once, reports a running operation and lets an expired lease be taken over', async () => {
    const repository = createShipxShipmentRepository(database.db);
    const first = await repository.acquire('workspace', { id: 'claim-1', orderId: 'order-claim', token: 'token-1', ...context, now, leaseExpiredBefore });
    expect(first).toMatchObject({
      kind: 'acquired',
      shipment: { shipxShipmentId: null, status: 'creating', environment: 'production', organizationId: '1234', operationToken: 'token-1', operationStartedAt: now, createdAt: now },
    });
    const busy = await repository.acquire('workspace', { id: 'claim-2', orderId: 'order-claim', token: 'token-2', ...context, now, leaseExpiredBefore });
    expect(busy).toMatchObject({ kind: 'in_progress', shipment: { operationToken: 'token-1' } });
    const later = '2026-11-08T10:05:00.000Z';
    const taken = await repository.acquire('workspace', { id: 'claim-3', orderId: 'order-claim', token: 'token-3', ...context, now: later, leaseExpiredBefore: '2026-11-08T10:03:30.000Z' });
    expect(taken).toMatchObject({ kind: 'acquired', shipment: { operationToken: 'token-3', operationStartedAt: later, createdAt: now } });
    expect(await repository.finishOperation('workspace', 'order-claim', 'token-3', { actorUserId: 'staff', at: later, outcome: 'bought' })).toEqual({ kind: 'finished' });
    expect(await repository.findByOrder('workspace', 'order-claim')).toMatchObject({ operationToken: null, operationStartedAt: null });
    expect((await repository.acquire('workspace', { id: 'claim-4', orderId: 'order-claim', token: 'token-4', ...context, now: later, leaseExpiredBefore })).kind).toBe('acquired');
    expect(await repository.listEvents('workspace', 'order-claim')).toEqual([
      expect.objectContaining({ type: 'attempt_claimed', operationToken: 'token-1', actorUserId: 'staff', details: { environment: 'production' }, createdAt: now }),
      expect.objectContaining({
        type: 'lease_taken_over', operationToken: 'token-3', actorUserId: 'staff', createdAt: later,
        details: { previousOperationToken: 'token-1', previousOperationStartedAt: now },
      }),
      expect.objectContaining({ type: 'operation_finished', operationToken: 'token-3', actorUserId: 'staff', details: { outcome: 'bought' }, createdAt: later }),
      expect.objectContaining({ type: 'attempt_claimed', operationToken: 'token-4', createdAt: later }),
    ]);
  });

  it('lets exactly one of several concurrent requests acquire a free row', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await seedShipment(repository, 'order-race', '555');
    const results = await Promise.all(Array.from({ length: 6 }, (_value, index) =>
      repository.acquire('workspace', { id: `race-${String(index)}`, orderId: 'order-race', token: `race-${String(index)}`, ...context, now, leaseExpiredBefore })));
    expect(results.filter((result) => result.kind === 'acquired')).toHaveLength(1);
    const fresh = await Promise.all(Array.from({ length: 6 }, (_value, index) =>
      repository.acquire('workspace', { id: `fresh-${String(index)}`, orderId: 'order-fresh', token: `fresh-${String(index)}`, ...context, now, leaseExpiredBefore })));
    expect(fresh.filter((result) => result.kind === 'acquired')).toHaveLength(1);
  });

  it('writes, finishes and releases only with the token of the current claim', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await repository.acquire('workspace', { id: 'owned-1', orderId: 'order-owned', token: 'stale', ...context, now, leaseExpiredBefore });
    const later = '2026-11-08T10:05:00.000Z';
    await repository.acquire('workspace', { id: 'owned-2', orderId: 'order-owned', token: 'current', ...context, now: later, leaseExpiredBefore: '2026-11-08T10:03:30.000Z' });
    expect(await repository.update('workspace', 'order-owned', 'stale', { status: 'unknown', createAttemptedAt: later, updatedAt: later }, synced)).toEqual({ kind: 'lost_lock' });
    expect(await repository.finishOperation('workspace', 'order-owned', 'stale', finished)).toEqual({ kind: 'lost_lock' });
    expect(await repository.release('workspace', 'order-owned', 'stale', audit)).toEqual({ kind: 'lost_lock' });
    expect(await repository.update('other', 'order-owned', 'current', { status: 'confirmed', updatedAt: later }, synced)).toEqual({ kind: 'lost_lock' });
    expect(await repository.findByOrder('workspace', 'order-owned')).toMatchObject({ status: 'creating', createAttemptedAt: null, operationToken: 'current', operationStartedAt: later });
    expect(await repository.update('workspace', 'order-owned', 'current', { status: 'unknown', createAttemptedAt: later, updatedAt: later }, synced)).toMatchObject({
      kind: 'updated', shipment: { status: 'unknown', createAttemptedAt: later },
    });
    expect(await repository.release('workspace', 'order-owned', 'current', { actorUserId: 'staff', at: later })).toEqual({ kind: 'released' });
    expect(await repository.findByOrder('workspace', 'order-owned')).toBeNull();
    expect((await repository.listEvents('workspace', 'order-owned')).map((event) => [event.type, event.operationToken])).toEqual([
      ['attempt_claimed', 'stale'],
      ['lease_taken_over', 'current'],
      ['status_refreshed', 'current'],
      ['attempt_released', 'current'],
    ]);
    expect((await repository.listEvents('workspace', 'order-owned')).at(-1)?.details).toEqual({ status: 'unknown', createAttemptedAt: later });
  });

  it('records the ShipX shipment, keeps the first purchase time and never releases a row with a ShipX id', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await repository.acquire('workspace', { id: 'record-1', orderId: 'order-record', token: 'record', ...context, now, leaseExpiredBefore });
    await repository.update('workspace', 'order-record', 'record', { shipxShipmentId: '12345', status: 'created', trackingNumber: null, updatedAt: now }, synced);
    const bought = await repository.update('workspace', 'order-record', 'record', {
      status: 'confirmed', trackingNumber: '523000015611700083038270', boughtAt: '2026-11-08T10:01:00.000Z', updatedAt: '2026-11-08T10:01:00.000Z',
    }, synced);
    expect(bought).toMatchObject({ kind: 'updated', shipment: { shipxShipmentId: '12345', status: 'confirmed', boughtAt: '2026-11-08T10:01:00.000Z' } });
    const again = await repository.update('workspace', 'order-record', 'record', { boughtAt: '2026-11-08T11:00:00.000Z', updatedAt: '2026-11-08T11:00:00.000Z' }, synced);
    expect(again).toMatchObject({ kind: 'updated', shipment: { boughtAt: '2026-11-08T10:01:00.000Z', updatedAt: '2026-11-08T10:01:00.000Z' } });
    expect(await repository.release('workspace', 'order-record', 'record', audit)).toEqual({ kind: 'lost_lock' });
    await repository.finishOperation('workspace', 'order-record', 'record', { actorUserId: 'staff', at: '2026-11-08T10:02:00.000Z', outcome: 'bought' });
    expect(await repository.discardUnconfirmed('workspace', 'order-record', leaseExpiredBefore, audit)).toBe(false);
    await repository.markLabelFetched('workspace', 'order-record', { actorUserId: 'staff', at: '2026-11-08T12:00:00.000Z' });
    expect(await repository.findByOrder('workspace', 'order-record')).toMatchObject({ shipxShipmentId: '12345', labelFetchedAt: '2026-11-08T12:00:00.000Z' });
    expect(await repository.listEvents('workspace', 'order-record')).toEqual([
      expect.objectContaining({ type: 'attempt_claimed', shipxShipmentId: null }),
      expect.objectContaining({ type: 'status_refreshed', shipxShipmentId: '12345', details: { from: 'creating', to: 'created', trackingNumber: null } }),
      expect.objectContaining({
        type: 'status_refreshed', shipxShipmentId: '12345', operationToken: 'record', createdAt: '2026-11-08T10:01:00.000Z',
        details: { from: 'created', to: 'confirmed', trackingNumber: '523000015611700083038270' },
      }),
      expect.objectContaining({
        type: 'offer_bought', shipxShipmentId: '12345', actorUserId: 'staff', operationToken: 'record', createdAt: '2026-11-08T10:01:00.000Z',
        details: { status: 'confirmed', trackingNumber: '523000015611700083038270' },
      }),
      expect.objectContaining({ type: 'operation_finished', shipxShipmentId: '12345', operationToken: 'record', details: { outcome: 'bought' }, createdAt: '2026-11-08T10:02:00.000Z' }),
      expect.objectContaining({ type: 'label_fetched', shipxShipmentId: '12345', actorUserId: 'staff', operationToken: null, createdAt: '2026-11-08T12:00:00.000Z' }),
    ]);
  });

  it('refreshes the stored status only while no request holds the operation', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await repository.acquire('workspace', { id: 'refresh-1', orderId: 'order-refresh', token: 'refresh', ...context, now, leaseExpiredBefore });
    await repository.update('workspace', 'order-refresh', 'refresh', { shipxShipmentId: '4321', status: 'offer_selected', updatedAt: now }, synced);
    expect(await repository.refreshUnclaimed('workspace', 'order-refresh', leaseExpiredBefore, await readRow(repository, 'order-refresh'), { status: 'confirmed', updatedAt: now }, 'staff')).toBeNull();
    await repository.finishOperation('workspace', 'order-refresh', 'refresh', finished);
    expect(await repository.refreshUnclaimed('workspace', 'order-refresh', leaseExpiredBefore, await readRow(repository, 'order-refresh'), { status: 'confirmed', trackingNumber: '6001', boughtAt: now, updatedAt: now }, 'viewer')).toMatchObject({
      status: 'confirmed', trackingNumber: '6001', boughtAt: now,
    });
    expect((await repository.listEvents('workspace', 'order-refresh')).at(-1)).toEqual({
      orderId: 'order-refresh', shipxShipmentId: '4321', type: 'offer_bought', actorUserId: 'viewer', operationToken: null,
      details: { status: 'confirmed', trackingNumber: '6001' }, createdAt: now,
    });
    expect((await repository.listEvents('workspace', 'order-refresh')).at(-2)).toMatchObject({
      type: 'status_refreshed', actorUserId: 'viewer', operationToken: null, details: { from: 'offer_selected', to: 'confirmed', trackingNumber: '6001' },
    });
  });

  it('drops a refresh read before a concurrent purchase and never clears a tracking number or changes a bought row', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await seedShipment(repository, 'order-fence', '7001');
    const stale = await readRow(repository, 'order-fence');
    const paidAt = '2026-11-08T10:00:30.000Z';
    await repository.acquire('workspace', { id: 'fence-1', orderId: 'order-fence', token: 'fence', ...context, now: paidAt, leaseExpiredBefore });
    await repository.update('workspace', 'order-fence', 'fence', { status: 'confirmed', trackingNumber: '6001', boughtAt: paidAt, updatedAt: paidAt }, synced);
    await repository.finishOperation('workspace', 'order-fence', 'fence', finished);
    const refreshedAt = '2026-11-08T10:01:00.000Z';
    expect(await repository.refreshUnclaimed('workspace', 'order-fence', leaseExpiredBefore, stale, { status: 'offer_selected', trackingNumber: null, updatedAt: refreshedAt }, 'viewer'))
      .toMatchObject({ status: 'confirmed', trackingNumber: '6001', boughtAt: paidAt });
    const bought = await readRow(repository, 'order-fence');
    expect(await repository.refreshUnclaimed('workspace', 'order-fence', leaseExpiredBefore, bought, { status: 'offer_selected', trackingNumber: null, updatedAt: refreshedAt }, 'viewer'))
      .toMatchObject({ status: 'confirmed', trackingNumber: '6001', updatedAt: paidAt });

    await seedShipment(repository, 'order-tracked', '7002');
    await repository.acquire('workspace', { id: 'tracked-1', orderId: 'order-tracked', token: 'tracked', ...context, now, leaseExpiredBefore });
    await repository.update('workspace', 'order-tracked', 'tracked', { status: 'offer_selected', trackingNumber: '6002', updatedAt: paidAt }, synced);
    await repository.finishOperation('workspace', 'order-tracked', 'tracked', finished);
    const tracked = await readRow(repository, 'order-tracked');
    expect(await repository.refreshUnclaimed('workspace', 'order-tracked', leaseExpiredBefore, tracked, { status: 'offers_prepared', trackingNumber: null, updatedAt: refreshedAt }, 'viewer'))
      .toMatchObject({ status: 'offer_selected', trackingNumber: '6002', updatedAt: paidAt });
    expect((await repository.listEvents('workspace', 'order-fence')).filter((event) => event.actorUserId === 'viewer')).toEqual([]);
    expect((await repository.listEvents('workspace', 'order-tracked')).filter((event) => event.actorUserId === 'viewer')).toEqual([]);
  });

  it('records a changed ShipX status as status_refreshed and writes nothing when the status is the same', async () => {
    const repository = createShipxShipmentRepository(database.db);
    const polled = '2026-11-08T10:00:10.000Z';
    await repository.acquire('workspace', { id: 'poll-1', orderId: 'order-poll', token: 'poll', ...context, now, leaseExpiredBefore });
    await repository.update('workspace', 'order-poll', 'poll', { shipxShipmentId: '9001', status: 'offers_prepared', trackingNumber: null, updatedAt: now }, {
      actorUserId: 'staff', event: { type: 'shipment_created', details: { status: 'offers_prepared' } },
    });
    const same = await repository.update('workspace', 'order-poll', 'poll', { shipxShipmentId: '9001', status: 'offers_prepared', trackingNumber: null, updatedAt: '2026-11-08T10:00:05.000Z' }, synced);
    expect(same).toMatchObject({ kind: 'updated', shipment: { status: 'offers_prepared', updatedAt: now } });
    await repository.update('workspace', 'order-poll', 'poll', { shipxShipmentId: '9001', status: 'confirmed', trackingNumber: null, updatedAt: polled }, synced);
    await repository.finishOperation('workspace', 'order-poll', 'poll', { actorUserId: 'staff', at: '2026-11-08T10:00:20.000Z', outcome: 'pending' });
    expect(await repository.refreshUnclaimed('workspace', 'order-poll', leaseExpiredBefore, await readRow(repository, 'order-poll'), { shipxShipmentId: '9001', status: 'confirmed', trackingNumber: null, updatedAt: '2026-11-08T10:01:00.000Z' }, 'viewer'))
      .toMatchObject({ status: 'confirmed', updatedAt: polled });
    expect(await repository.listEvents('workspace', 'order-poll')).toEqual([
      expect.objectContaining({ type: 'attempt_claimed' }),
      expect.objectContaining({ type: 'shipment_created' }),
      {
        orderId: 'order-poll', shipxShipmentId: '9001', type: 'status_refreshed', actorUserId: 'staff', operationToken: 'poll',
        details: { from: 'offers_prepared', to: 'confirmed', trackingNumber: null }, createdAt: polled,
      },
      {
        orderId: 'order-poll', shipxShipmentId: '9001', type: 'operation_finished', actorUserId: 'staff', operationToken: 'poll',
        details: { outcome: 'pending' }, createdAt: '2026-11-08T10:00:20.000Z',
      },
    ]);
  });

  it('discards only an unconfirmed attempt that no request is working on', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await repository.acquire('workspace', { id: 'unknown-1', orderId: 'order-unknown', token: 'unknown', ...context, now, leaseExpiredBefore });
    await repository.update('workspace', 'order-unknown', 'unknown', { status: 'unknown', createAttemptedAt: now, updatedAt: now }, synced);
    expect(await repository.discardUnconfirmed('workspace', 'order-unknown', leaseExpiredBefore, audit)).toBe(false);
    await repository.finishOperation('workspace', 'order-unknown', 'unknown', finished);
    expect(await repository.findByOrder('workspace', 'order-unknown')).toMatchObject({ status: 'unknown', createAttemptedAt: now });
    expect(await repository.discardUnconfirmed('other', 'order-unknown', leaseExpiredBefore, audit)).toBe(false);
    expect(await repository.discardUnconfirmed('workspace', 'order-unknown', leaseExpiredBefore, audit)).toBe(true);
    expect(await repository.findByOrder('workspace', 'order-unknown')).toBeNull();
  });

  it('keeps the discarded attempt in the event history with the staff user who discarded it', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await repository.acquire('workspace', { id: 'discard-1', orderId: 'order-discard', token: 'attempt', ...context, actorUserId: 'packer', now, leaseExpiredBefore });
    await repository.update('workspace', 'order-discard', 'attempt', { status: 'unknown', createAttemptedAt: now, updatedAt: now }, {
      actorUserId: 'packer', event: { type: 'attempt_marked', details: { createAttemptedAt: now } },
    });
    await repository.finishOperation('workspace', 'order-discard', 'attempt', { actorUserId: 'packer', at: now, outcome: 'unconfirmed' });
    const discardedAt = '2026-11-08T10:10:00.000Z';
    expect(await repository.discardUnconfirmed('workspace', 'order-discard', '2026-11-08T10:08:30.000Z', { actorUserId: 'manager', at: discardedAt })).toBe(true);
    expect(await repository.findByOrder('workspace', 'order-discard')).toBeNull();
    expect(await repository.listEvents('workspace', 'order-discard')).toEqual([
      expect.objectContaining({ type: 'attempt_claimed', actorUserId: 'packer', operationToken: 'attempt' }),
      expect.objectContaining({ type: 'attempt_marked', actorUserId: 'packer', operationToken: 'attempt', details: { createAttemptedAt: now } }),
      expect.objectContaining({ type: 'operation_finished', actorUserId: 'packer', operationToken: 'attempt', details: { outcome: 'unconfirmed' } }),
      {
        orderId: 'order-discard', shipxShipmentId: null, type: 'attempt_discarded', actorUserId: 'manager', operationToken: null,
        details: { status: 'unknown', createAttemptedAt: now }, createdAt: discardedAt,
      },
    ]);
    expect(await repository.listEvents('other', 'order-discard')).toEqual([]);
  });

  it('rolls the projection change back when its event cannot be written', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await database.db.execute(sql`
      CREATE FUNCTION refuse_shipment_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.actor_user_id = 'refused' THEN RAISE EXCEPTION 'event refused'; END IF;
        RETURN NEW;
      END $$`);
    await database.db.execute(sql`CREATE TRIGGER refuse_shipment_event BEFORE INSERT ON order_shipment_events FOR EACH ROW EXECUTE FUNCTION refuse_shipment_event()`);
    const refused = { ...context, actorUserId: 'refused' };
    await expect(repository.acquire('workspace', { id: 'atomic-1', orderId: 'order-atomic', token: 'atomic', ...refused, now, leaseExpiredBefore })).rejects.toThrow();
    expect(await repository.findByOrder('workspace', 'order-atomic')).toBeNull();
    await repository.acquire('workspace', { id: 'atomic-2', orderId: 'order-atomic', token: 'atomic', ...context, now, leaseExpiredBefore });
    await expect(repository.update('workspace', 'order-atomic', 'atomic', { status: 'unknown', createAttemptedAt: now, updatedAt: now }, {
      actorUserId: 'refused', event: { type: 'attempt_marked' },
    })).rejects.toThrow();
    expect(await repository.findByOrder('workspace', 'order-atomic')).toMatchObject({ status: 'creating', createAttemptedAt: null });
    await expect(repository.release('workspace', 'order-atomic', 'atomic', { actorUserId: 'refused', at: now })).rejects.toThrow();
    expect(await repository.findByOrder('workspace', 'order-atomic')).toMatchObject({ operationToken: 'atomic' });
    await expect(repository.update('workspace', 'order-atomic', 'atomic', { status: 'unknown', createAttemptedAt: now, updatedAt: now }, {
      actorUserId: 'refused', event: null,
    })).rejects.toThrow();
    expect(await repository.findByOrder('workspace', 'order-atomic')).toMatchObject({ status: 'creating', createAttemptedAt: null });
    await repository.update('workspace', 'order-atomic', 'atomic', { status: 'unknown', createAttemptedAt: now, updatedAt: now }, synced);
    await expect(repository.finishOperation('workspace', 'order-atomic', 'atomic', { actorUserId: 'refused', at: now, outcome: 'unconfirmed' })).rejects.toThrow();
    expect(await repository.findByOrder('workspace', 'order-atomic')).toMatchObject({ operationToken: 'atomic', operationStartedAt: now });
    await repository.finishOperation('workspace', 'order-atomic', 'atomic', finished);
    await expect(repository.refreshUnclaimed('workspace', 'order-atomic', leaseExpiredBefore, await readRow(repository, 'order-atomic'), { status: 'confirmed', updatedAt: now }, 'refused')).rejects.toThrow();
    await expect(repository.discardUnconfirmed('workspace', 'order-atomic', leaseExpiredBefore, { actorUserId: 'refused', at: now })).rejects.toThrow();
    expect(await repository.findByOrder('workspace', 'order-atomic')).toMatchObject({ status: 'unknown', operationToken: null });
    expect((await repository.listEvents('workspace', 'order-atomic')).map((event) => event.type)).toEqual(['attempt_claimed', 'status_refreshed', 'operation_finished']);
    await database.db.execute(sql`DROP TRIGGER refuse_shipment_event ON order_shipment_events`);
    await database.db.execute(sql`DROP FUNCTION refuse_shipment_event()`);
  });

  it('keeps workspaces apart', async () => {
    const repository = createShipxShipmentRepository(database.db);
    await repository.acquire('workspace', { id: 'release-1', orderId: 'order-release', token: 'release', ...context, now, leaseExpiredBefore });
    expect(await repository.findByOrder('other', 'order-release')).toBeNull();
    expect(await repository.release('other', 'order-release', 'release', audit)).toEqual({ kind: 'lost_lock' });
    expect(await repository.findByOrder('workspace', 'order-release')).not.toBeNull();
    expect(await repository.listEvents('workspace', 'order-release')).toHaveLength(1);
    expect(await repository.listEvents('other', 'order-release')).toEqual([]);
  });
});

describe('InPost shipment use-case on the database', () => {
  const order = (id: string) => orderListItemSchema.parse({
    id, tenantId: 'workspace', memberId: 'member-1', productId: 'stand', priceId: null, kind: 'one_time',
    status: 'paid', amountCents: 7398, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null,
    discountCents: 0, createdAt: '2026-11-04T09:00:00.000Z', paidAt: '2026-11-04T09:01:00.000Z',
    memberEmail: 'buyer@example.org', memberName: 'Jane Buyer', productTitle: 'Printed stand', couponCode: null, fulfilmentStatus: 'to_pack',
    shipping: {
      rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
      pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
      address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
      phone: '+48500000000',
    },
  });

  const depsFor = (orderId: string, client: ReturnType<typeof createScriptedShipxClient>['client']): CreateInpostShipmentDeps => {
    const stored = order(orderId);
    const findById = async (tenantId: string, id: string) => (tenantId === 'workspace' && id === orderId ? stored : null);
    const values: Partial<Record<TenantSecretKey, string>> = { 'shipx.organizationId': '1234', 'shipx.token': 'token' };
    const ids = { nextId: () => `${orderId}-${String(++sequence)}` };
    const clock = { nowIso: () => new Date().toISOString() };
    return {
      orderDetails: { findById },
      products: createProductRepository(database.db),
      shipxShipments: createShipxShipmentRepository(database.db),
      shipxSettings: createShipxSettingsRepository(database.db),
      tenantSecrets: { findByKey: async () => null },
      secrets: { resolve: async (_tenantId, key) => ok(values[key] ?? '') },
      shipx: { real: client, fake: createScriptedShipxClient().client },
      ids,
      clock,
      wait: async () => undefined,
      ship: {
        tenantDomains: createInMemoryTenantDomainRepository(),
        appBaseUrl: 'https://app.together.test',
        baseDomain: 'together.test',
        singleTenantMode: false,
        orderDetails: { findById },
        fulfilment: { ship: vi.fn<OrderFulfilmentRepository['ship']>(async (_tenantId, input) => ok({ ...stored, fulfilmentStatus: 'shipped' as const, shipment: input.shipment })) },
        members: { findById: async () => null },
        tenants: { findSettings: async () => null },
        ids,
        clock,
        dispatchEmail: vi.fn(),
      },
    };
  };

  const write = {
    identity: {
      userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null, tenantAccess: 'staff' as const,
      tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner' as const,
      memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
    },
    capabilities: ['order:write' as const, 'order:read' as const],
  };

  const unpaid = (id: string) => ok(remoteShipment(id, { status: 'offers_prepared', offers: [{ id: '55', status: 'available', service: 'inpost_locker_standard' }] }));

  it('buys once when a second click arrives while the first one is paying', async () => {
    await createShipxSettingsRepository(database.db).save('workspace', { environment: 'production', sender });
    await seedShipment(createShipxShipmentRepository(database.db), 'order-buy', '777');
    let releaseBuy: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseBuy = resolve;
    });
    let buyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      buyStarted = resolve;
    });
    const client = createScriptedShipxClient({
      polls: [unpaid, (id) => ok(remoteShipment(id, { status: 'confirmed', trackingNumber: '520000011395200025754311' }))],
      buy: async (id) => {
        buyStarted();
        await gate;
        return ok(remoteShipment(id, { status: 'offer_selected' }));
      },
    });
    const deps = depsFor('order-buy', client.client);
    const first = createInpostShipment(write, { orderId: 'order-buy' }, deps);
    await started;
    expect(await createInpostShipment(write, { orderId: 'order-buy' }, deps)).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
    releaseBuy();
    expect(await first).toMatchObject({ ok: true, value: { shipment: { trackingNumber: '520000011395200025754311' } } });
    expect(client.calls.buy).toEqual([{ shipmentId: '777', offerId: '55' }]);
    expect((await createShipxShipmentRepository(database.db).findByOrder('workspace', 'order-buy'))?.operationStartedAt).toBeNull();
    const events = await createShipxShipmentRepository(database.db).listEvents('workspace', 'order-buy');
    expect(events.map((event) => event.type)).toEqual([
      'attempt_claimed', 'status_refreshed', 'operation_finished',
      'attempt_claimed', 'status_refreshed', 'offer_bought', 'operation_finished',
    ]);
    expect(events.every((event) => event.actorUserId === 'staff')).toBe(true);
    expect(events.slice(3).map((event) => event.operationToken)).toEqual(Array.from({ length: 4 }, () => events[3]?.operationToken));
    expect(events.at(-1)?.details).toEqual({ outcome: 'bought' });
  });

  it('lets only one of two simultaneous clicks reach ShipX', async () => {
    await createShipxSettingsRepository(database.db).save('workspace', { environment: 'production', sender });
    await seedShipment(createShipxShipmentRepository(database.db), 'order-twin', '888');
    const client = createScriptedShipxClient({
      polls: [unpaid, (id) => ok(remoteShipment(id, { status: 'confirmed', trackingNumber: '520000011395200025754312' }))],
      buy: async (id) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return ok(remoteShipment(id, { status: 'offer_selected' }));
      },
    });
    const deps = depsFor('order-twin', client.client);
    const results = await Promise.all([
      createInpostShipment(write, { orderId: 'order-twin' }, deps),
      createInpostShipment(write, { orderId: 'order-twin' }, deps),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.error.code === 'fulfilment_conflict')).toHaveLength(1);
    expect(client.calls.buy).toHaveLength(1);
  });

  it('ignores the late cleanup of a released attempt, so a third click cannot create a second shipment', async () => {
    await createShipxSettingsRepository(database.db).save('workspace', { environment: 'production', sender });
    const repository = createShipxShipmentRepository(database.db);
    const rejecting = createScriptedShipxClient({
      create: () => err(shipxRejected({ status: 400, error: 'validation_failed', description: 'Invalid', fields: {} })),
    });
    const accepting = createScriptedShipxClient();
    let resumeSecond: () => void = () => undefined;
    const productsGate = new Promise<void>((resolve) => {
      resumeSecond = resolve;
    });
    let secondClaimed: () => void = () => undefined;
    const claimed = new Promise<void>((resolve) => {
      secondClaimed = resolve;
    });

    const second = depsFor('order-relay', accepting.client);
    const products = second.products;
    second.products = {
      findByIds: async (tenantId, productIds) => {
        await productsGate;
        return products.findByIds(tenantId, productIds);
      },
    };
    second.shipxShipments = {
      ...repository,
      acquire: async (tenantId, input) => {
        const acquired = await repository.acquire(tenantId, input);
        secondClaimed();
        return acquired;
      },
    };

    const running: { second?: ReturnType<typeof createInpostShipment> } = {};
    const first = depsFor('order-relay', rejecting.client);
    first.shipxShipments = {
      ...repository,
      release: async (tenantId, orderId, token, releaseAudit) => {
        const released = await repository.release(tenantId, orderId, token, releaseAudit);
        running.second = createInpostShipment(write, { orderId: 'order-relay' }, second);
        await claimed;
        return released;
      },
    };

    expect(await createInpostShipment(write, { orderId: 'order-relay' }, first)).toMatchObject({ ok: false, error: { code: 'shipx_rejected' } });
    const third = await createInpostShipment(write, { orderId: 'order-relay' }, depsFor('order-relay', accepting.client));
    expect(third).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
    resumeSecond();
    expect(await running.second).toMatchObject({ ok: true, value: { shipment: { shipxShipmentId: '1001' } } });
    expect(rejecting.calls.create).toHaveLength(1);
    expect(accepting.calls.create).toHaveLength(1);
    expect(await repository.findByOrder('workspace', 'order-relay')).toMatchObject({ operationToken: null, operationStartedAt: null });
    const events = await repository.listEvents('workspace', 'order-relay');
    expect(events.filter((event) => event.type === 'operation_finished').map((event) => event.details)).toEqual([{ outcome: 'bought' }]);
    expect(events.filter((event) => event.type === 'attempt_released')).toHaveLength(1);
  });
});

describe('ShipX settings repository and parcel template', () => {
  it('defaults to the sandbox without a sender and stores the settings per workspace', async () => {
    const repository = createShipxSettingsRepository(database.db);
    await repository.save('workspace', { environment: 'sandbox', sender: null });
    expect(await repository.find('workspace')).toEqual({ environment: 'sandbox', sender: null });
    await repository.save('workspace', { environment: 'production', sender });
    expect(await repository.find('workspace')).toEqual({ environment: 'production', sender });
    expect(await repository.find('other')).toEqual({ environment: 'sandbox', sender: null });
    expect(await repository.find('missing')).toBeNull();
  });

  it('stores the product parcel template with medium as the default', async () => {
    const productsRepository = createProductRepository(database.db);
    const stand = await productsRepository.findById('workspace', 'stand');
    expect(stand?.parcelTemplate).toBe('medium');
    if (stand === null) return;
    const updated = await productsRepository.update('workspace', { ...stand, parcelTemplate: 'large' }, {
      id: 'version-1', entityKind: 'product', entityId: 'stand', schemaVersion: 9, payload: {}, createdBy: null, createdAt: now,
    });
    expect(updated?.parcelTemplate).toBe('large');
  });
});
