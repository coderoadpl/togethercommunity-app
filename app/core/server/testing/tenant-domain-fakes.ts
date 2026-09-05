import type { TenantDomain } from '#core/domain/index.js';

import type { TenantDomainRepository } from '../ports.js';

export const tenantDomainFixture = (
  overrides: Partial<TenantDomain> & Pick<TenantDomain, 'id' | 'tenantId' | 'domain'>,
): TenantDomain => ({
  kind: 'custom',
  verified: false,
  provider: 'manual',
  verification: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  verifiedAt: null,
  lastCheckedAt: null,
  lastError: null,
  ...overrides,
});

export const createInMemoryTenantDomainRepository = (
  rows: TenantDomain[] = [],
): TenantDomainRepository => ({
  findByDomain: async (domain) => rows.find((row) => row.domain === domain && row.verified) ?? null,
  findAnyByDomain: async (domain) => rows.find((row) => row.domain === domain) ?? null,
  listVerifiedDomains: async () => rows.filter((row) => row.verified),
  listByTenant: async (tenantId) =>
    rows
      .filter((row) => row.tenantId === tenantId)
      .toSorted((left, right) => left.domain.localeCompare(right.domain)),
  insert: async (tenantId, domain) => {
    if (rows.some((row) => row.domain === domain.domain)) return null;
    const row = { ...domain, tenantId };
    rows.push(row);
    return row;
  },
  patch: async (tenantId, id, patch) => {
    const index = rows.findIndex((row) => row.tenantId === tenantId && row.id === id);
    const existing = rows[index];
    if (existing === undefined) return null;
    const next = { ...existing, ...patch };
    rows[index] = next;
    return next;
  },
  markVerified: async (tenantId, id, patch) => {
    const index = rows.findIndex(
      (row) => row.tenantId === tenantId && row.id === id && !row.verified,
    );
    const existing = rows[index];
    if (existing === undefined) return null;
    const next = { ...existing, ...patch, verified: true };
    rows[index] = next;
    return next;
  },
  remove: async (tenantId, id) => {
    const index = rows.findIndex((row) => row.tenantId === tenantId && row.id === id);
    if (index === -1) return false;
    rows.splice(index, 1);
    return true;
  },
  listOldestPendingPerTenant: async (limit) => {
    const seen = new Set<string>();
    return rows
      .filter((row) => row.kind === 'custom' && !row.verified)
      .toSorted((left, right) => (left.lastCheckedAt ?? '').localeCompare(right.lastCheckedAt ?? ''))
      .filter((row) => {
        if (seen.has(row.tenantId)) return false;
        seen.add(row.tenantId);
        return true;
      })
      .slice(0, limit);
  },
});

export const tenantDomainRepositoryStub = (
  overrides: Partial<TenantDomainRepository>,
): TenantDomainRepository => ({ ...createInMemoryTenantDomainRepository(), ...overrides });
