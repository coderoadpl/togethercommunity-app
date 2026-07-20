import { describe, expect, it } from 'vitest';

import {
  ok,
  type Member,
  type MemberSubscription,
  type Order,
  type ProcessedPaymentEvent,
  type Product,
  type ProductGrant,
  type ProductPrice,
} from '@core/domain/index.js';

import type { PaymentWebhookEvent } from '../ports.js';
import { m2mEnroll } from './m2m-enroll.js';
import { fulfillStripeWebhook, type StripeWebhookDeps } from './stripe-webhook.js';
import { simulateSubscriptionCycle, simulateSubscriptionFailure } from './subscription-simulate.js';

const now = '2026-07-14T10:00:00.000Z';
const tenantA = { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 };

const product = (tenantId: string): Product => ({
  id: 'product-1',
  tenantId,
  title: 'Course One',
  description: 'Learn.',
  priceCents: 4900,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: now,
});

const monthlyPrice = (tenantId: string): ProductPrice => ({
  id: 'price-monthly',
  tenantId,
  productId: 'product-1',
  kind: 'recurring',
  interval: 'month',
  amountCents: 2900,
  currency: 'PLN',
  active: true,
  createdAt: now,
});

const completedEvent = (overrides?: {
  id?: string;
  objectId?: string;
  tenantId?: string;
  productId?: string;
  priceId?: string;
  subscriptionId?: string;
  email?: string;
}): PaymentWebhookEvent => ({
  id: overrides?.id ?? 'evt-1',
  type: 'checkout.session.completed',
  objectId: overrides?.objectId ?? 'cs-1',
  checkoutSession: {
    email: overrides?.email ?? 'buyer@example.com',
    subscriptionId: overrides?.subscriptionId ?? null,
    paymentIntentId: 'pi-1',
    metadata: {
      tenantId: overrides?.tenantId ?? 'tenant-a',
      productId: overrides?.productId ?? 'product-1',
      priceId: overrides?.priceId ?? null,
      memberEmail: null,
      language: 'pl',
    },
  },
});

const invoiceEvent = (input: {
  id: string;
  type: 'invoice.paid' | 'invoice.payment_failed';
  invoiceId: string;
  subscriptionId: string;
  periodEnd?: string;
}): PaymentWebhookEvent => ({
  id: input.id,
  type: input.type,
  objectId: input.invoiceId,
  checkoutSession: null,
  invoice: {
    subscriptionId: input.subscriptionId,
    chargeId: `ch-${input.invoiceId}`,
    paymentIntentId: `pi-${input.invoiceId}`,
    amountCents: null,
    currency: null,
    periodEnd: input.periodEnd ?? null,
  },
});

const refundEvent = (id = 'evt-refund'): PaymentWebhookEvent => ({
  id,
  type: 'charge.refunded',
  objectId: 'ch-refund',
  checkoutSession: null,
  adjustment: {
    chargeId: 'ch-refund',
    paymentIntentId: 'pi-1',
    invoiceId: null,
  },
});

const subscriptionEvent = (input: {
  id: string;
  type: 'customer.subscription.updated' | 'customer.subscription.deleted';
  subscriptionId: string;
  cancelAtPeriodEnd?: boolean;
  status?: string;
}): PaymentWebhookEvent => ({
  id: input.id,
  type: input.type,
  objectId: input.subscriptionId,
  checkoutSession: null,
  subscription: {
    id: input.subscriptionId,
    status: input.status ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: null,
  },
});

