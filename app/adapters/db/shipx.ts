import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { SHIPX_STATUS_CREATING, shipxEnvironmentSchema, shipxSenderSchema, shipxShipmentSchema } from '#core/domain/index.js';
import type { ShipxSettingsRepository, ShipxShipmentRecord, ShipxShipmentRepository } from '#core/server/index.js';

import { tenants } from './app-schema.js';
import type { Db } from './client.js';
import { orderShipments } from './shipx-schema.js';

type ShipmentRow = typeof orderShipments.$inferSelect;

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
  operationStartedAt: isoOrNull(row.operationStartedAt),
});

export const createShipxShipmentRepository = (db: Db): ShipxShipmentRepository => {
  const byOrder = (tenantId: string, orderId: string) =>
    and(eq(orderShipments.tenantId, tenantId), eq(orderShipments.orderId, orderId));
  const operationFree = (leaseExpiredBefore: string) =>
    or(isNull(orderShipments.operationStartedAt), lt(orderShipments.operationStartedAt, leaseExpiredBefore));
  return {
    findByOrder: async (tenantId, orderId) => {
      const [row] = await db.select().from(orderShipments).where(byOrder(tenantId, orderId)).limit(1);
      return row === undefined ? null : toShipment(row);
    },
    acquire: async (tenantId, input) => {
      const [inserted] = await db.insert(orderShipments).values({
        id: input.id,
        tenantId,
        orderId: input.orderId,
        provider: 'inpost_shipx',
        environment: input.environment,
        organizationId: input.organizationId,
        providerShipmentId: null,
        status: SHIPX_STATUS_CREATING,
        trackingNumber: null,
        operationStartedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoNothing().returning();
      if (inserted !== undefined) return { kind: 'acquired', shipment: toShipment(inserted) };
      const [taken] = await db.update(orderShipments)
        .set({ operationStartedAt: input.now })
        .where(and(byOrder(tenantId, input.orderId), operationFree(input.leaseExpiredBefore)))
        .returning();
      if (taken !== undefined) return { kind: 'acquired', shipment: toShipment(taken) };
      const [busy] = await db.select().from(orderShipments).where(byOrder(tenantId, input.orderId)).limit(1);
      if (busy === undefined) throw new Error('Order shipment row vanished while acquiring it');
      return { kind: 'in_progress', shipment: toShipment(busy) };
    },
    update: async (tenantId, orderId, patch) => {
      const [row] = await db.update(orderShipments).set({
        ...(patch.shipxShipmentId === undefined ? {} : { providerShipmentId: patch.shipxShipmentId }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.trackingNumber === undefined ? {} : { trackingNumber: patch.trackingNumber }),
        ...(patch.createAttemptedAt === undefined ? {} : { createAttemptedAt: patch.createAttemptedAt }),
        ...(patch.boughtAt === undefined ? {} : { boughtAt: sql`coalesce(${orderShipments.boughtAt}, ${patch.boughtAt}::timestamptz)` }),
        ...(patch.labelFetchedAt === undefined ? {} : { labelFetchedAt: patch.labelFetchedAt }),
        updatedAt: patch.updatedAt,
      }).where(byOrder(tenantId, orderId)).returning();
      return row === undefined ? null : toShipment(row);
    },
    finishOperation: async (tenantId, orderId) => {
      await db.update(orderShipments).set({ operationStartedAt: null }).where(byOrder(tenantId, orderId));
    },
    release: async (tenantId, orderId) => {
      await db.delete(orderShipments).where(and(byOrder(tenantId, orderId), isNull(orderShipments.providerShipmentId)));
    },
    discardUnconfirmed: async (tenantId, orderId, leaseExpiredBefore) => {
      const removed = await db.delete(orderShipments).where(and(
        byOrder(tenantId, orderId),
        isNull(orderShipments.providerShipmentId),
        isNotNull(orderShipments.createAttemptedAt),
        operationFree(leaseExpiredBefore),
      )).returning({ id: orderShipments.id });
      return removed.length > 0;
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
