import { describe, expect, it } from 'vitest';

import { LIST_LAYOUT_MAX_BYTES, type Identity, type ImpersonationPrincipal, type ListLayout, type StaffRole } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ListLayoutRepository } from '../ports.js';
import { getListLayout, resetListLayout, saveListLayout } from './list-layouts.js';

const layout: ListLayout = {
  version: 1,
  columns: [{ field: 'createdAt', visible: true, width: 180 }, { field: 'coupon', visible: false }],
  sort: { field: 'amountCents', direction: 'desc' },
  filters: { billing: 'requested' },
};

const identity = (staffRole: StaffRole | null, over: Partial<Identity> = {}): Identity => ({
  userId: 'user-1',
  email: 'staff@example.com',
  name: 'Staff',
  emailVerified: true,
  image: null,
  tenantAccess: staffRole === null ? 'member' : 'staff',
  tenantId: 'tenant-a',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole,
  memberId: staffRole === null ? 'member-1' : null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
  ...over,
});

const createStore = () => {
  const rows = new Map<string, ListLayout>();
  const key = (tenantId: string, userId: string, listId: string): string => `${tenantId}|${userId}|${listId}`;
  const repository: ListLayoutRepository = {
    get: async (tenantId, userId, listId) => rows.get(key(tenantId, userId, listId)) ?? null,
    put: async (tenantId, userId, listId, stored) => { rows.set(key(tenantId, userId, listId), stored); },
    delete: async (tenantId, userId, listId) => { rows.delete(key(tenantId, userId, listId)); },
  };
  return { rows, deps: { listLayouts: repository } };
};

const impersonation: ImpersonationPrincipal = {
  id: 'impersonation-1',
  actorUserId: 'user-1',
  actorEmail: 'staff@example.com',
  actorName: 'Staff',
  actorStaffRole: 'owner',
  subjectMemberId: 'member-1',
  subjectName: 'Member',
  expiresAt: '2026-11-25T13:00:00.000Z',
};

