import type { Hono } from 'hono';

import { TENANT_HEADER } from '#core/contract/index.js';
import { communitySpacePath, coursePath, err, tenantNotFound } from '#core/domain/index.js';
import { getPublicNavigation, resolveTenant, resolveTenantOrigin } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { respond } from './respond.js';

const crawlerHeaders = (): Record<string, string> => ({
  'cache-control': 'public, max-age=300',
  vary: `Host, ${TENANT_HEADER}`,
});

export const registerCrawlerFiles = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.get('/robots.txt', async (c) => {
    const resolved = await resolveTenant(
      c.req.header('host') ?? '',
      c.req.header(TENANT_HEADER) ?? null,
      deps,
    );
    if (!resolved.ok) return respond(resolved);
    if (resolved.value === null) return respond(err(tenantNotFound()));
    const origin = await resolveTenantOrigin(resolved.value.tenant, deps);
    return c.text([
      'User-agent: *',
      'Allow: /',
      'Allow: /my/courses/',
      'Disallow: /my',
      'Disallow: /panel',
      'Disallow: /api',
      'Disallow: /login',
      `Sitemap: ${origin}/sitemap.xml`,
      '',
    ].join('\n'), 200, crawlerHeaders());
  });

  app.get('/sitemap.xml', async (c) => {
    const resolved = await resolveTenant(
      c.req.header('host') ?? '',
      c.req.header(TENANT_HEADER) ?? null,
      deps,
    );
    if (!resolved.ok) return respond(resolved);
    if (resolved.value === null) return respond(err(tenantNotFound()));
    const navigation = await getPublicNavigation(resolved.value.tenant, deps);
    if (!navigation.ok) return respond(navigation);
    const origin = await resolveTenantOrigin(resolved.value.tenant, deps);
    const paths = [
      '/',
      ...navigation.value.courses.map((course) => coursePath(encodeURIComponent(course.id))),
      ...navigation.value.spaces.map((space) => communitySpacePath(encodeURIComponent(space.id))),
    ];
    const urls = paths.map((path) => `  <url><loc>${new URL(path, origin).toString()}</loc></url>`);
    return c.body([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      '</urlset>',
      '',
    ].join('\n'), 200, {
      ...crawlerHeaders(),
      'content-type': 'application/xml; charset=UTF-8',
    });
  });
};
