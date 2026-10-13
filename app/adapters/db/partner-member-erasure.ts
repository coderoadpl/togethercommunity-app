import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { partnerCodes, partnerEvents, partners } from './partner-schema.js';

export const archiveMemberPartners = async (
  tx: Db,
  tenantId: string,
  memberId: string,
  occurredAt: string,
): Promise<string[]> => {
  const memberPartners = await tx.select().from(partners).where(and(
    eq(partners.tenantId, tenantId), eq(partners.memberId, memberId),
  )).for('update');
  if (memberPartners.length === 0) return [];
  const partnerIds = memberPartners.map((partner) => partner.id);
  const archivedPartners = await tx.update(partners).set({ status: 'archived' }).where(and(
    eq(partners.tenantId, tenantId), inArray(partners.id, partnerIds), eq(partners.status, 'active'),
  )).returning();
  const archivedCodes = await tx.update(partnerCodes).set({ status: 'archived', revision: sql`${partnerCodes.revision} + 1` }).where(and(
    eq(partnerCodes.tenantId, tenantId), inArray(partnerCodes.partnerId, partnerIds), eq(partnerCodes.status, 'active'),
  )).returning();
  const events = [
    ...archivedPartners.map((partner) => ({ id: `partner:${partner.id}:member-erased`, tenantId, entityId: partner.id, entityType: 'partner', type: 'member-erased', snapshot: partner, occurredAt })),
    ...archivedCodes.map((code) => ({ id: `code:${code.id}:${code.revision}`, tenantId, entityId: code.id, entityType: 'code', type: 'member-erased', snapshot: code, occurredAt })),
  ];
  if (events.length > 0) await tx.insert(partnerEvents).values(events);
  const codes = await tx.select({ promotionId: partnerCodes.stripePromotionCodeId }).from(partnerCodes).where(and(
    eq(partnerCodes.tenantId, tenantId), inArray(partnerCodes.partnerId, partnerIds),
  ));
  return codes.flatMap((code) => code.promotionId === null ? [] : [code.promotionId]);
};
