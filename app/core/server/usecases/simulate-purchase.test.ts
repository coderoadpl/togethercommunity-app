import { describe, expect, it } from 'vitest';

import type {
  Member,
  MemberSubscription,
  Order,
  Product,
  ProductGrant,
  ProductPrice,
} from '#core/domain/index.js';

import type { AuthPort, ProductRepository, PurchaseRepository } from '../ports.js';
import { simulatePurchase, type SimulatePurchaseDeps } from './simulate-purchase.js';

const product = (id: string, tenantId: string, published: boolean): Product => ({
  id,
  tenantId,
  title: `Product ${id}`,
  description: `Description ${id}`,
  priceCents: 1000,
  currency: 'PLN',
  published,
  accessItems: [],
  legacyId: null,
  createdAt: '1998-07-12T00:00:00.000Z',
});

const monthlyPrice = (id: string, tenantId: string, productId: string): ProductPrice => ({
  id,
  tenantId,
  productId,
  kind: 'recurring',
  interval: 'month',
  amountCents: 2900,
  currency: 'PLN',
  active: true,
  createdAt: '1998-07-12T00:00:00.000Z',
});

const fakeProducts = (initial: Product[]): ProductRepository => ({
  listByTenant: async (tenantId) => initial.filter((p) => p.tenantId === tenantId),
  listPublishedByTenant: async (tenantId) =>
    initial.filter((p) => p.tenantId === tenantId && p.published),
  findById: async (tenantId, id) =>
    initial.find((p) => p.tenantId === tenantId && p.id === id) ?? null,
  create: async () => undefined,
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
});

const fakePurchases = () => {
  const store: Member[] = [];
  const grants: ProductGrant[] = [];
  const repo: PurchaseRepository = {
    createMemberGrant: async (input) => {
      let member = store.find((m) => m.tenantId === input.tenantId && m.userId === input.userId);
      if (!member) {
        member = {
          id: input.memberId,
          tenantId: input.tenantId,
          userId: input.userId,
          email: input.email,
          displayName: null,
          tags: [],
          marketingConsents: {},
          externalCustomerIds: {},
          createdAt: input.createdAt,
          deletedAt: null,
        };
        store.push(member);
      }
      const existingGrant = grants.find(
        (g) =>
          g.tenantId === input.tenantId &&
          g.memberId === member.id &&
          g.productId === input.productId,
      );
      if (existingGrant) return { member, grantCreated: false };
      grants.push({
        id: input.grantId,
        tenantId: input.tenantId,
        memberId: member.id,
        productId: input.productId,
        source: 'simulated',
        startsAt: input.createdAt,
        expiresAt: null,
        legacyId: null,
        createdAt: input.createdAt,
      });
      return { member, grantCreated: true };
    },
  };
  return { repo, members: store, grants };
};

const fakeAuth = (): AuthPort => ({
  getAuthenticatedUser: async () => null,
  ensureUser: async () => ({ userId: 'user-1', created: true }),
  requestMagicLink: async () => undefined,
  createEnrollmentMagicLink: async () => ({ url: 'https://example.com/magic' }),
});

