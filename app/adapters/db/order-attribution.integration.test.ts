import { afterAll, beforeAll, expect, it } from 'vitest';
import { DELETED_MEMBER_DISPLAY, memberTombstone, orderSchema } from '#core/domain/index.js';
import { createMemberErasureRepository, createOrderRepository } from './repositories.js';
import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { checkoutSnapshots, members, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-10-15T12:00:00.000Z';
const attribution = { utmSource: 'meta', utmMedium: 'paid', fbclid: 'click-id', gclid: 'google-click-id', capturedAt: now };
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_order_attribution', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: now })));
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values(['workspace', 'other'].map((tenantId) => ({ id: `${tenantId}-member`, tenantId, userId: 'buyer', email: 'buyer@example.org', createdAt: now })));
  await database.db.insert(products).values(['workspace', 'other'].map((tenantId) => ({ id: `${tenantId}-product`, tenantId, slug: `${tenantId}-download`, type: 'digital_download' as const, title: 'Download', description: '', priceCents: 100, currency: 'PLN', published: true, createdAt: now })));
  const repository = createOrderRepository(database.db);
  for (const [id, tenantId, captured] of [
    ['attributed', 'workspace', attribution],
    ['duplicate-source', 'workspace', attribution],
    ['unattributed', 'workspace', null],
    ['click-only', 'workspace', { fbclid: 'another-click', capturedAt: now }],
    ['literal-none', 'workspace', { utmSource: 'none', capturedAt: now }],
    ['other-order', 'other', { ...attribution, utmSource: 'other-source' }],
  ] as const) {
    await repository.create(tenantId, orderSchema.parse({ id, tenantId, memberId: `${tenantId}-member`, productId: `${tenantId}-product`, priceId: null, kind: 'one_time', status: 'paid', amountCents: 100, currency: 'PLN', provider: 'simulated', providerObjectIds: { checkoutSession: `cs-${id}` }, couponId: null, discountCents: 0, attribution: captured, createdAt: now }));
  }
  await database.db.insert(checkoutSnapshots).values([
    { id: 'direct-snapshot', tenantId: 'workspace', providerSessionId: 'cs-attributed' },
    { id: 'spa-snapshot', tenantId: 'workspace', providerSessionId: null },
    { id: 'unrelated-snapshot', tenantId: 'workspace', providerSessionId: 'cs-unrelated' },
    { id: 'other-snapshot', tenantId: 'other', providerSessionId: 'cs-attributed' },
  ].map((snapshot) => ({ ...snapshot, attribution, lines: [], currency: 'PLN', createdAt: now })));
  const snapshots = createCheckoutSnapshotRepository(database.db);
  await snapshots.attachProviderSession('other', 'spa-snapshot', 'cs-wrong-tenant');
  await snapshots.attachProviderSession('workspace', 'spa-snapshot', 'cs-duplicate-source');
  await snapshots.attachProviderSession('workspace', 'spa-snapshot', 'cs-rebound');
});
afterAll(async () => { await database?.close(); });

it('filters and counts by exact source before pagination and returns tenant-scoped distinct source options', async () => {
  const repository = createOrderRepository(database.db);
  const page = await repository.list('workspace', { source: 'meta', page: 1, pageSize: 1 });
  expect(page).toMatchObject({ total: 2, sources: ['meta', 'none'], orders: [{ attribution }] });
  expect(page.orders).toHaveLength(1);
  expect(await repository.list('workspace', { source: 'none', page: 1, pageSize: 20 })).toMatchObject({ total: 1, sources: ['meta', 'none'], orders: [{ id: 'unattributed', attribution: null }] });
  expect(await repository.list('workspace', { source: 'none', sourceMatch: 'exact', page: 1, pageSize: 20 })).toMatchObject({ total: 1, sources: ['meta', 'none'], orders: [{ id: 'literal-none', attribution: { utmSource: 'none' } }] });
  expect(await repository.list('workspace', { source: 'other-source', page: 1, pageSize: 20 })).toMatchObject({ total: 0, sources: ['meta', 'none'] });
  expect(await repository.findById('other', 'attributed')).toBeNull();
  expect(await repository.findById('workspace', 'attributed')).toMatchObject({ attribution });
});

it('clears member order and checkout snapshot attribution while retaining unrelated attribution and revenue', async () => {
  const memberId = 'workspace-member';
  await createMemberErasureRepository(database.db, { compute: (tenantId, email) => `${tenantId}:${email}` }).pseudonymize('workspace', {
    memberId, deletedAt: now, tombstoneEmail: memberTombstone(memberId).email,
    severedUserId: memberTombstone(memberId).userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
  });
  const repository = createOrderRepository(database.db);
  const page = await repository.list('workspace', { page: 1, pageSize: 20 });
  expect(page.total).toBe(5);
  expect(page.sources).toEqual([]);
  expect(page.orders.every((order) => order.attribution === null)).toBe(true);
  expect(await repository.findById('other', 'other-order')).toMatchObject({ attribution: { ...attribution, utmSource: 'other-source' } });
  expect(await repository.revenueSince('workspace', now)).toEqual([{ currency: 'PLN', amountCents: 500 }]);
  const snapshots = await database.db.select().from(checkoutSnapshots);
  expect(snapshots.find((snapshot) => snapshot.id === 'direct-snapshot')?.attribution).toBeNull();
  expect(snapshots.find((snapshot) => snapshot.id === 'spa-snapshot')).toMatchObject({ attribution: null, providerSessionId: 'cs-duplicate-source' });
  expect(snapshots.find((snapshot) => snapshot.id === 'unrelated-snapshot')?.attribution).toEqual(attribution);
  expect(snapshots.find((snapshot) => snapshot.id === 'other-snapshot')?.attribution).toEqual(attribution);
});
