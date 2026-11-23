import { describe, expect, it } from 'vitest';

import { capabilitiesForPrincipal, isImpersonationReadCapability, PRINCIPALS, requiresVerifiedEmail } from './authorization.js';
import {
  minorUnitsFromDecimal,
  newOrderStaffRefund,
  orderRefundIdempotencyKey,
  orderRefundTotals,
  refundableRemainderCents,
  resolveStaffRefundAmount,
  resolveStaffRefundChoices,
  shopManagementCapabilities,
  shopManagementScopeSchema,
  staffRefundFulfilmentOptions,
  staffRefundMatchesRequest,
  staffRefundOrderBlocker,
} from './index.js';

const now = '2026-11-22T10:00:00.000Z';

const refund = (overrides: Partial<Parameters<typeof newOrderStaffRefund>[0]> = {}) => newOrderStaffRefund({
  id: 'refund-1', tenantId: 'tenant-a', orderId: 'order-1', paymentIntentId: 'pi_1', currency: 'PLN', kind: 'amount', amountCents: 1500,
  requestKey: 'req-1', requestedByUserId: 'user-1', requestedByEmail: 'owner@example.com', note: '  damaged cover  ', restocked: false,
  removedFromPackingList: false, now, ...overrides,
});

const paidOrder = {
  status: 'paid' as const, provider: 'stripe' as const, providerObjectIds: { paymentIntent: 'pi_1' }, amountCents: 4099, cancelReason: null,
};

