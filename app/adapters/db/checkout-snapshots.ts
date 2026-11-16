import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { checkoutSnapshotSchema, type CheckoutSnapshot } from '#core/domain/index.js';
import type { CheckoutSnapshotRepository } from '#core/server/index.js';
import { checkoutSnapshots } from './checkout-snapshot-schema.js';
import type { Db } from './client.js';

const findOne = async (db: Db, ...conditions: SQL[]): Promise<CheckoutSnapshot | null> => {
  const [row] = await db.select().from(checkoutSnapshots).where(and(...conditions)).limit(1);
  if (row === undefined) return null;
  const { clientReference, returnUrl, ...snapshot } = row;
  return checkoutSnapshotSchema.parse({
    ...snapshot, ...(clientReference === null ? {} : { clientReference }), ...(returnUrl === null ? {} : { returnUrl }),
  });
};

export const createCheckoutSnapshotRepository = (db: Db): CheckoutSnapshotRepository => ({
  create: async (tenantId, snapshot) => {
    await db.insert(checkoutSnapshots).values({ ...snapshot, tenantId });
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
