import type { TenantDomain } from '#core/domain/index.js';

import type { TenantDomainRepository, TenantRepository } from './ports.js';

export interface TenantUrlDeps {
  appBaseUrl: string;
  baseDomain: string;
  singleTenantMode: boolean;
}

export const tenantUrl = (
  tenantSlug: string | null,
  pathname: string,
  deps: TenantUrlDeps,
): string => {
  const url = new URL(pathname, deps.appBaseUrl);
  if (!deps.singleTenantMode && tenantSlug !== null) {
    url.hostname = `${tenantSlug}.${deps.baseDomain}`;
  }
  return url.toString();
};

export const customDomainOrigin = (domain: string, deps: TenantUrlDeps): string => {
  const configured = new URL(deps.appBaseUrl);
  const origin = new URL(`https://${domain}`);
  if (configured.protocol === 'https:') origin.port = configured.port;
  return origin.origin;
};

export const tenantOriginUrl = (
  tenant: { slug: string | null; customDomain: string | null },
  deps: TenantUrlDeps,
): string =>
  tenant.customDomain === null
    ? new URL(tenantUrl(tenant.slug, '/', deps)).origin
    : customDomainOrigin(tenant.customDomain, deps);

export const canonicalTenantDomain = (domains: TenantDomain[]): TenantDomain | null =>
  domains.filter((domain) => domain.kind === 'custom' && domain.verified)
    .toSorted((left, right) =>
      (left.verifiedAt ?? left.createdAt).localeCompare(right.verifiedAt ?? right.createdAt)
      || left.domain.localeCompare(right.domain))[0] ?? null;

export interface TenantOriginDeps extends TenantUrlDeps {
  tenantDomains: TenantDomainRepository;
}

export const resolveTenantOrigin = async (
  tenant: { id: string; slug: string | null },
  deps: TenantOriginDeps,
): Promise<string> => tenantOriginUrl({
  slug: tenant.slug,
  customDomain: canonicalTenantDomain(await deps.tenantDomains.listByTenant(tenant.id))?.domain ?? null,
}, deps);

export const createTenantOriginResolver = (
  deps: TenantOriginDeps & { tenants: TenantRepository },
): ((tenantId: string) => Promise<string>) => async (tenantId) => {
  const tenant = await deps.tenants.findById(tenantId);
  return resolveTenantOrigin({ id: tenantId, slug: tenant?.slug ?? null }, deps);
};
