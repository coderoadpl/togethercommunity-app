import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { decodeOrderChangeCursor, encodeOrderChangeCursor, listOrderChangesQuerySchema } from '#core/domain/index.js';
import type { OrderChangeRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { orders } from './app-schema.js';
import { orderChanges, orderFeedEpoch } from './order-change-schema.js';

const newEpoch = sql`replace(gen_random_uuid()::text, '-', '')`;
const settled = sql`${orderChanges.xactId} < pg_snapshot_xmin(pg_current_snapshot())`;

const currentEpoch = async (db: Db): Promise<string> => {
  const [row] = await db.select({ epoch: orderFeedEpoch.epoch }).from(orderFeedEpoch);
  if (row === undefined) throw new Error('The order feed epoch row is missing');
  return row.epoch;
};

export const rotateOrderFeedEpoch = async (db: Db): Promise<string> => {
  const [row] = await db.update(orderFeedEpoch).set({ epoch: newEpoch, rotatedAt: sql`now()` }).returning({ epoch: orderFeedEpoch.epoch });
  if (row === undefined) throw new Error('The order feed epoch row is missing');
  return row.epoch;
};

const rotateEpochFrom = async (db: Db, stale: string): Promise<string> => {
  const [row] = await db.update(orderFeedEpoch)
    .set({ epoch: newEpoch, rotatedAt: sql`now()` })
    .where(eq(orderFeedEpoch.epoch, stale))
    .returning({ epoch: orderFeedEpoch.epoch });
  return row?.epoch ?? currentEpoch(db);
};

const readEpoch = async (db: Db, xactId: string | undefined): Promise<{ epoch: string; ahead: boolean }> => {
  const [row] = await db.select({
    epoch: orderFeedEpoch.epoch,
    ahead: xactId === undefined ? sql<boolean>`false` : sql<boolean>`${xactId}::xid8 >= pg_snapshot_xmax(pg_current_snapshot())`,
  }).from(orderFeedEpoch);
  if (row === undefined) throw new Error('The order feed epoch row is missing');
  return row;
};

const tailCursor = async (db: Db, tenantId: string, epoch: string): Promise<string> => {
  const [row] = await db
    .select({ id: sql<string>`${orderChanges.id}::text`, xactId: sql<string>`${orderChanges.xactId}::text` })
    .from(orderChanges)
    .where(and(eq(orderChanges.tenantId, tenantId), settled))
    .orderBy(desc(orderChanges.xactId), desc(orderChanges.id))
    .limit(1);
  return encodeOrderChangeCursor({ epoch, xactId: row?.xactId ?? '0', id: row?.id ?? '0' });
};

export const createOrderChangeRepository = (db: Db): OrderChangeRepository => ({
  listOrderChanges: async (tenantId, query) => {
    const { after, limit, mode } = listOrderChangesQuerySchema.parse(query);
    const position = after === undefined ? null : decodeOrderChangeCursor(after);
    if (after !== undefined && position === null) throw new Error('Order change cursor was not validated');
    const { epoch, ahead } = await readEpoch(db, position?.xactId);
    if (position !== null && position.epoch !== epoch) {
      return { kind: 'reset', cursor: await tailCursor(db, tenantId, epoch) };
    }
    // A position this database has not reached yet comes from another timeline, such as a backup restored over the one the client read.
    if (ahead) return { kind: 'reset', cursor: await tailCursor(db, tenantId, await rotateEpochFrom(db, epoch)) };
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
        settled,
        position === null ? undefined : sql`(${orderChanges.xactId}, ${orderChanges.id}) > (${position.xactId}::xid8, ${position.id}::bigint)`,
      ))
      // Not by id alone: a transaction can take a lower id and commit after a reader has passed a higher one.
      .orderBy(asc(orderChanges.xactId), asc(orderChanges.id))
      .limit(limit);
    return {
      kind: 'changes',
      changes: rows.map((row) => ({
        cursor: encodeOrderChangeCursor({ epoch, xactId: row.xactId, id: row.id }),
        orderId: row.orderId,
        changedAt: new Date(row.changedAt).toISOString(),
      })),
    };
  },
});
