import { describe, expect, it } from 'vitest';

import type { Tenant, TenantDomain } from '#core/domain/index.js';

import type { TenantDomainRepository, TenantRepository } from '../ports.js';
import { resolveTenant } from './resolve-tenant.js';

const acme: Tenant = { id: 't-acme', slug: 'acme', name: 'Acme', contentVersion: 3 };
const globex: Tenant = { id: 't-globex', slug: 'globex', name: 'Globex', contentVersion: 5 };

const fakeDomains = (domains: TenantDomain[]): TenantDomainRepository => ({
  findByDomain: async (domain) => domains.find((candidate) => candidate.domain === domain) ?? null,
  listVerifiedDomains: async () => domains,
});

const fakeTenants = (tenantList: Tenant[]): TenantRepository => ({
  findById: async (tenantId) => tenantList.find((tenant) => tenant.id === tenantId) ?? null,
  findBySlug: async (slug) => tenantList.find((tenant) => tenant.slug === slug) ?? null,
  findSettings: async () => ({ billingPortalUrl: null, bunnyStreamLibraryId: null, logoUrl: null, accentColor: null, faviconUrl: null, termsUrl: null, privacyUrl: null }),
  updateSettings: async (_tenantId, settings) => settings,
  createTenantWithOwnerGrant: async (input) => ({
    id: input.tenant.id,
    slug: input.tenant.slug,
    name: input.tenant.name,
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
    });

    expect(result).toMatchObject({
      ok: true,
      value: { tenant: { id: 't-acme' }, source: 'custom-domain' },
    });
  });

  it('resolves subdomain and tenant header slugs', async () => {
    const deps = {
      tenantDomains: fakeDomains([]),
      tenants: fakeTenants([acme, globex]),
      baseDomain: 'localhost',
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
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found', message: 'No tenant "missing" or you do not have access to it' },
    });
  });
});
