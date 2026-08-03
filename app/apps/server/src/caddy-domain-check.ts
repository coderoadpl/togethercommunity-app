import { Hono } from 'hono';
import { z } from 'zod';

import type { TenantDomainRepository, TenantRepository } from '#core/server/index.js';

const domainSchema = z.string().trim().min(1).max(253).regex(/^[a-z0-9.-]+$/);

export interface CaddyDomainCheckConfig {
  appBaseUrl: string;
  baseDomain: string;
  singleTenantMode: boolean;
}

const isConfiguredHost = (domain: string, config: CaddyDomainCheckConfig): boolean => {
  if (domain === new URL(config.appBaseUrl).hostname) return true;
  if (config.singleTenantMode) return false;
  return domain === config.baseDomain;
};

const tenantSlugForHost = (domain: string, config: CaddyDomainCheckConfig): string | null => {
  if (config.singleTenantMode) return null;
  if (!domain.endsWith(`.${config.baseDomain}`)) return null;
  const subdomain = domain.slice(0, -(config.baseDomain.length + 1));
  return subdomain.length > 0 && !subdomain.includes('.') ? subdomain : null;
};

export const buildCaddyDomainCheckApp = (
  tenantDomains: TenantDomainRepository,
  tenants: Pick<TenantRepository, 'findBySlug'>,
  config: CaddyDomainCheckConfig,
) => {
  const app = new Hono();

  app.get('/internal/domain-check', async (context) => {
    const parsed = domainSchema.safeParse(context.req.query('domain')?.toLowerCase());
    if (!parsed.success) return context.body(null, 400);
    if (isConfiguredHost(parsed.data, config)) return context.body(null, 204);
    const tenantSlug = tenantSlugForHost(parsed.data, config);
    if (tenantSlug !== null) {
      const tenant = await tenants.findBySlug(tenantSlug);
      return context.body(null, tenant === null ? 404 : 204);
    }
    const domain = await tenantDomains.findByDomain(parsed.data);
    return context.body(null, domain?.verified === true ? 204 : 404);
  });

  return app;
};
