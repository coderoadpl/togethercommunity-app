import { afterAll, beforeAll, expect, it } from 'vitest';
import { couponCheckoutSessionSchema } from '#core/domain/index.js';
import { createCouponCheckoutSessionRepository } from './coupon-repositories.js';
import { createTestDatabase } from './test-database-name.js';
import { coupons, products, tenants } from './schema.js';

const now = '2026-10-08T12:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase('together_direct_coupon', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now });
  await database.db.insert(products).values({ id: 'product', tenantId: 'workspace', type: 'physical', description: '', slug: 'item', title: 'Printed item', priceCents: 1000, currency: 'PLN', published: true, accessItems: [], vatRate: 5, createdAt: now });
  await database.db.insert(coupons).values({ id: 'coupon', tenantId: 'workspace', code: 'SAVE', kind: 'percent', value: 50, scope: { kind: 'all' }, appliesTo: 'one_time', createdAt: now });
});
afterAll(async () => { await database?.close(); });

it('stores an anonymous direct coupon snapshot until Stripe collects the buyer email', async () => {
  const repository = createCouponCheckoutSessionRepository(database.db);
  const session = couponCheckoutSessionSchema.parse({
    id: 'session', tenantId: 'workspace', couponId: 'coupon', providerSessionId: null,
    memberEmail: null, productId: 'product', priceId: null, originalCents: 1000,
    discountCents: 500, finalCents: 500, currency: 'PLN', startedAt: now,
  });
  await repository.create('workspace', session);
  expect(await repository.findById('workspace', session.id)).toEqual(session);
  await repository.attachProviderSession('workspace', session.id, 'cs-direct');
  expect(await repository.findById('workspace', session.id)).toEqual({ ...session, providerSessionId: 'cs-direct' });
  expect(await repository.findById('other', session.id)).toBeNull();
});
