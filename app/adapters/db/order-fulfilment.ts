import { and, eq } from 'drizzle-orm';
import { correctedLinePersonalization, err, notFound, ok, orderDeliveryDetails, orderSchema, orderShipmentAllowed, validation, type AppError, type Result } from '#core/domain/index.js';
import type { OrderFulfilmentRepository, OrderPersonalizationRepository } from '#core/server/index.js';
import type { Db } from './client.js';
import { orders } from './app-schema.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import { orderFulfilmentEvents } from './order-fulfilment-schema.js';
import { normalizeOrderDates } from './order-dates.js';
import { createOrderRepository } from './repositories.js';

export const createOrderFulfilmentRepository = (db: Db): OrderFulfilmentRepository => {
  const details = createOrderRepository(db);
  return {
    ship: async (tenantId, input) => {
      let rejected: Result<never, AppError> | null = null;
      const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId))).for('update');
        if (row === undefined) return err(notFound('Order was not found'));
        const lockedOrder = orderSchema.parse(normalizeOrderDates(row));
        const allowed = orderShipmentAllowed(lockedOrder);
        if (!allowed.ok) return allowed;
        if (input.email !== null && lockedOrder.shipping == null) return err(validation('Order has no delivery details'));
        await tx.update(orders).set({ fulfilmentStatus: 'shipped', shipment: input.shipment })
          .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId)));
        await tx.insert(orderFulfilmentEvents).values({
          id: input.eventId,
          tenantId,
          orderId: input.orderId,
          type: 'shipped',
          payload: { carrier: input.shipment.carrier, trackingNumber: input.shipment.trackingNumber },
          actorUserId: input.shipment.shippedBy,
          occurredAt: input.shipment.shippedAt,
        });
        if (input.email !== null && lockedOrder.shipping != null) {
          const queued = await createEmailOutboxRepository(tx).enqueue({
            ...input.email,
            payload: { ...input.email.payload, shipment: { ...input.email.payload.shipment, delivery: orderDeliveryDetails(lockedOrder.shipping) } },
            tenantId,
            now: input.shipment.shippedAt,
          });
          if (!queued.ok) {
            rejected = queued;
            tx.rollback();
          }
        }
        return ok(undefined);
      }).catch((cause: unknown) => {
        if (rejected !== null) return rejected;
        throw cause;
      });
      if (!result.ok) return result;
      const order = await details.findById(tenantId, input.orderId);
      return order === null ? err(notFound('Order was not found')) : ok(order);
    },
  };
};

export const createOrderPersonalizationRepository = (db: Db): OrderPersonalizationRepository => {
  const details = createOrderRepository(db);
  return {
    correctPersonalization: async (tenantId, input) => {
      const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId))).for('update');
        if (row === undefined) return err(notFound('Order was not found'));
        const lines = orderSchema.parse(normalizeOrderDates(row)).lines ?? [];
        const index = lines.findIndex((line) => line.productId === input.productId && line.personalization !== undefined);
        const line = lines[index];
        if (line === undefined) return err(validation('This order line has no personalisation'));
        const corrected = correctedLinePersonalization(line.personalization, input);
        if (!corrected.ok) return corrected;
        await tx.update(orders).set({ lines: lines.map((item, position) => position === index ? { ...item, personalization: corrected.value } : item) })
          .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId)));
        return ok(undefined);
      });
      if (!result.ok) return result;
      const order = await details.findById(tenantId, input.orderId);
      return order === null ? err(notFound('Order was not found')) : ok(order);
    },
  };
};
