import { and, asc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { SHIPX_STATUS_CREATING, shipxEnvironmentSchema, shipxSenderSchema, shipxShipmentSchema } from '#core/domain/index.js';
import type {
  ShipxOwnedUpdate,
  ShipxSettingsRepository,
  ShipxShipmentAcquisition,
  ShipxShipmentEvent,
  ShipxShipmentEventDetails,
  ShipxShipmentPatch,
  ShipxShipmentRecord,
  ShipxShipmentRepository,
} from '#core/server/index.js';

import { tenants } from './app-schema.js';
import type { Db } from './client.js';
import { orderShipmentEvents, orderShipments } from './shipx-schema.js';

type ShipmentRow = typeof orderShipments.$inferSelect;
type EventRow = typeof orderShipmentEvents.$inferSelect;

const iso = (value: string): string => new Date(value).toISOString();

const isoOrNull = (value: string | null): string | null => value === null ? null : iso(value);

const toShipment = (row: ShipmentRow): ShipxShipmentRecord => ({
  ...shipxShipmentSchema.parse({
    shipxShipmentId: row.providerShipmentId,
    status: row.status,
    trackingNumber: row.trackingNumber,
    environment: row.environment,
    createAttemptedAt: isoOrNull(row.createAttemptedAt),
    boughtAt: isoOrNull(row.boughtAt),
    labelFetchedAt: isoOrNull(row.labelFetchedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }),
  organizationId: row.organizationId,
  operationToken: row.operationToken,
  operationStartedAt: isoOrNull(row.operationStartedAt),
});

const patchValues = (patch: ShipxShipmentPatch) => ({
  ...(patch.shipxShipmentId === undefined ? {} : { providerShipmentId: patch.shipxShipmentId }),
  ...(patch.status === undefined ? {} : { status: patch.status }),
  ...(patch.trackingNumber === undefined ? {} : { trackingNumber: patch.trackingNumber }),
  ...(patch.createAttemptedAt === undefined ? {} : { createAttemptedAt: patch.createAttemptedAt }),
  ...(patch.boughtAt === undefined ? {} : { boughtAt: sql`coalesce(${orderShipments.boughtAt}, ${patch.boughtAt}::timestamptz)` }),
  updatedAt: patch.updatedAt,
});

type EventInput = Pick<typeof orderShipmentEvents.$inferInsert, 'type' | 'providerShipmentId' | 'actorUserId' | 'operationToken' | 'details' | 'createdAt'>;

const toEvent = (row: EventRow): ShipxShipmentEvent => ({
  orderId: row.orderId,
  shipxShipmentId: row.providerShipmentId,
  type: row.type,
  actorUserId: row.actorUserId,
  operationToken: row.operationToken,
  details: row.details,
  createdAt: iso(row.createdAt),
});

const attemptDetails = (row: ShipmentRow) => ({ status: row.status, createAttemptedAt: isoOrNull(row.createAttemptedAt) });

const boughtTransition = (before: ShipmentRow, after: ShipmentRow) =>
  before.boughtAt === null && after.boughtAt !== null
    ? [{ type: 'offer_bought' as const, details: { status: after.status, trackingNumber: after.trackingNumber } }]
    : [];

export const createShipxShipmentRepository = (db: Db): ShipxShipmentRepository => {
  const byOrder = (tenantId: string, orderId: string) =>
    and(eq(orderShipments.tenantId, tenantId), eq(orderShipments.orderId, orderId));
  const owned = (tenantId: string, orderId: string, token: string) =>
    and(byOrder(tenantId, orderId), eq(orderShipments.operationToken, token));
  const operationFree = (leaseExpiredBefore: string) =>
    or(isNull(orderShipments.operationStartedAt), lt(orderShipments.operationStartedAt, leaseExpiredBefore));
  const record = async (tx: Db, tenantId: string, orderId: string, events: readonly EventInput[]) => {
    if (events.length === 0) return;
    await tx.insert(orderShipmentEvents).values(events.map((event) => ({ ...event, tenantId, orderId, provider: 'inpost_shipx' as const })));
  };
  return {
    findByOrder: async (tenantId, orderId) => {
      const [row] = await db.select().from(orderShipments).where(byOrder(tenantId, orderId)).limit(1);
      return row === undefined ? null : toShipment(row);
    },
    acquire: async (tenantId, input) => await db.transaction(async (tx): Promise<ShipxShipmentAcquisition> => {
      const claimed = (row: ShipmentRow, type: 'attempt_claimed' | 'lease_taken_over', details: ShipxShipmentEventDetails) =>
        record(tx, tenantId, input.orderId, [{
          type, providerShipmentId: row.providerShipmentId, actorUserId: input.actorUserId, operationToken: input.token, details, createdAt: input.now,
        }]);
      const [inserted] = await tx.insert(orderShipments).values({
        id: input.id,
        tenantId,
        orderId: input.orderId,
        provider: 'inpost_shipx',
        environment: input.environment,
        organizationId: input.organizationId,
        providerShipmentId: null,
        status: SHIPX_STATUS_CREATING,
        trackingNumber: null,
        operationToken: input.token,
        operationStartedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoNothing().returning();
      if (inserted !== undefined) {
        await claimed(inserted, 'attempt_claimed', { environment: input.environment });
        return { kind: 'acquired', shipment: toShipment(inserted) };
      }
      const [current] = await tx.select().from(orderShipments).where(byOrder(tenantId, input.orderId)).for('update');
      if (current === undefined) throw new Error('Order shipment row vanished while acquiring it');
      const [taken] = await tx.update(orderShipments)
        .set({ operationToken: input.token, operationStartedAt: input.now })
        .where(and(byOrder(tenantId, input.orderId), operationFree(input.leaseExpiredBefore)))
        .returning();
      if (taken === undefined) return { kind: 'in_progress', shipment: toShipment(current) };
      await (current.operationToken === null
        ? claimed(taken, 'attempt_claimed', { environment: taken.environment })
        : claimed(taken, 'lease_taken_over', {
          previousOperationToken: current.operationToken,
          previousOperationStartedAt: isoOrNull(current.operationStartedAt),
        }));
      return { kind: 'acquired', shipment: toShipment(taken) };
    }),
    update: async (tenantId, orderId, token, patch, step) => await db.transaction(async (tx): Promise<ShipxOwnedUpdate> => {
      const [before] = await tx.select().from(orderShipments).where(owned(tenantId, orderId, token)).for('update');
      if (before === undefined) return { kind: 'lost_lock' };
      const [row] = await tx.update(orderShipments).set(patchValues(patch)).where(owned(tenantId, orderId, token)).returning();
      if (row === undefined) return { kind: 'lost_lock' };
      const steps = [
        ...(step.event === null ? [] : [{ type: step.event.type, details: step.event.details ?? null }]),
        ...boughtTransition(before, row),
      ];
      await record(tx, tenantId, orderId, steps.map((event) => ({
        ...event, providerShipmentId: row.providerShipmentId, actorUserId: step.actorUserId, operationToken: token, createdAt: patch.updatedAt,
      })));
      return { kind: 'updated', shipment: toShipment(row) };
    }),
    finishOperation: async (tenantId, orderId, token) => {
      const finished = await db.update(orderShipments)
        .set({ operationToken: null, operationStartedAt: null })
        .where(owned(tenantId, orderId, token))
        .returning({ id: orderShipments.id });
      return finished.length > 0 ? { kind: 'finished' } : { kind: 'lost_lock' };
    },
    release: async (tenantId, orderId, token, audit) => await db.transaction(async (tx): Promise<{ kind: 'released' } | { kind: 'lost_lock' }> => {
      const [removed] = await tx.delete(orderShipments)
        .where(and(owned(tenantId, orderId, token), isNull(orderShipments.providerShipmentId)))
        .returning();
      if (removed === undefined) return { kind: 'lost_lock' };
      await record(tx, tenantId, orderId, [{
        type: 'attempt_released', providerShipmentId: removed.providerShipmentId, actorUserId: audit.actorUserId, operationToken: token, details: attemptDetails(removed), createdAt: audit.at,
      }]);
      return { kind: 'released' };
    }),
    refreshUnclaimed: async (tenantId, orderId, leaseExpiredBefore, patch, actorUserId) => await db.transaction(async (tx) => {
      const [before] = await tx.select().from(orderShipments).where(byOrder(tenantId, orderId)).for('update');
      if (before === undefined) return null;
      const [row] = await tx.update(orderShipments).set(patchValues(patch))
        .where(and(byOrder(tenantId, orderId), operationFree(leaseExpiredBefore)))
        .returning();
      if (row === undefined) return null;
      await record(tx, tenantId, orderId, boughtTransition(before, row).map((event) => ({
        ...event, providerShipmentId: row.providerShipmentId, actorUserId, operationToken: null, createdAt: patch.updatedAt,
      })));
      return toShipment(row);
    }),
    markLabelFetched: async (tenantId, orderId, audit) => {
      await db.transaction(async (tx) => {
        const [row] = await tx.update(orderShipments).set({ labelFetchedAt: audit.at, updatedAt: audit.at }).where(byOrder(tenantId, orderId)).returning();
        if (row === undefined) return;
        await record(tx, tenantId, orderId, [{
          type: 'label_fetched', providerShipmentId: row.providerShipmentId, actorUserId: audit.actorUserId, operationToken: null, details: null, createdAt: audit.at,
        }]);
      });
    },
    discardUnconfirmed: async (tenantId, orderId, leaseExpiredBefore, audit) => await db.transaction(async (tx) => {
      const [removed] = await tx.delete(orderShipments).where(and(
        byOrder(tenantId, orderId),
        isNull(orderShipments.providerShipmentId),
        isNotNull(orderShipments.createAttemptedAt),
        operationFree(leaseExpiredBefore),
      )).returning();
      if (removed === undefined) return false;
      await record(tx, tenantId, orderId, [{
        type: 'attempt_discarded', providerShipmentId: removed.providerShipmentId, actorUserId: audit.actorUserId, operationToken: null, details: attemptDetails(removed), createdAt: audit.at,
      }]);
      return true;
    }),
    listEvents: async (tenantId, orderId) => {
      const rows = await db.select().from(orderShipmentEvents)
        .where(and(eq(orderShipmentEvents.tenantId, tenantId), eq(orderShipmentEvents.orderId, orderId)))
        .orderBy(asc(orderShipmentEvents.createdAt), asc(orderShipmentEvents.sequence));
      return rows.map(toEvent);
    },
  };
};

export const createShipxSettingsRepository = (db: Db): ShipxSettingsRepository => ({
  find: async (tenantId) => {
    const [row] = await db.select({ environment: tenants.shipxEnvironment, sender: tenants.shipxSender })
      .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (row === undefined) return null;
    const sender = row.sender === null ? null : shipxSenderSchema.safeParse(row.sender);
    return {
      environment: shipxEnvironmentSchema.parse(row.environment),
      sender: sender === null || !sender.success ? null : sender.data,
    };
  },
  save: async (tenantId, settings) => {
    await db.update(tenants).set({ shipxEnvironment: settings.environment, shipxSender: settings.sender }).where(eq(tenants.id, tenantId));
  },
});
