import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createOrderRepository } from './repositories.js';
import { members, orders, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-11-15T10:00:00.000Z';
const since = '2026-11-01T00:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const insertOrder = (id: string, amountCents: number, cancelReason: 'out_of_stock' | null) => database.db.insert(orders).values({
  id, tenantId: 'workspace', memberId: 'member', productId: 'poster', kind: 'one_time', status: 'paid', amountCents,
  currency: 'PLN', provider: 'stripe', cancelReason, createdAt: now,
});

beforeAll(async () => {
  database = await createTestDatabase('together_order_cancel_reason', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now });
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', createdAt: now });
  await database.db.insert(products).values({
    id: 'poster', tenantId: 'workspace', type: 'physical', description: '', slug: 'poster', title: 'Poster', priceCents: 4900, currency: 'PLN', published: true, createdAt: now,
  });
}, 60_000);
afterAll(async () => { await database?.close(); });

it('leaves an order cancelled out of stock out of the 30-day revenue from the moment it is cancelled', async () => {
  const repository = createOrderRepository(database.db);
  await insertOrder('kept', 4900, null);
  await insertOrder('cancelled', 4099, 'out_of_stock');
  await insertOrder('cancelled-later', 2100, null);
  expect(await repository.revenueSince('workspace', since)).toEqual([{ currency: 'PLN', amountCents: 7000 }]);

  await database.db.update(orders).set({ cancelReason: 'out_of_stock' }).where(eq(orders.id, 'cancelled-later'));

  expect(await repository.revenueSince('workspace', since)).toEqual([{ currency: 'PLN', amountCents: 4900 }]);
});
