import { and, eq, lt, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import { appError, err, ok, commissionSchema, commissionStatusAt, partnerCodeSchema, partnerProgramSchema, partnerSchema } from '#core/domain/index.js';
import type { PartnerRepository } from '#core/server/index.js';
import { createPartnerCheckoutReservations } from './partner-checkout-reservations.js';
import type { Db } from './client.js';
import { coupons, orders, members } from './app-schema.js';
import { partnerCodes, partnerPrograms, partners, commissions, partnerEvents } from './partner-schema.js';
import { salesLinks } from './sales-link-schema.js';

const iso = (value: string) => new Date(value).toISOString();
const programRow = (row: typeof partnerPrograms.$inferSelect) => partnerProgramSchema.parse({ ...row, createdAt: iso(row.createdAt) });
const partnerRow = (row: typeof partners.$inferSelect) => partnerSchema.parse({ ...row, createdAt: iso(row.createdAt) });
const codeRow = (row: typeof partnerCodes.$inferSelect) => partnerCodeSchema.parse({ ...row, createdAt: iso(row.createdAt), validFrom: row.validFrom === null ? null : iso(row.validFrom), validTo: row.validTo === null ? null : iso(row.validTo) });
const commissionRow = (row: typeof commissions.$inferSelect) => commissionSchema.parse({ ...row, createdAt: iso(row.createdAt), payableAt: iso(row.payableAt) });
export const createPartnerRepository = (db: Db): PartnerRepository => ({
  ...createPartnerCheckoutReservations(db),
  listPrograms: async (tenantId) => (await db.select().from(partnerPrograms).where(eq(partnerPrograms.tenantId, tenantId))).map(programRow),
  findProgram: async (tenantId, id) => {
    const [row] = await db.select().from(partnerPrograms).where(and(eq(partnerPrograms.tenantId, tenantId), eq(partnerPrograms.id, id)));
    return row === undefined ? null : programRow(row);
  },
  saveProgram: async (tenantId, input, expectedRevision) => db.transaction(async (tx) => {
    const value = partnerProgramSchema.parse({ ...input, tenantId });
    if (expectedRevision !== null) {
      const [existing] = await tx.select().from(partnerPrograms).where(and(eq(partnerPrograms.tenantId, tenantId), eq(partnerPrograms.id, value.id))).for('update');
      if (existing?.revision !== expectedRevision) return err(appError('conflict', 'Partner program changed; reload before saving'));
      const [excessiveDiscount] = await tx.select({ id: partnerCodes.id }).from(partnerCodes).where(and(eq(partnerCodes.tenantId, tenantId), eq(partnerCodes.programId, value.id), gt(partnerCodes.discountPct, value.commissionPct))).limit(1);
      if (excessiveDiscount !== undefined) return err(appError('validation', 'Program commission cannot be lower than an existing code discount'));
    }
    const rows = expectedRevision === null ? await tx.insert(partnerPrograms).values(value).onConflictDoNothing().returning() : await tx.update(partnerPrograms).set(value).where(and(eq(partnerPrograms.tenantId, tenantId), eq(partnerPrograms.id, value.id), eq(partnerPrograms.revision, expectedRevision))).returning();
    const row = rows[0];
    if (row === undefined) return err(appError('conflict', 'Partner program changed; reload before saving'));
    await tx.insert(partnerEvents).values({ id: `program:${value.id}:${value.revision}`, tenantId, entityId: value.id, entityType: 'program', type: expectedRevision === null ? 'created' : 'updated', snapshot: value, occurredAt: new Date().toISOString() });
    return ok(programRow(row));
  }),
  listPartners: async (tenantId, programId) => (await db.select().from(partners).where(and(eq(partners.tenantId, tenantId), eq(partners.programId, programId)))).map(partnerRow),
  findPartner: async (tenantId, id) => {
    const [row] = await db.select().from(partners).where(and(eq(partners.tenantId, tenantId), eq(partners.id, id)));
    return row === undefined ? null : partnerRow(row);
  },
  savePartner: async (tenantId, input) => db.transaction(async (tx) => {
    const value = partnerSchema.parse({ ...input, tenantId });
    const [program] = await tx.select({ id: partnerPrograms.id }).from(partnerPrograms).where(and(eq(partnerPrograms.tenantId, tenantId), eq(partnerPrograms.id, value.programId)));
    const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.tenantId, tenantId), eq(members.id, value.memberId)));
    if (program === undefined || member === undefined) return err(appError('validation', 'Program and member must belong to this workspace'));
    const [existing] = await tx.select().from(partners).where(and(eq(partners.tenantId, tenantId), eq(partners.id, value.id))).for('update');
    const rows = existing === undefined ? await tx.insert(partners).values(value).onConflictDoNothing().returning() : await tx.update(partners).set({ status: value.status }).where(and(eq(partners.tenantId, tenantId), eq(partners.id, value.id))).returning();
    const row = rows[0];
    if (row === undefined) return err(appError('conflict', 'This member is already a partner of the program'));
    const occurredAt = new Date().toISOString();
    await tx.insert(partnerEvents).values({ id: crypto.randomUUID(), tenantId, entityId: value.id, entityType: 'partner', type: existing === undefined ? 'created' : 'updated', snapshot: value, occurredAt });
    return ok(partnerRow(row));
  }),
  listCodes: async (tenantId, programId) => (await db.select().from(partnerCodes).where(and(eq(partnerCodes.tenantId, tenantId), eq(partnerCodes.programId, programId)))).map(codeRow),
  findCode: async (tenantId, id) => {
    const [row] = await db.select().from(partnerCodes).where(and(eq(partnerCodes.tenantId, tenantId), eq(partnerCodes.id, id)));
    return row === undefined ? null : codeRow(row);
  },
  findCodeByCode: async (tenantId, code) => {
    const [row] = await db.select().from(partnerCodes).where(and(eq(partnerCodes.tenantId, tenantId), sql`lower(${partnerCodes.code}) = lower(${code})`));
    return row === undefined ? null : codeRow(row);
  },
  saveCode: async (tenantId, input, expectedRevision) => db.transaction(async (tx) => {
    const value = partnerCodeSchema.parse({ ...input, tenantId });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sales-links:${tenantId}`}, 0))`);
    if (value.status === 'active') {
      const offers = await tx.select().from(salesLinks).where(and(eq(salesLinks.tenantId, tenantId), inArray(salesLinks.id, value.salesLinkIds), isNull(salesLinks.deletedAt)));
      if (offers.length !== value.salesLinkIds.length) return err(appError('validation', 'Every offer must belong to this workspace'));
      const disabled = offers.find((offer) => !offer.allowsCodes);
      if (disabled !== undefined) return err(appError('validation', `Discount codes are disabled for offer: ${disabled.title}`, { reason: 'sales_link_codes_disabled', salesLinkTitle: disabled.title }));
    }
    const [program] = await tx.select().from(partnerPrograms).where(and(eq(partnerPrograms.tenantId, tenantId), eq(partnerPrograms.id, value.programId))).for('share');
    const [partner] = await tx.select().from(partners).where(and(eq(partners.tenantId, tenantId), eq(partners.id, value.partnerId), eq(partners.programId, value.programId)));
    if (program === undefined || partner === undefined || value.discountPct > program.commissionPct) return err(appError('validation', 'Invalid partner code program or partner'));
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`discount-codes:${tenantId}`}, 0))`);
    const [coupon] = await tx.select({ id: coupons.id }).from(coupons).where(and(eq(coupons.tenantId, tenantId), sql`lower(${coupons.code}) = lower(${value.code})`));
    const [duplicate] = await tx.select({ id: partnerCodes.id }).from(partnerCodes).where(and(eq(partnerCodes.tenantId, tenantId), sql`lower(${partnerCodes.code}) = lower(${value.code})`));
    if (coupon !== undefined || (duplicate !== undefined && duplicate.id !== value.id)) return err(appError('conflict', 'A discount code with this code already exists'));
    const rows = expectedRevision === null ? await tx.insert(partnerCodes).values(value).onConflictDoNothing().returning() : await tx.update(partnerCodes).set(value).where(and(eq(partnerCodes.tenantId, tenantId), eq(partnerCodes.id, value.id), eq(partnerCodes.revision, expectedRevision))).returning();
    const row = rows[0];
    if (row === undefined) return err(appError('conflict', 'Partner code changed; reload before saving'));
    await tx.insert(partnerEvents).values({ id: `code:${value.id}:${value.revision}`, tenantId, entityId: value.id, entityType: 'code', type: expectedRevision === null ? 'created' : 'updated', snapshot: value, occurredAt: new Date().toISOString() });
    return ok(codeRow(row));
  }),
  cacheStripeIds: async (tenantId, id, stripeIds, expectedRevision) => {
    const [row] = await db.update(partnerCodes).set(stripeIds).where(and(eq(partnerCodes.tenantId, tenantId), eq(partnerCodes.id, id), eq(partnerCodes.revision, expectedRevision), eq(partnerCodes.status, 'active'))).returning();
    return row === undefined ? null : codeRow(row);
  },
  hasActiveCodeForSalesLink: async (tenantId, salesLinkId) => {
    const [row] = await db.select({ id: partnerCodes.id }).from(partnerCodes).where(and(eq(partnerCodes.tenantId, tenantId), eq(partnerCodes.status, 'active'), sql`${partnerCodes.salesLinkIds} @> ${JSON.stringify([salesLinkId])}::jsonb`)).limit(1);
    return row !== undefined;
  },
  listCommissions: async (tenantId, programId, now) => (await db.select({ commission: commissions, orderStatus: orders.status }).from(commissions).innerJoin(orders, and(eq(orders.tenantId, tenantId), eq(orders.id, commissions.orderId))).where(and(eq(commissions.tenantId, tenantId), eq(commissions.programId, programId)))).map(({ commission, orderStatus }) => {
    const parsed = commissionRow(commission);
    return { ...parsed, status: commissionStatusAt(parsed, now, orderStatus) };
  }),
  createCommissions: async (tenantId, entries) => {
    if (entries.length === 0) return;
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(commissions).values(entries.map((entry) => commissionSchema.parse({ ...entry, tenantId }))).onConflictDoNothing().returning();
      if (inserted.length > 0) await tx.insert(partnerEvents).values(inserted.map((entry) => ({ id: `commission:${entry.id}:created`, tenantId, entityId: entry.id, entityType: 'commission', type: 'created', snapshot: commissionRow(entry), occurredAt: entry.createdAt })));
    });
  },
  voidPendingCommissions: async (tenantId, orderId, reason, now) => db.transaction(async (tx) => {
    const pending = and(eq(commissions.tenantId, tenantId), eq(commissions.orderId, orderId), eq(commissions.status, 'pending'));
    const voided = await tx.update(commissions).set({ status: 'voided', voidedReason: reason }).where(and(pending, lt(sql`${now}::timestamptz`, commissions.payableAt))).returning();
    const matured = await tx.update(commissions).set({ status: 'payable' }).where(and(pending, gte(sql`${now}::timestamptz`, commissions.payableAt))).returning();
    const changed = [...voided, ...matured];
    if (changed.length > 0) await tx.insert(partnerEvents).values(changed.map((entry) => ({ id: `commission:${entry.id}:${entry.status}`, tenantId, entityId: entry.id, entityType: 'commission', type: entry.status, snapshot: commissionRow(entry), occurredAt: now })));
  }),
});
