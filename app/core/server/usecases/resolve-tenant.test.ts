import { describe, expect, it } from 'vitest';

import type { Tenant, TenantDomain } from '#core/domain/index.js';

import type { TenantDomainRepository, TenantRepository } from '../ports.js';
import { authLinkBaseUrl, resolveTenant } from './resolve-tenant.js';

const acme: Tenant = {
  id: 't-acme',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'self_hosted',
  contentVersion: 3,
};
const globex: Tenant = {
  id: 't-globex',
  slug: 'globex',
  name: 'Globex',
  status: 'active',
  plan: 'hosted',
  contentVersion: 5,
};

const fakeDomains = (domains: TenantDomain[]): TenantDomainRepository => ({
  findByDomain: async (domain) => domains.find((candidate) => candidate.domain === domain) ?? null,
  listVerifiedDomains: async () => domains,
  listByTenant: async (tenantId) => domains.filter((candidate) => candidate.tenantId === tenantId),
});

const fakeTenants = (tenantList: Tenant[]): TenantRepository => ({
  findById: async (tenantId) => tenantList.find((tenant) => tenant.id === tenantId) ?? null,
  findBySlug: async (slug) => tenantList.find((tenant) => tenant.slug === slug) ?? null,
  findSole: async () => tenantList.length === 1 ? tenantList[0] ?? null : null,
  hasAny: async () => tenantList.length > 0,
  findSettings: async () => ({
    name: 'Acme', socialLinks: [],
    billingPortalUrl: null, bunnyStreamLibraryId: null, bunnyStreamCdnHostname: null, logoUrl: null, logoDarkUrl: null,
    accentColor: null, faviconUrl: null, ogTitle: null, ogDescription: null,
    ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
    privacyUrl: null,
    defaultHomeSpaceId: null,
  }),
  updateSettings: async (_tenantId, settings) => settings,
  createTenantWithOwnerGrant: async (input) => ({
    id: input.tenant.id,
    slug: input.tenant.slug,
    name: input.tenant.name,
    status: 'active',
    plan: 'self_hosted',
    contentVersion: 1,
  }),
});

describe('resolveTenant', () => {
  it('prefers a verified custom domain', async () => {
    const domain: TenantDomain = {
      id: 'domain-acme',
      tenantId: 't-acme',
      domain: 'offer.example.com',
      kind: 'custom',
      verified: true,
    };

    const result = await resolveTenant('offer.example.com:48730', 'globex', {
      tenantDomains: fakeDomains([domain]),
      tenants: fakeTenants([acme, globex]),
      baseDomain: 'localhost',
      platformHost: 'start.localhost',
      singleTenantMode: false,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { tenant: { id: 't-acme' }, source: 'custom-domain' },
    });
  });

  it('exposes the matched custom domain so link generation can gate on verification', async () => {
    const domain: TenantDomain = {
      id: 'domain-acme',
      tenantId: 't-acme',
      domain: 'offer.example.com',
      kind: 'custom',
      verified: true,
    };

    const result = await resolveTenant('offer.example.com:48730', null, {
      tenantDomains: fakeDomains([domain]),
      tenants: fakeTenants([acme]),
      baseDomain: 'localhost',
      platformHost: 'start.localhost',
      singleTenantMode: false,
    });

    expect(result).toEqual({ ok: true, value: { tenant: acme, source: 'custom-domain', domain } });
  });

  it('resolves subdomain and tenant header slugs', async () => {
    const deps = {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([acme, globex]),
      baseDomain: 'localhost',
      platformHost: 'start.localhost',
      singleTenantMode: false,
    };

    await expect(resolveTenant('acme.localhost:48730', null, deps)).resolves.toMatchObject({
      ok: true,
      value: { tenant: { id: 't-acme' }, source: 'subdomain' },
    });
    await expect(resolveTenant('localhost:48730', 'globex', deps)).resolves.toMatchObject({
      ok: true,
      value: { tenant: { id: 't-globex' }, source: 'tenant-header' },
    });
  });

  it('returns a tenant_not_found error for unknown slug tenants', async () => {
    const result = await resolveTenant('missing.localhost', null, {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([acme]),
      baseDomain: 'localhost',
      platformHost: 'start.localhost',
      singleTenantMode: false,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found', message: 'No tenant "missing" or you do not have access to it' },
    });
  });

  it('resolves the sole tenant on localhost in single-tenant mode', async () => {
    const result = await resolveTenant('localhost:48730', null, {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([acme]),
      baseDomain: 'localhost',
      platformHost: null,
      singleTenantMode: true,
    });

    expect(result).toEqual({
      ok: true,
      value: { tenant: acme, source: 'single-tenant' },
    });
  });

  it('does not guess a tenant when single-tenant mode has multiple tenants', async () => {
    const result = await resolveTenant('localhost:48730', null, {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([acme, globex]),
      baseDomain: 'localhost',
      platformHost: null,
      singleTenantMode: true,
    });

    expect(result).toEqual({ ok: true, value: null });
  });

  it.each([
    ['subdomain', 'missing.localhost', null],
    ['tenant header', 'localhost', 'missing'],
  ])('rejects an unknown %s instead of using the sole tenant', async (_source, host, header) => {
    const result = await resolveTenant(host, header, {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([acme]),
      baseDomain: 'localhost',
      platformHost: null,
      singleTenantMode: true,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });

  it('refuses suspended tenants during resolution', async () => {
    const suspended: Tenant = { ...acme, status: 'suspended' };
    const result = await resolveTenant('acme.localhost', null, {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([suspended]),
      baseDomain: 'localhost',
      platformHost: 'start.localhost',
      singleTenantMode: false,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'tenant_not_found', message: 'Unknown tenant' },
    });
  });

  it('refuses a suspended tenant resolved through a custom domain', async () => {
    const suspended: Tenant = { ...acme, status: 'suspended' };
    const result = await resolveTenant('learn.example.com', null, {
      tenantDomains: fakeDomains([{
        id: 'domain-acme',
        tenantId: acme.id,
        domain: 'learn.example.com',
        kind: 'custom',
        verified: true,
      }]),
      tenants: fakeTenants([suspended]),
      baseDomain: 'localhost',
      platformHost: 'start.localhost',
      singleTenantMode: false,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'tenant_not_found', message: 'Unknown tenant' },
    });
  });

  it('returns the no-tenant platform result on the derived start host', async () => {
    const result = await resolveTenant('START.TOGETHERCOMMUNITY.APP:443', 'acme', {
      tenantDomains: fakeDomains([{
        id: 'domain-acme',
        tenantId: acme.id,
        domain: 'start.togethercommunity.app',
        kind: 'custom',
        verified: true,
      }]),
      tenants: fakeTenants([acme]),
      baseDomain: 'togethercommunity.app',
      platformHost: 'start.togethercommunity.app',
      singleTenantMode: false,
    });

    expect(result).toEqual({ ok: true, value: null });
  });

  it('keeps tenant subdomain resolution unchanged beside the platform host', async () => {
    const result = await resolveTenant('acme.togethercommunity.app', null, {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([acme]),
      baseDomain: 'togethercommunity.app',
      platformHost: 'start.togethercommunity.app',
      singleTenantMode: false,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { tenant: { id: 't-acme' }, source: 'subdomain' },
    });
  });

  it('keeps the staging base host as a no-tenant platform surface', async () => {
    const result = await resolveTenant('staging.togethercommunity.app', null, {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([acme]),
      baseDomain: 'staging.togethercommunity.app',
      platformHost: 'start.staging.togethercommunity.app',
      singleTenantMode: false,
    });

    expect(result).toEqual({ ok: true, value: null });
  });
});