const harness = (options: { prices?: ProductPrice[] } = {}) => {
  const members = new Map<string, Member>();
  const grants = new Map<string, ProductGrant>();
  const events = new Map<string, ProcessedPaymentEvent>();
  const orders: Order[] = [];
  const subscriptions = new Map<string, MemberSubscription>();
  const prices = options.prices ?? [];
  const sent: string[] = [];
  let sequence = 0;
  let clockNow = now;
  let refundTransitions = 0;

  const deps: StripeWebhookDeps = {
    authPort: {
      getAuthenticatedUser: async () => null,
      ensureUser: async (email) => ({ userId: `user-${email}`, created: true }),
      requestMagicLink: async () => undefined,
      createEnrollmentMagicLink: async (input) => ({ url: `https://alpha.example.com/magic/${input.email}` }),
    },
    tenants: {
      findById: async () => null,
      findBySlug: async () => null,
      findSettings: async () => null,
      updateSettings: async (_tenantId, next) => next,
      createTenantWithOwnerGrant: async () => {
        throw new Error('not used');
      },
    },
    members: {
      findById: async (tenantId, memberId) => {
        const member = members.get(`${tenantId}:${memberId}`);
        return member ?? null;
      },
      findByEmail: async (tenantId, email) =>
        Array.from(members.values()).find((member) => member.tenantId === tenantId && member.email === email) ?? null,
      listWithProductIds: async () => [],
      create: async (tenantId, member) => {
        members.set(`${tenantId}:${member.id}`, member);
      },
      updateEmail: async () => null,
      delete: async () => false,
    },
    products: {
      listByTenant: async () => [],
      listPublishedByTenant: async () => [],
      findById: async (tenantId, productId) => (productId === 'product-1' ? product(tenantId) : null),
      create: async () => undefined,
      updateAccessItems: async () => null,
      setPublished: async () => undefined,
      bumpContentVersion: async () => undefined,
    },
    prices: {
      listByProduct: async (tenantId, productId) =>
        prices.filter((price) => price.tenantId === tenantId && price.productId === productId),
      listActiveByProducts: async () => prices,
      findById: async (tenantId, id) =>
        prices.find((price) => price.tenantId === tenantId && price.id === id) ?? null,
      create: async () => undefined,
      setActive: async () => null,
    },
    orders: {
      create: async (_tenantId, order) => {
        orders.push(order);
      },
      list: async () => ({ orders: [], total: 0 }),
      revenueSince: async () => [],
      countSince: async () => 0,
    },
    paymentRefunds: {
      findOrderByProviderObjectIds: async (tenantId, providerObjectIds) =>
        orders.find(
          (order) =>
            order.tenantId === tenantId &&
            Object.entries(providerObjectIds).some(
              ([key, value]) => order.providerObjectIds[key] === value,
            ),
        ) ?? null,
      findLatestSubscriptionOrder: async (tenantId, providerSubscriptionId) =>
        [...orders]
          .reverse()
          .find(
            (order) =>
              order.tenantId === tenantId &&
              order.providerObjectIds['subscription'] === providerSubscriptionId,
          ) ?? null,
      markOrderRefunded: async (tenantId, orderId) => {
        const index = orders.findIndex(
          (order) => order.tenantId === tenantId && order.id === orderId && order.status !== 'refunded',
        );
        if (index < 0) return null;
        const current = orders[index];
        if (!current) return null;
        const refunded: Order = { ...current, status: 'refunded' };
        orders[index] = refunded;
        refundTransitions += 1;
        return refunded;
      },
    },
    subscriptions: {
      findById: async (tenantId, id) => {
        const subscription = subscriptions.get(id);
        return subscription?.tenantId === tenantId ? subscription : null;
      },
      findByProviderSubscriptionId: async (tenantId, providerSubscriptionId) =>
        Array.from(subscriptions.values()).find(
          (subscription) =>
            subscription.tenantId === tenantId &&
            subscription.providerSubscriptionId === providerSubscriptionId,
        ) ?? null,
      listForMember: async (tenantId, memberId) =>
        Array.from(subscriptions.values()).filter(
          (subscription) => subscription.tenantId === tenantId && subscription.memberId === memberId,
        ),
      create: async (_tenantId, subscription) => {
        subscriptions.set(subscription.id, subscription);
      },
      update: async (_tenantId, subscription) => {
        subscriptions.set(subscription.id, subscription);
        return subscription;
      },
      countActive: async () => 0,
    },
    grants: {
      findById: async (tenantId, grantId) => grants.get(`${tenantId}:${grantId}`) ?? null,
      findGrant: async (tenantId, memberId, productId) =>
        Array.from(grants.values()).find(
          (grant) => grant.tenantId === tenantId && grant.memberId === memberId && grant.productId === productId,
        ) ?? null,
      createGrant: async (tenantId, grant) => {
        grants.set(`${tenantId}:${grant.id}`, grant);
        return true;
      },
      setGrantWindow: async (tenantId, grantId, window) => {
        const existing = grants.get(`${tenantId}:${grantId}`);
        if (!existing) return null;
        const updated = { ...existing, ...window };
        grants.set(`${tenantId}:${grantId}`, updated);
        return updated;
      },
      revokeGrant: async (tenantId, grantId, expiresAt) => {
        const existing = grants.get(`${tenantId}:${grantId}`);
        if (!existing) return null;
        const revoked = { ...existing, expiresAt };
        grants.set(`${tenantId}:${grantId}`, revoked);
        return revoked;
      },
      listForMemberWithProductNames: async () => [],
      listActiveForMember: async () => [],
      listGrantedProducts: async () => [],
    },
    processedPaymentEvents: {
      claim: async (tenantId, event) => {
        if (events.has(event.id)) return false;
        for (const existing of events.values()) {
          if (existing.tenantId === tenantId && existing.objectId === event.objectId && existing.type === event.type) {
            return false;
          }
        }
        events.set(event.id, { ...event, tenantId });
        return true;
      },
      release: async (_tenantId, eventId) => {
        events.delete(eventId);
      },
    },
    email: {
      send: async (message) => {
        sent.push(message.to);
        return ok({ messageId: `message-${sent.length}` });
      },
    },
    devMagicLinks: { findByEmail: async () => null },
    ids: { nextId: () => `id-${++sequence}` },
    clock: { nowIso: () => clockNow },
    appBaseUrl: 'https://alpha.example.com',
    exposeMagicLinks: false,
  };

  return {
    deps,
    members,
    grants,
    events,
    orders,
    subscriptions,
    sent,
    refundTransitions: () => refundTransitions,
    setNow: (iso: string) => {
      clockNow = iso;
    },
  };
};

