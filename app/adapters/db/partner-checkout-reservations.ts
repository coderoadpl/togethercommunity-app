import { and, count, eq, ne } from 'drizzle-orm';
import { err, ok, checkoutSnapshotSchema, partnerCodeSchema, validatePartnerCode, validation } from '#core/domain/index.js';
import type { PartnerRepository } from '#core/server/index.js';
import { orders } from './app-schema.js';
import { checkoutSnapshots } from './checkout-snapshot-schema.js';
import { partnerCheckoutReservations, partnerCodes, partnerEvents, partnerPrograms, partners } from './partner-schema.js';
import type { Db } from './client.js';

const unavailable = () => err(validation('Coupon cannot be applied'));
const countUsed = async (db: Db, tenantId: string, partnerCodeId: string, excludeOrderId?: string) => {
  const [ordered] = await db.select({ total: count() }).from(orders).where(and(
    eq(orders.tenantId, tenantId), eq(orders.partnerCodeId, partnerCodeId), eq(orders.mode, 'live'),
    excludeOrderId === undefined ? undefined : ne(orders.id, excludeOrderId),
  ));
  const [reserved] = await db.select({ total: count() }).from(partnerCheckoutReservations).where(and(
    eq(partnerCheckoutReservations.tenantId, tenantId), eq(partnerCheckoutReservations.partnerCodeId, partnerCodeId), eq(partnerCheckoutReservations.status, 'reserved'),
  ));
  return (ordered?.total ?? 0) + (reserved?.total ?? 0);
};

export const createPartnerCheckoutReservations = (db: Db): Pick<PartnerRepository, 'countRedemptions' | 'reserveCheckout' | 'attachCheckoutSession' | 'releaseCheckout' | 'completeCheckout'> => ({
  countRedemptions: (tenantId, partnerCodeId) => countUsed(db, tenantId, partnerCodeId),
  reserveCheckout: (tenantId, input) => db.transaction(async (tx) => {
    const snapshot = checkoutSnapshotSchema.parse({ ...input, tenantId });
    if (snapshot.partnerCodeId == null || snapshot.salesLinkId === null || snapshot.mode === 'test') return unavailable();
    const [code] = await tx.select().from(partnerCodes).where(and(eq(partnerCodes.tenantId, tenantId), eq(partnerCodes.id, snapshot.partnerCodeId))).for('update');
    if (code === undefined) return unavailable();
    const [program] = await tx.select().from(partnerPrograms).where(and(eq(partnerPrograms.tenantId, tenantId), eq(partnerPrograms.id, code.programId)));
    const [partner] = await tx.select().from(partners).where(and(eq(partners.tenantId, tenantId), eq(partners.id, code.partnerId)));
    const parsed = partnerCodeSchema.parse({ ...code, createdAt: new Date(code.createdAt).toISOString(), validFrom: code.validFrom === null ? null : new Date(code.validFrom).toISOString(), validTo: code.validTo === null ? null : new Date(code.validTo).toISOString() });
    if (program?.status !== 'active' || partner?.status !== 'active' || snapshot.partnerTerms?.commissionPct !== program.commissionPct || snapshot.partnerTerms.discountPct !== code.discountPct || snapshot.partnerTerms.graceDays !== program.graceDays || !validatePartnerCode(parsed, { now: snapshot.createdAt, salesLinkId: snapshot.salesLinkId, totalRedemptions: await countUsed(tx, tenantId, code.id) })) return unavailable();
    await tx.insert(checkoutSnapshots).values({ ...snapshot, tenantId });
    const reservation = { id: snapshot.id, tenantId, partnerCodeId: code.id, status: 'reserved' as const, orderId: null, createdAt: snapshot.createdAt };
    await tx.insert(partnerCheckoutReservations).values(reservation);
    await tx.insert(partnerEvents).values({ id: `reservation:${snapshot.id}:reserved`, tenantId, entityId: snapshot.id, entityType: 'reservation', type: 'reserved', snapshot: reservation, occurredAt: snapshot.createdAt });
    return ok(undefined);
  }),
  attachCheckoutSession: async (tenantId, checkoutSnapshotId, providerSessionId) => {
    await db.update(checkoutSnapshots).set({ providerSessionId }).where(and(eq(checkoutSnapshots.tenantId, tenantId), eq(checkoutSnapshots.id, checkoutSnapshotId)));
  },
  releaseCheckout: async (tenantId, checkoutSnapshotId, now) => {
    await db.transaction(async (tx) => {
      const [released] = await tx.update(partnerCheckoutReservations).set({ status: 'released' }).where(and(eq(partnerCheckoutReservations.tenantId, tenantId), eq(partnerCheckoutReservations.id, checkoutSnapshotId), eq(partnerCheckoutReservations.status, 'reserved'))).returning();
      if (released !== undefined) await tx.insert(partnerEvents).values({ id: `reservation:${checkoutSnapshotId}:released`, tenantId, entityId: checkoutSnapshotId, entityType: 'reservation', type: 'released', snapshot: released, occurredAt: now });
    });
  },
  completeCheckout: (tenantId, checkoutSnapshotId, orderId, now) => db.transaction(async (tx) => {
    const [snapshot] = await tx.select().from(checkoutSnapshots).where(and(eq(checkoutSnapshots.tenantId, tenantId), eq(checkoutSnapshots.id, checkoutSnapshotId)));
    if (snapshot?.partnerCodeId == null) return unavailable();
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId), eq(orders.partnerCodeId, snapshot.partnerCodeId), eq(orders.mode, 'live')));
    if (order === undefined) return unavailable();
    const [code] = await tx.select().from(partnerCodes).where(and(eq(partnerCodes.tenantId, tenantId), eq(partnerCodes.id, snapshot.partnerCodeId))).for('update');
    const [reservation] = await tx.select().from(partnerCheckoutReservations).where(and(eq(partnerCheckoutReservations.tenantId, tenantId), eq(partnerCheckoutReservations.id, checkoutSnapshotId))).for('update');
    if (reservation?.status === 'consumed') return reservation.orderId === orderId ? ok(undefined) : unavailable();
    if (code === undefined || reservation?.status === 'released') return unavailable();
    if (reservation === undefined && code.maxRedemptions !== null && await countUsed(tx, tenantId, code.id, orderId) >= code.maxRedemptions) return unavailable();
    const consumed = { id: checkoutSnapshotId, tenantId, partnerCodeId: code.id, status: 'consumed' as const, orderId, createdAt: snapshot.createdAt };
    if (reservation === undefined) await tx.insert(partnerCheckoutReservations).values(consumed);
    else await tx.update(partnerCheckoutReservations).set({ status: 'consumed', orderId }).where(and(eq(partnerCheckoutReservations.tenantId, tenantId), eq(partnerCheckoutReservations.id, checkoutSnapshotId)));
    await tx.insert(partnerEvents).values({ id: `reservation:${checkoutSnapshotId}:consumed`, tenantId, entityId: checkoutSnapshotId, entityType: 'reservation', type: 'consumed', snapshot: consumed, occurredAt: now });
    return ok(undefined);
  }),
});
