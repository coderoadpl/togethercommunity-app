import { afterAll, beforeAll, expect, it } from 'vitest';

import { err, ok, validation } from '#core/domain/index.js';
import { m2mAdoptStripeSubscription, type StripeSubscriptionAdoptionDeps } from '#core/server/index.js';

import { createTestDatabase } from './test-database-name.js';
import { createSubscriptionAdoptionTransaction } from './subscription-adoption.js';
import { members, tenants, user, products, productPrices, memberSubscriptions, productGrants, memberEvents } from './schema.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: StripeSubscriptionAdoptionDeps;
const now = '1998-07-01T00:00:00.000Z';
const input = { subscriptionId: 'sub_existing', memberId: 'member-1', productId: 'product-1' };

beforeAll(async () => {
  database = await createTestDatabase('together_subscription_adoption', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: 't1', slug: 'acme', name: 'Acme', createdAt: now });
  await database.db.insert(user).values({ id: 'user-1', email: 'buyer@example.com', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'member-1', tenantId: 't1', userId: 'user-1', email: 'buyer@example.com', createdAt: now });
  await database.db.insert(products).values({ id: 'product-1', tenantId: 't1', slug: 'course', title: 'Course', type: 'course', description: '', priceCents: 0, currency: 'EUR', createdAt: now });
  let sequence = 0;
  deps = {
    subscriptionAdoptionTransaction: createSubscriptionAdoptionTransaction(database.db),
    clock: { nowIso: () => now }, ids: { nextId: () => `adoption-${++sequence}` },
    payment: { retrieveStripeSubscription: async () => ok({ id: input.subscriptionId, status: 'active',
      currentPeriodEnd: '1998-08-01T00:00:00.000Z', cancelAtPeriodEnd: false, customerEmail: 'buyer@example.com',
      price: { id: 'price_existing', amountCents: 3500, currency: 'EUR', interval: 'month', intervalCount: 1 } }) },
  };
});
afterAll(async () => { await database?.close(); });

it('rolls back every local write when an adoption fails', async () => {
  const transaction = deps.subscriptionAdoptionTransaction;
  const result = await m2mAdoptStripeSubscription('t1', input, { ...deps, subscriptionAdoptionTransaction: {
    run: (tenantId, operation) => transaction.run(tenantId, async (repositories) => {
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
});

it('serializes concurrent adoption and persists a single audit and imported price', async () => {
  const results = await Promise.all([m2mAdoptStripeSubscription('t1', input, deps), m2mAdoptStripeSubscription('t1', input, deps)]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(results.filter((result) => result.ok && result.value.subscriptionCreated)).toHaveLength(1);
  expect(await database.db.select().from(memberSubscriptions)).toHaveLength(1);
  expect(await database.db.select().from(productPrices)).toMatchObject([{ imported: true, active: false, providerPriceId: 'price_existing' }]);
  expect((await database.db.select().from(memberEvents)).filter((event) => event.type === 'subscription-adopted')).toHaveLength(1);
});
