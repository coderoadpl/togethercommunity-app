import {
  err,
  ok,
  tenantNotFound,
  type AppError,
  type Result,
  type Tenant,
  type TenantDomain,
} from '#core/domain/index.js';

import type { TenantDomainRepository, TenantRepository } from '../ports.js';
import { tenantUrl, type TenantUrlDeps } from '../tenant-url.js';

export interface ResolveTenantDeps {
  tenantDomains: TenantDomainRepository;
  tenants: TenantRepository;
  baseDomain: string;
  platformHost: string | null;
  singleTenantMode: boolean;
}

type TenantSource = 'custom-domain' | 'subdomain' | 'tenant-header' | 'single-tenant';

export interface ResolvedTenant {
  tenant: Tenant;
  source: TenantSource;
  domain?: TenantDomain;
}

const customDomainOrigin = (domain: string, routing: TenantUrlDeps): string => {
  const configured = new URL(routing.appBaseUrl);
  const origin = new URL(`https://${domain}`);
  if (configured.protocol === 'https:') origin.port = configured.port;
  return origin.origin;
};

export const authLinkBaseUrl = (
  resolved: ResolvedTenant | null,
  routing: TenantUrlDeps,
): string => {
  if (resolved === null) return routing.appBaseUrl;
  const { domain } = resolved;
  if (domain?.kind === 'custom') {
    return domain.verified ? customDomainOrigin(domain.domain, routing) : routing.appBaseUrl;
  }
  if (resolved.source === 'subdomain' || domain?.kind === 'subdomain') {
    return new URL(tenantUrl(resolved.tenant.slug, '/', routing)).origin;
  }
  return routing.appBaseUrl;
};

const stripPort = (host: string): string => host.split(':')[0] ?? host;

const resolvedIfActive = (
  tenant: Tenant,
  source: TenantSource,
  domain?: TenantDomain,
): Result<ResolvedTenant, AppError> =>
  tenant.status === 'active'
    ? ok({ tenant, source, ...(domain === undefined ? {} : { domain }) })
    : err(tenantNotFound());

const tenantNotFoundMessage = (slug: string): string =>
  `No tenant "${slug}" or you do not have access to it`;

export const resolveTenant = async (
  hostHeader: string,
  tenantHeader: string | null,
  deps: ResolveTenantDeps,
): Promise<Result<ResolvedTenant | null, AppError>> => {
  const host = stripPort(hostHeader).toLowerCase();
  if (deps.platformHost !== null && host === deps.platformHost.toLowerCase()) return ok(null);

  const customDomain = await deps.tenantDomains.findByDomain(host);
  if (customDomain) {
    const tenant = await deps.tenants.findById(customDomain.tenantId);
    return tenant
      ? resolvedIfActive(tenant, 'custom-domain', customDomain)
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
