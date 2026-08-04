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
