import { and, eq } from 'drizzle-orm';
import { appError, correctedOrderShipping, deliveryCorrectionAllowed, err, notFound, ok, orderSchema, validation } from '#core/domain/index.js';
import type { OrderDeliveryRepository } from '#core/server/index.js';
import { members, orders } from './app-schema.js';
import type { Db } from './client.js';
import { normalizeOrderDates } from './order-dates.js';
import { createOrderRepository } from './repositories.js';
import { orderShipments } from './shipx-schema.js';

export const createOrderDeliveryRepository = (db: Db): OrderDeliveryRepository => ({
  correctDelivery: async (tenantId, command) => {
    const orderId = command.input.orderId;
    const result = await db.transaction(async (tx) => {
      const [owner] = await tx.select({ memberId: orders.memberId }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
      if (owner === undefined) return err(notFound('Order was not found'));
      const [member] = await tx.select({ deletedAt: members.deletedAt }).from(members).where(and(eq(members.tenantId, tenantId), eq(members.id, owner.memberId))).for('update');
      if (member === undefined || member.deletedAt !== null) return err(appError('delivery_correction_member_erased', 'The member has been erased'));
      const [row] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).for('update');
      if (row === undefined || row.memberId !== owner.memberId) return err(notFound('Order was not found'));
      const shipments = await tx.select().from(orderShipments).where(and(eq(orderShipments.tenantId, tenantId), eq(orderShipments.orderId, orderId))).for('update');
      const order = orderSchema.parse(normalizeOrderDates(row));
      const allowed = deliveryCorrectionAllowed(order, shipments);
      if (!allowed.ok) return allowed;
      if (order.shipping == null) return err(validation('Order has no delivery details'));
      const corrected = correctedOrderShipping(order.shipping, command);
      if (!corrected.ok) return corrected;
      await tx.update(orders).set({ shipping: corrected.value }).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
      const updated = await createOrderRepository(tx).findById(tenantId, orderId);
      return updated === null ? err(notFound('Order was not found')) : ok({ order: updated, recreateShipment: false });
    });
    return result;
  },
});
