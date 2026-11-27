import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderSchema } from '#core/domain/index.js';
import { createOrderRepository } from './repositories.js';
import { invoices, members, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const company = { nip: '5555555555', companyName: 'Example Company', address: 'Main Street 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' };
const privatePerson = { nip: null, companyName: 'Jane Example', address: 'Side Street 2', postalCode: '00-002', city: 'Warsaw', country: 'PL' };
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const ids = (page: { orders: Array<{ id: string }> }): string[] => page.orders.map((order) => order.id);

beforeAll(async () => {
  database = await createTestDatabase('together_order_list_filters', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  const now = '2026-11-01T12:00:00.000Z';
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: now })));
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.com', name: 'Buyer' });
  await database.db.insert(members).values(['workspace', 'other'].map((tenantId) => ({ id: `${tenantId}-member`, tenantId, userId: 'buyer', email: 'buyer@example.com', createdAt: now })));
  await database.db.insert(products).values(['workspace', 'other'].map((tenantId) => ({ id: `${tenantId}-product`, tenantId, slug: `${tenantId}-download`, type: 'digital_download' as const, title: 'Download', description: '', priceCents: 100, currency: 'PLN', published: true, createdAt: now })));
  const repository = createOrderRepository(database.db);
  for (const [id, tenantId, billing, amountCents, createdAt] of [
    ['company-invoiced', 'workspace', company, 300, '2026-11-01T10:00:00.000Z'],
    ['company-pending', 'workspace', company, 100, '2026-11-02T10:00:00.000Z'],
    ['private-pending', 'workspace', privatePerson, 300, '2026-11-03T10:00:00.000Z'],
    ['no-billing', 'workspace', null, 200, '2026-11-04T10:00:00.000Z'],
    ['other-company', 'other', company, 500, '2026-11-05T10:00:00.000Z'],
  ] as const) {
    await repository.create(tenantId, orderSchema.parse({ id, tenantId, memberId: `${tenantId}-member`, productId: `${tenantId}-product`, priceId: null, kind: 'one_time', status: 'paid', amountCents, currency: 'PLN', provider: 'simulated', providerObjectIds: { checkoutSession: `cs-${id}` }, couponId: null, discountCents: 0, billing, createdAt }));
  }
  await database.db.insert(invoices).values([
    { id: 'invoice-workspace', tenantId: 'workspace', orderId: 'company-invoiced', status: 'issued', provider: 'simulated', createdAt: '2026-11-01T11:00:00.000Z' },
    { id: 'invoice-mismatched-tenant', tenantId: 'other', orderId: 'company-pending', status: 'issued', provider: 'simulated', createdAt: '2026-11-02T11:00:00.000Z' },
    { id: 'invoice-other', tenantId: 'other', orderId: 'other-company', status: 'issued', provider: 'simulated', createdAt: '2026-11-05T11:00:00.000Z' },
  ]);
});
afterAll(async () => { await database?.close(); });

describe('order list invoice and billing filters', () => {
  it.each([
    [{ invoice: 'with' as const }, ['company-invoiced']],
    [{ invoice: 'without' as const }, ['no-billing', 'private-pending', 'company-pending']],
    [{ billing: 'requested' as const }, ['private-pending', 'company-pending', 'company-invoiced']],
    [{ billing: 'company' as const }, ['company-pending', 'company-invoiced']],
    [{ billing: 'private' as const }, ['private-pending']],
    [{ billing: 'none' as const }, ['no-billing']],
    [{ invoice: 'without' as const, billing: 'company' as const }, ['company-pending']],
  ])('filters and counts %o inside the workspace', async (filter, expected) => {
    const page = await createOrderRepository(database.db).list('workspace', { ...filter, page: 1, pageSize: 20 });
    expect(ids(page)).toEqual(expected);
    expect(page.total).toBe(expected.length);
  });

  it('never counts another workspace\'s invoice or billing', async () => {
    const repository = createOrderRepository(database.db);
    expect(await repository.list('other', { invoice: 'without', page: 1, pageSize: 20 })).toMatchObject({ total: 0, orders: [] });
    expect(ids(await repository.list('other', { billing: 'company', page: 1, pageSize: 20 }))).toEqual(['other-company']);
  });
});

describe('order list sort', () => {
  it('keeps newest first when no sort is given', async () => {
    expect(ids(await createOrderRepository(database.db).list('workspace', { page: 1, pageSize: 20 })))
      .toEqual(['no-billing', 'private-pending', 'company-pending', 'company-invoiced']);
  });

  it('sorts by creation date ascending', async () => {
    expect(ids(await createOrderRepository(database.db).list('workspace', { sortBy: 'createdAt', sortDirection: 'asc', page: 1, pageSize: 20 })))
      .toEqual(['company-invoiced', 'company-pending', 'private-pending', 'no-billing']);
  });

  it('sorts by amount with the creation date as the tie-breaker', async () => {
    const repository = createOrderRepository(database.db);
    expect(ids(await repository.list('workspace', { sortBy: 'amountCents', sortDirection: 'desc', page: 1, pageSize: 20 })))
      .toEqual(['private-pending', 'company-invoiced', 'no-billing', 'company-pending']);
    expect(ids(await repository.list('workspace', { sortBy: 'amountCents', sortDirection: 'asc', page: 1, pageSize: 20 })))
      .toEqual(['company-pending', 'no-billing', 'company-invoiced', 'private-pending']);
  });

  it('pages a sorted result without repeating rows', async () => {
    const repository = createOrderRepository(database.db);
    const first = await repository.list('workspace', { sortBy: 'amountCents', sortDirection: 'asc', page: 1, pageSize: 2 });
    const second = await repository.list('workspace', { sortBy: 'amountCents', sortDirection: 'asc', page: 2, pageSize: 2 });
    expect([...ids(first), ...ids(second)]).toEqual(['company-pending', 'no-billing', 'company-invoiced', 'private-pending']);
  });
});
