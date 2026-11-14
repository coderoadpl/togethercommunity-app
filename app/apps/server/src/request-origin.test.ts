import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  BETTER_AUTH_OAUTH_CALLBACK_PATH_PATTERN,
  BETTER_AUTH_PASSWORD_SIGN_IN_PATH,
  BETTER_AUTH_SIGN_OUT_PATH,
  BETTER_AUTH_TWO_FACTOR_BACKUP_CODE_PATH,
  BETTER_AUTH_TWO_FACTOR_TOTP_PATH,
} from '#adapters/auth/create-auth.js';
import { API_ROUTES } from '#core/contract/index.js';
import type { Tenant } from '#core/domain/index.js';
import { tenantDomainFixture, tenantDomainRepositoryStub } from '#core/server/testing/tenant-domain-fakes.js';

import type { AppVars } from './app-vars.js';
import { PUBLIC_ROUTE_MANIFEST } from './public-route-manifest.js';
import { SELF_AUTHENTICATING_ROUTE_MANIFEST } from './self-authenticating-route-manifest.js';
import { assertRequestOriginCoverage, requestOriginPolicy } from './request-origin-policy.js';
import { isAllowedRequestOrigin, requestOriginGuard } from './request-origin.js';

type Deps = Parameters<typeof requestOriginGuard>[0];
const acme: Tenant = { id: 'acme', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1 };
const studio: Tenant = { ...acme, id: 'studio', slug: 'studio', name: 'Studio' };
const user = { sessionId: 'session', userId: 'user', email: 'user@example.test', name: 'User', emailVerified: true, image: null };
const domains = [
  tenantDomainFixture({ id: 'canonical', tenantId: acme.id, domain: 'community.example.test', verified: true }),
  tenantDomainFixture({ id: 'alias', tenantId: acme.id, domain: 'alias.example.test', verified: true }),
  tenantDomainFixture({ id: 'pending', tenantId: acme.id, domain: 'pending.example.test', verified: false }),
  tenantDomainFixture({ id: 'sibling', tenantId: studio.id, domain: 'studio.example.test', verified: true }),
];

const deps = (overrides: Partial<Deps> = {}): Deps => ({
  appBaseUrl: 'https://start.together.test',
  deploymentAuthOrigins: [],
  baseDomain: 'together.test',
  platformHost: 'start.together.test',
  singleTenantMode: false,
  tenants: {
    findById: async (id) => [acme, studio].find((tenant) => tenant.id === id) ?? null,
    findBySlug: async (slug) => [acme, studio].find((tenant) => tenant.slug === slug) ?? null,
    findSole: async () => acme,
    findSettings: async () => null,
    updateSettings: async (_id, settings) => settings,
    createTenantWithOwnerGrant: async () => null,
    hasAny: async () => true,
  },
  tenantDomains: tenantDomainRepositoryStub({
    findByDomain: async (host) => domains.find((domain) => domain.domain === host) ?? null,
    listByTenant: async (tenantId) => domains.filter((domain) => domain.tenantId === tenantId),
  }),
  authPort: {
    getAuthenticatedUser: async (headers) => headers.get('authorization') === 'Bearer valid'
      || headers.get('cookie')?.includes('session=valid') === true ? user : null,
  },
  ...overrides,
});

const request = (headers: Record<string, string> = {}, url = 'https://acme.together.test/api/products'): Request =>
  new Request(url, { method: 'POST', headers });
const allowed = (headers: Record<string, string>, config = deps(), url?: string) =>
  isAllowedRequestOrigin(request(headers, url), config);

const harness = (config = deps()) => {
  const app = new Hono<AppVars>();
  const mutation = vi.fn();
  app.use('/api/*', requestOriginGuard(config));
  app.all('*', (c) => {
    mutation(c.req.raw.headers.get('cookie'));
    return c.body(null, 204);
  });
  const send = (path: string, headers: Record<string, string> = {}, method = 'POST') =>
    app.request(`https://acme.together.test${path}`, { method, headers });
  return { send, mutation };
};

