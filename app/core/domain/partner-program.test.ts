import { describe, expect, it } from 'vitest';
import { commissionForLine, commissionStatusAt, normalisePartnerCode, partnerCodeSchema, partnerProgramSchema, validatePartnerCode } from './partner-program.js';

const now = '2026-10-13T12:00:00.000Z';
const code = partnerCodeSchema.parse({ id: 'code', tenantId: 'tenant', programId: 'program', partnerId: 'partner', code: ' friend10 ', discountPct: 10, salesLinkIds: ['offer'], stripeCouponId: null, stripePromotionCodeId: null, createdAt: now, revision: 1 });
describe('partner program rules', () => {
  it('calculates commission from net before discount with half-up cent rounding', () => {
    expect(commissionForLine(10000, 50, 10)).toBe(4000);
    expect(commissionForLine(5, 50, 0)).toBe(3);
    expect(commissionForLine(1, 49, 0)).toBe(0);
    expect(commissionForLine(10000, 50, 50)).toBe(0);
    expect(commissionForLine(10000, 10, 50)).toBe(0);
    expect(commissionForLine(-100, 50, 10)).toBe(0);
  });
  it('normalises and validates code alphabet and length', () => {
    expect(normalisePartnerCode(' friend-10 ')).toBe('FRIEND-10');
    expect(code.code).toBe('FRIEND10');
    for (const invalid of ['A', 'A_B', 'A'.repeat(41), 'A B']) expect(partnerCodeSchema.safeParse({ ...code, code: invalid }).success).toBe(false);
  });
  it('enforces offer scope, active state, validity boundaries and redemption limits', () => {
    const input = { now, salesLinkId: 'offer', totalRedemptions: 0 };
    expect(validatePartnerCode(code, input)).toBe(true);
    expect(validatePartnerCode(code, { ...input, salesLinkId: null })).toBe(false);
    expect(validatePartnerCode(code, { ...input, salesLinkId: 'foreign' })).toBe(false);
    expect(validatePartnerCode({ ...code, status: 'archived' }, input)).toBe(false);
    expect(validatePartnerCode({ ...code, validFrom: '2026-10-14T12:00:00.000Z' }, input)).toBe(false);
    expect(validatePartnerCode({ ...code, validFrom: now }, input)).toBe(true);
    expect(validatePartnerCode({ ...code, validTo: now }, input)).toBe(false);
    expect(validatePartnerCode({ ...code, maxRedemptions: 1 }, { ...input, totalRedemptions: 1 })).toBe(false);
  });
  it('changes pending status only within the paid and grace rules', () => {
    const pending = { status: 'pending' as const, payableAt: now };
    expect(commissionStatusAt(pending, now, 'paid')).toBe('payable');
    expect(commissionStatusAt(pending, '2026-10-12T12:00:00.000Z', 'paid')).toBe('pending');
    expect(commissionStatusAt(pending, '2026-10-12T12:00:00.000Z', 'refunded')).toBe('voided');
    expect(commissionStatusAt(pending, '2026-10-12T12:00:00.000Z', 'disputed')).toBe('voided');
    expect(commissionStatusAt({ ...pending, status: 'paid' }, now, 'refunded')).toBe('paid');
    expect(commissionStatusAt({ ...pending, status: 'voided' }, now, 'paid')).toBe('voided');
    expect(commissionStatusAt(pending, now, 'created')).toBe('pending');
  });
  it('enforces program commission and grace bounds', () => {
    const program = { id: 'program', tenantId: 'tenant', name: 'Partners', commissionPct: 50, createdAt: now, revision: 1 };
    expect(partnerProgramSchema.parse(program).graceDays).toBe(14);
    for (const commissionPct of [0, 101, 1.5]) expect(partnerProgramSchema.safeParse({ ...program, commissionPct }).success).toBe(false);
    expect(partnerProgramSchema.safeParse({ ...program, graceDays: 366 }).success).toBe(false);
  });
});
