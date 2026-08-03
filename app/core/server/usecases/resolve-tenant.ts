import {
  err,
  ok,
  tenantNotFound,
  type AppError,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type { TenantDomainRepository, TenantRepository } from '../ports.js';

export interface ResolveTenantDeps {
  tenantDomains: TenantDomainRepository;
  tenants: TenantRepository;
  baseDomain: string;
  singleTenantMode: boolean;
}

export type TenantSource = 'custom-domain' | 'subdomain' | 'tenant-header' | 'single-tenant';

export interface ResolvedTenant {
  tenant: Tenant;
  source: TenantSource;
}

const stripPort = (host: string): string => host.split(':')[0] ?? host;

const resolvedIfActive = (
  tenant: Tenant,
  source: TenantSource,
): Result<ResolvedTenant, AppError> =>
  tenant.status === 'active'
    ? ok({ tenant, source })
    : err(tenantNotFound());

export const tenantNotFoundMessage = (slug: string): string =>
  `No tenant "${slug}" or you do not have access to it`;

export const resolveTenant = async (
  hostHeader: string,
  tenantHeader: string | null,
  deps: ResolveTenantDeps,
): Promise<Result<ResolvedTenant | null, AppError>> => {
  const host = stripPort(hostHeader).toLowerCase();

  const customDomain = await deps.tenantDomains.findByDomain(host);
  if (customDomain) {
    const tenant = await deps.tenants.findById(customDomain.tenantId);
    return tenant
      ? resolvedIfActive(tenant, 'custom-domain')
      : err(tenantNotFound('Tenant domain is not attached'));
  }

  const subdomain = subdomainOf(host, deps.baseDomain);
  const slug = subdomain ?? tenantHeader?.toLowerCase() ?? null;
  if (!slug) {
    if (!deps.singleTenantMode) return ok(null);
    const tenant = await deps.tenants.findSole();
    return tenant ? resolvedIfActive(tenant, 'single-tenant') : ok(null);
  }

  const tenant = await deps.tenants.findBySlug(slug);
  if (!tenant) return err(tenantNotFound(tenantNotFoundMessage(slug)));
  return resolvedIfActive(tenant, subdomain ? 'subdomain' : 'tenant-header');
};

const subdomainOf = (host: string, baseDomain: string): string | null => {
  if (host === baseDomain) return null;
  if (!host.endsWith(`.${baseDomain}`)) return null;
  const sub = host.slice(0, -(baseDomain.length + 1));
  if (sub.includes('.')) return null;
  return sub;
};
