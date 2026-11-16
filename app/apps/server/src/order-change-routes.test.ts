import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { orderChangeContracts } from '#core/contract/index.js';
import { orderListItemSchema, type Identity, type OrderListItem } from '#core/domain/index.js';
import type { OrderChangeRepository, OrderListItemReader } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import { registerOrderChangeRoutes } from './order-change-routes.js';

const identity = (staffRole: 'owner' | null): Identity => ({
  userId: 'person', email: 'person@example.org', name: 'Person', emailVerified: true, image: null,
  tenantAccess: staffRole === null ? 'member' : 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace',
  staffRole, memberId: staffRole === null ? 'member' : null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null,
  memberLanguage: null, memberVideoAutoplay: false,
});

const order = (id: string, mode: 'live' | 'test'): OrderListItem => orderListItemSchema.parse({
  id, tenantId: 'workspace', memberId: 'member', productId: 'stand', priceId: null, kind: 'one_time', status: 'paid', mode,
  amountCents: 7398, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: '2026-11-04T09:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed stand',
  couponCode: null, fulfilmentStatus: 'shipped',
});

const EPOCH = '0123456789abcdef0123456789abcdef';

const harness = (staffRole: 'owner' | null) => {
  const stored = [order('live-order', 'live'), order('test-order', 'test')];
  const listOrderChanges = vi.fn<OrderChangeRepository['listOrderChanges']>(async (_tenantId, query) => query.after?.startsWith(EPOCH) === false
    ? { kind: 'reset', cursor: `${EPOCH}.12.4` }
    : { kind: 'changes', changes: stored
      .filter((item) => query.mode === undefined || item.mode === query.mode)
      .map((item, index) => ({ cursor: `${EPOCH}.9.${String(index + 1)}`, orderId: item.id, changedAt: item.createdAt })) });
  const listByIds = vi.fn<OrderListItemReader['listByIds']>(async (_tenantId, ids) => stored.filter((item) => ids.includes(item.id)));
  const app = new Hono<AppVars>();
  app.use('*', async (c, next) => { c.set('identity', identity(staffRole)); await next(); });
  registerOrderChangeRoutes(app, { orderChangeFeed: { changes: { listOrderChanges }, orders: { listByIds } } });
  return { app, listOrderChanges };
};

describe('order changes HTTP route', () => {
  it('returns the changed orders in the order list shape with the next cursor', async () => {
    const h = harness('owner');
    const response = await h.app.request(`/api/orders/changes?after=${EPOCH}.8.1&limit=50`);
    expect(response.status).toBe(200);
    const { data } = z.object({ ok: z.literal(true), data: orderChangeContracts.orderChanges.output }).parse(await response.json());
    expect(data.changes.map((change) => change.order.id)).toEqual(['live-order', 'test-order']);
    expect(data.nextCursor).toBe(`${EPOCH}.9.2`);
    expect(h.listOrderChanges).toHaveBeenCalledExactlyOnceWith('workspace', { after: `${EPOCH}.8.1`, limit: 50 });
  });

  it('answers 409 feed_cursor_reset with a typed fresh cursor to a cursor from another database timeline', async () => {
    const h = harness('owner');
    const response = await h.app.request(`/api/orders/changes?after=${'f'.repeat(32)}.8.1`);
    expect(response.status).toBe(409);
    const body = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), details: orderChangeContracts.orderChanges.resetDetails }) })
      .parse(await response.json());
    expect(body.error).toEqual({
      code: 'feed_cursor_reset',
      message: 'Order change feed reset: resync from the order list, then start from the cursor in this answer',
      details: { cursor: `${EPOCH}.12.4` },
    });
  });

  it('forwards mode=live so test orders stay out', async () => {
    const h = harness('owner');
    const response = await h.app.request('/api/orders/changes?mode=live');
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: true, data: { changes: [{ order: { id: 'live-order', mode: 'live' } }] } });
    expect(h.listOrderChanges).toHaveBeenCalledExactlyOnceWith('workspace', { mode: 'live', limit: 100 });
  });

  it('answers 403 to a member without order:read', async () => {
    const h = harness(null);
    const response = await h.app.request('/api/orders/changes');
    expect(response.status).toBe(403);
    expect(h.listOrderChanges).not.toHaveBeenCalled();
  });

  it.each(['limit=0', 'limit=201', 'after=not-a-cursor', 'after=8.1', 'mode=staging'])('answers 400 to %s', async (query) => {
    const h = harness('owner');
    const response = await h.app.request(`/api/orders/changes?${query}`);
    expect(response.status).toBe(400);
    expect(h.listOrderChanges).not.toHaveBeenCalled();
  });
});