const subscribedHarness = async () => {
  const h = harness({ prices: [monthlyPrice('tenant-a')] });
  const checkout = await fulfillStripeWebhook(
    tenantA,
    completedEvent({ priceId: 'price-monthly', subscriptionId: 'sub-1' }),
    h.deps,
  );
  expect(checkout).toEqual({ ok: true, value: { processed: true } });
  const subscription = Array.from(h.subscriptions.values())[0];
  if (!subscription) throw new Error('checkout did not create a subscription');
  return { ...h, subscription };
};

describe('fulfillStripeWebhook', () => {
  it('fulfills once when Stripe retries the same event', async () => {
    const h = harness();
    const first = await fulfillStripeWebhook(tenantA, completedEvent(), h.deps);
    const second = await fulfillStripeWebhook(tenantA, completedEvent(), h.deps);

    expect(first).toEqual({ ok: true, value: { processed: true } });
    expect(second).toEqual({ ok: true, value: { processed: false } });
    expect(h.members.size).toBe(1);
    expect(h.grants.size).toBe(1);
    expect(h.events.size).toBe(1);
    expect(h.orders).toHaveLength(1);
    expect(h.sent).toEqual(['buyer@example.com']);
    expect(Array.from(h.grants.values())[0]?.source).toBe('stripe');
    expect(h.orders[0]).toMatchObject({
      kind: 'one_time',
      status: 'paid',
      amountCents: 4900,
      provider: 'stripe',
      providerObjectIds: { checkoutSession: 'cs-1' },
    });
  });

  it('appends exactly one order when two duplicate deliveries race the same event', async () => {
    const h = harness();
    const [first, second] = await Promise.all([
      fulfillStripeWebhook(tenantA, completedEvent(), h.deps),
      fulfillStripeWebhook(tenantA, completedEvent(), h.deps),
    ]);

    const outcomes = [first, second];
    expect(outcomes).toContainEqual({ ok: true, value: { processed: true } });
    expect(outcomes).toContainEqual({ ok: true, value: { processed: false } });
    expect(h.orders).toHaveLength(1);
    expect(h.members.size).toBe(1);
    expect(h.grants.size).toBe(1);
    expect(h.events.size).toBe(1);
    expect(h.sent).toEqual(['buyer@example.com']);
  });

  it('rejects tenant metadata mismatch before creating a member or grant', async () => {
    const h = harness();
    const result = await fulfillStripeWebhook(tenantA, completedEvent({ tenantId: 'tenant-b' }), h.deps);

    expect(result.ok).toBe(false);
    expect(h.members.size).toBe(0);
    expect(h.grants.size).toBe(0);
    expect(h.orders).toHaveLength(0);
    expect(h.sent).toEqual([]);
  });

  it('uses the same member, grant, magic-link, and welcome-email fulfillment path as m2m enrollment', async () => {
    const stripe = harness();
    const m2m = harness();
    const stripeResult = await fulfillStripeWebhook(tenantA, completedEvent(), stripe.deps);
    const m2mResult = await m2mEnroll(
      tenantA,
      { email: 'buyer@example.com', productId: 'product-1', language: 'pl' },
      m2m.deps,
    );

    expect(stripeResult.ok).toBe(true);
    expect(m2mResult.ok).toBe(true);
    expect(stripe.members.size).toBe(m2m.members.size);
    expect(stripe.grants.size).toBe(m2m.grants.size);
    expect(stripe.sent).toEqual(m2m.sent);
  });

  it('creates a subscription with a grace-buffered grant on a recurring checkout', async () => {
    const h = await subscribedHarness();

    expect(h.subscription).toMatchObject({
      status: 'active',
      priceId: 'price-monthly',
      providerSubscriptionId: 'sub-1',
      currentPeriodEnd: '2026-08-14T10:00:00.000Z',
      cancelAtPeriodEnd: false,
    });
    expect(h.orders).toHaveLength(1);
    expect(h.orders[0]).toMatchObject({ kind: 'recurring', status: 'paid', amountCents: 2900 });
    expect(Array.from(h.grants.values())[0]?.expiresAt).toBe('2026-08-17T10:00:00.000Z');
  });

  it('renews the grant to the new period end plus grace on invoice.paid', async () => {
    const h = await subscribedHarness();

    const renewal = await fulfillStripeWebhook(
      tenantA,
      invoiceEvent({
        id: 'evt-2',
        type: 'invoice.paid',
        invoiceId: 'in-1',
        subscriptionId: 'sub-1',
        periodEnd: '2026-09-14T10:00:00.000Z',
      }),
      h.deps,
    );

    expect(renewal).toEqual({ ok: true, value: { processed: true } });
    const subscription = h.subscriptions.get(h.subscription.id);
    expect(subscription).toMatchObject({
      status: 'active',
      currentPeriodEnd: '2026-09-14T10:00:00.000Z',
    });
    expect(Array.from(h.grants.values())[0]?.expiresAt).toBe('2026-09-17T10:00:00.000Z');
    expect(h.orders).toHaveLength(2);
    expect(h.orders[1]).toMatchObject({
      kind: 'recurring',
      status: 'paid',
      amountCents: 2900,
      providerObjectIds: { invoice: 'in-1', subscription: 'sub-1' },
    });
  });

  it('appends exactly one order when the same invoice.paid event is retried', async () => {
    const h = await subscribedHarness();
    const event = invoiceEvent({ id: 'evt-2', type: 'invoice.paid', invoiceId: 'in-1', subscriptionId: 'sub-1' });

    const first = await fulfillStripeWebhook(tenantA, event, h.deps);
    const second = await fulfillStripeWebhook(tenantA, event, h.deps);

    expect(first).toEqual({ ok: true, value: { processed: true } });
    expect(second).toEqual({ ok: true, value: { processed: false } });
    expect(h.orders).toHaveLength(2);
  });

  it('marks past_due on invoice.payment_failed and keeps access until the period end', async () => {
    const h = await subscribedHarness();
    const grantBefore = Array.from(h.grants.values())[0];

    const failure = await fulfillStripeWebhook(
      tenantA,
      invoiceEvent({ id: 'evt-3', type: 'invoice.payment_failed', invoiceId: 'in-2', subscriptionId: 'sub-1' }),
      h.deps,
    );

    expect(failure).toEqual({ ok: true, value: { processed: true } });
    expect(h.subscriptions.get(h.subscription.id)?.status).toBe('past_due');
    expect(Array.from(h.grants.values())[0]?.expiresAt).toBe(grantBefore?.expiresAt);
    expect(h.orders).toHaveLength(2);
    expect(h.orders[1]).toMatchObject({ kind: 'recurring', status: 'failed', amountCents: 2900 });
  });

  it('flags cancelAtPeriodEnd on customer.subscription.updated and cancels on deleted without cutting the grant', async () => {
    const h = await subscribedHarness();

    await fulfillStripeWebhook(
      tenantA,
      subscriptionEvent({
        id: 'evt-4',
        type: 'customer.subscription.updated',
        subscriptionId: 'sub-1',
        cancelAtPeriodEnd: true,
        status: 'active',
      }),
      h.deps,
    );
    expect(h.subscriptions.get(h.subscription.id)).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true,
    });

    const expiresBefore = Array.from(h.grants.values())[0]?.expiresAt;
    await fulfillStripeWebhook(
      tenantA,
      subscriptionEvent({ id: 'evt-5', type: 'customer.subscription.deleted', subscriptionId: 'sub-1' }),
      h.deps,
    );
    expect(h.subscriptions.get(h.subscription.id)?.status).toBe('canceled');
    expect(Array.from(h.grants.values())[0]?.expiresAt).toBe(expiresBefore);
    expect(h.orders).toHaveLength(1);
  });

  it('marks a refunded order and revokes its grant', async () => {
    const h = harness();
    await fulfillStripeWebhook(tenantA, completedEvent(), h.deps);

    const result = await fulfillStripeWebhook(tenantA, refundEvent(), h.deps, 'simulated');

    expect(result).toEqual({ ok: true, value: { processed: true } });
    expect(h.orders[0]?.status).toBe('refunded');
    expect(Array.from(h.grants.values())[0]?.expiresAt).toBe(now);
    expect(h.refundTransitions()).toBe(1);
  });

  it('applies a duplicate refund delivery exactly once', async () => {
    const h = harness();
    await fulfillStripeWebhook(tenantA, completedEvent(), h.deps);
    const event = refundEvent();

    const first = await fulfillStripeWebhook(tenantA, event, h.deps);
    const second = await fulfillStripeWebhook(tenantA, event, h.deps);

    expect(first).toEqual({ ok: true, value: { processed: true } });
    expect(second).toEqual({ ok: true, value: { processed: false } });
    expect(h.orders[0]?.status).toBe('refunded');
    expect(h.refundTransitions()).toBe(1);
  });
});

