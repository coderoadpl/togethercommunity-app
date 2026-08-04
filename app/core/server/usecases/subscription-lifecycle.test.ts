import { describe, expect, it } from 'vitest';

import type { MemberSubscription, Order, ProductGrant, ProductPrice } from '#core/domain/index.js';

import type { SubscriptionLifecycleDeps } from './subscription-lifecycle.js';
import {
  failSubscriptionPayment,
  renewSubscriptionPeriod,
  startSubscription,
  syncGrantToSubscription,
  updateSubscriptionFromProvider,
} from './subscription-lifecycle.js';

const NOW = '2026-07-14T10:00:00.000Z';

const price = (over: Partial<ProductPrice> = {}): ProductPrice => ({
  id: 'price-1',
  tenantId: 't1',
  productId: 'prod-1',
  kind: 'recurring',
  interval: 'month',
  amountCents: 2900,
  currency: 'PLN',
  active: true,
  createdAt: NOW,
  ...over,
});

const subscription = (over: Partial<MemberSubscription> = {}): MemberSubscription => ({
  id: 'sub-1',
  tenantId: 't1',
  memberId: 'mem-1',
  productId: 'prod-1',
  priceId: 'price-1',
  provider: 'stripe',
  providerSubscriptionId: 'psub-1',
  status: 'active',
  currentPeriodEnd: '2026-08-14T10:00:00.000Z',
  cancelAtPeriodEnd: false,
  couponId: null,
  couponDiscountCents: 0,
  couponRecurringDuration: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const harness = (prices: ProductPrice[] = []) => {
  const orders: Order[] = [];
  const grants = new Map<string, ProductGrant>();
  const subs = new Map<string, MemberSubscription>();
  let seq = 0;
  const deps: SubscriptionLifecycleDeps = {
    prices: {
      listByProduct: async () => prices,
      listActiveByProducts: async () => prices,
      findById: async (tenantId, id) => prices.find((p) => p.tenantId === tenantId && p.id === id) ?? null,
      create: async () => undefined,
      setActive: async () => null,
    },
    orders: {
      create: async (_t, order) => {
        orders.push(order);
      },
      list: async () => ({ orders: [], total: 0 }),
      revenueSince: async () => [],
      countSince: async () => 0,
      listPaidWithoutGrant: async () => [],
    },
    subscriptions: {
      findById: async (_t, id) => subs.get(id) ?? null,
      findByProviderSubscriptionId: async () => null,
      listForMember: async () => [],
      create: async (_t, sub) => {
        subs.set(sub.id, sub);
      },
      update: async (_t, sub) => {
        subs.set(sub.id, sub);
        return sub;
      },
      countActive: async () => 0,
    },
    grants: {
      findById: async () => null,
      findGrant: async (tenantId, memberId, productId) =>
        [...grants.values()].find(
          (g) => g.tenantId === tenantId && g.memberId === memberId && g.productId === productId,
        ) ?? null,
      createGrant: async (_t, grant) => {
        grants.set(grant.id, grant);
        return true;
      },
      setGrantWindow: async (_t, grantId, window) => {
        const existing = [...grants.values()].find((g) => g.id === grantId);
        if (!existing) return null;
        const updated = { ...existing, ...window };
        grants.set(grantId, updated);
        return updated;
      },
      revokeGrant: async () => null,
      listForMemberWithProductNames: async () => [],
      listActiveForMember: async () => [],
      listGrantedProducts: async () => [],
    },
    ids: { nextId: () => `id-${(seq += 1)}` },
    clock: { nowIso: () => NOW },
  };
  return { deps, orders, grants, subs };
};

describe('startSubscription', () => {
  it('computes the first period from the price interval and grace-buffers the grant', async () => {
    const h = harness();
    const { subscription: sub, order } = await startSubscription(
      't1',
      {
        memberId: 'mem-1',
        price: price(),
        provider: 'stripe',
        providerSubscriptionId: 'psub-1',
        providerObjectIds: { checkoutSession: 'cs-1' },
      },
      h.deps,
    );
    expect(sub).toMatchObject({ status: 'active', currentPeriodEnd: '2026-08-14T10:00:00.000Z', cancelAtPeriodEnd: false });
    expect(order).toMatchObject({ kind: 'recurring', status: 'paid', amountCents: 2900, provider: 'stripe' });
    expect([...h.grants.values()][0]?.expiresAt).toBe('2026-08-17T10:00:00.000Z');
    expect([...h.grants.values()][0]?.source).toBe('stripe');
  });

  it('honours an explicit period end and amount, and maps a simulated provider to a simulated grant', async () => {
    const h = harness();
    const { order } = await startSubscription(
      't1',
      {
        memberId: 'mem-1',
        price: price(),
        provider: 'simulated',
        providerSubscriptionId: null,
        providerObjectIds: {},
        currentPeriodEnd: '2026-12-01T00:00:00.000Z',
        amountCents: 1000,
      },
      h.deps,
    );
    expect(order.amountCents).toBe(1000);
    expect([...h.grants.values()][0]?.source).toBe('simulated');
    expect([...h.grants.values()][0]?.expiresAt).toBe('2026-12-04T00:00:00.000Z');
  });
});

describe('renewSubscriptionPeriod', () => {
  it('carries the original billing snapshot onto renewal orders', async () => {
    const h = harness([price()]);
    const billing = {
      nip: '5555555555',
      companyName: 'Acme sp. z o.o.',
      address: 'Prosta 1',
      postalCode: '00-001',
      city: 'Warszawa',
      country: 'PL',
    };
    const { order } = await renewSubscriptionPeriod(
      't1',
      { subscription: subscription(), providerObjectIds: { invoice: 'in-1' }, billing },
      h.deps,
    );
    expect(order.billing).toEqual(billing);
  });

  it('keeps forever coupon attribution on renewal orders', async () => {
    const h = harness([price()]);
    const { order } = await renewSubscriptionPeriod(
      't1',
      {
        subscription: subscription({
          couponId: 'coupon-1',
          couponDiscountCents: 1000,
          couponRecurringDuration: 'forever',
        }),
        providerObjectIds: { invoice: 'in-coupon' },
      },
      h.deps,
    );
    expect(order).toMatchObject({
      amountCents: 1900,
      couponId: 'coupon-1',
      discountCents: 1000,
    });
  });

  it('extends from the current period end when it is still in the future, using the price interval', async () => {
    const h = harness([price({ interval: 'year' })]);
    const { subscription: sub, order } = await renewSubscriptionPeriod(
      't1',
      { subscription: subscription(), providerObjectIds: { invoice: 'in-1' } },
      h.deps,
    );
    expect(sub.currentPeriodEnd).toBe('2027-08-14T10:00:00.000Z');
    expect(order).toMatchObject({ status: 'paid', amountCents: 2900 });
  });

  it('extends a grant that a withdrawn cancellation had cut back to the period end', async () => {
    const h = harness([price()]);
    const started = await startSubscription(
      't1',
      {
        memberId: 'mem-1',
        price: price(),
        provider: 'stripe',
        providerSubscriptionId: 'psub-1',
        providerObjectIds: {},
      },
      h.deps,
    );
    await syncGrantToSubscription(
      't1',
      { ...started.subscription, cancelAtPeriodEnd: true },
      null,
      h.deps,
    );
    expect([...h.grants.values()][0]?.expiresAt).toBe('2026-08-14T10:00:00.000Z');

    await renewSubscriptionPeriod(
      't1',
      { subscription: started.subscription, providerObjectIds: { invoice: 'in-renew' } },
      h.deps,
    );
    expect([...h.grants.values()][0]?.expiresAt).toBe('2026-09-17T10:00:00.000Z');
  });

  it('extends from now when the current period already lapsed', async () => {
    const h = harness([price()]);
    const { subscription: sub } = await renewSubscriptionPeriod(
      't1',
      { subscription: subscription({ currentPeriodEnd: '2026-01-01T00:00:00.000Z' }), providerObjectIds: {} },
      h.deps,
    );
    expect(sub.currentPeriodEnd).toBe('2026-08-14T10:00:00.000Z');
  });

  it('falls back to a monthly period, zero amount and PLN when the price row is gone', async () => {
    const h = harness([]);
    const { order } = await renewSubscriptionPeriod(
      't1',
      { subscription: subscription(), providerObjectIds: {} },
      h.deps,
    );
    expect(order).toMatchObject({ amountCents: 0, currency: 'PLN' });
  });

  it('honours an explicit period end and amount/currency override', async () => {
    const h = harness([price()]);
    const { subscription: sub, order } = await renewSubscriptionPeriod(
      't1',
      {
        subscription: subscription(),
        providerObjectIds: {},
        periodEnd: '2026-09-30T00:00:00.000Z',
        amountCents: 500,
        currency: 'EUR',
      },
      h.deps,
    );
    expect(sub.currentPeriodEnd).toBe('2026-09-30T00:00:00.000Z');
    expect(order).toMatchObject({ amountCents: 500, currency: 'EUR' });
  });
});

describe('failSubscriptionPayment', () => {
  it('flips the subscription to past_due and records a failed order without touching the grant', async () => {
    const h = harness([]);
    const { subscription: sub, order } = await failSubscriptionPayment(
      't1',
      { subscription: subscription(), providerObjectIds: { invoice: 'in-2' } },
      h.deps,
    );
    expect(sub.status).toBe('past_due');
    expect(order).toMatchObject({ status: 'failed', amountCents: 0, currency: 'PLN' });
    expect(h.grants.size).toBe(0);
  });
});

describe('updateSubscriptionFromProvider', () => {
  it('sets cancelAtPeriodEnd while keeping the status and period when not canceled', async () => {
    const h = harness();
    const sub = await updateSubscriptionFromProvider(
      't1',
      { subscription: subscription(), cancelAtPeriodEnd: true },
      h.deps,
    );
    expect(sub).toMatchObject({ cancelAtPeriodEnd: true, status: 'active', currentPeriodEnd: '2026-08-14T10:00:00.000Z' });
  });

  it('marks canceled and adopts a new period end when the provider reports one', async () => {
    const h = harness();
    const sub = await updateSubscriptionFromProvider(
      't1',
      {
        subscription: subscription(),
        cancelAtPeriodEnd: true,
        canceled: true,
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      },
      h.deps,
    );
    expect(sub).toMatchObject({ status: 'canceled', currentPeriodEnd: '2026-09-01T00:00:00.000Z' });
  });
});

describe('syncGrantToSubscription', () => {
  const subscribed = async () => {
    const h = harness();
    const started = await startSubscription(
      't1',
      {
        memberId: 'mem-1',
        price: price(),
        provider: 'stripe',
        providerSubscriptionId: 'psub-1',
        providerObjectIds: {},
      },
      h.deps,
    );
    return { ...h, subscription: started.subscription };
  };
  const grantExpiry = (h: { grants: Map<string, ProductGrant> }) =>
    [...h.grants.values()][0]?.expiresAt;

  it('drops the grace buffer and ends the grant at the paid period end when cancellation is scheduled', async () => {
    const h = await subscribed();
    await syncGrantToSubscription(
      't1',
      { ...h.subscription, cancelAtPeriodEnd: true, currentPeriodEnd: '2026-08-20T10:00:00.000Z' },
      '2026-08-20T10:00:00.000Z',
      h.deps,
    );
    expect(grantExpiry(h)).toBe('2026-08-20T10:00:00.000Z');
  });

  it('keeps the paid period the provider reports on a cancelled subscription', async () => {
    const h = await subscribed();
    await syncGrantToSubscription(
      't1',
      { ...h.subscription, status: 'canceled' },
      '2026-08-20T10:00:00.000Z',
      h.deps,
    );
    expect(grantExpiry(h)).toBe('2026-08-20T10:00:00.000Z');
  });

  it('ends access at the provider termination time for an immediate cancellation', async () => {
    const h = await subscribed();
    await syncGrantToSubscription('t1', { ...h.subscription, status: 'canceled' }, NOW, h.deps);
    expect(grantExpiry(h)).toBe(NOW);
  });

  it('falls back to the stored period end when a canceled event omits it', async () => {
    const h = await subscribed();
    await syncGrantToSubscription('t1', { ...h.subscription, status: 'canceled' }, null, h.deps);
    expect(grantExpiry(h)).toBe(h.subscription.currentPeriodEnd);
  });

  it('restores the grace buffer when a scheduled cancellation is withdrawn', async () => {
    const h = await subscribed();
    await syncGrantToSubscription(
      't1',
      { ...h.subscription, cancelAtPeriodEnd: true },
      null,
      h.deps,
    );
    expect(grantExpiry(h)).toBe('2026-08-14T10:00:00.000Z');

    await syncGrantToSubscription('t1', h.subscription, null, h.deps);
    expect(grantExpiry(h)).toBe('2026-08-17T10:00:00.000Z');
  });

  it('does not shorten a longer grant on an ordinary subscription update', async () => {
    const h = await subscribed();
    const grant = [...h.grants.values()][0];
    if (grant === undefined) throw new Error('missing grant');
    h.grants.set(grant.id, { ...grant, expiresAt: '2026-12-01T00:00:00.000Z' });

    const applied = await syncGrantToSubscription('t1', h.subscription, null, h.deps);

    expect(applied).toBe('2026-12-01T00:00:00.000Z');
    expect(grantExpiry(h)).toBe('2026-12-01T00:00:00.000Z');
  });

  it('leaves a lifetime grant alone', async () => {
    const h = await subscribed();
    const grant = [...h.grants.values()][0];
    if (grant === undefined) throw new Error('missing grant');
    h.grants.set(grant.id, { ...grant, expiresAt: null });

    await syncGrantToSubscription('t1', { ...h.subscription, status: 'canceled' }, null, h.deps);
    expect(grantExpiry(h)).toBeNull();
  });

  it('does not resurrect an already expired grant', async () => {
    const h = await subscribed();
    const grant = [...h.grants.values()][0];
    if (grant === undefined) throw new Error('missing grant');
    h.grants.set(grant.id, { ...grant, expiresAt: '2026-07-01T10:00:00.000Z' });

    await syncGrantToSubscription('t1', h.subscription, null, h.deps);
    expect(grantExpiry(h)).toBe('2026-07-01T10:00:00.000Z');

    await syncGrantToSubscription(
      't1',
      { ...h.subscription, status: 'canceled' },
      '2026-09-01T10:00:00.000Z',
      h.deps,
    );
    expect(grantExpiry(h)).toBe('2026-07-01T10:00:00.000Z');
  });
});
