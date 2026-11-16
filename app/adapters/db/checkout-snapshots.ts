import { and, eq, getTableColumns, isNull, type SQL } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { checkoutSnapshotSchema, type CheckoutSnapshot } from '#core/domain/index.js';
import type { CheckoutSnapshotRepository } from '#core/server/index.js';
import { checkoutSnapshots } from './checkout-snapshot-schema.js';
import type { Db } from './client.js';

// A narrow second mapping of the same table, so whole-row selects of checkoutSnapshots (the legacy golden ones included) keep their column set.
const checkoutSnapshotStorefrontColumns = pgTable('checkout_snapshots', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  clientReference: text('client_reference'),
  returnUrl: text('return_url'),
});

const findOne = async (db: Db, ...conditions: SQL[]): Promise<CheckoutSnapshot | null> => {
  const [row] = await db.select({
    ...getTableColumns(checkoutSnapshots),
    clientReference: checkoutSnapshotStorefrontColumns.clientReference,
    returnUrl: checkoutSnapshotStorefrontColumns.returnUrl,
  }).from(checkoutSnapshots).where(and(...conditions)).limit(1);
  if (row === undefined) return null;
  const { clientReference, returnUrl, ...snapshot } = row;
  return checkoutSnapshotSchema.parse({
    ...snapshot, ...(clientReference === null ? {} : { clientReference }), ...(returnUrl === null ? {} : { returnUrl }),
  });
};

export const createCheckoutSnapshotRepository = (db: Db): CheckoutSnapshotRepository => ({
  create: async (tenantId, { clientReference, returnUrl, ...snapshot }) => {
    if (clientReference == null && returnUrl == null) {
      await db.insert(checkoutSnapshots).values({ ...snapshot, tenantId });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.insert(checkoutSnapshots).values({ ...snapshot, tenantId });
      await tx.update(checkoutSnapshotStorefrontColumns).set({ clientReference: clientReference ?? null, returnUrl: returnUrl ?? null }).where(and(
        eq(checkoutSnapshotStorefrontColumns.tenantId, tenantId), eq(checkoutSnapshotStorefrontColumns.id, snapshot.id),
      ));
    });
  },
  attachProviderSession: async (tenantId, id, providerSessionId) => {
    await db.update(checkoutSnapshots).set({ providerSessionId }).where(and(
      eq(checkoutSnapshots.tenantId, tenantId), eq(checkoutSnapshots.id, id),
      isNull(checkoutSnapshots.providerSessionId),
    ));
  },
  findById: async (tenantId, id) => findOne(db, eq(checkoutSnapshots.tenantId, tenantId), eq(checkoutSnapshots.id, id)),
  findByProviderSession: async (tenantId, providerSessionId) =>
    findOne(db, eq(checkoutSnapshots.tenantId, tenantId), eq(checkoutSnapshots.providerSessionId, providerSessionId)),
});
