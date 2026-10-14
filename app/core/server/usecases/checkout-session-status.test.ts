import { describe, expect, it, vi } from 'vitest';

import { type Order } from '#core/domain/index.js';
import { type PaymentRefundRepository } from '../ports.js';
import { getCheckoutSessionStatus } from './checkout-session-status.js';

const order: Order = {
  id: 'order-1',
  tenantId: 'tenant-1',
  memberId: 'member-1',
  productId: 'product-1',
  priceId: null,
  kind: 'one_time',
  status: 'paid',
  mode: 'live',
  amountCents: 1000,
  currency: 'PLN',
  provider: 'stripe',
  providerObjectIds: { checkoutSession: 'cs_live_paid123' },
  couponId: null,
  discountCents: 0,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const harness = (rows: Order[] = [order]) => {
  const findOrderByProviderObjectIds = vi.fn<PaymentRefundRepository['findOrderByProviderObjectIds']>(
    async (tenantId, ids, mode) => rows.find((row) => row.tenantId === tenantId
      && row.mode === mode && row.providerObjectIds.checkoutSession === ids.checkoutSession) ?? null,
  );
  return {
    paymentRefunds: {
      findOrderByProviderObjectIds,
      findLatestSubscriptionOrder: async () => null,
      listAccessRetainingOrdersForMemberProduct: async () => [],
      markOrderRefunded: async () => null,
      markOrderPartiallyRefunded: async () => null,
    },
  };
};

describe('getCheckoutSessionStatus', () => {
  it.each(['paid', 'partially_refunded', 'refunded'] as const)('reports %s orders as paid without exposing order data', async (status) => {
    const deps = harness([{ ...order, status }]);
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toEqual({
      ok: true, value: { status: 'paid' },
    });
    expect(deps.paymentRefunds.findOrderByProviderObjectIds).toHaveBeenCalledExactlyOnceWith(
      'tenant-1', { checkoutSession: 'cs_live_paid123' }, 'live',
    );
  });

  it.each([
    ['unknown session', order, 'tenant-1', 'cs_live_unknown'],
    ['foreign tenant', order, 'tenant-2', 'cs_live_paid123'],
    ['wrong mode', { ...order, mode: 'test' }, 'tenant-1', 'cs_live_paid123'],
    ['pending order', { ...order, status: 'pending' }, 'tenant-1', 'cs_live_paid123'],
  ] as const)('reports pending for %s', async (_case, row, tenantId, sessionId) => {
    expect(await getCheckoutSessionStatus(tenantId, sessionId, harness([row]))).toEqual({
      ok: true, value: { status: 'pending' },
    });
  });

  it.each([
    ['foreign tenant', { ...order, tenantId: 'tenant-2' }],
    ['wrong mode', { ...order, mode: 'test' }],
    ['another session', { ...order, providerObjectIds: { checkoutSession: 'cs_live_other' } }],
    ['failed payment', { ...order, status: 'failed' }],
  ] as const)('never treats a repository result for %s as paid', async (_case, row) => {
    const deps = harness();
    deps.paymentRefunds.findOrderByProviderObjectIds.mockResolvedValue(row);
    expect(await getCheckoutSessionStatus('tenant-1', 'cs_live_paid123', deps)).toEqual({
      ok: true, value: { status: 'pending' },
    });
  });

  it('looks up test sessions in test mode', async () => {
    const sessionId = 'cs_test_paid123';
    const deps = harness([{ ...order, mode: 'test', providerObjectIds: { checkoutSession: sessionId } }]);
    expect(await getCheckoutSessionStatus('tenant-1', sessionId, deps)).toEqual({
      ok: true, value: { status: 'paid' },
    });
    expect(deps.paymentRefunds.findOrderByProviderObjectIds).toHaveBeenCalledExactlyOnceWith(
      'tenant-1', { checkoutSession: sessionId }, 'test',
    );
  });

  it.each(['', 'cs_live_', 'cs_test_', 'cs_other_abc', 'cs_live_a-b', 'cs_live_a_b', `cs_live_${'a'.repeat(201)}`])(
    'rejects malformed session ids without a repository lookup: %s', async (sessionId) => {
      const deps = harness();
      expect(await getCheckoutSessionStatus('tenant-1', sessionId, deps)).toMatchObject({
        ok: false, error: { code: 'validation' },
      });
      expect(deps.paymentRefunds.findOrderByProviderObjectIds).not.toHaveBeenCalled();
    },
  );
});
