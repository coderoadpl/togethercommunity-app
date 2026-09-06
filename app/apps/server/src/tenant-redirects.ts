import type { Hono } from 'hono';

import { TENANT_HEADER } from '#core/contract/index.js';
import { normalizeRedirectPath } from '#core/domain/index.js';
import { resolveTenant } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';

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
    const redirect = await deps.redirects.findByFromPath(
      tenant.value.tenant.id,
      normalizeRedirectPath(c.req.path),
    );
    if (redirect === null) {
      await next();
      return;
    }
    return c.redirect(
      `${redirect.targetPath}${new URL(c.req.url).search}`,
      redirect.permanent ? 301 : 302,
    );
  });
};
