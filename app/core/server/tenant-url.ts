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
