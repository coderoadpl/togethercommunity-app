import { describe, expect, it } from 'vitest';

import type { Tenant, TenantDomain } from '#core/domain/index.js';

import type { TenantDomainRepository, TenantRepository } from '../ports.js';
import { resolveTenant } from './resolve-tenant.js';

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
});

const fakeTenants = (tenantList: Tenant[]): TenantRepository => ({
  findById: async (tenantId) => tenantList.find((tenant) => tenant.id === tenantId) ?? null,
  findBySlug: async (slug) => tenantList.find((tenant) => tenant.slug === slug) ?? null,
  findSole: async () => tenantList.length === 1 ? tenantList[0] ?? null : null,
  findSettings: async () => ({
    billingPortalUrl: null, bunnyStreamLibraryId: null, logoUrl: null,
    accentColor: null, faviconUrl: null, ogTitle: null, ogDescription: null,
    ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
    privacyUrl: null,
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
      singleTenantMode: false,
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
      singleTenantMode: false,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'tenant_not_found', message: 'Unknown tenant' },
    });
  });
});
