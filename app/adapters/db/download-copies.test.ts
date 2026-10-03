import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DOWNLOAD_COPY_PAGE_SIZE, memberTombstone, type DownloadCopy, type Order } from '#core/domain/index.js';

import { createDownloadCopyOrderReader, createDownloadCopyRepository } from './download-copies.js';
import { createMemberErasureRepository } from './repositories.js';
import { members, orders, products, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-10-01T12:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const copy = (id: string, tenantId = 'copies'): DownloadCopy => ({
  id, tenantId, copyIdentifier: 'copy_AAAAAAAAAAAAAAAAAAAAAAAAAA', memberId: `${tenantId}-member`,
  orderId: null, productId: 'product', assetId: 'asset', lineageId: 'original', versionNumber: 2,
  fileName: 'workbook.pdf', personalised: true, contentHash: 'a'.repeat(64), bytes: 100, createdAt: NOW,
});
const order = (id: string, overrides: Partial<Order> = {}): Order => ({
  id, tenantId: 'copies', memberId: 'copies-member', productId: 'product', priceId: null,
  mode: 'live', kind: 'one_time', status: 'paid', amountCents: 100, currency: 'PLN', provider: 'stripe',
  providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: NOW, ...overrides,
});

beforeAll(async () => {
  database = await createTestDatabase('together_download_copies', 'postgres://together:together@localhost:48912/together');
  for (const tenantId of ['copies', 'other']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Copies', createdAt: NOW });
    await database.db.insert(members).values({ id: `${tenantId}-member`, tenantId, userId: `${tenantId}-user`, email: `${tenantId}@example.test`, createdAt: NOW });
    await database.db.insert(products).values({ id: `${tenantId}-product`, tenantId, slug: 'product', title: 'Workbook', description: '', priceCents: 100, currency: 'PLN', createdAt: NOW });
  }
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('download copy persistence', () => {
  it('selects the newest paid order only for the member, tenant and product with deterministic ties', async () => {
    await database.db.insert(orders).values([
      order('old', { productId: 'copies-product', createdAt: '2026-09-01T12:00:00.000Z' }),
      order('new-a', { productId: 'copies-product' }), order('new-b', { productId: 'copies-product' }),
      order('pending', { productId: 'copies-product', status: 'pending', createdAt: '2026-10-02T12:00:00.000Z' }),
      order('refunded', { productId: 'copies-product', status: 'refunded', createdAt: '2026-10-02T12:00:00.000Z' }),
      order('partial', { productId: 'copies-product', status: 'partially_refunded', createdAt: '2026-10-02T12:00:00.000Z' }),
      order('other', { tenantId: 'other', memberId: 'other-member', productId: 'other-product', createdAt: '2026-10-02T12:00:00.000Z' }),
    ]);
    const reader = createDownloadCopyOrderReader(database.db);
    expect(await reader.findLatestPaidOrderId('copies', 'copies-member', 'copies-product')).toBe('new-b');
    expect(await reader.findLatestPaidOrderId('other', 'copies-member', 'copies-product')).toBeNull();
    expect(await reader.findLatestPaidOrderId('copies', 'manual-member', 'copies-product')).toBeNull();
    expect(await reader.findLatestPaidOrderId('copies', 'copies-member', 'other-product')).toBeNull();
  });

  it('keeps identifiers private to a tenant and enforces uniqueness within it', async () => {
    const repository = createDownloadCopyRepository(database.db);
    expect(await repository.create('copies', copy('copy-1'))).toBe(true);
    expect(await repository.create('other', copy('copy-2', 'other'))).toBe(true);
    await expect(repository.create('copies', copy('duplicate'))).rejects.toThrow();
    expect(await repository.list('other', { memberId: 'copies-member' })).toEqual([]);
    expect(await repository.list('copies', { productId: 'product', copyIdentifier: copy('copy-1').copyIdentifier })).toEqual([copy('copy-1')]);
  });

  it('bounds history and pages through tied timestamps without repeating newer copies', async () => {
    const repository = createDownloadCopyRepository(database.db);
    const rows = Array.from({ length: DOWNLOAD_COPY_PAGE_SIZE + 2 }, (_unused, index) => ({
      ...copy(`page-${String(index).padStart(3, '0')}`, 'other'),
      productId: 'paged-product', copyIdentifier: `copy_B${'A'.repeat(22)}${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}A`,
      createdAt: index === 0 ? '2026-09-01T12:00:00.000Z' : NOW,
    }));
    for (const row of rows) await repository.create('other', row);
    const first = await repository.list('other', { memberId: 'other-member', productId: 'paged-product' });
    expect(first).toHaveLength(DOWNLOAD_COPY_PAGE_SIZE);
    const last = first.at(-1);
    if (!last) throw new Error('Missing first page');
    await repository.create('other', { ...copy('newest', 'other'), productId: 'paged-product',
      copyIdentifier: 'copy_ZZZZZZZZZZZZZZZZZZZZZZZZZA', createdAt: '2026-10-02T12:00:00.000Z' });
    const second = await repository.list('other', { memberId: 'other-member', productId: 'paged-product',
      cursor: { createdAt: last.createdAt, id: last.id } });
    expect(second.map((row) => row.id)).toEqual(['page-001', 'page-000']);
    expect([...first, ...second].map((row) => row.id)).toEqual(rows.toReversed().map((row) => row.id));
    expect(await repository.list('copies', { memberId: 'other-member', productId: 'paged-product' })).toEqual([]);
  });

  it('erases copies atomically and refuses subsequent writes for tombstoned members', async () => {
    const tombstone = memberTombstone('copies-member');
    await createMemberErasureRepository(database.db, { compute: (_tenant, email) => email }).pseudonymize('copies', {
      memberId: 'copies-member', deletedAt: NOW, tombstoneEmail: tombstone.email,
      severedUserId: tombstone.userId, postAuthorDisplay: 'Deleted member',
    });
    const repository = createDownloadCopyRepository(database.db);
    expect(await repository.list('copies', { memberId: 'copies-member' })).toEqual([]);
    expect(await repository.list('other', { memberId: 'other-member', productId: 'product' })).toHaveLength(1);
    expect(await repository.create('copies', copy('too-late'))).toBe(false);
  });
});