describe('staff refund rules', () => {
  it('grants order:refund to owners and admins only, behind a verified e-mail and never under impersonation or a shop key', () => {
    expect(PRINCIPALS.filter((principal) => capabilitiesForPrincipal(principal).includes('order:refund'))).toStrictEqual(['owner', 'admin']);
    expect(requiresVerifiedEmail('order:refund')).toBe(true);
    expect(isImpersonationReadCapability('order:refund')).toBe(false);
    for (const scope of shopManagementScopeSchema.options) {
      expect(shopManagementCapabilities([scope], 'direct')).not.toContain('order:refund');
      expect(shopManagementCapabilities([scope], 'propose')).not.toContain('order:refund');
    }
  });

  it('keys the provider request by the refund id with the shared generation rule', () => {
    const created = refund();
    expect(created).toMatchObject({ idempotencyKey: 'staff-refund-refund-1', status: 'pending', nextAttemptAt: now, note: 'damaged cover', buyerNotifiedAt: null });
    expect(orderRefundIdempotencyKey(created)).toBe('staff-refund-refund-1');
    expect(orderRefundIdempotencyKey({ ...created, keyGeneration: 2 })).toBe('staff-refund-refund-1-2');
    expect(refund({ note: '   ' }).note).toBeNull();
    expect(() => refund({ note: 'x'.repeat(501) })).toThrow();
  });

  it('takes the larger of the provider and platform committed sums from the paid amount', () => {
    expect(refundableRemainderCents({ paidCents: 4099, providerCommittedCents: 1000, platformCommittedCents: 500 })).toBe(3099);
    expect(refundableRemainderCents({ paidCents: 4099, providerCommittedCents: null, platformCommittedCents: 500 })).toBe(3599);
    expect(refundableRemainderCents({ paidCents: 4099, providerCommittedCents: 5000, platformCommittedCents: 0 })).toBe(0);
  });

  it('stores a missing amount as a remainder refund, keeps a typed amount, even the whole remainder, and refuses zero, fractions and amounts above the remainder', () => {
    expect(resolveStaffRefundAmount({ expectedAmountCents: 3000, remainderCents: 3000, currency: 'PLN' })).toStrictEqual({ ok: true, value: { kind: 'remainder', amountCents: 3000 } });
    expect(resolveStaffRefundAmount({ amountCents: 3000, remainderCents: 3000, currency: 'PLN' })).toStrictEqual({ ok: true, value: { kind: 'amount', amountCents: 3000 } });
    expect(resolveStaffRefundAmount({ amountCents: 1200, remainderCents: 3000, currency: 'PLN' })).toStrictEqual({ ok: true, value: { kind: 'amount', amountCents: 1200 } });
    expect(resolveStaffRefundAmount({ amountCents: 3001, remainderCents: 3000, currency: 'PLN' })).toMatchObject({ ok: false, error: { code: 'validation', message: 'Refund amount is above the refundable remainder of 30.00 PLN' } });
    expect(resolveStaffRefundAmount({ amountCents: 0, remainderCents: 3000, currency: 'PLN' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(resolveStaffRefundAmount({ amountCents: 1.5, remainderCents: 3000, currency: 'PLN' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(resolveStaffRefundAmount({ remainderCents: 0, currency: 'PLN' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('refunds the whole remainder only when the request names the remainder it was confirmed for', () => {
    expect(resolveStaffRefundAmount({ remainderCents: 3000, currency: 'PLN' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(resolveStaffRefundAmount({ expectedAmountCents: 4099, remainderCents: 3000, currency: 'PLN' })).toMatchObject({
      ok: false, error: { code: 'conflict', message: 'The refundable remainder is now 30.00 PLN; check the refund again before confirming it', details: { remainderCents: 3000 } },
    });
    expect(resolveStaffRefundAmount({ expectedAmountCents: 2000, remainderCents: 3000, currency: 'PLN' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(resolveStaffRefundAmount({ amountCents: 1000, expectedAmountCents: 1000, remainderCents: 3000, currency: 'PLN' })).toStrictEqual({ ok: true, value: { kind: 'amount', amountCents: 1000 } });
    expect(resolveStaffRefundAmount({ amountCents: 1000, expectedAmountCents: 3000, remainderCents: 3000, currency: 'PLN' })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('converts decimals to minor units with the decimals the currency allows', () => {
    expect(minorUnitsFromDecimal('12,5', 'PLN')).toStrictEqual({ ok: true, value: 1250 });
    expect(minorUnitsFromDecimal('12.05', 'EUR')).toStrictEqual({ ok: true, value: 1205 });
    expect(minorUnitsFromDecimal('12.055', 'EUR')).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(minorUnitsFromDecimal('1200', 'JPY')).toStrictEqual({ ok: true, value: 1200 });
    expect(minorUnitsFromDecimal('12.5', 'JPY')).toMatchObject({ ok: false, error: { message: 'Amount in JPY must be a whole number' } });
    expect(minorUnitsFromDecimal('-1', 'PLN')).toMatchObject({ ok: false });
  });

  it('names why an order cannot be refunded', () => {
    expect(staffRefundOrderBlocker(paidOrder)).toBeNull();
    expect(staffRefundOrderBlocker({ ...paidOrder, status: 'partially_refunded' })).toBeNull();
    expect(staffRefundOrderBlocker({ ...paidOrder, status: 'refunded' })).toMatchObject({ code: 'conflict' });
    expect(staffRefundOrderBlocker({ ...paidOrder, cancelReason: 'out_of_stock' })).toMatchObject({ code: 'conflict' });
    expect(staffRefundOrderBlocker({ ...paidOrder, provider: 'simulated' })).toMatchObject({ code: 'validation' });
    expect(staffRefundOrderBlocker({ ...paidOrder, providerObjectIds: { checkoutSession: 'cs_1' } })).toMatchObject({ code: 'validation' });
    expect(staffRefundOrderBlocker({ ...paidOrder, amountCents: 0 })).toMatchObject({ code: 'validation' });
  });

  it('defaults restock and packing removal on only for a full refund of an untouched order waiting to be packed', () => {
    const untouched = staffRefundFulfilmentOptions({ fulfilmentStatus: 'to_pack', shipment: null }, { coversRemainder: true, hasLabel: false });
    expect(untouched).toStrictEqual({ restockOffered: true, restockDefault: true, removeFromPackingListOffered: true, removeFromPackingListDefault: true });
    expect(staffRefundFulfilmentOptions({ fulfilmentStatus: 'to_pack', shipment: null }, { coversRemainder: true, hasLabel: true }))
      .toStrictEqual({ restockOffered: true, restockDefault: false, removeFromPackingListOffered: true, removeFromPackingListDefault: false });
    expect(staffRefundFulfilmentOptions({ fulfilmentStatus: 'shipped', shipment: null }, { coversRemainder: true, hasLabel: false }))
      .toStrictEqual({ restockOffered: true, restockDefault: false, removeFromPackingListOffered: false, removeFromPackingListDefault: false });
    const partial = staffRefundFulfilmentOptions({ fulfilmentStatus: 'to_pack', shipment: null }, { coversRemainder: false, hasLabel: false });
    expect(resolveStaffRefundChoices(partial, {})).toStrictEqual({ ok: true, value: { restock: false, removeFromPackingList: false } });
    expect(resolveStaffRefundChoices(partial, { restock: true })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(resolveStaffRefundChoices(untouched, { restock: false })).toStrictEqual({ ok: true, value: { restock: false, removeFromPackingList: true } });
  });

  it('matches a repeated request only with the same amount and choices', () => {
    const stored = refund({ kind: 'remainder', amountCents: 4099, restocked: true, removedFromPackingList: true });
    expect(staffRefundMatchesRequest(stored, { orderId: 'order-1' })).toBe(true);
    expect(staffRefundMatchesRequest(stored, { orderId: 'order-1', restock: true, removeFromPackingList: true })).toBe(true);
    expect(staffRefundMatchesRequest(stored, { orderId: 'order-1', restock: false })).toBe(false);
    expect(staffRefundMatchesRequest(stored, { orderId: 'order-1', amountCents: 100 })).toBe(false);
    expect(staffRefundMatchesRequest(stored, { orderId: 'order-1', expectedAmountCents: 4099 })).toBe(true);
    expect(staffRefundMatchesRequest(stored, { orderId: 'order-1', expectedAmountCents: 3000 })).toBe(false);
    expect(staffRefundMatchesRequest(stored, { orderId: 'order-2' })).toBe(false);
  });

  it('sums committed refunds into the order totals and reads a refunded order as fully refunded', () => {
    const refunds = [{ status: 'succeeded' as const, amountCents: 1000 }, { status: 'failed' as const, amountCents: 500 }, { status: 'pending' as const, amountCents: 200 }];
    expect(orderRefundTotals({ status: 'partially_refunded', amountCents: 4099, currency: 'PLN' }, refunds)).toStrictEqual({ paidCents: 4099, refundedCents: 1200, remainingCents: 2899, currency: 'PLN' });
    expect(orderRefundTotals({ status: 'refunded', amountCents: 4099, currency: 'PLN' }, refunds)).toStrictEqual({ paidCents: 4099, refundedCents: 4099, remainingCents: 0, currency: 'PLN' });
  });
});
