import type { AppDeps } from './composition.js';

const normalizedHost = (host: string): string =>
  (host.split(':')[0] ?? '').toLowerCase().replace(/\.+$/, '');

export const checkoutAnalyticsTenant = async (
  hostHeader: string,
  deps: Pick<AppDeps, 'baseDomain' | 'appBaseUrl' | 'platformHost' | 'tenantDomains' | 'tenants'>,
): Promise<string | null> => {
  const host = normalizedHost(hostHeader);
  const reservedHosts = [deps.baseDomain, new URL(deps.appBaseUrl).hostname, deps.platformHost ?? '']
    .map(normalizedHost).filter(Boolean);
  if (host === '' || hostHeader.split(':')[0]?.endsWith('.')
    || reservedHosts.some((reserved) => host === reserved || host.endsWith(`.${reserved}`) || reserved.endsWith(`.${host}`))) return null;
  const domain = await deps.tenantDomains.findByDomain(host);
  if (domain?.kind !== 'custom' || !domain.verified) return null;
  const tenant = await deps.tenants.findById(domain.tenantId);
  return tenant?.status === 'active' ? tenant.id : null;
};
