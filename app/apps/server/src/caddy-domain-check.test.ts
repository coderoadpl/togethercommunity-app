import { describe, expect, it } from 'vitest';

import type { Tenant, TenantDomain } from '#core/domain/index.js';
import type { TenantDomainRepository, TenantRepository } from '#core/server/index.js';

import { buildCaddyDomainCheckApp } from './caddy-domain-check.js';

const verified: TenantDomain = {
  id: 'domain-1',
  tenantId: 'tenant-1',
  domain: 'courses.example.com',
  kind: 'custom',
  verified: true,
};

const unverified: TenantDomain = {
  ...verified,
  id: 'domain-2',
  domain: 'pending.example.com',
  verified: false,
};

const repository: TenantDomainRepository = {
  findByDomain: async (domain) =>
    [verified, unverified].find((candidate) => candidate.domain === domain) ?? null,
  listVerifiedDomains: async () => [verified],
};

const tenant: Tenant = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'self_hosted',
  contentVersion: 1,
};

const tenants: Pick<TenantRepository, 'findBySlug'> = {
  findBySlug: async (slug) => slug === tenant.slug ? tenant : null,
};

const singleTenantConfig = {
  appBaseUrl: 'https://community.example.com',
  baseDomain: 'community.example.com',
  singleTenantMode: true,
};

describe('Caddy domain check', () => {
  it('allows only a verified tenant domain', async () => {
    const app = buildCaddyDomainCheckApp(repository, tenants, singleTenantConfig);

    expect((await app.request('/internal/domain-check?domain=COURSES.EXAMPLE.COM')).status).toBe(204);
    expect((await app.request('/internal/domain-check?domain=pending.example.com')).status).toBe(404);
    expect((await app.request('/internal/domain-check?domain=unknown.example.com')).status).toBe(404);
  });

  it('allows the configured public host and one-level tenant subdomains', async () => {
    const singleTenant = buildCaddyDomainCheckApp(repository, tenants, singleTenantConfig);
    const multiTenant = buildCaddyDomainCheckApp(repository, tenants, {
      appBaseUrl: 'https://together.example.com',
      baseDomain: 'example.com',
      singleTenantMode: false,
    });

    expect((await singleTenant.request('/internal/domain-check?domain=community.example.com')).status).toBe(204);
    expect((await multiTenant.request('/internal/domain-check?domain=example.com')).status).toBe(204);
    expect((await multiTenant.request('/internal/domain-check?domain=acme.example.com')).status).toBe(204);
    expect((await multiTenant.request('/internal/domain-check?domain=unknown.example.com')).status).toBe(404);
    expect((await multiTenant.request('/internal/domain-check?domain=nested.acme.example.com')).status).toBe(404);
  });

  it('rejects missing and malformed hostnames', async () => {
    const app = buildCaddyDomainCheckApp(repository, tenants, singleTenantConfig);

    expect((await app.request('/internal/domain-check')).status).toBe(400);
    expect((await app.request('/internal/domain-check?domain=https%3A%2F%2Fcourses.example.com')).status).toBe(400);
  });
});