const harness = (input: { products: Product[]; prices?: ProductPrice[] }) => {
  const purchases = fakePurchases();
  const members: Member[] = [];
  const grants = new Map<string, ProductGrant>();
  const orders: Order[] = [];
  const subscriptions = new Map<string, MemberSubscription>();
  const prices = input.prices ?? [];
  let sequence = 0;

  const deps: SimulatePurchaseDeps = {
    products: fakeProducts(input.products),
    purchases: purchases.repo,
    authPort: fakeAuth(),
    members: {
      findById: async () => null,
      findByEmail: async (tenantId, email) =>
        members.find((m) => m.tenantId === tenantId && m.email === email) ?? null,
      listWithProductIds: async () => [],
      create: async (_tenantId, member) => {
        members.push(member);
      },
      updateEmail: async () => null,
    },
    prices: {
      listByProduct: async (tenantId, productId) =>
        prices.filter((p) => p.tenantId === tenantId && p.productId === productId),
      listActiveByProducts: async () => prices,
      findById: async (tenantId, id) =>
        prices.find((p) => p.tenantId === tenantId && p.id === id) ?? null,
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
      listPaidWithoutGrant: async () => [],
    },
    subscriptions: {
      findById: async (_tenantId, id) => subscriptions.get(id) ?? null,
      findByProviderSubscriptionId: async () => null,
      listForMember: async (_tenantId, memberId) =>
        Array.from(subscriptions.values()).filter((s) => s.memberId === memberId),
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
      findById: async (_tenantId, id) => grants.get(id) ?? null,
      findGrant: async (tenantId, memberId, productId) =>
        Array.from(grants.values()).find(
          (g) => g.tenantId === tenantId && g.memberId === memberId && g.productId === productId,
        ) ?? null,
      createGrant: async (_tenantId, grant) => {
        grants.set(grant.id, grant);
        return true;
      },
      setGrantWindow: async (_tenantId, id, window) => {
        const existing = grants.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...window };
        grants.set(id, updated);
        return updated;
      },
      revokeGrant: async () => null,
      listForMemberWithProductNames: async () => [],
      listActiveForMember: async () => [],
      listGrantedProducts: async () => [],
    },
    ids: { nextId: () => `id-${++sequence}` },
    clock: { nowIso: () => '1998-07-12T00:00:00.000Z' },
  };

  return { deps, purchases, orders, subscriptions, grants };
};

describe('simulatePurchase', () => {
  it('provisions exactly one member, one grant and one order when run twice', async () => {
    const h = harness({ products: [product('p1', 't-acme', true)] });

    const first = await simulatePurchase('t-acme', { email: 'buyer@together.dev', productId: 'p1' }, h.deps);
    expect(first).toMatchObject({ ok: true, value: { alreadyOwned: false } });

    const second = await simulatePurchase('t-acme', { email: 'buyer@together.dev', productId: 'p1' }, h.deps);
    expect(second).toMatchObject({ ok: true, value: { alreadyOwned: true, orderId: null } });

    expect(h.purchases.members).toHaveLength(1);
    expect(h.purchases.grants).toHaveLength(1);
    expect(h.orders).toHaveLength(1);
    expect(h.orders[0]).toMatchObject({
      kind: 'one_time',
      status: 'paid',
      amountCents: 1000,
      provider: 'simulated',
    });
    expect(first.ok && second.ok && first.value.memberId).toBe(
      second.ok ? second.value.memberId : '',
    );
  });

  it('starts a simulated subscription for a recurring price', async () => {
    const h = harness({
      products: [product('p1', 't-acme', true)],
      prices: [monthlyPrice('price-1', 't-acme', 'p1')],
    });

    const result = await simulatePurchase(
      't-acme',
      { email: 'buyer@together.dev', productId: 'p1', priceId: 'price-1' },
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, value: { alreadyOwned: false } });
    expect(h.subscriptions.size).toBe(1);
    const subscription = Array.from(h.subscriptions.values())[0];
    expect(subscription).toMatchObject({
      status: 'active',
      priceId: 'price-1',
      provider: 'simulated',
      currentPeriodEnd: '1998-08-12T00:00:00.000Z',
    });
    expect(h.orders).toHaveLength(1);
    expect(h.orders[0]).toMatchObject({ kind: 'recurring', status: 'paid', amountCents: 2900 });
    const grant = Array.from(h.grants.values())[0];
    expect(grant?.expiresAt).toBe('1998-08-15T00:00:00.000Z');

    const repeat = await simulatePurchase(
      't-acme',
      { email: 'buyer@together.dev', productId: 'p1', priceId: 'price-1' },
      h.deps,
    );
    expect(repeat).toMatchObject({ ok: true, value: { alreadyOwned: true } });
    expect(h.subscriptions.size).toBe(1);
    expect(h.orders).toHaveLength(1);
  });

  it('returns not_found for an unpublished product', async () => {
    const h = harness({ products: [product('p1', 't-acme', false)] });

    const result = await simulatePurchase('t-acme', { email: 'buyer@together.dev', productId: 'p1' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.purchases.members).toHaveLength(0);
  });

  it('returns not_found for a product owned by another tenant', async () => {
    const h = harness({ products: [product('p1', 't-other', true)] });

    const result = await simulatePurchase('t-acme', { email: 'buyer@together.dev', productId: 'p1' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