describe('authLinkBaseUrl', () => {
  const routing = {
    appBaseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
  };
  const customDomain: TenantDomain = {
    id: 'domain-acme',
    tenantId: acme.id,
    domain: 'learn.acme.example',
    kind: 'custom',
    verified: true,
  };

  it('uses the tenant subdomain origin for subdomain routing', () => {
    expect(authLinkBaseUrl({ tenant: acme, source: 'subdomain' }, routing))
      .toBe('http://acme.localhost:48730');
  });

  it('uses the verified custom domain over HTTPS', () => {
    expect(authLinkBaseUrl({ tenant: acme, source: 'custom-domain', domain: customDomain }, routing))
      .toBe('https://learn.acme.example');
  });

  it('keeps the configured HTTPS port on the verified custom domain', () => {
    expect(authLinkBaseUrl(
      { tenant: acme, source: 'custom-domain', domain: customDomain },
      { ...routing, appBaseUrl: 'https://start.example:8443', baseDomain: 'example' },
    )).toBe('https://learn.acme.example:8443');
  });

  it('routes a subdomain domain row through the configured tenant URL', () => {
    const subdomainRow: TenantDomain = {
      ...customDomain,
      domain: 'acme.localhost',
      kind: 'subdomain',
    };

    expect(authLinkBaseUrl({ tenant: acme, source: 'custom-domain', domain: subdomainRow }, routing))
      .toBe('http://acme.localhost:48730');
  });

  it.each([
    ['an unresolved host', null],
    ['tenant-header routing', { tenant: acme, source: 'tenant-header' as const }],
    ['single-tenant routing', { tenant: acme, source: 'single-tenant' as const }],
    [
      'an unverified custom domain',
      {
        tenant: acme,
        source: 'custom-domain' as const,
        domain: { ...customDomain, verified: false },
      },
    ],
  ])('falls back to the configured base URL for %s', (_case, resolved) => {
    expect(authLinkBaseUrl(resolved, routing)).toBe('http://localhost:48730');
  });

  it('keeps the configured base URL in single-tenant mode', () => {
    expect(authLinkBaseUrl(
      { tenant: acme, source: 'subdomain' },
      { ...routing, singleTenantMode: true },
    )).toBe('http://localhost:48730');
  });
});
