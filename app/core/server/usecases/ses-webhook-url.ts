import type { TenantDomainRepository, TenantRepository } from '../ports.js';
import { tenantOriginUrl, type TenantUrlDeps } from '../tenant-url.js';

const SES_WEBHOOK_PATH = '/api/webhooks/ses';

export type SesWebhookBaseUrlResolver = (tenantId: string) => Promise<string>;

export interface SesWebhookBaseUrlDeps {
  tenants: TenantRepository;
  tenantDomains: TenantDomainRepository;
  routing: TenantUrlDeps;
}

export const createSesWebhookBaseUrlResolver = (
  deps: SesWebhookBaseUrlDeps,
): SesWebhookBaseUrlResolver => async (tenantId) => {
  const [tenant, domains] = await Promise.all([
    deps.tenants.findById(tenantId),
    deps.tenantDomains.listByTenant(tenantId),
  ]);
  const custom = domains.find((domain) => domain.kind === 'custom' && domain.verified);
  const origin = tenantOriginUrl({
    slug: tenant?.slug ?? null,
    customDomain: custom?.domain ?? null,
  }, deps.routing);
  return `${origin}${SES_WEBHOOK_PATH}`;
};