describe('simulated subscription lifecycle', () => {
  it('drives invoice.paid through the webhook path on simulate-cycle', async () => {
    const h = await subscribedHarness();

    const cycled = await simulateSubscriptionCycle(tenantA, h.subscription.id, h.deps);

    expect(cycled).toMatchObject({
      ok: true,
      value: { processed: true, subscription: { status: 'active' } },
    });
    expect(h.orders).toHaveLength(2);
    expect(h.orders[1]).toMatchObject({ kind: 'recurring', status: 'paid' });
    if (cycled.ok) {
      expect(cycled.value.subscription.currentPeriodEnd > h.subscription.currentPeriodEnd).toBe(true);
      expect(Array.from(h.grants.values())[0]?.expiresAt).toBe(
        '2026-09-17T10:00:00.000Z',
      );
    }
  });

  it('marks past_due on simulate-failure without touching the grant', async () => {
    const h = await subscribedHarness();
    const expiresBefore = Array.from(h.grants.values())[0]?.expiresAt;

    const failed = await simulateSubscriptionFailure(tenantA, h.subscription.id, h.deps);

    expect(failed).toMatchObject({
      ok: true,
      value: { processed: true, subscription: { status: 'past_due' } },
    });
    expect(h.orders).toHaveLength(2);
    expect(h.orders[1]).toMatchObject({ status: 'failed' });
    expect(Array.from(h.grants.values())[0]?.expiresAt).toBe(expiresBefore);
  });

  it('is not found when simulating a cycle for an unknown subscription', async () => {
    const h = harness({ prices: [monthlyPrice('tenant-a')] });
    const result = await simulateSubscriptionCycle(tenantA, 'missing-sub', h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects simulating a subscription that has no provider subscription id', async () => {
    const h = await subscribedHarness();
    h.subscriptions.set(h.subscription.id, { ...h.subscription, providerSubscriptionId: null });
    const result = await simulateSubscriptionCycle(tenantA, h.subscription.id, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects simulating a failure on an already-canceled subscription', async () => {
    const h = await subscribedHarness();
    h.subscriptions.set(h.subscription.id, { ...h.subscription, status: 'canceled' });
    const result = await simulateSubscriptionFailure(tenantA, h.subscription.id, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('cancels instead of renewing when cancelAtPeriodEnd is set', async () => {
    const h = await subscribedHarness();
    await fulfillStripeWebhook(
      tenantA,
      subscriptionEvent({
        id: 'evt-4',
        type: 'customer.subscription.updated',
        subscriptionId: 'sub-1',
        cancelAtPeriodEnd: true,
        status: 'active',
      }),
      h.deps,
    );

    const cycled = await simulateSubscriptionCycle(tenantA, h.subscription.id, h.deps);

    expect(cycled).toMatchObject({
      ok: true,
      value: { processed: true, subscription: { status: 'canceled' } },
    });
    expect(h.orders).toHaveLength(1);
    expect(h.subscriptions.get(h.subscription.id)?.currentPeriodEnd).toBe(
      h.subscription.currentPeriodEnd,
    );
  });
});
