import { describe, expect, it } from 'vitest';

import type { Identity, TenantDomain } from '#core/domain/index.js';

import type { TenantDomainRepository } from '../ports.js';
import { getTenantRouting } from './tenant-domains.js';

const identity: Identity = {
  userId: 'u-1',
  email: 'owner@together.dev',
  name: 'Owner',
  emailVerified: true,
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
};

const domains: TenantDomain[] = [
  { id: 'd-1', tenantId: 't-acme', domain: 'acme.together.example', kind: 'subdomain', verified: true },
  { id: 'd-2', tenantId: 't-acme', domain: 'kurs.coderoad.example', kind: 'custom', verified: true },
  { id: 'd-3', tenantId: 't-acme', domain: 'nowa.coderoad.example', kind: 'custom', verified: false },
];

const tenantDomains: TenantDomainRepository = {
  findByDomain: async (domain) => domains.find((row) => row.domain === domain) ?? null,
  listVerifiedDomains: async () => domains.filter((row) => row.verified),
  listByTenant: async (tenantId) => domains.filter((row) => row.tenantId === tenantId),
};

const deps = {
  tenantDomains,
  routing: {
    appBaseUrl: 'https://start.together.example',
    baseDomain: 'together.example',
    singleTenantMode: false,
  },
  customDomainTarget: 'cname.vercel-dns.com',
};

describe('getTenantRouting', () => {
  it('reports the tenant host with verified and pending custom domains', async () => {
    const result = await getTenantRouting({ identity }, deps);

    expect(result).toEqual({
      ok: true,
      value: {
        tenantHost: 'acme.together.example',
        customDomains: [
          { domain: 'kurs.coderoad.example', verified: true },
          { domain: 'nowa.coderoad.example', verified: false },
        ],
        customDomainTarget: 'cname.vercel-dns.com',
      },
    });
  });

  it('refuses a member without a staff role', async () => {
    const result = await getTenantRouting(
      { identity: { ...identity, staffRole: null, memberId: 'm-1' } },
      deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('refuses a caller that has not selected a tenant', async () => {
    const result = await getTenantRouting(
      { identity: { ...identity, tenantId: null, tenantSlug: null } },
      deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
