import { z } from 'zod';

const status = z.enum(['active', 'archived']);
const date = z.string().datetime();
export const normalisePartnerCode = (code: string): string => code.trim().toUpperCase();
const code = z.string().transform(normalisePartnerCode).pipe(z.string().min(2).max(40).regex(/^[A-Z0-9-]+$/));
export const partnerProgramInputSchema = z.object({ name: z.string().trim().min(1).max(120), commissionPct: z.number().int().min(1).max(100), graceDays: z.number().int().min(0).max(365).default(14), status: status.default('active'), notes: z.string().max(2000).default('') }).strict();
export const partnerProgramSchema = partnerProgramInputSchema.extend({ id: z.string(), tenantId: z.string(), createdAt: date, revision: z.number().int().positive() });
export const partnerProgramUpdateSchema = partnerProgramInputSchema.extend({ id: z.string().min(1), expectedRevision: z.number().int().positive() });
export type PartnerProgram = z.infer<typeof partnerProgramSchema>;
export const partnerSchema = z.object({ id: z.string(), tenantId: z.string(), programId: z.string(), memberId: z.string(), createdAt: date, status });
export type Partner = z.infer<typeof partnerSchema>;
export const partnerAssignInputSchema = z.object({ programId: z.string().min(1), email: z.string().email() }).strict();
export const partnerUpdateInputSchema = z.object({ id: z.string().min(1), status }).strict();
export const partnerCodeInputSchema = z.object({ programId: z.string().min(1), partnerId: z.string().min(1), code, discountPct: z.number().int().min(0).max(100), salesLinkIds: z.array(z.string().min(1)).min(1), validFrom: date.nullable().default(null), validTo: date.nullable().default(null), maxRedemptions: z.number().int().positive().nullable().default(null), status: status.default('active') }).strict();
export const partnerCodeSchema = partnerCodeInputSchema.extend({ id: z.string(), tenantId: z.string(), stripeCouponId: z.string().nullable(), stripePromotionCodeId: z.string().nullable(), createdAt: date, revision: z.number().int().positive() });
export const partnerCodeUpdateSchema = partnerCodeInputSchema.extend({ id: z.string().min(1), expectedRevision: z.number().int().positive() });
export type PartnerCode = z.infer<typeof partnerCodeSchema>;
export const commissionSchema = z.object({ id: z.string(), tenantId: z.string(), orderId: z.string(), orderLineId: z.string(), programId: z.string(), partnerId: z.string(), partnerCodeId: z.string(), baseCents: z.number().int().nonnegative(), pct: z.number().int().min(0).max(100), amountCents: z.number().int().nonnegative(), status: z.enum(['pending', 'payable', 'paid', 'voided']), payableAt: date, voidedReason: z.string().nullable(), payoutId: z.string().nullable(), createdAt: date });
export type Commission = z.infer<typeof commissionSchema>;
export const commissionForLine = (lineNetBeforeDiscountCents: number, commissionPct: number, discountPct: number): number => Math.max(0, Math.floor((Math.max(0, lineNetBeforeDiscountCents) * Math.max(0, commissionPct - discountPct) + 50) / 100));
export const commissionStatusAt = (commission: Pick<Commission, 'status' | 'payableAt'>, now: string, orderStatus: string): Commission['status'] => {
  if (commission.status !== 'pending') return commission.status;
  if (Date.parse(now) < Date.parse(commission.payableAt) && ['refunded', 'disputed'].includes(orderStatus)) return 'voided';
  return Date.parse(now) >= Date.parse(commission.payableAt) && orderStatus === 'paid' ? 'payable' : 'pending';
};
export const validatePartnerCode = (partnerCode: PartnerCode, input: { now: string; salesLinkId: string | null; totalRedemptions: number }): boolean => partnerCode.status === 'active' && input.salesLinkId !== null && partnerCode.salesLinkIds.includes(input.salesLinkId) && (partnerCode.validFrom === null || Date.parse(input.now) >= Date.parse(partnerCode.validFrom)) && (partnerCode.validTo === null || Date.parse(input.now) < Date.parse(partnerCode.validTo)) && (partnerCode.maxRedemptions === null || input.totalRedemptions < partnerCode.maxRedemptions);
export const partnerProgramSummarySchema = z.object({ program: partnerProgramSchema, partnerCount: z.number().int().nonnegative(), codeCount: z.number().int().nonnegative(), currencyTotals: z.array(z.object({ currency: z.string().length(3), pendingCents: z.number().int().nonnegative(), payableCents: z.number().int().nonnegative(), paidCents: z.number().int().nonnegative() })) });
export const partnerDetailSchema = partnerSchema.extend({ email: z.string().email() });

export const partnerCheckoutReservationSchema = z.object({ checkoutSnapshotId: z.string().min(1), sessionId: z.string().min(1).nullable() });
export type PartnerCheckoutReservation = z.infer<typeof partnerCheckoutReservationSchema>;
