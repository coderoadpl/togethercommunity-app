import type { TenantRepository } from '../ports.js';
import { tenantUrl, type TenantUrlDeps } from '../tenant-url.js';

const SES_WEBHOOK_PATH = '/api/webhooks/ses';

export type SesWebhookBaseUrlResolver = (tenantId: string) => Promise<string>;

export interface SesWebhookBaseUrlDeps {
  tenants: TenantRepository;
  routing: TenantUrlDeps;
}

export const createSesWebhookBaseUrlResolver = (
  deps: SesWebhookBaseUrlDeps,
): SesWebhookBaseUrlResolver => {
  return async (tenantId) => {
    const tenant = await deps.tenants.findById(tenantId);
    return `${new URL(tenantUrl(tenant?.slug ?? null, '/', deps.routing)).origin}${SES_WEBHOOK_PATH}`;
  };
};
