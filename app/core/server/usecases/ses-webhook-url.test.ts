import { describe, expect, it } from 'vitest';

import type { Tenant, TenantDomain } from '#core/domain/index.js';

import type { TenantDomainRepository, TenantRepository } from '../ports.js';
import { createSesWebhookBaseUrlResolver } from './ses-webhook-url.js';

const acme: Tenant = {
  id: 't-acme',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'hosted',
  contentVersion: 1,
};

const fakeTenants: TenantRepository = {
  findById: async (tenantId) => tenantId === acme.id ? acme : null,
  findBySlug: async (slug) => slug === acme.slug ? acme : null,
  findSole: async () => acme,
  hasAny: async () => true,
  findSettings: async () => null,
  updateSettings: async (_tenantId, settings) => settings,
  createTenantWithOwnerGrant: async () => acme,
};

const fakeDomains = (domains: TenantDomain[]): TenantDomainRepository => ({
  findByDomain: async (domain) => domains.find((candidate) => candidate.domain === domain) ?? null,
  listVerifiedDomains: async () => domains.filter((candidate) => candidate.verified),
  listByTenant: async (tenantId) => domains.filter((candidate) => candidate.tenantId === tenantId),
});

const customDomain = (overrides: Partial<TenantDomain> = {}): TenantDomain => ({
  id: 'domain-acme',
  tenantId: 't-acme',
  domain: 'community.acme.test',
  kind: 'custom',
  verified: true,
  ...overrides,
});

const routing = {
  appBaseUrl: 'https://togethercommunity.app',
  baseDomain: 'togethercommunity.app',
  singleTenantMode: false,
};

describe('SES webhook base URL', () => {
  it('uses the tenant subdomain instead of the platform apex', async () => {
    const resolve = createSesWebhookBaseUrlResolver({
      tenants: fakeTenants,
      tenantDomains: fakeDomains([]),
      routing,
    });

    expect(await resolve('t-acme')).toBe('https://acme.togethercommunity.app/api/webhooks/ses');
  });

  it('prefers a verified custom domain', async () => {
    const resolve = createSesWebhookBaseUrlResolver({
      tenants: fakeTenants,
      tenantDomains: fakeDomains([customDomain()]),
      routing,
    });

    expect(await resolve('t-acme')).toBe('https://community.acme.test/api/webhooks/ses');
  });

  it('ignores an unverified custom domain', async () => {
    const resolve = createSesWebhookBaseUrlResolver({
      tenants: fakeTenants,
      tenantDomains: fakeDomains([customDomain({ verified: false })]),
      routing,
    });

    expect(await resolve('t-acme')).toBe('https://acme.togethercommunity.app/api/webhooks/ses');
  });

  it('keeps the configured base URL in single-tenant mode', async () => {
    const resolve = createSesWebhookBaseUrlResolver({
      tenants: fakeTenants,
      tenantDomains: fakeDomains([]),
      routing: { ...routing, appBaseUrl: 'http://localhost:48730', singleTenantMode: true },
    });

    expect(await resolve('t-acme')).toBe('http://localhost:48730/api/webhooks/ses');
  });
});
