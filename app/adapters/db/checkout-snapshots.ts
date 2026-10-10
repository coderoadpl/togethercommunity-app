import { and, eq } from 'drizzle-orm';
import { checkoutSnapshotSchema } from '#core/domain/index.js';
import type { CheckoutSnapshotRepository } from '#core/server/index.js';
import { checkoutSnapshots } from './checkout-snapshot-schema.js';
import type { Db } from './client.js';


export const createCheckoutSnapshotRepository = (db: Db): CheckoutSnapshotRepository => ({
  create: async (tenantId, snapshot) => {
    await db.insert(checkoutSnapshots).values({ ...snapshot, tenantId });
  },
  findById: async (tenantId, id) => {
    const [row] = await db.select().from(checkoutSnapshots).where(and(
      eq(checkoutSnapshots.tenantId, tenantId), eq(checkoutSnapshots.id, id),
    )).limit(1);
    return row === undefined ? null : checkoutSnapshotSchema.parse(row);
  },
});
