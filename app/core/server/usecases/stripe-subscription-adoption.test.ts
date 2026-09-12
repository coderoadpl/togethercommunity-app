import { describe, expect, it, vi } from 'vitest';

import {
  memberSchema, ok, type MemberEvent, type MemberSubscription, type ProductGrant,
  type ProductPrice, type StripeSubscriptionSnapshot,
} from '#core/domain/index.js';

import type { SubscriptionAdoptionRepositories } from '../ports.js';
import { m2mAdoptStripeSubscription, m2mListStripeSubscriptions, type StripeSubscriptionAdoptionDeps } from './stripe-subscription-adoption.js';

const now = '1998-07-01T00:00:00.000Z';
const periodEnd = '1998-08-01T00:00:00.000Z';
const input = { subscriptionId: 'sub_existing', memberId: 'member-1', productId: 'product-1' };
const harness = (published = true) => {
  const member = memberSchema.parse({ id: input.memberId, tenantId: 't1', userId: 'user-1',
    email: 'buyer@example.com', displayName: null, tags: [], marketingConsents: {},
    externalCustomerIds: {}, createdAt: now, deletedAt: null });
  const remote: StripeSubscriptionSnapshot = {
    id: input.subscriptionId, status: 'active', currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: true, customerEmail: 'BUYER@example.com',
    price: { id: 'price_existing', amountCents: 3500, currency: 'EUR', interval: 'month', intervalCount: 3 },
  };
  const prices: ProductPrice[] = [];
  const subscriptions: MemberSubscription[] = [];
  const grants: ProductGrant[] = [];
  const events: Omit<MemberEvent, 'tenantId'>[] = [];
  const repositories: SubscriptionAdoptionRepositories = {
    members: { findById: async (tenantId, id) => tenantId === member.tenantId && id === member.id ? member : null,
      findByEmail: async (tenantId, email) => tenantId === member.tenantId && email === member.email ? member : null },
    products: { findById: async (tenantId, id) => tenantId === 't1' && id === input.productId ? {
      id, tenantId, type: 'course', slug: 'course', title: 'Course', description: '', coverUrl: null,
      priceCents: 0, currency: 'EUR', visibility: 'listed', published, accessItems: [], legacyId: null, createdAt: now,
    } : null },
    prices: { listByProduct: async (tenantId, productId) => prices.filter((price) => price.tenantId === tenantId && price.productId === productId),
      findById: async (tenantId, id) => prices.find((price) => price.tenantId === tenantId && price.id === id) ?? null,
      create: async (_tenantId, price) => { prices.push(price); } },
    subscriptions: { findByProviderSubscriptionId: async (tenantId, id) => subscriptions.find((subscription) => subscription.tenantId === tenantId && subscription.providerSubscriptionId === id) ?? null,
      create: async (_tenantId, subscription) => { subscriptions.push(subscription); },
      update: async (_tenantId, subscription) => {
        const index = subscriptions.findIndex((candidate) => candidate.id === subscription.id);
        if (index < 0) return null;
        subscriptions[index] = subscription;
        return subscription;
      } },
    grants: { findGrant: async (tenantId, memberId, productId) => grants.find((grant) => grant.tenantId === tenantId && grant.memberId === memberId && grant.productId === productId) ?? null,
      createGrant: async (_tenantId, grant) => { grants.push(grant); return true; },
      setGrantWindow: async (_tenantId, id, window) => {
        const grant = grants.find((candidate) => candidate.id === id);
        if (!grant) return null;
        grant.expiresAt = window.expiresAt; grant.startsAt = window.startsAt;
        return grant;
      } },
    memberEvents: { append: async (_tenantId, event) => { events.push(event); } },
  };
  let sequence = 0;
  const retrieve = vi.fn(async () => ok(remote));
  const deps: StripeSubscriptionAdoptionDeps = {
    payment: { retrieveStripeSubscription: retrieve }, clock: { nowIso: () => now }, ids: { nextId: () => `id-${++sequence}` },
    subscriptionAdoptionTransaction: { run: async (_tenantId, operation) => operation(repositories) },
  };
  const adoptedIds = {
    listKnownProviderSubscriptionIds: async (tenantId: string, ids: readonly string[]) => subscriptions
      .flatMap((subscription) => subscription.tenantId === tenantId && subscription.providerSubscriptionId !== null
        && ids.includes(subscription.providerSubscriptionId) ? [subscription.providerSubscriptionId] : []),
  };
  return { deps, remote, prices, subscriptions, grants, events, member, repositories, retrieve, adoptedIds };
};

const existingPrice = (): ProductPrice => ({ id: 'local-price', tenantId: 't1', productId: input.productId,
  kind: 'recurring', interval: 'month', intervalCount: 3, amountCents: 3500, currency: 'EUR',
  active: false, imported: true, providerPriceId: 'price_existing', createdAt: now });

