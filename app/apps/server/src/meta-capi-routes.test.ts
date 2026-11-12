import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { ok, orderSchema, tenantSchema, tenantSettingsSchema, type Identity } from '#core/domain/index.js';
import type { MetaCapiDispatchDeps } from '#core/server/usecases/meta-capi.js';
import type { MetaCapiOrder, MetaCapiRepository, TenantRepository } from '#core/server/index.js';
import { tenantDomainRepositoryStub } from '#core/server/testing/tenant-domain-fakes.js';
import type { AppVars } from './app-vars.js';
import { registerMetaCapiRoutes, registerPublicMetaCapiRoutes } from './meta-capi-routes.js';
import { publicRateLimitMiddleware, selectPublicRateLimitPolicies } from './public-rate-limit.js';

const now = '2026-11-01T10:00:00.000Z';
const version = 'a'.repeat(64);
const actor: Identity = { userId: 'buyer', email: 'buyer@example.org', name: 'Buyer', emailVerified: true, image: null,
  tenantAccess: 'member', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: null,
  memberId: 'buyer', memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };
const harness = (limited = false) => {
  const app = new Hono<AppVars>();
  const tenant = tenantSchema.parse({ id: 'workspace', slug: 'workspace', name: 'Workspace', status: 'active', plan: 'self_hosted', contentVersion: 1 });
  const settings = tenantSettingsSchema.parse({ name: 'Workspace', bunnyStreamLibraryId: null, billingPortalUrl: null,
    privacyUrl: 'https://workspace.example.org/privacy', analyticsMetaCapiEnabled: true, analyticsMetaPixelId: '1234567890' });
  const current: MetaCapiOrder = { order: orderSchema.parse({ id: 'purchase', tenantId: 'workspace', memberId: 'buyer', productId: 'book',
    priceId: null, kind: 'one_time', status: 'paid', amountCents: 9900, currency: 'PLN', provider: 'stripe',
    providerObjectIds: { checkoutSession: 'cs_live_purchase' }, couponId: null, discountCents: 0, paidAt: now, createdAt: now }),
    consent: { consent: 'undecided', withdrawnAt: null }, consentAt: null, memberDeleted: false, email: 'buyer@example.org', sourceUrl: 'https://workspace.example.org/offer/book' };
  const decide = vi.fn<MetaCapiRepository['decide']>(async (_tenantId, _access, action) => {
    const result = await action(current);
    if (!result.ok) return result;
    return ok({ consent: result.value.decision === 'withdrawn' ? 'granted' : result.value.decision,
      withdrawnAt: result.value.decision === 'withdrawn' ? now : null });
  });
  const listEvents = vi.fn(async () => []);
  const tenants: TenantRepository = { findById: async () => tenant, findBySlug: async () => tenant, findSole: async () => tenant,
    findSettings: async () => settings, updateSettings: async (_tenantId, next) => next, createTenantWithOwnerGrant: async () => tenant, hasAny: async () => true };
  const metaCapi: MetaCapiDispatchDeps = { tenants, clock: { nowIso: () => now }, hash: { sha256: () => version },
    secrets: { resolve: async () => ok('never-returned-token') }, gateway: { send: async () => ({ ok: true, fbtraceId: null }) },
    directory: { listAll: async () => [tenant] }, repository: { decide, findOrder: async () => current,
      processNext: async () => false, listEvents, listMemberConsents: async () => [{ orderId: 'purchase', consent: 'granted', consentAt: now, withdrawnAt: null }] } };
  const deps = { metaCapi, tenants, tenantDomains: tenantDomainRepositoryStub({}), baseDomain: 'example.org', platformHost: null,
    singleTenantMode: true, authTrustedProxyHeader: null };
  app.use('*', publicRateLimitMiddleware({ ...deps, clock: metaCapi.clock, publicRateLimitPolicies: selectPublicRateLimitPolicies({ NODE_ENV: 'production' }),
    rateLimitBuckets: { claim: async () => !limited, purgeExpired: async () => 0 } }));
  app.use('*', async (c, next) => { c.set('identity', actor); await next(); });
  registerPublicMetaCapiRoutes(app, deps);
  registerMetaCapiRoutes(app, deps);
  return { app, decide, listEvents };
};
const body = { sessionId: 'cs_live_purchase', decision: 'granted', textVersion: version };
const request = (payload = body, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });

describe('Meta consent routes', () => {
  it('accepts an explicit same-origin JSON decision without returning buyer details', async () => {
    const h = harness();
    const response = await h.app.request('https://workspace.example.org/api/public/meta-capi/consent', request(body, { origin: 'https://workspace.example.org' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { consent: 'granted', withdrawnAt: null } });
    expect(h.decide).toHaveBeenCalledWith('workspace', { sessionId: 'cs_live_purchase' }, expect.any(Function));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  describe.each([
    { path: '/api/public/meta-capi/consent', payload: body },
    { path: '/api/me/meta-capi/withdraw', payload: { orderId: 'purchase' } },
  ])('$path behind a TLS-terminating proxy', ({ path, payload }) => {
    it.each([
      { origin: 'https://workspace.example.org', status: 200 },
      { origin: undefined, status: 200 },
      { origin: 'https://foreign.example.org', status: 403 },
      { origin: 'not a URL', status: 403 },
      { origin: 'null', status: 403 },
      { origin: 'https://workspace.example.org:9443', status: 403 },
      { origin: 'http://internal:9001', status: 403 },
    ])('returns $status for Origin $origin', async ({ origin, status }) => {
      const h = harness();
      const response = await h.app.request(`http://internal:9001${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', host: 'workspace.example.org',
          ...(origin === undefined ? {} : { origin }) }, body: JSON.stringify(payload),
      });
      expect(response.status).toBe(status);
      expect(h.decide).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    });
  });
  it('rejects a valid QR credential with the current text version for new decisions', async () => {
    const h = harness();
    for (const decision of ['granted', 'denied']) {
      const response = await h.app.request('/api/public/meta-capi/consent', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderToken: 'q'.repeat(64), decision, textVersion: version }) });
      expect(response.status).toBe(400);
    }
    expect(h.decide).not.toHaveBeenCalled();
  });
  it('rejects cross-origin and form submissions before consent is stored', async () => {
    const h = harness();
    expect((await h.app.request('/api/public/meta-capi/consent', request(body, { origin: 'https://foreign.example.org' }))).status).toBe(403);
    expect((await h.app.request('/api/public/meta-capi/consent', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'decision=granted' })).status).toBe(400);
    expect(h.decide).not.toHaveBeenCalled();
  });
  it('uses the public write limiter and rejects invalid credentials', async () => {
    const limited = harness(true);
    expect((await limited.app.request('/api/public/meta-capi/consent', request())).status).toBe(429);
    expect(limited.decide).not.toHaveBeenCalled();
    const h = harness();
    expect((await h.app.request('/api/public/meta-capi/consent', request({ ...body, sessionId: 'not-a-token' }))).status).toBe(400);
    expect(h.decide).not.toHaveBeenCalled();
  });
  it('keeps evidence owner-only while binding withdrawal to the signed-in member', async () => {
    const h = harness();
    expect((await h.app.request('/api/meta-capi/events')).status).toBe(403);
    expect(h.listEvents).not.toHaveBeenCalled();
    expect((await h.app.request('/api/me/meta-capi/consents')).status).toBe(200);
    const response = await h.app.request('/api/me/meta-capi/withdraw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: 'purchase' }) });
    expect(response.status).toBe(200);
    expect(h.decide).toHaveBeenCalledWith('workspace', { orderId: 'purchase', memberId: 'buyer' }, expect.any(Function));
  });
});
