import type { Hono } from 'hono';

import { API_PATHS, HTTP_STATUS_BY_ERROR_CODE, salesLinkContracts, TENANT_HEADER } from '#core/contract/index.js';
import { err, forbidden, internal, resolveCancelReturnUrl, resolveCheckoutBranding, tenantNotFound, validation } from '#core/domain/index.js';
import { authLinkBaseUrl, createDirectSalesLinkCheckout, getPublicSalesLink, resolveTenant } from '#core/server/index.js';

import type { AppVars } from './app-vars.js';
import type { AppDeps } from './composition.js';
import { directSalesLinkCopy, renderDirectSalesLinkPage } from './direct-sales-link-page.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';
import { SOCIAL_CRAWLER_PATTERN } from './social-preview.js';

export const registerDirectSalesLinkRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.get('/offer/:slug', async (c, next) => {
    const crawler = SOCIAL_CRAWLER_PATTERN.test(c.req.header('user-agent') ?? '');
    const status = c.req.query('status');
    if (!crawler && (status === 'success' || status === 'cancelled')) {
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
    const settings = await deps.tenants.findSettings(tenant.id);
    const baseUrl = await authLinkBaseUrl(resolved.value, deps);
    const requestedReturnUrl = c.req.query('return');
    const link = requestedReturnUrl === undefined ? null : await deps.salesLinkManagement.salesLinks.findBySlug(tenant.id, slug);
    const returnUrl = requestedReturnUrl !== undefined && resolveCancelReturnUrl(link?.cancelReturnUrl, requestedReturnUrl) === requestedReturnUrl
      ? requestedReturnUrl : undefined;
    const page = {
      heading: offer.ok ? offer.value.salesLink.heading : directSalesLinkCopy(settings?.defaultLanguage ?? 'en').checkoutUnavailable,
      description: offer.ok ? offer.value.salesLink.description : '',
      tenantName: tenant.name,
      branding: settings === null ? undefined : resolveCheckoutBranding(settings, baseUrl),
      faviconUrl: settings?.faviconUrl ?? null,
      canonicalUrl: `${baseUrl}/offer/${encodeURIComponent(slug)}`,
      language: settings?.defaultLanguage ?? 'en',
      endpoint: API_PATHS.directSalesLinkCheckout.replace(':slug', encodeURIComponent(slug)),
      ...(returnUrl === undefined ? {} : { returnUrl }),
      crawler,
      nonce: c.get('secureHeadersNonce') ?? '',
    };
    const headers = { 'cache-control': 'no-store', vary: 'User-Agent' };
    if (!offer.ok) return new Response(renderDirectSalesLinkPage({ ...page, mode: 'live', error: 'checkoutUnavailable' }), {
      status: HTTP_STATUS_BY_ERROR_CODE[offer.error.code], headers: { ...headers, 'content-type': 'text/html; charset=UTF-8' },
    });
    const products = await deps.products.findByIds(tenant.id, offer.value.lines.map((line) => line.productId));
    const missingLegal = settings?.termsUrl == null || settings.privacyUrl === null;
    if (!crawler && !missingLegal && c.req.query('checkout') === 'together') {
      await next();
      return;
    }
    if (!page.crawler && !missingLegal && products.some((product) => (product.checkoutConsentDefinitionIds?.length ?? 0) > 0)) {
      const query = new URLSearchParams(new URL(c.req.url).search);
      if (returnUrl === undefined) query.delete('return');
      else query.set('return', returnUrl);
      query.set('checkout', 'together');
      return c.redirect(`/offer/${encodeURIComponent(slug)}?${query}`, 302);
    }
    c.set('signupRedirectOrigin', 'https://checkout.stripe.com');
    return c.html(renderDirectSalesLinkPage({
      ...page,
      mode: 'live',
      ...(missingLegal ? { error: 'legalUrlsMissing' as const } : {}),
    }), missingLegal ? 503 : 200, headers);
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
      ...(parsed.data.returnUrl === undefined ? {} : { returnUrl: parsed.data.returnUrl }),
      termsAcceptanceMessage: (legal, language) => directSalesLinkCopy(language).termsAcceptanceMessage(legal),
    }, deps);
    if (!result.ok) return respond(result);
    const output = salesLinkContracts.directSalesLinkCheckout.output.safeParse(result.value);
    if (!output.success) return respond(err(internal('Checkout response does not match the contract')));
    if (form) {
      c.set('signupRedirectOrigin', new URL(output.data.url).origin);
      c.res = c.redirect(output.data.url, 303);
    } else {
      c.res = respond({ ok: true, value: output.data }, { headers: { 'cache-control': 'no-store' } });
    }
    return c.res;
  });
};