const existingGrant = (expiresAt: string | null): ProductGrant => ({ id: 'grant-1', tenantId: 't1',
  memberId: input.memberId, productId: input.productId, source: 'manual', startsAt: now,
  expiresAt, legacyId: null, createdAt: now });

describe('Stripe subscription adoption', () => {
  it('refuses an unpublished product without creating access or commerce records', async () => {
    const h = harness(false);
    expect(await m2mAdoptStripeSubscription('t1', input, h.deps)).toEqual({
      ok: false, error: { code: 'validation', message: 'Product must be published before adopting a subscription' },
    });
    expect(h.prices).toEqual([]);
    expect(h.subscriptions).toEqual([]);
    expect(h.grants).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('refuses reconciliation after a product is unpublished without restoring access', async () => {
    const h = harness();
    expect(await m2mAdoptStripeSubscription('t1', input, h.deps)).toMatchObject({ ok: true });
    h.repositories.products = harness(false).repositories.products;
    h.grants.length = 0;
    h.remote.currentPeriodEnd = '1998-09-01T00:00:00.000Z';
    expect(await m2mAdoptStripeSubscription('t1', input, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.grants).toEqual([]);
    expect(h.subscriptions[0]?.currentPeriodEnd).toBe(periodEnd);
    expect(h.events).toHaveLength(1);
  });

  it('imports a price, preserves Stripe state, grants access and records only ids', async () => {
    const h = harness();
    const result = await m2mAdoptStripeSubscription('t1', input, h.deps);
    expect(result).toMatchObject({ ok: true, value: { subscriptionCreated: true, priceCreated: true, grantCreated: true,
      subscription: { status: 'active', currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true },
      price: { imported: true, active: false, providerPriceId: 'price_existing', intervalCount: 3 } } });
    expect(h.retrieve).toHaveBeenCalledWith('t1', input.subscriptionId);
    expect(h.grants[0]?.expiresAt).toBe(periodEnd);
    expect(h.events[0]).toMatchObject({ type: 'subscription-adopted', memberId: input.memberId });
    expect(Object.keys(h.events[0]?.payload ?? {}).sort()).toEqual(['priceId', 'productId', 'providerSubscriptionId', 'subscriptionId']);
  });

  it('reuses the same subscription without duplicate side effects, including after cancellation', async () => {
    const h = harness();
    await m2mAdoptStripeSubscription('t1', input, h.deps);
    h.remote.status = 'canceled';
    const result = await m2mAdoptStripeSubscription('t1', input, h.deps);
    expect(result).toMatchObject({ ok: true, value: { subscriptionCreated: false, priceCreated: false, grantCreated: false } });
    expect(h.subscriptions).toHaveLength(1); expect(h.prices).toHaveLength(1); expect(h.events).toHaveLength(1);
  });

  it('restores revoked access and the Stripe period when the same subscription is adopted again', async () => {
    const h = harness();
    await m2mAdoptStripeSubscription('t1', input, h.deps);
    const grant = h.grants[0];
    if (grant !== undefined) grant.expiresAt = now;
    h.remote.currentPeriodEnd = '1998-09-01T00:00:00.000Z';
    h.remote.cancelAtPeriodEnd = false;
    const result = await m2mAdoptStripeSubscription('t1', input, h.deps);
    expect(result).toMatchObject({ ok: true, value: { subscriptionCreated: false, grantCreated: false, grantExtended: true,
      subscription: { currentPeriodEnd: '1998-09-01T00:00:00.000Z', cancelAtPeriodEnd: false } } });
    expect(h.grants[0]?.expiresAt).toBe('1998-09-01T00:00:00.000Z');
    expect(h.subscriptions[0]?.currentPeriodEnd).toBe('1998-09-01T00:00:00.000Z');
  });

  it('recreates a deleted grant and a missing price when the same subscription is adopted again', async () => {
    const h = harness();
    await m2mAdoptStripeSubscription('t1', input, h.deps);
    h.grants.length = 0; h.prices.length = 0;
    const result = await m2mAdoptStripeSubscription('t1', input, h.deps);
    expect(result).toMatchObject({ ok: true, value: { subscriptionCreated: false, priceCreated: true, grantCreated: true } });
    expect(h.grants[0]?.expiresAt).toBe(periodEnd);
    expect(h.subscriptions[0]?.priceId).toBe(h.prices[0]?.id);
  });

  it('accepts an explicit price that is not linked to a Stripe price yet', async () => {
    const h = harness();
    h.prices.push({ ...existingPrice(), providerPriceId: null, amountCents: 9900, intervalCount: 1 });
    const result = await m2mAdoptStripeSubscription('t1', { ...input, priceId: 'local-price' }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { priceCreated: false, price: { id: 'local-price' } } });
    expect(h.prices).toHaveLength(1);
  });

  it('adopts a matching provider price whose local record drifted from Stripe', async () => {
    const h = harness();
    h.prices.push({ ...existingPrice(), amountCents: 9900, interval: 'year', intervalCount: 1 });
    expect(await m2mAdoptStripeSubscription('t1', input, h.deps))
      .toMatchObject({ ok: true, value: { priceCreated: false, price: { id: 'local-price' } } });
  });

  it.each([false, true])('maps an existing matching provider price (explicit selection: %s)', async (explicit) => {
    const h = harness(); h.prices.push(existingPrice());
    const result = await m2mAdoptStripeSubscription('t1', { ...input, ...(explicit ? { priceId: 'local-price' } : {}) }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { priceCreated: false, price: { id: 'local-price' } } });
    expect(h.prices).toHaveLength(1);
  });

  it.each(['other@example.com', null])('refuses email mismatch or absent email unless explicitly allowed: %s', async (email) => {
    const h = harness(); h.remote.customerEmail = email;
    expect(await m2mAdoptStripeSubscription('t1', input, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.subscriptions).toHaveLength(0); expect(h.prices).toHaveLength(0);
    expect(await m2mAdoptStripeSubscription('t1', { ...input, allowEmailMismatch: true }, h.deps)).toMatchObject({ ok: true });
  });

  it.each(['trialing', 'canceled', 'unpaid', 'incomplete'])('refuses %s before creating records', async (status) => {
    const h = harness(); h.remote.status = status;
    expect(await m2mAdoptStripeSubscription('t1', input, h.deps)).toMatchObject({ ok: false });
    expect(h.prices).toHaveLength(0); expect(h.events).toHaveLength(0);
  });

  it('adopts past_due and resolves a normalized member email', async () => {
    const h = harness(); h.remote.status = 'past_due';
    expect(await m2mAdoptStripeSubscription('t1', { subscriptionId: input.subscriptionId, productId: input.productId, email: 'BUYER@example.com' }, h.deps))
      .toMatchObject({ ok: true, value: { subscription: { memberId: input.memberId, status: 'past_due' } } });
  });

  it.each(['1998-07-15T00:00:00.000Z', '1999-01-01T00:00:00.000Z', null])('extends shorter access and preserves longer or lifetime access: %s', async (expiry) => {
    const h = harness(); h.grants.push(existingGrant(expiry));
    const extendsGrant = expiry !== null && expiry < periodEnd;
    expect(await m2mAdoptStripeSubscription('t1', input, h.deps)).toMatchObject({ ok: true, value: { grantCreated: false, grantExtended: extendsGrant } });
    expect(h.grants[0]?.expiresAt).toBe(extendsGrant ? periodEnd : expiry);
  });

  it('refuses another member ownership, wrong product or mismatched explicit price', async () => {
    const h = harness(); await m2mAdoptStripeSubscription('t1', input, h.deps);
    h.member.id = 'another-member';
    expect(await m2mAdoptStripeSubscription('t1', { ...input, memberId: h.member.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const other = harness(); other.prices.push({ ...existingPrice(), providerPriceId: 'price_other' });
    expect(await m2mAdoptStripeSubscription('t1', { ...input, priceId: 'local-price' }, other.deps)).toMatchObject({ ok: false });
    expect(await m2mAdoptStripeSubscription('t1', { ...input, productId: 'missing' }, other.deps)).toMatchObject({ ok: false });
    expect(other.subscriptions).toHaveLength(0);
  });

  it('reports an unknown e-mail without repeating it', async () => {
    const h = harness();
    expect(await m2mAdoptStripeSubscription('t1', { subscriptionId: input.subscriptionId, productId: input.productId, email: 'ghost@example.com' }, h.deps))
      .toEqual({ ok: false, error: { code: 'not_found', message: 'No member with that e-mail address in this tenant' } });
  });

  it('does not resolve another tenant member or product', async () => {
    const h = harness();
    expect(await m2mAdoptStripeSubscription('t2', input, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.prices).toHaveLength(0);
  });

  it('marks adopted Stripe subscriptions and keeps the cursor on a filtered empty page', async () => {
    const h = harness(); await m2mAdoptStripeSubscription('t1', input, h.deps);
    const list = vi.fn(async () => ok({ subscriptions: [{ id: input.subscriptionId, status: 'active', providerPriceId: 'price_existing' }], nextCursor: input.subscriptionId }));
    const result = await m2mListStripeSubscriptions('t1', { status: 'active', unadopted: true }, { payment: { listStripeSubscriptions: list }, subscriptions: h.adoptedIds });
    expect(result).toEqual(ok({ subscriptions: [], nextCursor: input.subscriptionId }));
    expect(list).toHaveBeenCalledWith('t1', { status: 'active', unadopted: true });
  });
});
