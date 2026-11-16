import { afterAll, beforeAll, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { DELETED_MEMBER_DISPLAY, err, memberTombstone, ok, validation, type StripeSubscriptionSnapshot } from '#core/domain/index.js';
import { m2mAdoptStripeSubscription, m2mListStripeSubscriptions, type StripeSubscriptionAdoptionDeps } from '#core/server/index.js';

import { createProviderCustomerOwnerRepository } from './provider-customer-owners.js';
import { createStripeWebhookOwnershipReader } from './stripe-webhook-ownership.js';
import { createMemberErasureRepository, createMemberSubscriptionRepository } from './repositories.js';
import { createTestDatabase } from './test-database-name.js';
import { createSubscriptionAdoptionTransaction } from './subscription-adoption.js';
import {
  members, tenants, user, products, productPrices, memberSubscriptions, productGrants, memberEvents, providerCustomerOwners,
} from './schema.js';

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

const ownersOf = async (customerId: string) => (await database.db.select().from(providerCustomerOwners)
  .where(eq(providerCustomerOwners.customerId, customerId))).map((owner) => owner.tenantId);

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
  expect(await database.db.select().from(providerCustomerOwners)).toHaveLength(0);
});

it('serializes concurrent adoption and persists a single audit and imported price', async () => {
  const results = await Promise.all([m2mAdoptStripeSubscription('t1', input, deps), m2mAdoptStripeSubscription('t1', input, deps)]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(results.filter((result) => result.ok && result.value.subscriptionCreated)).toHaveLength(1);
  expect(await database.db.select().from(memberSubscriptions)).toHaveLength(1);
  expect(await database.db.select().from(productPrices)).toMatchObject([{ imported: true, active: false, providerPriceId: 'price_existing' }]);
  expect((await database.db.select().from(memberEvents)).filter((event) => event.type === 'subscription-adopted')).toHaveLength(1);
  expect(await ownersOf('cus_existing')).toEqual(['t1']);
  expect(await stripeCustomerOf('member-1')).toEqual({});
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

it('keeps one customer owner when the same subscription is reconciled again', async () => {
  const result = await m2mAdoptStripeSubscription('t1', input, deps);
  expect(result).toMatchObject({ ok: true, value: { subscriptionCreated: false } });
  expect(await ownersOf('cus_existing')).toEqual(['t1']);
  expect(await stripeCustomerOf('member-1')).toEqual({});
});

const snapshot = (id: string, customerId: string, customerEmail: string): StripeSubscriptionSnapshot => ({
  id, status: 'active', currentPeriodEnd: '1998-08-01T00:00:00.000Z', cancelAtPeriodEnd: false,
  customerId, customerEmail, metadataTenantId: null,
  price: { id: `price_${id}`, amountCents: 2500, currency: 'EUR', interval: 'month', intervalCount: 1 },
});

const addMembers = async (name: string, stripeCustomers: { t1?: string; t2?: string }) => {
  const email = `${name}@example.com`;
  await database.db.insert(user).values({ id: `user-${name}`, email, name });
  await database.db.insert(members).values((['t1', 't2'] as const).map((tenantId) => {
    const stripe = stripeCustomers[tenantId];
    return { id: `${name}-${tenantId}`, tenantId, userId: `user-${name}`, email, createdAt: now,
      externalCustomerIds: stripe === undefined ? {} : { stripe } };
  }));
  return email;
};

const productOf = { t1: 'product-1', t2: 'product-2' } as const;

const adopt = (tenantId: 't1' | 't2', memberId: string, remote: StripeSubscriptionSnapshot, overrides: Partial<StripeSubscriptionAdoptionDeps> = {}) =>
  m2mAdoptStripeSubscription(tenantId, { subscriptionId: remote.id, memberId, productId: productOf[tenantId] },
    { ...deps, payment: { retrieveStripeSubscription: async () => ok(remote) }, ...overrides });

const conflict = { ok: false, error: { code: 'conflict', details: { adoptionRefusal: 'conflict' } } };

it('adopts a subscription of a second customer for a member already linked to another Stripe customer', async () => {
  const email = await addMembers('holder', { t1: 'cus_holder_first' });
  const result = await adopt('t1', 'holder-t1', snapshot('sub_holderSecond', 'cus_holder_second', email));
  expect(result).toMatchObject({ ok: true, value: { subscriptionCreated: true } });
  expect(await ownersOf('cus_holder_second')).toEqual(['t1']);
  expect(await stripeCustomerOf('holder-t1')).toEqual({ stripe: 'cus_holder_first' });
});

it('records the owner of a customer adopted before ownership rows existed when its subscription is reconciled', async () => {
  const email = await addMembers('legacy', { t1: 'cus_legacy_other' });
  await database.db.insert(productPrices).values({ id: 'price-legacy', tenantId: 't1', productId: 'product-1', kind: 'recurring',
    interval: 'month', amountCents: 2500, currency: 'EUR', providerPriceId: 'price_sub_legacy', createdAt: now });
  await database.db.insert(memberSubscriptions).values({ id: 'subscription-legacy', tenantId: 't1', memberId: 'legacy-t1',
    productId: 'product-1', priceId: 'price-legacy', provider: 'stripe', providerSubscriptionId: 'sub_legacy', status: 'active',
    currentPeriodEnd: '1998-08-01T00:00:00.000Z', createdAt: now, updatedAt: now });
  expect(await ownersOf('cus_legacy')).toEqual([]);

  const reconciled = await adopt('t1', 'legacy-t1', snapshot('sub_legacy', 'cus_legacy', email));
  expect(reconciled).toMatchObject({ ok: true, value: { subscriptionCreated: false } });
  expect(await ownersOf('cus_legacy')).toEqual(['t1']);
  expect(await stripeCustomerOf('legacy-t1')).toEqual({ stripe: 'cus_legacy_other' });

  const before = await counts();
  expect(await adopt('t2', 'legacy-t2', snapshot('sub_legacySecond', 'cus_legacy', email))).toMatchObject(conflict);
  expect(await counts()).toEqual(before);
  expect(await ownersOf('cus_legacy')).toEqual(['t1']);
});

it('never writes a Stripe customer back onto a member erased while the adoption runs', async () => {
  const email = await addMembers('erased', {});
  const erasure = createMemberErasureRepository(database.db, { compute: (tenantId, value) => `${tenantId}:${value}` });
  const transaction = createSubscriptionAdoptionTransaction(database.db);
  const result = await adopt('t1', 'erased-t1', snapshot('sub_erased', 'cus_erased', email), {
    subscriptionAdoptionTransaction: { run: (tenantId, stripe, operation) => transaction.run(tenantId, stripe, (repositories) =>
      operation({ ...repositories, members: { ...repositories.members, findById: async (memberTenantId, memberId) => {
        const found = await repositories.members.findById(memberTenantId, memberId);
        const tombstone = memberTombstone(memberId);
        await erasure.pseudonymize(memberTenantId, { memberId, deletedAt: now, tombstoneEmail: tombstone.email,
          severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY });
        return found;
      } } })) },
  });
  expect(result).toMatchObject({ ok: true, value: { subscriptionCreated: true } });
  const [erased] = await database.db.select().from(members).where(eq(members.id, 'erased-t1'));
  expect(erased?.deletedAt).not.toBeNull();
  expect(erased?.externalCustomerIds).toEqual({});
  expect(await ownersOf('cus_erased')).toEqual(['t1']);
});

it('lets exactly one of two workspaces adopt different subscriptions of one customer at the same time', async () => {
  const email = await addMembers('shared', { t1: 'cus_shared_t1_earlier', t2: 'cus_shared_t2_earlier' });
  const first = snapshot('sub_sharedFirst', 'cus_shared', email);
  const second = snapshot('sub_sharedSecond', 'cus_shared', email);
  const reader = createStripeWebhookOwnershipReader(database.db);
  let checked = 0;
  let releaseChecks = () => {};
  const bothChecked = new Promise<void>((resolve) => { releaseChecks = resolve; });
  const stripeWebhookOwnership = { hasForeignOwner: async (tenantId: string, ids: { customer?: string; subscription?: string }) => {
    const foreign = await reader.hasForeignOwner(tenantId, ids);
    if (++checked === 2) releaseChecks();
    await bothChecked;
    return foreign;
  } };
  const results = await Promise.all([
    adopt('t1', 'shared-t1', first, { stripeWebhookOwnership }),
    adopt('t2', 'shared-t2', second, { stripeWebhookOwnership }),
  ]);
  expect(results.filter((result) => result.ok && result.value.subscriptionCreated)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toMatchObject([conflict]);
  const owners = await ownersOf('cus_shared');
  expect(owners).toHaveLength(1);
  expect((await database.db.select().from(memberSubscriptions))
    .filter((subscription) => subscription.providerSubscriptionId === first.id || subscription.providerSubscriptionId === second.id)
    .map((subscription) => subscription.tenantId)).toEqual(owners);
});

const ownerRowOf = async (customerId: string) => (await database.db.select().from(providerCustomerOwners)
  .where(eq(providerCustomerOwners.customerId, customerId))).map((owner) => ({ tenantId: owner.tenantId, memberId: owner.memberId }));

it('records the adopting member on a new owner row and fills a row without a member only for this workspace', async () => {
  await database.db.insert(providerCustomerOwners).values({ provider: 'stripe', customerId: 'cus_unclaimed', tenantId: 't1', createdAt: now });
  const owners = createProviderCustomerOwnerRepository(database.db);

  await expect(owners.claimStripeCustomer('t2', { customerId: 'cus_unclaimed', memberId: 'member-2', claimedAt: now }))
    .resolves.toBe('another-workspace');
  expect(await ownerRowOf('cus_unclaimed')).toEqual([{ tenantId: 't1', memberId: null }]);
  await expect(owners.claimStripeCustomer('t1', { customerId: 'cus_unclaimed', memberId: 'member-1', claimedAt: now }))
    .resolves.toBe('this-workspace');
  expect(await ownerRowOf('cus_unclaimed')).toEqual([{ tenantId: 't1', memberId: 'member-1' }]);
  await expect(owners.claimStripeCustomer('t1', { customerId: 'cus_unclaimed', memberId: 'member-3', claimedAt: now }))
    .resolves.toBe('this-workspace');
  expect(await ownerRowOf('cus_unclaimed')).toEqual([{ tenantId: 't1', memberId: 'member-1' }]);
});

it('removes the owner rows of an erased member so a later adoption of its customer follows the normal rules', async () => {
  const email = 'forgotten@example.com';
  await database.db.insert(user).values({ id: 'user-forgotten', email, name: 'Forgotten' });
  await database.db.insert(members).values([
    { id: 'forgotten', tenantId: 't1', userId: 'user-forgotten', email, createdAt: now,
      externalCustomerIds: { stripe: 'cus_forgotten_linked' } },
    { id: 'forgotten', tenantId: 't2', userId: 'user-forgotten', email, createdAt: now },
  ]);
  await database.db.insert(providerCustomerOwners).values([
    { provider: 'stripe', customerId: 'cus_forgotten_linked', tenantId: 't1', createdAt: now },
    { provider: 'stripe', customerId: 'cus_forgotten_elsewhere', tenantId: 't2', memberId: 'forgotten', createdAt: now },
  ]);
  expect(await adopt('t1', 'forgotten', snapshot('sub_forgotten', 'cus_forgotten', email)))
    .toMatchObject({ ok: true, value: { subscriptionCreated: true } });
  expect(await ownerRowOf('cus_forgotten')).toEqual([{ tenantId: 't1', memberId: 'forgotten' }]);
  expect(await adopt('t2', 'forgotten', snapshot('sub_forgottenBlocked', 'cus_forgotten', email))).toMatchObject(conflict);

  const tombstone = memberTombstone('forgotten');
  await createMemberErasureRepository(database.db, { compute: (tenantId, value) => `${tenantId}:${value}` })
    .pseudonymize('t1', { memberId: 'forgotten', deletedAt: now, tombstoneEmail: tombstone.email,
      severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY });

  expect(await ownerRowOf('cus_forgotten')).toEqual([]);
  expect(await ownerRowOf('cus_forgotten_linked')).toEqual([]);
  expect(await ownerRowOf('cus_existing')).toEqual([{ tenantId: 't1', memberId: 'member-1' }]);
  expect(await ownerRowOf('cus_forgotten_elsewhere')).toEqual([{ tenantId: 't2', memberId: 'forgotten' }]);

  expect(await adopt('t2', 'forgotten', snapshot('sub_forgottenLater', 'cus_forgotten', email)))
    .toMatchObject({ ok: true, value: { subscriptionCreated: true } });
  expect(await ownerRowOf('cus_forgotten')).toEqual([{ tenantId: 't2', memberId: 'forgotten' }]);
});
