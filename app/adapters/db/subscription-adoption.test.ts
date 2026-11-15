import { afterAll, beforeAll, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { err, ok, validation, type StripeSubscriptionSnapshot } from '#core/domain/index.js';
import { m2mAdoptStripeSubscription, m2mListStripeSubscriptions, type StripeSubscriptionAdoptionDeps } from '#core/server/index.js';

import { createStripeWebhookOwnershipReader } from './stripe-webhook-ownership.js';
import { createMemberSubscriptionRepository } from './repositories.js';
import { createTestDatabase } from './test-database-name.js';
import { createSubscriptionAdoptionTransaction } from './subscription-adoption.js';
import { members, tenants, user, products, productPrices, memberSubscriptions, productGrants, memberEvents } from './schema.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: StripeSubscriptionAdoptionDeps;
const now = '1998-07-01T00:00:00.000Z';
const input = { subscriptionId: 'sub_existing', memberId: 'member-1', productId: 'product-1' };

beforeAll(async () => {
  database = await createTestDatabase('together_subscription_adoption', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values([
    { id: 't1', slug: 'acme', name: 'Acme', createdAt: now },
    { id: 't2', slug: 'studio', name: 'Studio', createdAt: now },
  ]);
  await database.db.insert(user).values([
    { id: 'user-1', email: 'buyer@example.com', name: 'Buyer' },
    { id: 'user-2', email: 'contested@example.com', name: 'Contested' },
  ]);
  await database.db.insert(members).values([
    { id: 'member-1', tenantId: 't1', userId: 'user-1', email: 'buyer@example.com', createdAt: now },
    { id: 'member-2', tenantId: 't2', userId: 'user-1', email: 'buyer@example.com', createdAt: now },
    { id: 'member-3', tenantId: 't1', userId: 'user-2', email: 'contested@example.com', createdAt: now },
    { id: 'member-4', tenantId: 't2', userId: 'user-2', email: 'contested@example.com', createdAt: now },
  ]);
  await database.db.insert(products).values([
    { id: 'product-1', tenantId: 't1', slug: 'course', title: 'Course', type: 'course', published: true, description: '', priceCents: 0, currency: 'EUR', createdAt: now },
    { id: 'product-2', tenantId: 't2', slug: 'course', title: 'Course', type: 'course', published: true, description: '', priceCents: 0, currency: 'EUR', createdAt: now },
  ]);
  let sequence = 0;
  deps = {
    subscriptionAdoptionTransaction: createSubscriptionAdoptionTransaction(database.db),
    clock: { nowIso: () => now }, ids: { nextId: () => `adoption-${++sequence}` },
    stripeWebhookOwnership: createStripeWebhookOwnershipReader(database.db),
    payment: { retrieveStripeSubscription: async () => ok({ id: input.subscriptionId, status: 'active',
      currentPeriodEnd: '1998-08-01T00:00:00.000Z', cancelAtPeriodEnd: false,
      customerId: 'cus_existing', customerEmail: 'buyer@example.com', metadataTenantId: null,
      price: { id: 'price_existing', amountCents: 3500, currency: 'EUR', interval: 'month', intervalCount: 1 } }) },
  };
});
afterAll(async () => { await database?.close(); });

const stripeCustomerOf = async (memberId: string) =>
  (await database.db.select().from(members).where(eq(members.id, memberId)))[0]?.externalCustomerIds;

it('rolls back every local write when an adoption fails', async () => {
  const transaction = deps.subscriptionAdoptionTransaction;
  const result = await m2mAdoptStripeSubscription('t1', input, { ...deps, subscriptionAdoptionTransaction: {
    run: (tenantId, stripe, operation) => transaction.run(tenantId, stripe, async (repositories) => {
      const result = await operation(repositories);
      expect(result.ok).toBe(true);
      return err(validation('Reject transaction after audit write'));
    }),
  } });
  expect(result.ok).toBe(false);
  expect(await database.db.select().from(productPrices)).toHaveLength(0);
  expect(await database.db.select().from(memberSubscriptions)).toHaveLength(0);
  expect(await database.db.select().from(productGrants)).toHaveLength(0);
  expect(await database.db.select().from(memberEvents)).toHaveLength(0);
  expect(await stripeCustomerOf('member-1')).toEqual({});
});

it('serializes concurrent adoption and persists a single audit and imported price', async () => {
  const results = await Promise.all([m2mAdoptStripeSubscription('t1', input, deps), m2mAdoptStripeSubscription('t1', input, deps)]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(results.filter((result) => result.ok && result.value.subscriptionCreated)).toHaveLength(1);
  expect(await database.db.select().from(memberSubscriptions)).toHaveLength(1);
  expect(await database.db.select().from(productPrices)).toMatchObject([{ imported: true, active: false, providerPriceId: 'price_existing' }]);
  expect((await database.db.select().from(memberEvents)).filter((event) => event.type === 'subscription-adopted')).toHaveLength(1);
  expect(await stripeCustomerOf('member-1')).toEqual({ stripe: 'cus_existing' });
});

it('refuses another tenant adopting a subscription already stored for this account', async () => {
  const result = await m2mAdoptStripeSubscription('t2', { ...input, memberId: 'member-2', productId: 'product-2' }, deps);
  expect(result).toMatchObject({ ok: false, error: { code: 'conflict', details: { adoptionRefusal: 'conflict' } } });
  expect(await database.db.select().from(memberSubscriptions)).toMatchObject([{ tenantId: 't1' }]);
  expect((await database.db.select().from(productPrices)).map((price) => price.tenantId)).toEqual(['t1']);
  expect((await database.db.select().from(productGrants)).map((grant) => grant.tenantId)).toEqual(['t1']);
});

it('lets exactly one of two workspaces adopt the same subscription when both pass the early ownership check', async () => {
  const contested: StripeSubscriptionSnapshot = { id: 'sub_contested', status: 'active', currentPeriodEnd: '1998-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false, customerId: 'cus_contested', customerEmail: 'contested@example.com', metadataTenantId: null,
    price: { id: 'price_contested', amountCents: 4500, currency: 'EUR', interval: 'month', intervalCount: 1 } };
  const reader = createStripeWebhookOwnershipReader(database.db);
  let checked = 0;
  let releaseChecks = () => {};
  const bothChecked = new Promise<void>((resolve) => { releaseChecks = resolve; });
  const contestedDeps: StripeSubscriptionAdoptionDeps = { ...deps,
    payment: { retrieveStripeSubscription: async () => ok(contested) },
    stripeWebhookOwnership: { hasForeignOwner: async (tenantId, ids) => {
      const foreign = await reader.hasForeignOwner(tenantId, ids);
      if (++checked === 2) releaseChecks();
      await bothChecked;
      return foreign;
    } } };
  const results = await Promise.all([
    m2mAdoptStripeSubscription('t1', { subscriptionId: contested.id, memberId: 'member-3', productId: 'product-1' }, contestedDeps),
    m2mAdoptStripeSubscription('t2', { subscriptionId: contested.id, memberId: 'member-4', productId: 'product-2' }, contestedDeps),
  ]);
  expect(results.filter((result) => result.ok && result.value.subscriptionCreated)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toMatchObject([{ error: { code: 'conflict', details: { adoptionRefusal: 'conflict' } } }]);
  const stored = (await database.db.select().from(memberSubscriptions))
    .filter((subscription) => subscription.providerSubscriptionId === contested.id);
  expect(stored).toHaveLength(1);
  const winner = stored[0]?.tenantId;
  expect((await database.db.select().from(productPrices)).filter((price) => price.providerPriceId === contested.price.id)
    .map((price) => price.tenantId)).toEqual([winner]);
  expect((await database.db.select().from(memberEvents))
    .filter((event) => event.payload['providerSubscriptionId'] === contested.id)
    .map((event) => event.tenantId)).toEqual([winner]);
});

const counts = async () => ({
  subscriptions: (await database.db.select().from(memberSubscriptions)).length,
  prices: (await database.db.select().from(productPrices)).length,
  grants: (await database.db.select().from(productGrants)).length,
  events: (await database.db.select().from(memberEvents)).length,
});

it('refuses another workspace adopting a different subscription of a customer this workspace adopted', async () => {
  const second: StripeSubscriptionSnapshot = { id: 'sub_second', status: 'active', currentPeriodEnd: '1998-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false, customerId: 'cus_existing', customerEmail: 'buyer@example.com', metadataTenantId: null,
    price: { id: 'price_second', amountCents: 2500, currency: 'EUR', interval: 'month', intervalCount: 1 } };
  const before = await counts();
  const result = await m2mAdoptStripeSubscription('t2', { subscriptionId: second.id, memberId: 'member-2', productId: 'product-2' },
    { ...deps, payment: { retrieveStripeSubscription: async () => ok(second) } });
  expect(result).toMatchObject({ ok: false, error: { code: 'conflict', details: { adoptionRefusal: 'conflict' } } });
  expect(await counts()).toEqual(before);
  expect(await stripeCustomerOf('member-2')).toEqual({});
  const listed = await m2mListStripeSubscriptions('t2', {}, {
    payment: { listStripeSubscriptions: async () => ok({ subscriptions: [{ id: second.id, status: second.status,
      providerPriceId: second.price.id, customerId: second.customerId, metadataTenantId: null }], nextCursor: null }) },
    subscriptions: createMemberSubscriptionRepository(database.db),
    stripeWebhookOwnership: createStripeWebhookOwnershipReader(database.db),
  });
  expect(listed).toEqual(ok({ subscriptions: [], nextCursor: null }));
});

it('refuses a member already linked to a different Stripe customer and writes nothing', async () => {
  const elsewhere: StripeSubscriptionSnapshot = { id: 'sub_elsewhere', status: 'active', currentPeriodEnd: '1998-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false, customerId: 'cus_elsewhere', customerEmail: 'buyer@example.com', metadataTenantId: null,
    price: { id: 'price_elsewhere', amountCents: 2500, currency: 'EUR', interval: 'month', intervalCount: 1 } };
  const before = await counts();
  const result = await m2mAdoptStripeSubscription('t1', { subscriptionId: elsewhere.id, memberId: 'member-1', productId: 'product-1' },
    { ...deps, payment: { retrieveStripeSubscription: async () => ok(elsewhere) } });
  expect(result).toMatchObject({ ok: false, error: { code: 'conflict', details: { adoptionRefusal: 'conflict' } } });
  expect(await counts()).toEqual(before);
  expect(await stripeCustomerOf('member-1')).toEqual({ stripe: 'cus_existing' });
});

it('keeps the recorded customer when the same subscription is reconciled again', async () => {
  const result = await m2mAdoptStripeSubscription('t1', input, deps);
  expect(result).toMatchObject({ ok: true, value: { subscriptionCreated: false } });
  expect(await stripeCustomerOf('member-1')).toEqual({ stripe: 'cus_existing' });
});
