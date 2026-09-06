import { describe, expect, it } from 'vitest';

import { createInMemoryTenantDomainRepository, tenantDomainFixture } from './testing/tenant-domain-fakes.js';
import { resolveTenantOrigin } from './tenant-url.js';

const tenant = { id: 'tenant-1', slug: 'acme' };
const routing = { appBaseUrl: 'https://start.example.org', baseDomain: 'example.org', singleTenantMode: false };
const domain = (id: string, host: string, verifiedAt: string | null, verified = true) =>
  tenantDomainFixture({ id, tenantId: tenant.id, domain: host, verified, verifiedAt });

const older = domain('older', 'courses.example.org', '2026-09-01T00:00:00.000Z');
const newer = domain('newer', 'academy.example.org', '2026-09-02T00:00:00.000Z');

describe('resolveTenantOrigin', () => {
  it.each([
    { name: 'no domains', domains: [], origin: 'https://acme.example.org' },
    { name: 'one active domain', domains: [older], origin: 'https://courses.example.org' },
    { name: 'several active domains in reverse verification order', domains: [newer, older], origin: 'https://courses.example.org' },
    { name: 'pending domains', domains: [domain('pending', 'pending.example.org', null, false)], origin: 'https://acme.example.org' },
    { name: 'pending before active', domains: [domain('pending', 'pending.example.org', null, false), newer], origin: 'https://academy.example.org' },
    { name: 'equal timestamps', domains: [older, { ...newer, verifiedAt: older.verifiedAt }], origin: 'https://academy.example.org' },
    { name: 'legacy verified row without timestamp', domains: [newer, { ...older, verifiedAt: null }], origin: 'https://courses.example.org' },
    { name: 'verified subdomain row', domains: [{ ...older, kind: 'subdomain' as const }], origin: 'https://acme.example.org' },
    { name: 'another tenant domain', domains: [{ ...older, tenantId: 'tenant-2' }], origin: 'https://acme.example.org' },
  ])('$name', async ({ domains, origin }) => {
    expect(await resolveTenantOrigin(tenant, { ...routing, tenantDomains: createInMemoryTenantDomainRepository(domains) })).toBe(origin);
  });

  it('uses the configured origin in single-tenant mode without an active custom domain', async () => {
    expect(await resolveTenantOrigin(tenant, {
      ...routing, singleTenantMode: true, tenantDomains: createInMemoryTenantDomainRepository(),
    })).toBe(routing.appBaseUrl);
  });
});
