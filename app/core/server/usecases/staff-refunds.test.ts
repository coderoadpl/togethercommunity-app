import { describe, expect, it } from 'vitest';

import { memberSubscriptionSchema, ok, orderListItemSchema, type Identity, type MemberSubscription, type Order, type OrderListItem } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { OrderStaffRefundRepository } from '../ports.js';
import { previewStaffRefund } from './staff-refunds.js';

const createdAt = '2026-11-22T10:00:00.000Z';

const owner: Ctx = {
  identity: {
    userId: 'staff-a', email: 'owner@tenant-a.example.com', name: 'Owner', emailVerified: true, tenantAccess: 'staff', tenantId: 'tenant-a',
    tenantSlug: 'tenant-a', tenantName: 'tenant-a', staffRole: 'owner', memberId: null, image: null, memberDisplayName: null, memberBannedAt: null,
    memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  } satisfies Identity,
};

const recurringOrder = (overrides: Partial<OrderListItem> = {}): OrderListItem => orderListItemSchema.parse({
  id: 'order-2', tenantId: 'tenant-a', memberId: 'member-1', productId: 'club', priceId: 'price-1', kind: 'recurring', status: 'paid',
  amountCents: 4900, currency: 'PLN', provider: 'stripe', providerObjectIds: { paymentIntent: 'pi_2', invoice: 'in_2', subscription: 'sub_1' }, couponId: null,
  discountCents: 0, cancelReason: null, createdAt, memberEmail: 'buyer@example.com', memberName: null, productTitle: 'Club', couponCode: null, mode: 'live',
  ...overrides,
});

const subscription = (overrides: Partial<MemberSubscription> = {}): MemberSubscription => memberSubscriptionSchema.parse({
  mode: 'live', id: 'subscription-1', tenantId: 'tenant-a', memberId: 'member-1', productId: 'club', priceId: 'price-1', provider: 'stripe',
  providerSubscriptionId: 'sub_1', status: 'active', currentPeriodEnd: '2026-12-22T10:00:00.000Z', cancelAtPeriodEnd: false, couponId: null,
  couponDiscountCents: 0, couponRecurringDuration: null, createdAt, updatedAt: createdAt, ...overrides,
});

const staffRefunds: Pick<OrderStaffRefundRepository, 'platformCommittedCents' | 'hasLabel' | 'returnableStock' | 'listByOrder'> = {
  platformCommittedCents: async () => 0,
  hasLabel: async () => false,
  returnableStock: async () => [],
  listByOrder: async () => [],
};

const preview = async (order: OrderListItem, input: { latest?: Order | null; current?: MemberSubscription | null } = {}) => {
  const result = await previewStaffRefund(owner, order.id, {
    orderDetails: { findById: async (tenantId, orderId) => (tenantId === order.tenantId && orderId === order.id ? order : null) },
    staffRefunds: { ...staffRefunds, create: async () => { throw new Error('Not used'); }, committedCentsByOrder: async () => new Map(), activeRefundByOrder: async () => new Map(), noteChargeRefunded: async () => [], shipAnyway: async () => { throw new Error('Not used'); } },
    payment: { listRefunds: async () => ok([]) },
    subscriptionOrders: { findLatestSubscriptionOrder: async () => (input.latest === undefined ? order : input.latest) },
    subscriptions: { findByProviderSubscriptionId: async () => (input.current === undefined ? subscription() : input.current) },
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('staff refund preview', () => {
  it('says a full refund of the latest invoice of a running subscription also cancels the subscription, as the refund webhook does', async () => {
    expect(await preview(recurringOrder())).toMatchObject({ refundable: true, cancelsSubscription: true });
  });

  it.each([
    ['a one-time order', recurringOrder({ kind: 'one_time' }), {}],
    ['an earlier invoice of the subscription', recurringOrder(), { latest: recurringOrder({ id: 'order-3' }) }],
    ['a subscription already canceled', recurringOrder(), { current: subscription({ status: 'canceled' }) }],
    ['a subscription the platform does not know', recurringOrder(), { current: null }],
    ['a subscription of the other payment mode', recurringOrder(), { current: subscription({ mode: 'test' }) }],
  ] as const)('says nothing about the subscription for %s', async (_name, order, input) => {
    expect(await preview(order, input)).toMatchObject({ cancelsSubscription: false });
  });
});
