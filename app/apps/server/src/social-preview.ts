import type { Hono } from 'hono';

import { TENANT_HEADER } from '#core/contract/index.js';
import { resolveTenantSocial, type Identity } from '#core/domain/index.js';
import { resolveTenant } from '#core/server/index.js';

import type { AppDeps } from './composition.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string } };

const SOCIAL_CRAWLER_PATTERN =
  /facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Googlebot|redditbot|Applebot/i;

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] ?? character);

const meta = (property: string, content: string): string =>
  `<meta property="${escapeHtml(property)}" content="${escapeHtml(content)}">`;

export interface SocialPreviewInput {
  tenantName: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  canonicalUrl: string;
}

export const renderSocialPreview = (input: SocialPreviewInput): string => {
  const description = input.description === null
    ? ''
    : `<meta name="description" content="${escapeHtml(input.description)}">${meta('og:description', input.description)}`;
  const image = input.imageUrl === null ? '' : meta('og:image', input.imageUrl);
  const card = input.imageUrl === null ? 'summary' : 'summary_large_image';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
${description}
${meta('og:type', 'website')}
${meta('og:site_name', input.tenantName)}
${meta('og:title', input.title)}
${meta('og:url', input.canonicalUrl)}
${image}
<meta name="twitter:card" content="${card}">
<link rel="canonical" href="${escapeHtml(input.canonicalUrl)}">
</head>
<body>
<main>
<h1>${escapeHtml(input.tenantName)}</h1>
<a href="${escapeHtml(input.canonicalUrl)}">${escapeHtml(input.title)}</a>
</main>
</body>
</html>`;
};

const hasFileExtension = (path: string): boolean => /\/[^/]+\.[^/]+$/.test(path);

export const registerSocialPreviewRoute = (app: Hono<Vars>, deps: AppDeps): void => {
  app.get('*', async (c, next) => {
    const userAgent = c.req.header('user-agent') ?? '';
    if (
      c.req.method !== 'GET'
      || !SOCIAL_CRAWLER_PATTERN.test(userAgent)
      || c.req.path.startsWith('/assets/')
      || hasFileExtension(c.req.path)
    ) {
      await next();
      return;
    }
    const resolved = await resolveTenant(
      c.req.header('host') ?? '',
      c.req.header(TENANT_HEADER) ?? null,
      deps,
    );
    if (!resolved.ok || resolved.value === null) {
      await next();
      return;
    }
    const { tenant } = resolved.value;
    const settings = await deps.tenants.findSettings(tenant.id);
    const social = resolveTenantSocial(tenant, settings);
    const requestUrl = new URL(c.req.url);
    const canonicalUrl = `${requestUrl.origin}${requestUrl.pathname}`;
    return c.html(renderSocialPreview({
      tenantName: tenant.name,
      title: social.title,
      description: social.description,
      imageUrl: social.imageUrl,
      canonicalUrl,
    }));
  });
};
