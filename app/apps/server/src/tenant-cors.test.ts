import { describe, expect, it } from 'vitest';

import type { TenantDomain } from '#core/domain/index.js';
import { tenantDomainFixture, tenantDomainRepositoryStub } from '#core/server/testing/tenant-domain-fakes.js';

import { isTenantScopedOrigin, type TenantCorsDeps } from './tenant-cors.js';

const domain = (input: Partial<TenantDomain> & { domain: string }): TenantDomain =>
  tenantDomainFixture({
    id: `domain-${input.domain}`,
    tenantId: 't-acme',
    verified: true,
    ...input,
  });

const deps = (domains: TenantDomain[] = [], overrides: Partial<TenantCorsDeps> = {}): TenantCorsDeps => ({
  tenantDomains: tenantDomainRepositoryStub({
    findByDomain: async (host) => domains.find((candidate) => candidate.domain === host) ?? null,
    listVerifiedDomains: async () => domains.filter((candidate) => candidate.verified),
    listByTenant: async (tenantId) => domains.filter((candidate) => candidate.tenantId === tenantId),
  }),
  baseDomain: 'together.test',
  platformHost: 'start.together.test',
  appBaseUrl: 'https://start.together.test',
  ...overrides,
});

describe('isTenantScopedOrigin', () => {
  it('accepts the platform host and tenant subdomains', async () => {
    expect(await isTenantScopedOrigin('https://start.together.test', deps())).toBe(true);
    expect(await isTenantScopedOrigin('https://acme.together.test', deps())).toBe(true);
    expect(await isTenantScopedOrigin('https://ACME.together.test', deps())).toBe(true);
  });

  it('rejects nested labels, the bare base domain and lookalike suffixes', async () => {
    expect(await isTenantScopedOrigin('https://a.acme.together.test', deps())).toBe(false);
    expect(await isTenantScopedOrigin('https://together.test', deps())).toBe(false);
    expect(await isTenantScopedOrigin('https://acme.together.test.evil.example', deps())).toBe(false);
    expect(await isTenantScopedOrigin('https://eviltogether.test', deps())).toBe(false);
  });

  it('accepts a verified custom domain and rejects an unverified or subdomain row', async () => {
    const rows = [
      domain({ domain: 'kurs.acme.example' }),
      domain({ domain: 'pending.acme.example', verified: false }),
      domain({ domain: 'acme.together.test', kind: 'subdomain' }),
    ];

    expect(await isTenantScopedOrigin('https://kurs.acme.example', deps(rows))).toBe(true);
    expect(await isTenantScopedOrigin('https://pending.acme.example', deps(rows))).toBe(false);
    expect(await isTenantScopedOrigin('https://other.example', deps(rows))).toBe(false);
  });

  it('refuses plaintext and unparseable origins when the app runs on https', async () => {
    expect(await isTenantScopedOrigin('http://acme.together.test', deps())).toBe(false);
    expect(await isTenantScopedOrigin('null', deps())).toBe(false);
    expect(await isTenantScopedOrigin('', deps())).toBe(false);
  });

  it('allows the local scheme when the app itself is served over http', async () => {
    const local = deps([], {
      baseDomain: 'localhost',
      platformHost: 'start.localhost',
      appBaseUrl: 'http://localhost:48730',
    });

    expect(await isTenantScopedOrigin('http://acme.localhost:48730', local)).toBe(true);
    expect(await isTenantScopedOrigin('http://localhost:48730', local)).toBe(true);
    expect(await isTenantScopedOrigin('ftp://acme.localhost', local)).toBe(false);
  });
});