describe('exact tenant request origins', () => {
  it.each([
    'https://acme.together.test',
    'https://start.together.test',
    'https://community.example.test',
    'https://alias.example.test',
  ])('accepts the platform and all verified tenant origins: %s', async (origin) => {
    expect(await allowed({ origin, 'sec-fetch-site': 'cross-site' })).toBe(true);
  });

  it.each([
    'https://studio.together.test', 'https://studio.example.test', 'https://pending.example.test',
    'https://acme.together.test.evil.test', 'http://acme.together.test', 'https://acme.together.test:8443',
    'null', 'not an origin', '', 'https://acme.together.test/path', 'https://acme.together.test/',
    'https://acme.together.test?query', 'https://acme.together.test#fragment', 'https://user@acme.together.test',
    'https://acme.together.test\\path',
    'https://acme.together.test, https://studio.together.test', 'ftp://acme.together.test',
  ])('rejects sibling, unverified, non-exact and malformed origins: %s', async (origin) => {
    expect(await allowed({ origin, 'sec-fetch-site': 'same-site' })).toBe(false);
  });

  it('accepts normalized default ports but not a changed scheme or effective port', async () => {
    expect(await allowed({ origin: 'https://acme.together.test:443' })).toBe(true);
    expect(await allowed({ host: 'acme.together.test:443', origin: 'https://acme.together.test' })).toBe(true);
    expect(await allowed({ host: 'acme.together.test:99999', origin: 'https://acme.together.test' })).toBe(false);
    const configured = deps({ appBaseUrl: 'https://start.together.test:8443' });
    const url = 'https://acme.together.test:8443/api/products';
    expect(await allowed({ origin: 'https://acme.together.test:8443' }, configured, url)).toBe(true);
    expect(await allowed({ origin: 'https://acme.together.test' }, configured, url)).toBe(false);
    expect(await allowed({ origin: 'http://acme.together.test:8443' }, configured, url)).toBe(false);
  });

  it('requires Origin unless fetch metadata consistently says same-origin', async () => {
    expect(await allowed({ 'sec-fetch-site': 'same-origin' })).toBe(true);
    expect(await allowed({ origin: 'https://acme.together.test', 'sec-fetch-site': 'same-origin' })).toBe(true);
    for (const site of ['same-site', 'cross-site', 'none', 'invalid', 'same-origin, same-site']) {
      expect(await allowed({ 'sec-fetch-site': site })).toBe(false);
    }
    expect(await allowed({})).toBe(false);
    expect(await allowed({ origin: 'https://start.together.test', 'sec-fetch-site': 'same-origin' })).toBe(false);
    expect(await allowed({ origin: 'https://acme.together.test', 'sec-fetch-site': 'invalid' })).toBe(false);
  });

  it('uses host precedence, not a conflicting tenant or forwarded header', async () => {
    expect(await allowed({ origin: 'https://studio.together.test', 'x-tenant': 'studio' })).toBe(false);
    expect(await allowed({ origin: 'https://acme.together.test', 'x-tenant': 'studio' })).toBe(true);
    expect(await allowed({ origin: 'https://studio.together.test', 'x-forwarded-host': 'studio.together.test', 'x-forwarded-proto': 'https' })).toBe(false);
    for (const host of ['evil.test', 'pending.example.test', 'acme.together.test:8443', 'user@acme.together.test', 'acme.together.test/path']) {
      expect(await allowed({ host, origin: 'https://start.together.test', 'x-tenant': 'acme' })).toBe(false);
      expect(await allowed({ host, 'sec-fetch-site': 'same-origin', 'x-tenant': 'acme' })).toBe(false);
    }
  });

  it('never gives platform account endpoints a union of tenant origins', async () => {
    for (const path of ['/api/me/profile', '/api/tenants', BETTER_AUTH_SIGN_OUT_PATH, '/api/platform/data-reset']) {
      const url = `https://start.together.test${path}`;
      expect(await allowed({ origin: 'https://acme.together.test', 'x-tenant': 'acme' }, deps(), url)).toBe(false);
      expect(await allowed({ origin: 'https://start.together.test', 'x-tenant': 'acme' }, deps(), url)).toBe(true);
    }
  });

  it('supports custom-domain targets and checks current verification on each request', async () => {
    const config = deps();
    expect(await allowed({ origin: 'https://acme.together.test' }, config, 'https://alias.example.test/api/products')).toBe(true);
    config.tenantDomains.listByTenant = async () => domains.filter((domain) => domain.id !== 'alias');
    expect(await allowed({ origin: 'https://alias.example.test' }, config)).toBe(false);
    expect(await allowed({ origin: 'https://start.together.test' }, config, 'https://alias.example.test/api/products')).toBe(false);
  });

  it.each([80, 9347])('supports verified HTTP custom domains only at the composed development port %s', async (port) => {
    const config = deps({
      appBaseUrl: `http://localhost:${port}`, baseDomain: 'localhost', platformHost: 'start.localhost',
      developmentCustomDomainPort: port,
    });
    const origin = new URL(`http://alias.example.test:${port}`).origin;
    const url = `${origin}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`;
    expect(await allowed({ origin, 'sec-fetch-site': 'same-origin' }, config, url)).toBe(true);
    expect(await allowed({ 'sec-fetch-site': 'same-origin' }, config, url)).toBe(true);
    expect(await allowed({}, config, url)).toBe(false);
    expect(await allowed({ origin: `http://studio.example.test:${port}` }, config, url)).toBe(false);
    expect(await allowed({ origin: `http://pending.example.test:${port}` }, config, url)).toBe(false);
    expect(await allowed({ origin: 'http://alias.example.test:9348' }, config, url)).toBe(false);
    expect(await allowed({ origin }, deps(), url)).toBe(false);
    const withoutDevelopment = { ...config };
    delete withoutDevelopment.developmentCustomDomainPort;
    expect(await allowed({ origin }, withoutDevelopment, url)).toBe(false);
    config.tenantDomains.listByTenant = async () => domains.filter((domain) => domain.id !== 'alias');
    expect(await allowed({ origin }, config, url)).toBe(false);
  });

  it('accepts the IPv6 loopback authority without trusting tenant origins on account paths', async () => {
    const config = deps({ appBaseUrl: 'http://[::1]:48730', baseDomain: 'localhost', platformHost: null });
    const url = `${config.appBaseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`;
    expect(await allowed({ origin: config.appBaseUrl, 'sec-fetch-site': 'same-origin' }, config, url)).toBe(true);
    expect(await allowed({ host: '[0:0:0:0:0:0:0:1]:48730', origin: config.appBaseUrl, 'x-tenant': 'missing' }, config, url)).toBe(true);
    expect(await allowed({ origin: 'http://acme.localhost:48730', 'x-tenant': 'acme' }, config, url)).toBe(false);
  });

  it('keeps a configured app host that looks like a non-tenant subdomain of the base domain tenantless', async () => {
    const config = deps({ appBaseUrl: 'https://staging.example.test', baseDomain: 'example.test', platformHost: null });
    const url = `${config.appBaseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`;
    expect(await allowed({ origin: config.appBaseUrl, 'sec-fetch-site': 'same-origin' }, config, url)).toBe(true);
    expect(await allowed({ 'sec-fetch-site': 'same-origin' }, config, `${config.appBaseUrl}/api/me/profile`)).toBe(true);
    expect(await allowed({ origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' }, config, url)).toBe(false);
    expect(await allowed({ origin: 'https://acme.example.test', 'sec-fetch-site': 'same-site' }, config, url)).toBe(false);
    const unknown = 'https://missing.example.test';
    expect(await allowed({ origin: unknown, 'sec-fetch-site': 'same-origin' }, config, `${unknown}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`)).toBe(false);
    expect(await allowed({ origin: config.appBaseUrl }, config, `${unknown}/api/products`)).toBe(false);
  });

  it.each([
    '[::1]:99999', '[::1]:invalid', '[::1]:', '::1:48730', '[:::1]:48730',
    'user@[::1]:48730', '[::1]:48730/path', '[::1]:48730?query', '[::1]:48730#fragment',
  ])('rejects malformed IPv6 authorities: %s', async (host) => {
    const config = deps({ appBaseUrl: 'http://[::1]:48730', baseDomain: 'localhost', platformHost: null });
    expect(await allowed({ host, origin: config.appBaseUrl }, config, `${config.appBaseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`)).toBe(false);
  });

  it('supports only the explicitly composed local Vite/API port pair', async () => {
    const config = deps({ appBaseUrl: 'http://localhost:48730', baseDomain: 'localhost', platformHost: 'start.localhost', developmentWebOrigin: 'http://localhost:48731' });
    expect(await allowed({ origin: 'http://acme.localhost:48731' }, config, 'http://acme.localhost:48730/api/products')).toBe(true);
    expect(await allowed({ host: 'acme.localhost:48731', origin: 'http://acme.localhost:48731', 'sec-fetch-site': 'same-origin' }, config, 'http://localhost:48730/api/products')).toBe(true);
    expect(await allowed({ origin: 'http://studio.localhost:48731' }, config, 'http://acme.localhost:48731/api/products')).toBe(false);
    expect(await allowed({ origin: 'http://acme.localhost:9876' }, config, 'http://acme.localhost:48730/api/products')).toBe(false);
    expect(await allowed({ origin: 'http://acme.localhost:48731' }, deps({ ...config, developmentWebOrigin: 'http://localhost:9876' }), 'http://acme.localhost:48730/api/products')).toBe(false);
    expect(await allowed({ origin: 'https://acme.together.test:48731' }, deps({ developmentWebOrigin: 'http://localhost:48731' }))).toBe(false);
  });
});

describe('request origin guard', () => {
  it.each(['/api/products', '/api/public/terms-consent', '/api/tenants', '/api/public/checkout/session', '/api/public/surveys/feedback/submit', BETTER_AUTH_SIGN_OUT_PATH])('rejects cookie attacks before mutation on %s', async (path) => {
    const { send, mutation } = harness();
    const response = await send(path, { cookie: 'session=valid', origin: 'https://studio.together.test', 'sec-fetch-site': 'same-site' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'forbidden', message: 'Request origin is not allowed' } });
    expect(mutation).not.toHaveBeenCalled();
    expect((await send(path, { cookie: 'session=valid' })).status).toBe(403);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'PROPFIND'])('protects every unsafe method including unclassified routes: %s', async (method) => {
    expect((await harness().send('/api/new-route', { cookie: 'session=valid' }, method)).status).toBe(403);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('leaves %s and OAuth GET callbacks untouched', async (method) => {
    const { send } = harness();
    expect((await send('/api/products', { cookie: 'session=valid', origin: 'null' }, method)).status).toBe(204);
    expect((await send(`${BETTER_AUTH_OAUTH_CALLBACK_PATH_PATTERN.replace(':provider', 'google')}?state=provider-proof`, {}, method)).status).toBe(204);
  });

  it('guards login, two-factor cookies and PWA writes without broad auth exceptions', async () => {
    const { send } = harness();
    expect((await send(BETTER_AUTH_PASSWORD_SIGN_IN_PATH)).status).toBe(403);
    expect((await send(BETTER_AUTH_TWO_FACTOR_TOTP_PATH, { cookie: 'two_factor=challenge', origin: 'https://acme.together.test' })).status).toBe(204);
    expect((await send(BETTER_AUTH_TWO_FACTOR_BACKUP_CODE_PATH, { cookie: 'two_factor=challenge' })).status).toBe(403);
    expect((await send(BETTER_AUTH_OAUTH_CALLBACK_PATH_PATTERN.replace(':provider', 'google'), { cookie: 'session=valid' })).status).toBe(403);
    expect((await send('/api/products', { cookie: 'session=valid', 'sec-fetch-site': 'same-origin', 'user-agent': 'Installed PWA' })).status).toBe(204);
  });

  it('verifies bearer without cookies and prevents fallback to cookie authority', async () => {
    const { send, mutation } = harness();
    expect((await send('/api/products', { authorization: 'Bearer valid' })).status).toBe(204);
    expect((await send('/api/products', { authorization: 'Bearer valid', cookie: 'session=other; together_stripe_test=ambient' })).status).toBe(204);
    expect(mutation).toHaveBeenLastCalledWith(null);
    for (const authorization of ['Bearer invalid', 'Bearer bad.signature', 'Basic valid', 'Bearer ']) {
      expect((await send('/api/products', { authorization, cookie: 'session=valid' })).status).toBe(403);
    }
    expect((await send('/api/products', { 'x-api-key': 'arbitrary', cookie: 'session=valid' })).status).toBe(403);
    expect((await send(BETTER_AUTH_SIGN_OUT_PATH, { authorization: 'Bearer valid', cookie: 'session=valid' })).status).toBe(403);
  });

  it.each([
    ['/api/m2m/enroll', 'api-key'], ['/api/m2m/import/courses', 'api-key'], ['/api/m2m/marketing/contacts', 'api-key'],
    ['/api/webhooks/stripe/acme', 'signature'], ['/api/webhooks/ses/token', 'signature'],
    ['/api/internal/dispatch-email', 'secret'], ['/api/internal/marketing/tick', 'secret'], ['/api/internal/tenants/provision', 'secret'],
    ['/u/token', 'token'], ['/u/token/confirm', 'token'], ['/u/token/all', 'token'], ['/u/token/preferences', 'token'], ['/marketing/confirm/token', 'token'],
    ['/api/public/auth-resolve', 'public'], ['/api/public/checkout/coupon', 'public'],
    ['/api/public/marketing/forms/news/submit', 'public'], ['/api/public/sales-links/offer/checkout', 'public'],
  ])('leaves %s to its own %s authorization, not cookie authority', async (path, policy) => {
    const config = deps({ authPort: { getAuthenticatedUser: vi.fn(async () => { throw new Error('Cookie authority must not be consumed'); }) } });
    expect(requestOriginPolicy('POST', path)).toBe(policy);
    expect((await harness(config).send(path, { cookie: 'session=valid', origin: 'https://external.test' })).status).toBe(204);
    expect(config.authPort.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it.each(['/api/public/checkout/session', '/api/public/surveys/feedback/submit'])('enforces the origin on %s only for a signed-in session', async (path) => {
    const { send, mutation } = harness();
    const foreign = { origin: 'https://external.test', 'sec-fetch-site': 'cross-site' };
    expect((await send(path, foreign)).status).toBe(204);
    expect((await send(path, { origin: 'https://studio.together.test' })).status).toBe(204);
    expect((await send(path, { ...foreign, cookie: 'session=invalid' })).status).toBe(204);
    expect(mutation).toHaveBeenCalledTimes(3);
    const rejected = await send(path, { ...foreign, cookie: 'session=valid' });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({ ok: false, error: { code: 'forbidden', message: 'Request origin is not allowed' } });
    expect(mutation).toHaveBeenCalledTimes(3);
    expect((await send(path)).status).toBe(204);
    expect((await send(path, { cookie: 'session=valid' })).status).toBe(403);
    expect((await send(path, { cookie: 'session=valid', origin: 'https://alias.example.test' })).status).toBe(204);
    expect((await send(path, { cookie: 'session=valid', 'sec-fetch-site': 'same-origin' })).status).toBe(204);
  });

  it('does not turn invalid credentials into authority or exempt neighboring routes', async () => {
    const { send } = harness();
    expect((await send('/api/products', { cookie: 'session=invalid' })).status).toBe(204);
    expect((await send('/api/public/new', { cookie: 'session=valid' })).status).toBe(403);
    expect((await send('/api/internal/new', { cookie: 'session=valid' })).status).toBe(403);
    expect(requestOriginPolicy('DELETE', '/api/m2m/enroll')).toBe('session');
  });

  it('keeps development automation headerless but refuses foreign browser calls', async () => {
    const { send } = harness();
    expect((await send('/api/dev/grant')).status).toBe(204);
    expect((await send('/api/dev/grant', { origin: 'https://evil.test' })).status).toBe(403);
  });
});

describe('origin policy registration coverage', () => {
  it('classifies every contract and pre-identity/public unsafe registration', () => {
    const manifests = [...PUBLIC_ROUTE_MANIFEST, ...SELF_AUTHENTICATING_ROUTE_MANIFEST];
    expect(() => assertRequestOriginCoverage([
      ...Object.values(API_ROUTES),
      ...manifests.flatMap((entry) => entry.methods.map((method) => ({ method, path: entry.path }))),
    ])).not.toThrow();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('requires an explicit classification for a new %s route', (method) => {
    expect(() => assertRequestOriginCoverage([{ method, path: '/api/public/new-mutation' }])).toThrow('Unsafe routes missing origin policy');
    expect(() => assertRequestOriginCoverage([{ method, path: '/api/internal/new-mutation' }])).toThrow('Unsafe routes missing origin policy');
  });
});
