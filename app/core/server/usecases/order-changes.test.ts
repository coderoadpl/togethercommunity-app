import { describe, expect, it, vi } from 'vitest';

import { orderListItemSchema, type Identity, type OrderChange, type OrderChangeRead, type OrderListItem } from '#core/domain/index.js';

import type { OrderChangeRepository, OrderListItemReader } from '../order-change-ports.js';
import { listOrderChangeFeed } from './order-changes.js';

const identity = (staffRole: 'owner' | 'admin' | null): Identity => ({
  userId: 'u1', email: 'person@example.org', name: 'Person', emailVerified: true, image: null,
  tenantAccess: staffRole === null ? 'member' : 'staff', tenantId: 't1', tenantSlug: 'alpha', tenantName: 'Alpha', staffRole,
  memberId: staffRole === null ? 'm1' : null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null,
  memberLanguage: null, memberVideoAutoplay: false,
});

const order = (id: string, over: Partial<OrderListItem> = {}): OrderListItem => orderListItemSchema.parse({
  mode: 'live', id, tenantId: 't1', memberId: 'm1', productId: 'p1', priceId: null, kind: 'one_time', status: 'paid',
  amountCents: 4900, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: '2026-11-16T10:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Course',
  couponCode: null, ...over,
});

const EPOCH = '0123456789abcdef0123456789abcdef';
const at = (position: string): string => `${EPOCH}.${position}`;

const change = (position: string, orderId: string): OrderChange => ({ cursor: at(position), orderId, changedAt: '2026-11-16T10:00:00.000Z' });

const harness = (page: OrderChange[], stored: OrderListItem[], read: OrderChangeRead = { kind: 'changes', changes: page }) => {
  const listOrderChanges = vi.fn<OrderChangeRepository['listOrderChanges']>(async () => read);
  const listByIds = vi.fn<OrderListItemReader['listByIds']>(async (_tenantId, orderIds) => stored.filter((item) => orderIds.includes(item.id)));
  return { deps: { changes: { listOrderChanges }, orders: { listByIds } }, listOrderChanges, listByIds };
};

describe('listOrderChangeFeed', () => {
  it('returns each changed order once, at its latest cursor, in cursor order', async () => {
    const h = harness(
      [change('5.1', 'a'), change('5.2', 'b'), change('6.3', 'a')],
      [order('a', { fulfilmentStatus: 'shipped' }), order('b')],
    );
    const result = await listOrderChangeFeed({ identity: identity('owner') }, { after: at('4.9'), limit: '10' }, h.deps);
    expect(result).toEqual({ ok: true, value: {
      changes: [{ cursor: at('5.2'), order: order('b') }, { cursor: at('6.3'), order: order('a', { fulfilmentStatus: 'shipped' }) }],
      nextCursor: at('6.3'),
    } });
    expect(h.listOrderChanges).toHaveBeenCalledExactlyOnceWith('t1', { after: at('4.9'), limit: 10 });
    expect(h.listByIds).toHaveBeenCalledExactlyOnceWith('t1', ['b', 'a']);
  });

  it('advances past a change whose order is no longer listed', async () => {
    const h = harness([change('5.1', 'gone')], []);
    const result = await listOrderChangeFeed({ identity: identity('admin') }, { after: at('4.9') }, h.deps);
    expect(result).toEqual({ ok: true, value: { changes: [], nextCursor: at('5.1') } });
  });

  it('keeps the input cursor when nothing changed, and has none before the first change', async () => {
    const h = harness([], []);
    expect(await listOrderChangeFeed({ identity: identity('owner') }, { after: at('4.9') }, h.deps))
      .toEqual({ ok: true, value: { changes: [], nextCursor: at('4.9') } });
    expect(await listOrderChangeFeed({ identity: identity('owner') }, {}, h.deps))
      .toEqual({ ok: true, value: { changes: [], nextCursor: null } });
    expect(h.listOrderChanges).toHaveBeenLastCalledWith('t1', { limit: 100 });
  });

  it('answers a cursor from another database timeline with feed_cursor_reset and a fresh cursor, reading no orders', async () => {
    const h = harness([], [order('a')], { kind: 'reset', cursor: at('7.2') });
    const result = await listOrderChangeFeed({ identity: identity('owner') }, { after: `${'f'.repeat(32)}.4.9` }, h.deps);
    expect(result).toEqual({ ok: false, error: {
      code: 'feed_cursor_reset',
      message: 'Order change feed reset: resync from the order list, then start from the cursor in this answer',
      details: { cursor: at('7.2') },
    } });
    expect(h.listByIds).not.toHaveBeenCalled();
  });

  it('forwards the payment mode', async () => {
    const h = harness([], []);
    await listOrderChangeFeed({ identity: identity('owner') }, { mode: 'live', limit: 1 }, h.deps);
    expect(h.listOrderChanges).toHaveBeenCalledExactlyOnceWith('t1', { mode: 'live', limit: 1 });
  });

  it('refuses a member without order:read before reading anything', async () => {
    const h = harness([change('5.1', 'a')], [order('a')]);
    const result = await listOrderChangeFeed({ identity: identity(null) }, {}, h.deps);
    expect(result.ok ? null : result.error.code).toBe('forbidden');
    expect(h.listOrderChanges).not.toHaveBeenCalled();
  });

  it.each([
    { limit: 0 }, { limit: 201 }, { limit: '1.5' }, { after: '12' }, { after: at('1.02') }, { after: '4.9' }, { after: `${'A'.repeat(32)}.4.9` }, { mode: 'staging' }, { before: at('1.1') },
  ])('rejects %j as a validation error', async (query) => {
    const h = harness([], []);
    const result = await listOrderChangeFeed({ identity: identity('owner') }, query, h.deps);
    expect(result.ok ? null : result.error.code).toBe('validation');
    expect(h.listOrderChanges).not.toHaveBeenCalled();
  });
});
