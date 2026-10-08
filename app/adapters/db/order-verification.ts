import { and, eq, or } from 'drizzle-orm';
import { appError, err, notFound, ok, orderSchema, validation } from '#core/domain/index.js';
import type { OrderVerificationRepository } from '#core/server/index.js';
import type { Db } from './client.js';
import { orders } from './app-schema.js';
import { orderIssueEvents } from './order-issue-schema.js';
import { createOrderRepository } from './repositories.js';

export const createOrderVerificationRepository = (db: Db): OrderVerificationRepository => {
  const details = createOrderRepository(db);
  return {
    findByToken: async (tenantId, token) => {
      const [row] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.verificationToken, token))).limit(1);
      return row === undefined ? null : details.findById(tenantId, row.id);
    },
    findByReference: async (tenantId, reference) => {
      const [row] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), or(eq(orders.verificationToken, reference), eq(orders.id, reference)))).limit(1);
      return row === undefined ? null : details.findById(tenantId, row.id);
    },
    issueLine: async (tenantId, input) => {
      const result = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId))).for('update');
        if (row === undefined) return err(notFound('Order was not found'));
        if (row.status !== 'paid') return err(validation('Only paid orders can be issued'));
        const order = orderSchema.parse(row);
        const line = order.lines?.find((item) => item.productId === input.productId);
        if (line === undefined) return err(notFound('Order line was not found'));
        if (line.productType !== 'physical' || line.issuedCount === null) return err(validation('Only physical order lines can be issued'));
        if (line.issuedCount >= 1) return err(appError('conflict', 'Order line has already been issued'));
        const issuedCount = line.issuedCount + 1;
        const lines = order.lines?.map((item) => item.productId === input.productId ? { ...item, issuedCount, issuedAt: item.issuedAt ?? input.occurredAt, issuedBy: item.issuedBy ?? input.staffUserId } : item);
        await tx.update(orders).set({ lines }).where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId)));
        await tx.insert(orderIssueEvents).values({ tenantId, orderId: input.orderId, productId: input.productId, issuedCount, staffUserId: input.staffUserId, occurredAt: input.occurredAt });
        return ok(undefined);
      });
      if (!result.ok) return result;
      const order = await details.findById(tenantId, input.orderId);
      return order === null ? err(notFound('Order was not found')) : ok(order);
    },
  };
};
