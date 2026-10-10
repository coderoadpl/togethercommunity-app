import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';
import { registerConsumerSalesRoutes } from './consumer-sales-routes.js';

const identity: Identity = { userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };
const query = { from: '2026-09-01', to: '2026-09-30' };
const harness = (actor = identity) => {
  const app = new Hono<AppVars>();
  const listUninvoicedConsumers = vi.fn(async () => []);
  app.use('*', async (c, next) => { c.set('identity', actor); await next(); });
  registerConsumerSalesRoutes(app, { consumerSales: { listUninvoicedConsumers } });
  return { app, listUninvoicedConsumers };
};

describe('consumer sales HTTP contracts', () => {
  it('returns JSON and a raw downloadable CSV through the registered route', async () => {
    const h = harness();
    const json = await h.app.request('/api/orders/consumer-sales-summary?from=2026-09-01&to=2026-09-30');
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({ ok: true, data: { ...query, orderIds: [] } });
    expect(h.listUninvoicedConsumers).toHaveBeenCalledWith('workspace', query);
    const response = await h.app.request('/api/orders/consumer-sales-summary?from=2026-09-01&to=2026-09-30&format=csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="consumer-sales-2026-09-01-2026-09-30.csv"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('"TOTAL","0","0","0","0","0"');
  });
  it('preserves error envelopes for forbidden CSV requests without touching storage', async () => {
    const h = harness({ ...identity, staffRole: null, tenantAccess: 'member', memberId: 'member' });
    expect((await h.app.request('/api/orders/consumer-sales-summary?from=2026-09-01&to=2026-09-30&format=csv')).status).toBe(403);
    expect((await h.app.request('/api/orders/consumer-sales-summary?from=2026-09-01&to=2026-09-30')).status).toBe(403);
    expect(h.listUninvoicedConsumers).not.toHaveBeenCalled();
  });
  it.each(['', '?from=2026-09-01&to=2026-09-31', '?from=2026-09-30&to=2026-09-01', '?from=2026-09-01&to=2026-09-30&format=pdf'])('rejects an invalid query %s', async (search) => {
    const h = harness();
    expect((await h.app.request(`/api/orders/consumer-sales-summary${search}`)).status).toBe(400);
    expect(h.listUninvoicedConsumers).not.toHaveBeenCalled();
  });
  it.each([
    { from: '2026-09-30', to: '2026-09-01', details: { formErrors: ['Date range is reversed'], fieldErrors: {} } },
    { from: '2026-09-31', to: '2026-10-01', details: { formErrors: [], fieldErrors: { from: ['Invalid calendar day'] } } },
  ])('returns the same flattened date issues as the CLI for $from to $to', async ({ from, to, details }) => {
    const h = harness();
    const response = await h.app.request(`/api/orders/consumer-sales-summary?from=${from}&to=${to}`);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Invalid consumer sales query', details } });
    expect(h.listUninvoicedConsumers).not.toHaveBeenCalled();
  });
});
