import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { ApiClient } from '#core/client/index.js';
import { EXIT_CODE_BY_ERROR_CODE } from '#core/contract/index.js';
import { appError, err, forbidden, internal, ok, orderListItemSchema, type OrderStaffRefundView, type StaffRefundPreview } from '#core/domain/index.js';

import { refundPreviewLines, runOrderRefund } from './order-refund-commands.js';

const preview = (over: Partial<StaffRefundPreview> = {}): StaffRefundPreview => ({
  orderId: 'order-1', refundable: true, blockedReason: null, paidCents: 4099, refundedCents: 1000, remainderCents: 3099, currency: 'PLN',
  mode: 'live', remainderSource: 'provider', refundedAmountUnknown: false, grantsAccess: false, returnableStock: [{ productId: 'book', quantity: 1 }], onPackingList: true, hasShipment: false,
  hasInvoice: true, cancelsSubscription: false, fullRefundOptions: { restockOffered: true, restockDefault: true, removeFromPackingListOffered: true, removeFromPackingListDefault: true },
  waitingRefundId: null, providerListedRefundIds: [], ...over,
});

const refundView = (over: Partial<OrderStaffRefundView> = {}): OrderStaffRefundView => ({
  id: 'refund-1', kind: 'remainder', status: 'pending', amountCents: 3099, currency: 'PLN', attempts: 0, nextAttemptAt: '2026-11-22T10:00:00.000Z',
  lastError: null, providerRefundStatus: null, submittedAt: null, permissionBlockedAt: null, createOutcomeUnknown: false, requestedByUserId: 'owner-1', requestedByEmail: 'owner@acme.example.com',
  note: null, restocked: true, removedFromPackingList: true, createdAt: '2026-11-22T10:00:00.000Z', updatedAt: '2026-11-22T10:00:00.000Z', providerRefundId: null, ...over,
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
  it('replays a stored full refund by its request key once nothing is left to refund', async () => {
    const h = harness();
    h.orderRefundPreview.mockResolvedValueOnce(ok(preview({ refundable: false, refundedCents: 4099, remainderCents: 0 })));
    h.createOrderRefund.mockResolvedValueOnce(ok({ refund: refundView(), created: false }));
    await h.refund({ yes: true, remainder: '30.99', requestKey: 'lost-full' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-1', requestKey: 'lost-full', expectedAmountCents: 3099, expectedRemainderCents: 3099, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
    expect(String(logSpy.mock.calls[0]?.[0])).toContain('(already requested with this request key)');
    expect(process.exitCode).toBeUndefined();
  });

  it('refunds the whole remainder with --yes and --remainder, leaving restock and packing to the server defaults', async () => {
    const h = harness();
    await h.refund({ yes: true, remainder: '30.99', requestKey: 'retry-7' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-1', requestKey: 'retry-7', expectedAmountCents: 3099, expectedRemainderCents: 3099, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('refund refund-1: 30.99 PLN (full), pending, stock returned, off the packing list\nrequest key: retry-7 (repeat with --request-key retry-7 to retry without a second refund)');
    expect(process.exitCode).toBeUndefined();
  });

  it('converts --amount from the order currency to minor units and passes the reason, keeping stock and the packing list as they are', async () => {
    const h = harness();
    await h.refund({ amount: '12,50', remainder: '30.99', reason: 'Damaged cover', restock: false, keepOnPackingList: true, yes: true, requestKey: 'part-1' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({
      orderId: 'order-1', requestKey: 'part-1', amountCents: 1250, expectedRemainderCents: 3099, reason: 'Damaged cover', restock: false, removeFromPackingList: false,
      expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false },
    });
  });

  it('sends the packing and label state its preview showed, so the server refuses the refund when it changed since', async () => {
    const h = harness();
    h.orderRefundPreview.mockResolvedValueOnce(ok(preview({ onPackingList: false, hasShipment: true })));
    h.createOrderRefund.mockResolvedValueOnce(err(appError('conflict', 'The packing list or shipping label of the order changed since the refund was checked; check the refund again before confirming it', {
      shipmentState: { onPackingList: false, hasShipmentOrLabel: false },
    })));
    await h.refund({ yes: true, remainder: '30.99', requestKey: 'label-1' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({
      orderId: 'order-1', requestKey: 'label-1', expectedAmountCents: 3099, expectedRemainderCents: 3099, expectedShipmentState: { onPackingList: false, hasShipmentOrLabel: true },
    });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('says the refunded amount of an order marked refunded is not known here instead of printing a number the platform did not see', () => {
    const lines = refundPreviewLines(preview({
      refundable: false, blockedReason: 'The order is marked refunded: refunded in full, refunded outside the platform or disputed; nothing more can be refunded here; check the payment in the payment provider\'s dashboard',
      refundedCents: 0, remainderCents: 0, refundedAmountUnknown: true,
    })).split('\n');
    expect(lines[1]).toBe('paid 40.99 PLN, refunded not known here (refunded outside the platform or disputed), remaining 0.00 PLN (read from the payment provider)');
    expect(refundPreviewLines(preview())).not.toContain('not known here');
  });

  it.each([
    [{ grantsAccess: true, cancelsSubscription: true }, 'a partial refund keeps access and the subscription, but if the payment ends fully refunded (for example through another refund, also one made in the Stripe Dashboard), access may end and the subscription stops, as for a full refund'],
    [{ grantsAccess: true, cancelsSubscription: false }, 'a partial refund keeps access, but if the payment ends fully refunded (for example through another refund, also one made in the Stripe Dashboard), access may end, as for a full refund'],
    [{ grantsAccess: false, cancelsSubscription: true }, 'a partial refund keeps the subscription, but if the payment ends fully refunded (for example through another refund, also one made in the Stripe Dashboard), the subscription stops, as for a full refund'],
  ] as const)('says in the preview that a partial refund may still end access or a subscription once the payment ends fully refunded (%o)', (flags, line) => {
    expect(refundPreviewLines(preview(flags)).split('\n')).toContain(line);
    expect(refundPreviewLines(preview())).not.toContain('fully refunded');
  });

  it('names a subscription a full refund would cancel in the preview', () => {
    expect(refundPreviewLines(preview({ cancelsSubscription: true }))).toContain('a full refund also cancels the subscription, so its future payments stop');
    expect(refundPreviewLines(preview())).not.toContain('subscription');
  });

  it('generates a request key when none is given', async () => {
    const h = harness();
    await h.refund({ yes: true, amount: '5', remainder: '30.99' });
    expect(h.createOrderRefund.mock.calls[0]?.[0].requestKey).toMatch(/^cli-[0-9a-f-]{36}$/);
    await h.refund({ yes: true, amount: '5', remainder: '30.99' }, () => 'fixed-key');
    expect(h.createOrderRefund.mock.calls[1]?.[0].requestKey).toBe('fixed-key');
  });

  it('prints a generated request key before sending, so a request whose answer was lost can be repeated with it', async () => {
    const h = harness();
    h.createOrderRefund.mockImplementationOnce(async () => {
      expect(errorSpy).toHaveBeenCalledExactlyOnceWith('request key: lost-1 (after a network error repeat with --request-key lost-1; the same key never refunds twice)');
      return err(internal('Network error calling /api/orders/order-1/refunds: TypeError: fetch failed'));
    });
    await h.refund({ yes: true, remainder: '30.99' }, () => 'lost-1');
    expect(h.createOrderRefund).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[1]?.[0]).toBe('error(internal): Network error calling /api/orders/order-1/refunds: TypeError: fetch failed');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.internal);
  });

  it('names the request key in the error envelope with --json and prints nothing before it', async () => {
    const h = harness(true);
    h.createOrderRefund.mockResolvedValueOnce(err(internal('Network error calling /api/orders/order-1/refunds: TypeError: fetch failed')));
    await h.refund({ yes: true, remainder: '30.99', requestKey: 'lost-2' });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(printed()).toEqual({ ok: false, error: { code: 'internal', message: 'Network error calling /api/orders/order-1/refunds: TypeError: fetch failed', details: { requestKey: 'lost-2' } } });
  });

  it('refuses without --yes, names the amount, the exact command to confirm with and shows the preview, and sends nothing', async () => {
    const h = harness();
    await h.refund({ amount: '5', reason: "Buyer's choice" });
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]?.[0]).toBe("error(validation): Refunding 5.00 PLN of order order-1 cannot be undone; to confirm, repeat it as: order refund order-1 --amount 5 --remainder 30.99 --reason 'Buyer'\\''s choice' --yes");
    expect(String(errorSpy.mock.calls[1]?.[0])).toContain('paid 40.99 PLN, refunded 10.00 PLN, remaining 30.99 PLN');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
  });

  it('names the remainder to confirm a full refund with, sends the confirmed remainder and shows the refusal when it changed since', async () => {
    const h = harness();
    await h.refund({});
    expect(errorSpy.mock.calls[0]?.[0]).toBe('error(validation): Refunding 30.99 PLN of order order-1 cannot be undone; to confirm, repeat it as: order refund order-1 --remainder 30.99 --yes');
    h.createOrderRefund.mockResolvedValueOnce(err(appError('conflict', 'The refundable remainder is now 40.99 PLN; check the refund again before confirming it', { remainderCents: 4099 })));
    await h.refund({ yes: true, remainder: '30.99', requestKey: 'full-1' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-1', requestKey: 'full-1', expectedAmountCents: 3099, expectedRemainderCents: 3099, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
    expect(errorSpy.mock.calls.at(-1)?.[0]).toBe('error(conflict): The refundable remainder is now 40.99 PLN; check the refund again before confirming it');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('sends the remainder the operator confirmed from the dry run, never the one a later preview read, so a stale confirmation writes nothing', async () => {
    const h = harness();
    let remainderCents = 10_000;
    h.orderRefundPreview.mockImplementation(async () => ok(preview({ paidCents: 10_000, refundedCents: 10_000 - remainderCents, remainderCents })));
    const written: unknown[] = [];
    h.createOrderRefund.mockImplementation(async (input) => {
      if (input.expectedRemainderCents !== remainderCents) {
        return err(appError('conflict', `The refundable remainder is now ${String(remainderCents / 100)}.00 PLN; check the refund again before confirming it`, { remainderCents }));
      }
      written.push(input);
      return ok({ refund: refundView({ kind: 'amount', amountCents: input.amountCents ?? 0 }), created: true });
    });

    await h.refund({ amount: '40' });
    expect(errorSpy.mock.calls[0]?.[0]).toBe('error(validation): Refunding 40.00 PLN of order order-1 cannot be undone; to confirm, repeat it as: order refund order-1 --amount 40 --remainder 100.00 --yes');
    remainderCents = 4000;
    await h.refund({ amount: '40', remainder: '100.00', yes: true, requestKey: 'typed-1' });

    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({
      orderId: 'order-1', requestKey: 'typed-1', amountCents: 4000, expectedRemainderCents: 10_000, restock: false, removeFromPackingList: false,
      expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false },
    });
    expect(written).toStrictEqual([]);
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(refundPreviewLines(preview({ paidCents: 10_000, refundedCents: 6000, remainderCents: 4000 })));
    expect(errorSpy.mock.calls.at(-1)?.[0]).toBe('error(conflict): The refundable remainder is now 40.00 PLN; check the refund again before confirming it');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('warns about and offers to confirm the same current remainder when a full dry run names a remainder that grew since, and a --yes run with the old one writes nothing', async () => {
    const h = harness();
    h.orderRefundPreview.mockImplementation(async () => ok(preview({ paidCents: 4000, refundedCents: 0, remainderCents: 4000 })));
    const written: unknown[] = [];
    h.createOrderRefund.mockImplementation(async (input) => {
      if (input.expectedRemainderCents !== 4000) return err(appError('conflict', 'The refundable remainder is now 40.00 PLN; check the refund again before confirming it', { remainderCents: 4000 }));
      written.push(input);
      return ok({ refund: refundView({ amountCents: 4000 }), created: true });
    });
    await h.refund({ remainder: '10.00' });
    expect(errorSpy.mock.calls[0]?.[0]).toBe('error(validation): The remainder changed from 10.00 PLN to 40.00 PLN. Refunding 40.00 PLN of order order-1 cannot be undone; to confirm, repeat it as: order refund order-1 --remainder 40.00 --yes');
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    await h.refund({ remainder: '10.00', yes: true, requestKey: 'old-full' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-1', requestKey: 'old-full', expectedAmountCents: 1000, expectedRemainderCents: 1000, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
    expect(written).toStrictEqual([]);
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('sends a partial refund that covers the whole remainder with stock and the packing list kept, never the full refund defaults', async () => {
    const h = harness();
    await h.refund({ amount: '30.99', remainder: '30.99', yes: true, requestKey: 'typed-all' });
    expect(h.createOrderRefund).toHaveBeenCalledExactlyOnceWith({
      orderId: 'order-1', requestKey: 'typed-all', amountCents: 3099, expectedRemainderCents: 3099, restock: false, removeFromPackingList: false,
      expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false },
    });
  });

  it('puts the new preview into the error envelope with --json when the remainder changed', async () => {
    const h = harness(true);
    h.orderRefundPreview.mockResolvedValueOnce(ok(preview())).mockResolvedValueOnce(ok(preview({ remainderCents: 1000 })));
    h.createOrderRefund.mockResolvedValueOnce(err(appError('conflict', 'The refundable remainder is now 10.00 PLN; check the refund again before confirming it', { remainderCents: 1000 })));
    await h.refund({ amount: '5', remainder: '30.99', yes: true, requestKey: 'typed-json' });
    expect(printed()).toMatchObject({ ok: false, error: { code: 'conflict', details: { remainderCents: 1000, requestKey: 'typed-json', preview: { remainderCents: 1000 } } } });
  });

  it('refuses --keep-on-packing-list without --no-restock before any request', async () => {
    const h = harness();
    await h.refund({ remainder: '30.99', keepOnPackingList: true, yes: true, requestKey: 'keep-1' });
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]?.[0]).toBe('error(validation): Use --keep-on-packing-list together with --no-restock: goods returned to stock cannot stay on the packing list');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
  });

  it('requires --request-key with --json before any request and keeps generating one for a person at the terminal', async () => {
    const h = harness(true);
    await h.refund({ yes: true, amount: '5' });
    expect(h.orderRefundPreview).not.toHaveBeenCalled();
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(printed()).toEqual({
      ok: false, error: { code: 'validation', message: 'With --json, pass your own --request-key and keep it, so a refund whose answer was lost can be repeated without a second refund' },
    });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    const human = harness();
    await human.refund({ yes: true, amount: '5', remainder: '30.99' }, () => 'made-1');
    expect(human.createOrderRefund).toHaveBeenCalledExactlyOnceWith({
      orderId: 'order-1', requestKey: 'made-1', amountCents: 500, expectedRemainderCents: 3099, restock: false, removeFromPackingList: false,
      expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false },
    });
    expect(errorSpy).toHaveBeenCalledWith('request key: made-1 (after a network error repeat with --request-key made-1; the same key never refunds twice)');
  });

  it('refuses a full refund with --yes but without --remainder, shows the preview and names the flag to add, never confirming the fresh remainder', async () => {
    const h = harness();
    await h.refund({ yes: true, requestKey: 'full-2' });
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]?.[0]).toBe('error(validation): Refunding 30.99 PLN of order order-1 cannot be undone; to confirm, repeat it as: order refund order-1 --remainder 30.99 --request-key full-2 --yes');
    expect(String(errorSpy.mock.calls[1]?.[0])).toContain('paid 40.99 PLN, refunded 10.00 PLN, remaining 30.99 PLN');
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
  });

  it('refuses a partial refund with --yes but without --remainder, shows the preview and names the command to confirm with, never confirming the fresh remainder', async () => {
    const h = harness();
    await h.refund({ amount: '5', yes: true, requestKey: 'part-2' });
    expect(h.createOrderRefund).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]?.[0]).toBe('error(validation): Refunding 5.00 PLN of order order-1 cannot be undone; to confirm, repeat it as: order refund order-1 --amount 5 --remainder 30.99 --request-key part-2 --yes');
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
    await h.refund({ yes: true, remainder: '30.99', requestKey: 'json-1' });
    expect(printed()).toEqual({ ok: true, data: { refund: refundView(), created: true, requestKey: 'json-1' } });
    logSpy.mockClear();
    h.createOrderRefund.mockResolvedValueOnce(err(appError('conflict', 'Another refund of this order is still waiting to reach the payment provider')));
    await h.refund({ yes: true, amount: '5', remainder: '30.99', requestKey: 'json-2' });
    expect(printed()).toEqual({
      ok: false, error: { code: 'conflict', message: 'Another refund of this order is still waiting to reach the payment provider', details: { requestKey: 'json-2' } },
    });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.conflict);
  });

  it('says when the request key was already used for this refund', async () => {
    const h = harness();
    h.createOrderRefund.mockResolvedValueOnce(ok({ refund: refundView({ status: 'succeeded' }), created: false }));
    await h.refund({ yes: true, remainder: '30.99', requestKey: 'retry-7' });
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
