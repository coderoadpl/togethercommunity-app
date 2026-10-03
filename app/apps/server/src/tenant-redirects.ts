import type { Hono } from 'hono';

import { TENANT_HEADER } from '#core/contract/index.js';
import { normalizeRedirectPath } from '#core/domain/index.js';
import { claimRateLimitWindow, resolveTenant } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';

const platformShortLinkPrefix = '/link';
const isPlatformShortLinkPath = (path: string): boolean =>
  path === platformShortLinkPrefix || path.startsWith(`${platformShortLinkPrefix}/`);

const staticAssetExtensions = new Set([
  'avif', 'css', 'eot', 'gif', 'ico', 'jpeg', 'jpg', 'js', 'json', 'map', 'mjs', 'otf', 'png',
  'svg', 'ttf', 'txt', 'webmanifest', 'webp', 'woff', 'woff2', 'xml',
]);

const isAssetRequest = (path: string): boolean => {
  if (path.startsWith('/assets/')) return true;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const extension = lastSegment.includes('.') ? lastSegment.split('.').at(-1) : undefined;
  return extension !== undefined && staticAssetExtensions.has(extension.toLowerCase());
};

export const registerTenantRedirects = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.use('*', async (c, next) => {
    await next();
    const hit = c.get('tenantRedirectHit');
    if (hit === undefined) return;
    try {
      const claimed = await claimRateLimitWindow({
        scope: 'redirect-hit',
        key: `${hit.tenantId}:${hit.redirectId}`,
        window: deps.publicRateLimitPolicies.redirectHitsPerRedirect,
      }, { buckets: deps.rateLimitBuckets, clock: deps.clock });
      if (!claimed.ok) return;
      await deps.redirects.incrementHit(hit.tenantId, hit.redirectId);
    } catch {
      deps.logger.warn(`[tenant-redirect] hit increment failed for ${hit.tenantId}/${hit.redirectId}`);
    }
  });
  app.get('*', async (c, next) => {
    if (isAssetRequest(c.req.path)) {
      await next();
      return;
    }
    const tenant = await resolveTenant(
      c.req.header('host') ?? '',
      c.req.header(TENANT_HEADER) ?? null,
      deps,
    );
    if (!tenant.ok || tenant.value === null) {
      await next();
      return;
    }
    const requestPath = normalizeRedirectPath(c.req.path);
    const redirect = await deps.redirects.findByFromPath(
      tenant.value.tenant.id,
      requestPath,
    );
    if (redirect === null) {
      if (isPlatformShortLinkPath(requestPath)) return c.redirect('/', 302);
      await next();
      return;
    }
    if (c.req.method === 'GET') c.set('tenantRedirectHit', { tenantId: tenant.value.tenant.id, redirectId: redirect.id });
    return c.redirect(
      `${redirect.targetPath}${new URL(c.req.url).search}${redirect.targetAnchor === null ? '' : `#${redirect.targetAnchor}`}`,
      redirect.permanent ? 301 : 302,
    );
  });
};
