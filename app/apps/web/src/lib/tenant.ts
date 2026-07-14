/** URL of a sibling tenant on the same base domain (acme.localhost → studio.localhost). */
export const tenantUrl = (slug: string): string => {
  const { protocol, hostname, port } = window.location;
  const parts = hostname.split('.');
  const base = parts.length > 1 ? parts.slice(1).join('.') : hostname;
  return `${protocol}//${slug}.${base}${port ? `:${port}` : ''}`;
};

/** Base domain the SPA is served under (e.g. `localhost`, `together.com`). */
export const appBaseDomain = (): string => import.meta.env.VITE_APP_BASE_DOMAIN ?? 'localhost';

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
