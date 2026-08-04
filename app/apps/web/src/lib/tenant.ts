type TenantLocation = Pick<Location, 'hostname' | 'port' | 'protocol'>;

const configuredAppBaseDomain = (): string | undefined =>
  import.meta.env.VITE_APP_BASE_DOMAIN || undefined;

export const isConfiguredBaseDomainHost = (hostname: string): boolean => {
  const baseDomain = configuredAppBaseDomain();
  return baseDomain !== undefined && hostname.toLowerCase() === baseDomain.toLowerCase();
};

export const usesPlatformAuthSurface = (hostname: string): boolean =>
  configuredAppBaseDomain() === undefined || isConfiguredBaseDomainHost(hostname);

/** Base domain the SPA is served under (e.g. `localhost`, `together.example`). */
export const appBaseDomain = (): string => configuredAppBaseDomain() ?? 'localhost';

const tenantBaseDomain = (hostname: string): string => {
  const configuredBase = configuredAppBaseDomain();
  if (configuredBase !== undefined) return configuredBase;
  const fallbackBase = appBaseDomain();
  const host = hostname.toLowerCase();
  const base = fallbackBase.toLowerCase();
  if (host === base || host.endsWith(`.${base}`)) return fallbackBase;
  const parts = hostname.split('.');
  return parts.length > 2 ? parts.slice(1).join('.') : hostname;
};

export const tenantUrl = (slug: string, location: TenantLocation = window.location): string => {
  const { protocol, hostname, port } = location;
  const base = tenantBaseDomain(hostname);
  return `${protocol}//${slug}.${base}${port ? `:${port}` : ''}`;
};

/**
 * Whether the current host addresses a tenant subdomain (`acme.localhost`)
 * rather than the apex (`localhost`). Mirrors the server's `subdomainOf`, so an
 * unresolved tenant here means a genuine unknown-space 404, not the apex picker.
 */
export const hostHasTenantSubdomain = (hostname: string, baseDomain: string = appBaseDomain()): boolean => {
  const host = hostname.toLowerCase();
  const base = baseDomain.toLowerCase();
  if (host === base) return false;
  if (!host.endsWith(`.${base}`)) return false;
  const sub = host.slice(0, -(base.length + 1));
  return sub.length > 0 && !sub.includes('.');
};

/** Stable accent hue per tenant so each tenant is visibly its own world. */
export const tenantHue = (slug: string): number => {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return Math.round((hash * 137.508) % 360);
};
