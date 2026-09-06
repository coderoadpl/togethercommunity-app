import type { TenantDomainRepository, TenantRepository } from '../ports.js';
import { createTenantOriginResolver, type TenantUrlDeps } from '../tenant-url.js';

const SES_WEBHOOK_PATH = '/api/webhooks/ses';

export type SesWebhookBaseUrlResolver = (tenantId: string) => Promise<string>;

export interface SesWebhookBaseUrlDeps {
  tenants: TenantRepository;
  tenantDomains: TenantDomainRepository;
  routing: TenantUrlDeps;
}

export const createSesWebhookBaseUrlResolver = (
  deps: SesWebhookBaseUrlDeps,
): SesWebhookBaseUrlResolver => {
  const resolveOrigin = createTenantOriginResolver({ ...deps.routing, ...deps });
  return async (tenantId) => `${await resolveOrigin(tenantId)}${SES_WEBHOOK_PATH}`;
};
