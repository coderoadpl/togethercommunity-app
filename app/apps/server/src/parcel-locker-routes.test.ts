import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createFakePickupPointDirectory, FAKE_PICKUP_POINT_CODES } from '#adapters/shipx/fake.js';
import { API_PATHS } from '#core/contract/index.js';
import { tenantSchema, tenantSettingsSchema, type ShippingRate } from '#core/domain/index.js';
import { withPickupPointLookupBudget, type PublicRateLimitRepository, type TenantRepository } from '#core/server/index.js';
import { tenantDomainRepositoryStub } from '#core/server/testing/tenant-domain-fakes.js';

import type { AppVars } from './app-vars.js';
import { registerPublicParcelLockerRoutes } from './parcel-locker-routes.js';
import { publicRateLimitMiddleware, selectPublicRateLimitPolicies, type PublicRateLimitPolicies } from './public-rate-limit.js';
import { publicRouteManifestEntry } from './public-route-manifest.js';
import { requestOriginPolicy } from './request-origin-policy.js';

const lockerRate: ShippingRate = { id: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true };

const countingBuckets = (): PublicRateLimitRepository & { claims: string[] } => {
  const counts = new Map<string, number>();
  const claims: string[] = [];
  return {
    claims,
    claim: async (input) => {
      claims.push(input.scope);
      const key = `${input.scope}:${input.key}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count <= input.limit;
    },
    purgeExpired: async () => 0,
  };
};

const harness = (rates: ShippingRate[] = [lockerRate], policies: Partial<PublicRateLimitPolicies> = {}, authTrustedProxyHeader: string | null = null) => {
  const tenant = tenantSchema.parse({ id: 'workspace', slug: 'workspace', name: 'Workspace', status: 'active', plan: 'hosted', contentVersion: 1 });
  const settings = tenantSettingsSchema.parse({ name: 'Workspace', billingPortalUrl: null, bunnyStreamLibraryId: null, shippingRates: rates });
  const tenants: TenantRepository = { findById: async () => tenant, findBySlug: async () => tenant, findSole: async () => tenant,
    findSettings: async () => settings, changeSettings: async () => null, createTenantWithOwnerGrant: async () => tenant, hasAny: async () => true };
  const fake = createFakePickupPointDirectory();
  const lookup = vi.fn(fake.lookup);
  const buckets = countingBuckets();
  const clock = { nowIso: () => '2026-11-22T10:00:00.000Z' };
  const publicRateLimitPolicies = { ...selectPublicRateLimitPolicies({ NODE_ENV: 'production' }), ...policies };
  const pickupPoints = withPickupPointLookupBudget({ lookup }, { buckets, clock, window: publicRateLimitPolicies.parcelLockerLookupsGlobal });
  const deps = { tenants, tenantDomains: tenantDomainRepositoryStub({}), baseDomain: 'example.org', platformHost: null,
    singleTenantMode: true, authTrustedProxyHeader, pickupPoints, clock, publicRateLimitPolicies, rateLimitBuckets: buckets };
  const app = new Hono<AppVars>();
  app.use('*', publicRateLimitMiddleware(deps));
  registerPublicParcelLockerRoutes(app, deps);
  const get = (code: string, clientIp?: string) => app.request(`https://workspace.example.org/api/public/parcel-lockers/${code}`,
    clientIp === undefined ? {} : { headers: { 'x-client-ip': clientIp } });
  return { get, lookup, buckets };
};

describe('public parcel locker lookup route', () => {
  it('answers a usable locker with only its code, name, address and verdict', async () => {
    const h = harness();
    const response = await h.get('waw01m');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(await response.json()).toEqual({ ok: true, data: {
      status: 'found', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw', usable: true, reason: null,
    } });
    expect(h.lookup).toHaveBeenCalledExactlyOnceWith('WAW01M');
  });

  it.each([
    [FAKE_PICKUP_POINT_CODES.notFound, { status: 'not_found' }],
    [FAKE_PICKUP_POINT_CODES.notOperating, { status: 'found', code: 'CLOSED01', usable: false, reason: 'not_operating' }],
    [FAKE_PICKUP_POINT_CODES.wrongType, { status: 'found', code: 'SENDONLY1', usable: false, reason: 'not_usable' }],
    [FAKE_PICKUP_POINT_CODES.unavailable, { status: 'unavailable' }],
  ])('answers %s', async (code, data) => {
    const response = await harness().get(code);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data });
  });

  it.each(['WAW-01', 'ab1', 'A'.repeat(13), 'WAW01M%3Fx%3D1', 'WAW01M%2F..'])('refuses the malformed code %s without asking the carrier', async (code) => {
    const h = harness();
    const response = await h.get(code);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.buckets.claims.filter((scope) => scope === 'parcel-locker:public' || scope === 'parcel-locker:global')).toEqual([]);
  });

  it('never forwards extra path segments or a query string', async () => {
    const h = harness();
    expect((await h.get('WAW01M/../../shipments')).status).toBe(404);
    expect((await h.get('%2E%2E')).status).toBe(404);
    expect((await h.get('WAW01M?fields=name')).status).toBe(200);
    expect(h.lookup).toHaveBeenCalledExactlyOnceWith('WAW01M');
  });

  it('answers not found without asking the carrier in a workspace without an active locker rate', async () => {
    const h = harness([{ ...lockerRate, active: false }, { ...lockerRate, id: 'courier', pickupPoint: 'none' }]);
    const response = await h.get('WAW01M');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.buckets.claims.filter((scope) => scope === 'parcel-locker:public' || scope === 'parcel-locker:global')).toEqual([]);
  });

  it('limits lookups per client address before the carrier is asked', async () => {
    const h = harness();
    for (let attempt = 0; attempt < 30; attempt += 1) expect((await h.get('WAW01M')).status).toBe(200);
    const limited = await h.get('WAW01M');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    expect(h.lookup).toHaveBeenCalledTimes(30);
    expect(h.buckets.claims.filter((scope) => scope === 'parcel-locker:global')).toHaveLength(30);
    expect(h.buckets.claims.at(-1)).toBe('parcel-locker:ip');
  });

  it('answers unavailable without asking the carrier once the platform-wide budget is spent', async () => {
    const h = harness([lockerRate], { parcelLockerLookupsGlobal: { limit: 3, windowMs: 60_000 } }, 'x-client-ip');
    for (const clientIp of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) expect((await h.get('WAW01M', clientIp)).status).toBe(200);
    const spent = await h.get('WAW01M', '192.0.2.4');
    expect(spent.status).toBe(200);
    expect(await spent.json()).toEqual({ ok: true, data: { status: 'unavailable' } });
    expect(h.lookup).toHaveBeenCalledTimes(3);
    expect(h.buckets.claims.at(-1)).toBe('parcel-locker:global');
  });

  it('answers unavailable without asking the carrier once the public share of the budget is spent', async () => {
    const h = harness([lockerRate], { parcelLockerLookupsPublic: { limit: 2, windowMs: 60_000 } }, 'x-client-ip');
    for (const clientIp of ['192.0.2.1', '192.0.2.2']) expect((await h.get('WAW01M', clientIp)).status).toBe(200);
    const spent = await h.get('WAW01M', '192.0.2.3');
    expect(spent.status).toBe(200);
    expect(await spent.json()).toEqual({ ok: true, data: { status: 'unavailable' } });
    expect(h.lookup).toHaveBeenCalledTimes(2);
    expect(h.buckets.claims.filter((scope) => scope === 'parcel-locker:global')).toHaveLength(2);
    expect(h.buckets.claims.at(-1)).toBe('parcel-locker:public');
  });

  it('is listed as a read-only, same-origin GET in the public route manifest and needs no origin policy', () => {
    expect(publicRouteManifestEntry({ path: API_PATHS.publicParcelLocker, method: 'GET' })).toMatchObject({ mutating: false });
    expect(publicRouteManifestEntry({ path: API_PATHS.publicParcelLocker, method: 'OPTIONS' })).toBeUndefined();
    expect(publicRouteManifestEntry({ path: API_PATHS.publicParcelLocker, method: 'POST' })).toBeUndefined();
    expect(requestOriginPolicy('GET', '/api/public/parcel-lockers/WAW01M')).toBe('session');
  });
});
