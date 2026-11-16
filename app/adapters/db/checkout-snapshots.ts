import { and, eq, getTableColumns, isNull } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { checkoutSnapshotSchema } from '#core/domain/index.js';
import type { CheckoutSnapshotRepository } from '#core/server/index.js';
import { checkoutSnapshots } from './checkout-snapshot-schema.js';
import type { Db } from './client.js';

// A narrow second mapping of the same table, so whole-row selects of checkoutSnapshots (the legacy golden ones included) keep their column set.
const checkoutSnapshotClientReferences = pgTable('checkout_snapshots', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clientReference: text('client_reference'),
});

export const createCheckoutSnapshotRepository = (db: Db): CheckoutSnapshotRepository => ({
  create: async (tenantId, { clientReference, ...snapshot }) => {
    if (clientReference == null) {
      await db.insert(checkoutSnapshots).values({ ...snapshot, tenantId });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.insert(checkoutSnapshots).values({ ...snapshot, tenantId });
      await tx.update(checkoutSnapshotClientReferences).set({ clientReference }).where(and(
        eq(checkoutSnapshotClientReferences.tenantId, tenantId), eq(checkoutSnapshotClientReferences.id, snapshot.id),
      ));
    });
  },
  attachProviderSession: async (tenantId, id, providerSessionId) => {
    await db.update(checkoutSnapshots).set({ providerSessionId }).where(and(
      eq(checkoutSnapshots.tenantId, tenantId), eq(checkoutSnapshots.id, id),
      isNull(checkoutSnapshots.providerSessionId),
    ));
  },
  findById: async (tenantId, id) => {
    const [row] = await db.select({
      ...getTableColumns(checkoutSnapshots),
      clientReference: checkoutSnapshotClientReferences.clientReference,
    }).from(checkoutSnapshots).where(and(
      eq(checkoutSnapshots.tenantId, tenantId), eq(checkoutSnapshots.id, id),
    )).limit(1);
    if (row === undefined) return null;
    const { clientReference, ...snapshot } = row;
    return checkoutSnapshotSchema.parse(clientReference === null ? snapshot : { ...snapshot, clientReference });
  },
});
