import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ListLayout } from '#core/domain/index.js';

import { createStaffListLayoutRepository } from './staff-list-layouts.js';
import { staffListLayouts, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const layout: ListLayout = { version: 1, columns: [{ field: 'createdAt', visible: true, width: 180 }], sort: null, filters: { billing: 'requested' } };
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_staff_list_layouts', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: '2026-11-01T12:00:00.000Z' })));
});
afterAll(async () => { await database?.close(); });

describe('staff list layout repository', () => {
  it('stores, replaces and deletes one layout per workspace, user and list', async () => {
    const repository = createStaffListLayoutRepository(database.db);
    expect(await repository.get('workspace', 'user-1', 'orders')).toBeNull();
    await repository.put('workspace', 'user-1', 'orders', layout);
    expect(await repository.get('workspace', 'user-1', 'orders')).toEqual(layout);
    const replaced: ListLayout = { ...layout, sort: { field: 'amountCents', direction: 'asc' } };
    await repository.put('workspace', 'user-1', 'orders', replaced);
    expect(await repository.get('workspace', 'user-1', 'orders')).toEqual(replaced);
    expect(await database.db.select().from(staffListLayouts)).toHaveLength(1);
    await repository.delete('workspace', 'user-1', 'orders');
    expect(await repository.get('workspace', 'user-1', 'orders')).toBeNull();
  });

  it('never reads or removes another user\'s or another workspace\'s layout', async () => {
    const repository = createStaffListLayoutRepository(database.db);
    await repository.put('workspace', 'user-1', 'orders', layout);
    expect(await repository.get('workspace', 'user-2', 'orders')).toBeNull();
    expect(await repository.get('other', 'user-1', 'orders')).toBeNull();
    await repository.delete('workspace', 'user-2', 'orders');
    await repository.delete('other', 'user-1', 'orders');
    expect(await repository.get('workspace', 'user-1', 'orders')).toEqual(layout);
  });

  it('answers no layout when the stored row no longer parses', async () => {
    await database.db.insert(staffListLayouts).values({ tenantId: 'workspace', userId: 'user-3', listId: 'orders', layout: { version: 0 } });
    expect(await createStaffListLayoutRepository(database.db).get('workspace', 'user-3', 'orders')).toBeNull();
  });
});
