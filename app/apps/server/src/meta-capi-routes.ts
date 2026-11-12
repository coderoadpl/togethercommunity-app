import type { Hono } from 'hono';
import { API_PATHS, TENANT_HEADER, metaCapiDecisionSchema, metaCapiWithdrawSchema } from '#core/contract/index.js';
import { err, forbidden, internal, tenantNotFound, validation } from '#core/domain/index.js';
import { listMetaCapiConsents, listMetaCapiEvents, recordPublicMetaCapiConsent, resolveTenant, withdrawMetaCapiConsent } from '#core/server/index.js';
import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { trustedClientIp } from './auth-network.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

const sameOrigin = (request: Request): boolean => {
  const origin = request.headers.get('origin');
  return origin === null || (URL.canParse(origin) && new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host));
};

export const registerPublicMetaCapiRoutes = (app: Hono<AppVars>, deps: Pick<AppDeps, 'metaCapi' | 'tenants' | 'tenantDomains' | 'baseDomain' | 'platformHost' | 'singleTenantMode' | 'authTrustedProxyHeader'>): void => {
  app.post(API_PATHS.publicMetaCapiConsent, async (c) => {
    c.header('cache-control', 'no-store');
    if (!sameOrigin(c.req.raw)) return respond(err(forbidden('Cross-origin consent is not permitted')));
    if (!deps.metaCapi) return respond(err(internal('Meta conversions are unavailable')));
    const tenant = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!tenant.ok) return respond(tenant);
    if (!tenant.value) return respond(err(tenantNotFound()));
    const input = metaCapiDecisionSchema.safeParse(await readJson(c.req.raw));
    if (!input.success) return respond(err(validation('Invalid Meta conversion consent')));
    return respond(await recordPublicMetaCapiConsent(tenant.value.tenant.id, input.data,
      { ip: trustedClientIp(c, deps.authTrustedProxyHeader), userAgent: c.req.header('user-agent')?.slice(0, 1024) ?? null }, deps.metaCapi));
  });
};

export const registerMetaCapiRoutes = (app: Hono<AppVars>, deps: Pick<AppDeps, 'metaCapi'>): void => {
  app.get(API_PATHS.metaCapiEvents, async (c) => {
    c.header('cache-control', 'no-store');
    return deps.metaCapi ? respond(await listMetaCapiEvents(ctxOf(c), deps.metaCapi)) : respond(err(internal('Meta conversions are unavailable')));
  });
  app.get(API_PATHS.metaCapiConsents, async (c) => {
    c.header('cache-control', 'no-store');
    return deps.metaCapi ? respond(await listMetaCapiConsents(ctxOf(c), deps.metaCapi)) : respond(err(internal('Meta conversions are unavailable')));
  });
  app.post(API_PATHS.withdrawMetaCapiConsent, async (c) => {
    c.header('cache-control', 'no-store');
    if (!sameOrigin(c.req.raw)) return respond(err(forbidden('Cross-origin withdrawal is not permitted')));
    if (!deps.metaCapi) return respond(err(internal('Meta conversions are unavailable')));
    const input = metaCapiWithdrawSchema.safeParse(await readJson(c.req.raw));
    return input.success ? respond(await withdrawMetaCapiConsent(ctxOf(c), input.data, deps.metaCapi)) : respond(err(validation('Invalid withdrawal')));
  });
};
