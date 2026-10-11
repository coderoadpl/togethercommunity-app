import type { Hono } from 'hono';

import { API_PATHS, salesLinkContracts, TENANT_HEADER } from '#core/contract/index.js';
import { err, forbidden, internal, tenantNotFound, validation } from '#core/domain/index.js';
import { authLinkBaseUrl, createDirectSalesLinkCheckout, getDirectSalesLinkMode, getPublicSalesLink, resolveTenant } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { directSalesLinkCopy, renderDirectSalesLinkPage } from './direct-sales-link-page.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import { SOCIAL_CRAWLER_PATTERN } from './social-preview.js';

export const registerDirectSalesLinkRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.get('/offer/:slug', async (c, next) => {
    const status = c.req.query('status');
    if (status === 'success' || status === 'cancelled') {
      await next();
      return;
    }
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok) return respond(resolved);
    if (resolved.value === null) return respond(err(tenantNotFound()));
    if (deps.salesLinkManagement === undefined) return respond(err(internal('Sales links are unavailable')));
    const tenant = resolved.value.tenant;
    const slug = c.req.param('slug');
    const offer = await getPublicSalesLink(tenant.id, slug, deps.salesLinkManagement);
    if (!offer.ok) return respond(offer);
    const settings = await deps.tenants.findSettings(tenant.id);
    const products = await deps.products.findByIds(tenant.id, offer.value.lines.map((line) => line.productId));
    const crawler = SOCIAL_CRAWLER_PATTERN.test(c.req.header('user-agent') ?? '');
    const missingLegal = settings?.termsUrl == null || settings.privacyUrl === null;
    if (!missingLegal && c.req.query('checkout') === 'together') {
      await next();
      return;
    }
    if (!crawler && !missingLegal && products.some((product) => (product.checkoutConsentDefinitionIds?.length ?? 0) > 0)) {
      const query = new URLSearchParams(new URL(c.req.url).search);
      query.set('checkout', 'together');
      return c.redirect(`/offer/${encodeURIComponent(slug)}?${query}`, 302);
    }
    const mode = await getDirectSalesLinkMode(tenant.id, c.req.query('test') === undefined ? 'live' : 'test', deps);
    if (!mode.ok) return respond(mode);
    c.set('signupRedirectOrigin', 'https://checkout.stripe.com');
    return c.html(renderDirectSalesLinkPage({
      heading: offer.value.salesLink.heading,
      description: offer.value.salesLink.description,
      tenantName: tenant.name,
      faviconUrl: settings?.faviconUrl ?? null,
      canonicalUrl: `${await authLinkBaseUrl(resolved.value, deps)}/offer/${encodeURIComponent(slug)}`,
      language: settings?.defaultLanguage ?? 'en',
      mode: mode.value,
      endpoint: API_PATHS.directSalesLinkCheckout.replace(':slug', encodeURIComponent(slug)),
      crawler,
      nonce: c.get('secureHeadersNonce') ?? '',
      ...(missingLegal ? { error: 'Checkout is unavailable until terms and privacy URLs are configured.' } : {}),
    }), missingLegal ? 503 : 200, { 'cache-control': 'no-store', vary: 'User-Agent' });
  });

  app.post(API_PATHS.directSalesLinkCheckout, async (c) => {
    if (SOCIAL_CRAWLER_PATTERN.test(c.req.header('user-agent') ?? '')) return respond(err(forbidden('Checkout is unavailable to crawlers')));
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok) return respond(resolved);
    if (resolved.value === null) return respond(err(tenantNotFound()));
    const contentType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    const form = contentType === 'application/x-www-form-urlencoded';
    if (!form && contentType !== 'application/json') return c.body(null, 415);
    const origin = c.req.header('origin');
    if (origin !== undefined && (!URL.canParse(origin) || new URL(origin).host !== (c.req.header('host') ?? new URL(c.req.url).host))) return respond(err(forbidden('Checkout must start from this workspace')));
    const parsed = salesLinkContracts.directSalesLinkCheckout.input.safeParse(form ? Object.fromEntries(new URLSearchParams(await c.req.text())) : await readJson(c.req.raw));
    if (!parsed.success) return respond(err(validation('Invalid checkout payload')));
    const result = await createDirectSalesLinkCheckout(resolved.value.tenant, await authLinkBaseUrl(resolved.value, deps), {
      slug: c.req.param('slug') ?? '',
      mode: parsed.data.mode,
      termsAcceptanceMessage: (legal, language) => directSalesLinkCopy(language).termsAcceptanceMessage(legal),
    }, deps);
    if (!result.ok) return respond(result);
    const output = salesLinkContracts.directSalesLinkCheckout.output.safeParse(result.value);
    if (!output.success) return respond(err(internal('Checkout response does not match the contract')));
    if (form) {
      c.set('signupRedirectOrigin', new URL(output.data.url).origin);
      return c.redirect(output.data.url, 303);
    }
    return respond({ ok: true, value: output.data }, { headers: { 'cache-control': 'no-store' } });
  });
};