describe('list layouts', () => {
  it.each<StaffRole>(['owner', 'admin'])('saves, reads and resets the layout of an %s', async (staffRole) => {
    const store = createStore();
    const ctx: Ctx = { identity: identity(staffRole) };
    expect(await getListLayout(ctx, 'orders', store.deps)).toEqual({ ok: true, value: { layout: null } });
    expect(await saveListLayout(ctx, 'orders', layout, store.deps)).toEqual({ ok: true, value: { layout } });
    expect(await getListLayout(ctx, 'orders', store.deps)).toEqual({ ok: true, value: { layout } });
    expect([...store.rows.keys()]).toEqual(['tenant-a|user-1|orders']);
    expect(await resetListLayout(ctx, 'orders', store.deps)).toEqual({ ok: true, value: { reset: true } });
    expect(await getListLayout(ctx, 'orders', store.deps)).toEqual({ ok: true, value: { layout: null } });
  });

  it('refuses a member for every operation', async () => {
    const store = createStore();
    const ctx: Ctx = { identity: identity(null) };
    expect(await getListLayout(ctx, 'orders', store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await saveListLayout(ctx, 'orders', layout, store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await resetListLayout(ctx, 'orders', store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await getListLayout(ctx, 'unknown', store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await saveListLayout(ctx, 'unknown', layout, store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await resetListLayout(ctx, 'unknown', store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store.rows.size).toBe(0);
  });

  it('refuses a staff role without the capability that reads the list', async () => {
    const store = createStore();
    const ctx: Ctx = { identity: identity('owner'), capabilities: ['product:read'] };
    expect(await getListLayout(ctx, 'orders', store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await saveListLayout(ctx, 'orders', layout, store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('never shows or changes another user\'s layout in the same workspace', async () => {
    const store = createStore();
    await saveListLayout({ identity: identity('owner') }, 'orders', layout, store.deps);
    const other: Ctx = { identity: identity('admin', { userId: 'user-2', email: 'other@example.com' }) };
    expect(await getListLayout(other, 'orders', store.deps)).toEqual({ ok: true, value: { layout: null } });
    await resetListLayout(other, 'orders', store.deps);
    expect(await getListLayout({ identity: identity('owner') }, 'orders', store.deps)).toEqual({ ok: true, value: { layout } });
  });

  it('never shows or changes the same user\'s layout of another workspace', async () => {
    const store = createStore();
    await saveListLayout({ identity: identity('owner') }, 'orders', layout, store.deps);
    const elsewhere: Ctx = { identity: identity('owner', { tenantId: 'tenant-b', tenantSlug: 'studio', tenantName: 'Studio' }) };
    expect(await getListLayout(elsewhere, 'orders', store.deps)).toEqual({ ok: true, value: { layout: null } });
    await resetListLayout(elsewhere, 'orders', store.deps);
    expect([...store.rows.keys()]).toEqual(['tenant-a|user-1|orders']);
  });

  it('refuses an unknown list before touching the store', async () => {
    const store = createStore();
    const ctx: Ctx = { identity: identity('owner') };
    expect(await getListLayout(ctx, 'members', store.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await saveListLayout(ctx, 'members', layout, store.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await resetListLayout(ctx, 'members', store.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(store.rows.size).toBe(0);
  });

  it('refuses a malformed layout', async () => {
    const store = createStore();
    expect(await saveListLayout({ identity: identity('owner') }, 'orders', { ...layout, version: 2 }, store.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(store.rows.size).toBe(0);
  });

  it('refuses a layout over 16 KiB once serialized', async () => {
    const store = createStore();
    const filters = Object.fromEntries(Array.from({ length: 30 }, (_value, index) => [`filter-${String(index)}`, '\u0001'.repeat(200)]));
    const oversize = { ...layout, filters };
    expect(JSON.stringify(oversize).length).toBeGreaterThan(16 * 1024);
    expect(await saveListLayout({ identity: identity('owner') }, 'orders', oversize, store.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(store.rows.size).toBe(0);
  });

  it('refuses multibyte data when its UTF-8 size alone exceeds the limit', async () => {
    const store = createStore();
    const filters = Object.fromEntries(Array.from({ length: 30 }, (_value, index) => [`filter-${String(index)}`, String.fromCodePoint(0x754c).repeat(200)]));
    const oversize = { ...layout, filters };
    const serialized = JSON.stringify(oversize);
    expect(serialized.length).toBeLessThan(LIST_LAYOUT_MAX_BYTES);
    expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(LIST_LAYOUT_MAX_BYTES);
    expect(await saveListLayout({ identity: identity('owner') }, 'orders', oversize, store.deps))
      .toMatchObject({ ok: false, error: { code: 'validation', message: `A list layout is at most ${LIST_LAYOUT_MAX_BYTES} bytes` } });
    expect(store.rows.size).toBe(0);
  });

  it('takes the user only from the signed-in identity, ignoring a user id in the layout', async () => {
    const store = createStore();
    expect(await saveListLayout({ identity: identity('owner') }, 'orders', { ...layout, userId: 'user-2' }, store.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    await saveListLayout({ identity: identity('owner') }, 'orders', layout, store.deps);
    expect([...store.rows.keys()]).toEqual(['tenant-a|user-1|orders']);
  });

  it('reads but never saves or resets while impersonating', async () => {
    const store = createStore();
    await saveListLayout({ identity: identity('owner') }, 'orders', layout, store.deps);
    const viewing: Ctx = { identity: identity('owner'), impersonation };
    expect(await saveListLayout(viewing, 'orders', { ...layout, sort: null }, store.deps))
      .toMatchObject({ ok: false, error: { code: 'impersonation_read_only' } });
    expect(await resetListLayout(viewing, 'orders', store.deps))
      .toMatchObject({ ok: false, error: { code: 'impersonation_read_only' } });
    expect(await getListLayout({ identity: identity('owner') }, 'orders', store.deps)).toEqual({ ok: true, value: { layout } });
  });

  it('refuses a shop management key', async () => {
    const store = createStore();
    const ctx: Ctx = { identity: identity('owner'), machineActor: { kind: 'shop_management_key', apiKeyId: 'key-1', mode: 'direct' } };
    expect(await getListLayout(ctx, 'orders', store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await saveListLayout(ctx, 'orders', layout, store.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
