import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { ApiClient } from '#core/client/index.js';
import { EXIT_CODE_BY_ERROR_CODE } from '#core/contract/index.js';
import { appError, err, forbidden, ok, orderListItemSchema, type OrderStaffRefundView, type StaffRefundPreview } from '#core/domain/index.js';

import { refundPreviewLines, runOrderRefund } from './order-refund-commands.js';

const preview = (over: Partial<StaffRefundPreview> = {}): StaffRefundPreview => ({
  orderId: 'order-1', refundable: true, blockedReason: null, paidCents: 4099, refundedCents: 1000, remainderCents: 3099, currency: 'PLN',
  mode: 'live', remainderSource: 'provider', returnableStock: [{ productId: 'book', quantity: 1 }], onPackingList: true, hasShipment: false,
  hasInvoice: true, fullRefundOptions: { restockOffered: true, restockDefault: true, removeFromPackingListOffered: true, removeFromPackingListDefault: true },
  waitingRefundId: null, ...over,
});

const refundView = (over: Partial<OrderStaffRefundView> = {}): OrderStaffRefundView => ({
  id: 'refund-1', kind: 'remainder', status: 'pending', amountCents: 3099, currency: 'PLN', attempts: 0, nextAttemptAt: '2026-11-22T10:00:00.000Z',
  lastError: null, providerRefundStatus: null, submittedAt: null, requestedByUserId: 'owner-1', requestedByEmail: 'owner@acme.example.com',
  note: null, restocked: true, removedFromPackingList: true, createdAt: '2026-11-22T10:00:00.000Z', updatedAt: '2026-11-22T10:00:00.000Z', ...over,
});

const order = orderListItemSchema.parse({
  id: 'order-1', tenantId: 'acme', memberId: 'member-1', productId: 'book', priceId: null, kind: 'one_time', status: 'refunded', mode: 'live',
  amountCents: 4099, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: '2026-11-20T09:00:00.000Z',
  memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed book', couponCode: null, fulfilmentStatus: 'to_pack',
});

let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.exitCode = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const harness = (json = false) => {
  const orderRefundPreview = vi.fn<ApiClient['orderRefundPreview']>(async () => ok(preview()));
  const createOrderRefund = vi.fn<ApiClient['createOrderRefund']>(async () => ok({ refund: refundView(), created: true }));
  const shipOrderAnyway = vi.fn<ApiClient['shipOrderAnyway']>(async () => ok({ order }));
  const ctx = { api: { orderRefundPreview, createOrderRefund, shipOrderAnyway }, json };
  const refund = (options: Record<string, unknown>, newRequestKey?: () => string) => runOrderRefund(ctx, 'order-1', options, newRequestKey);
  return { orderRefundPreview, createOrderRefund, refund };
};

const printed = (): unknown => JSON.parse(String(logSpy.mock.calls[0]?.[0]));

describe('order refund command', () => {
  it('refunds the whole remainder with --yes, leaving restock and packing to the server defaults', async () => {
    const h = harness();
    await h.refund({ yes: true, requestKey: 'retry-7' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-1', requestKey: 'retry-7' });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('refund refund-1: 30.99 PLN (full), pending, stock returned, off the packing list\nrequest key: retry-7 (repeat with --request-key retry-7 to retry without a second refund)');
    expect(process.exitCode).toBeUndefined();
  });

  it('converts --amount from the order currency to minor units and passes the reason and the fulfilment choices', async () => {
    const h = harness();
    await h.refund({ amount: '12,50', reason: 'Damaged cover', restock: false, keepOnPackingList: true, yes: true, requestKey: 'part-1' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({
      orderId: 'order-1', requestKey: 'part-1', amountCents: 1250, reason: 'Damaged cover', restock: false, removeFromPackingList: false,
    });
  });

  it('generates a request key when none is given', async () => {
    const h = harness();
    await h.refund({ yes: true });
    expect(h.createOrderRefund.mock.calls[0]?.[0].requestKey).toMatch(/^cli-[0-9a-f-]{36}$/);
    await h.refund({ yes: true }, () => 'fixed-key');
    expect(h.createOrderRefund.mock.calls[1]?.[0].requestKey).toBe('fixed-key');
  });

  it('refuses without --yes, names the amount and shows the preview, and sends nothing', async () => {
    const h = harness();
    await h.refund({ amount: '5' });
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]?.[0]).toBe('error(validation): Refunding 5.00 PLN of order order-1 cannot be undone; repeat the command with --yes to confirm');
    expect(String(errorSpy.mock.calls[1]?.[0])).toContain('paid 40.99 PLN, refunded 10.00 PLN, remaining 30.99 PLN');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
  });

  it('refuses an amount with more decimals than the currency allows before any request', async () => {
    const h = harness();
    await h.refund({ amount: '1.005', yes: true });
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
  });

  it('prints one envelope with --json and maps a server refusal to its exit code', async () => {
    const h = harness(true);
    await h.refund({ yes: true, requestKey: 'json-1' });
    expect(printed()).toEqual({ ok: true, data: { refund: refundView(), created: true, requestKey: 'json-1' } });
    logSpy.mockClear();
    h.createOrderRefund.mockResolvedValueOnce(err(appError('conflict', 'Another refund of this order is still waiting to reach the payment provider')));
    await h.refund({ yes: true });
    expect(printed()).toEqual({ ok: false, error: { code: 'conflict', message: 'Another refund of this order is still waiting to reach the payment provider' } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('says when the request key was already used for this refund', async () => {
    const h = harness();
    h.createOrderRefund.mockResolvedValueOnce(ok({ refund: refundView({ status: 'succeeded' }), created: false }));
    await h.refund({ yes: true, requestKey: 'retry-7' });
    expect(String(logSpy.mock.calls[0]?.[0])).toContain('(already requested with this request key)');
  });

  it('stops at a preview the server refuses', async () => {
    const h = harness();
    h.orderRefundPreview.mockResolvedValueOnce(err(forbidden('order:refund is not permitted')));
    await h.refund({ yes: true });
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.forbidden);
  });
});

describe('order refund preview output', () => {
  it('prints what is refundable and the consequences', () => {
    expect(refundPreviewLines(preview({ remainderSource: 'platform', hasShipment: true, waitingRefundId: 'refund-0' }))).toBe([
      'order order-1: refundable',
      'paid 40.99 PLN, refunded 10.00 PLN, remaining 30.99 PLN (platform records only; the payment provider list could not be read)',
      'mode: live',
      'on the packing list: yes; shipment or label: yes; invoice: yes',
      'stock a full refund can return: book x1',
      'full refund defaults: return stock yes, take off the packing list yes',
      'refund still waiting to reach the payment provider: refund-0',
      'a refund does not cancel the shipping label',
      'the order has an invoice; issue a correcting invoice yourself',
    ].join('\n'));
  });

  it('names the reason an order cannot be refunded', () => {
    expect(refundPreviewLines(preview({ refundable: false, blockedReason: 'Nothing is left to refund on this order', remainderCents: 0 })).split('\n')[0])
      .toBe('order order-1: not refundable: Nothing is left to refund on this order');
  });
});
