import { and, asc, eq, sql, type SQL } from 'drizzle-orm';

import { decodeOrderChangeCursor, encodeOrderChangeCursor, listOrderChangesQuerySchema } from '#core/domain/index.js';
import type { OrderChangeRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { orders } from './app-schema.js';
import { orderChanges } from './order-change-schema.js';

const afterCursor = (cursor: string | undefined): SQL | undefined => {
  if (cursor === undefined) return undefined;
  const position = decodeOrderChangeCursor(cursor);
  if (position === null) throw new Error('Order change cursor was not validated');
  return sql`(${orderChanges.xactId}, ${orderChanges.id}) > (${position.xactId}::xid8, ${position.id}::bigint)`;
};

export const createOrderChangeRepository = (db: Db): OrderChangeRepository => ({
  listOrderChanges: async (tenantId, query) => {
    const { after, limit, mode } = listOrderChangesQuerySchema.parse(query);
    const rows = await db
      .select({
        id: sql<string>`${orderChanges.id}::text`,
        xactId: sql<string>`${orderChanges.xactId}::text`,
        orderId: orderChanges.orderId,
        changedAt: orderChanges.changedAt,
      })
      .from(orderChanges)
      .innerJoin(orders, and(eq(orders.tenantId, orderChanges.tenantId), eq(orders.id, orderChanges.orderId)))
      .where(and(
        eq(orderChanges.tenantId, tenantId),
        mode === undefined ? undefined : eq(orders.mode, mode),
        sql`${orderChanges.xactId} < pg_snapshot_xmin(pg_current_snapshot())`,
        afterCursor(after),
      ))
      // Not by id alone: a transaction can take a lower id and commit after a reader has passed a higher one.
      .orderBy(asc(orderChanges.xactId), asc(orderChanges.id))
      .limit(limit);
    return rows.map((row) => ({
      cursor: encodeOrderChangeCursor({ xactId: row.xactId, id: row.id }),
      orderId: row.orderId,
      changedAt: new Date(row.changedAt).toISOString(),
    }));
  },
});
