import { describe, expect, it, vi } from 'vitest';

import configuration from '../../../vercel.json' with { type: 'json' };
import { directSalesLinkCopyEn } from './direct-sales-link-copy.en.js';
import { directSalesLinkCopyPl } from './direct-sales-link-copy.pl.js';
import { renderDirectSalesLinkPage } from './direct-sales-link-page.js';
import { SOCIAL_CRAWLER_PATTERN } from './social-preview.js';

const page = {
  heading: 'Offer "<name>', description: 'A <bundle>', tenantName: 'Acme',
  faviconUrl: 'https://example.test/favicon.png', canonicalUrl: 'https://example.test/offer/bundle',
  language: 'en' as const, mode: 'live' as const, endpoint: '/api/public/sales-links/bundle/checkout', crawler: false, nonce: 'safe-nonce',
};

describe('direct sales-link page', () => {
  it('renders checkout branding and escapes interpolated HTML attributes and names', () => {
    const html = renderDirectSalesLinkPage({
      ...page,
      branding: {
        displayName: 'Acme <"Studio">',
        logoUrl: 'https://example.test/logo.png?label="<brand>"&size=2',
        buttonColor: '#123456',
        backgroundColor: '#abcdef',
      },
      tenantName: 'Fallback <"name">',
      endpoint: '/checkout?label="<value>"&source=offer',
      canonicalUrl: 'https://example.test/offer?label="<value>"&source=offer',
      faviconUrl: 'https://example.test/favicon.png?label="<value>"&size=2',
      nonce: 'nonce"<value>',
    });
    expect(html).toContain('<h1>Acme &lt;&quot;Studio&quot;&gt;</h1>');
    expect(html).toContain('<img class="logo" src="https://example.test/logo.png?label=&quot;&lt;brand&gt;&quot;&amp;size=2" alt="">');
    expect(html).toContain('style="--accent: #123456; --background: #abcdef"');
    expect(html).toContain('content="Fallback &lt;&quot;name&quot;&gt;"');
    expect(html).toContain('data-endpoint="/checkout?label=&quot;&lt;value&gt;&quot;&amp;source=offer"');
    expect(html).toContain('href="https://example.test/offer?label=&quot;&lt;value&gt;&quot;&amp;source=offer"');
    expect(html).toContain('href="https://example.test/favicon.png?label=&quot;&lt;value&gt;&quot;&amp;size=2"');
    expect(html).toContain('<script nonce="nonce&quot;&lt;value&gt;">');
    expect(html).not.toContain('<brand>');
    expect(html).not.toContain('<value>');
    expect(html).not.toContain('<"Studio">');
  });

  it('uses the tenant name without a configured logo and supports system color schemes', () => {
    const html = renderDirectSalesLinkPage(page);
    expect(html).toContain('<h1>Acme</h1>');
    expect(html).not.toContain('<img');
    expect(html).toContain('font-family: system-ui');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain('<div class="spinner" aria-hidden="true"></div>');
    expect(html).not.toContain('<strong>TEST</strong>');
    expect(html).not.toContain('name="mode"');
  });

  it.each([
    { language: 'en', copy: directSalesLinkCopyEn },
    { language: 'pl', copy: directSalesLinkCopyPl },
  ] as const)('renders the $language status copy and working fallback form', ({ language, copy }) => {
    const html = renderDirectSalesLinkPage({ ...page, language });
    expect(html).toContain(`<p role="status">${copy.redirecting}</p>`);
    expect(html).toContain(`<form method="post" action="${page.endpoint}"><button type="submit">${copy.continueToPayment}</button></form>`);
  });

  it('posts attribution and redirects to the checkout response URL', async () => {
    const html = renderDirectSalesLinkPage(page);
    const script = html.match(/<script nonce="safe-nonce">([\s\S]*?)<\/script>/)?.[1];
    if (script === undefined) throw new Error('Missing checkout script');
    const status = { textContent: directSalesLinkCopyEn.redirecting };
    const replace = vi.fn();
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { url: 'https://example.test/payment' } }) }));
    await new Function('document', 'fetch', 'location', `return ${script.trim()}`)(
      { querySelector: (selector: string) => selector === 'main'
        ? { dataset: { endpoint: page.endpoint, checkoutUnavailable: directSalesLinkCopyEn.checkoutUnavailable } }
        : status },
      fetch,
      { replace },
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(page.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"attribution":{}}',
    });
    expect(replace).toHaveBeenCalledExactlyOnceWith('https://example.test/payment');
    expect(status.textContent).toBe(directSalesLinkCopyEn.redirecting);
  });

  it('escapes the return address in both attributes and submits its original text', async () => {
    const returnUrl = 'https://sales.example/offer?section="details"&value=<item>#buy';
    const html = renderDirectSalesLinkPage({ ...page, returnUrl });
    const escaped = 'https://sales.example/offer?section=&quot;details&quot;&amp;value=&lt;item&gt;#buy';
    expect(html).toContain(`data-return-url="${escaped}"`);
    expect(html).toContain(`<input type="hidden" name="returnUrl" value="${escaped}">`);
    expect(html).not.toContain(returnUrl);
    const script = html.match(/<script nonce="safe-nonce">([\s\S]*?)<\/script>/)?.[1];
    if (script === undefined) throw new Error('Missing checkout script');
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { url: 'https://example.test/payment' } }) }));
    const replace = vi.fn();
    await new Function('document', 'fetch', 'location', `return ${script.trim()}`)(
      { querySelector: (selector: string) => selector === 'main'
        ? { dataset: { endpoint: page.endpoint, returnUrl } } : { textContent: '' } },
      fetch,
      { replace },
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(page.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attribution: {}, returnUrl }),
    });
    expect(replace).toHaveBeenCalledExactlyOnceWith('https://example.test/payment');
  });

  it('renders crawler metadata without automatic checkout or a spinner', () => {
    const html = renderDirectSalesLinkPage({ ...page, crawler: true });
    expect(html).toContain('property="og:site_name" content="Acme"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<div class="spinner"');
  });

  it.each(['checkoutUnavailable', 'legalUrlsMissing'] as const)('renders the Polish %s error without checkout actions', (error) => {
    const html = renderDirectSalesLinkPage({ ...page, language: 'pl', error });
    expect(html).toContain('<html lang="pl">');
    expect(directSalesLinkCopyPl[error]).not.toBe(directSalesLinkCopyEn[error]);
    expect(html).toContain(`<p role="status">${directSalesLinkCopyPl[error]}</p>`);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<form');
  });

  it.each(['validation', 'malformed', 'network'] as const)('renders a %s failure using fallback copy without exposing server or network messages', async (failure) => {
    const html = renderDirectSalesLinkPage({ ...page, language: 'pl' });
    expect(html).toContain(`data-checkout-unavailable="${directSalesLinkCopyPl.checkoutUnavailable}"`);
    const script = html.match(/<script nonce="safe-nonce">([\s\S]*?)<\/script>/)?.[1];
    if (script === undefined) throw new Error('Missing checkout script');
    const status = { textContent: '' };
    const replace = vi.fn();
    const fetch = vi.fn(async () => {
      if (failure === 'network') throw new Error('Network failure');
      return { ok: false, json: async () => failure === 'malformed' ? null : { ok: false, error: { message: 'Stripe is not configured for this tenant' } } };
    });
    await new Function('document', 'fetch', 'location', `return ${script.trim()}`)(
      { querySelector: (selector: string) => selector === 'main'
        ? { dataset: { endpoint: page.endpoint, checkoutUnavailable: directSalesLinkCopyPl.checkoutUnavailable } }
        : status },
      fetch,
      { replace },
    );
    expect(status.textContent).toBe(directSalesLinkCopyPl.checkoutUnavailable);
    expect(fetch).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it('escapes public metadata and localizes the redirect and form', () => {
    const html = renderDirectSalesLinkPage({ ...page, language: 'pl', mode: 'test' });
    expect(html).toContain('<title>Offer &quot;&lt;name&gt;</title>');
    expect(html).toContain('property="og:description" content="A &lt;bundle&gt;"');
    expect(html).toContain(directSalesLinkCopyPl.redirecting);
    expect(html).toContain(directSalesLinkCopyPl.continueToPayment);
    expect(html).toContain('<strong>TEST</strong>');
    expect(html).toContain('<script nonce="safe-nonce">');
  });

  it('forwards crawlers before offer fallbacks and handoffs before the SPA rewrite', () => {
    const crawlerIndex = configuration.rewrites.findIndex((rewrite) => rewrite.has?.some((condition) => condition.key === 'user-agent'));
    expect(crawlerIndex).toBeGreaterThanOrEqual(0);
    const crawlerRewrite = configuration.rewrites[crawlerIndex];
    expect(crawlerRewrite?.destination).toBe('/api/index');
    const crawlerValue = crawlerRewrite?.has?.find((condition) => condition.key === 'user-agent')?.value;
    expect(crawlerValue).toBe(`.*(${SOCIAL_CRAWLER_PATTERN.source}).*`);
    const offerRewrites = configuration.rewrites.filter((rewrite) => rewrite.source === '/offer/(.*)');
    expect(offerRewrites).toEqual([
      { source: '/offer/(.*)', has: [{ type: 'query', key: 'checkout', value: 'together' }], destination: '/index.html' },
      { source: '/offer/(.*)', has: [{ type: 'query', key: 'status', value: 'success|cancelled' }], destination: '/index.html' },
      { source: '/offer/(.*)', destination: '/api/index' },
    ]);
    for (const offerRewrite of offerRewrites) {
      expect(configuration.rewrites.indexOf(offerRewrite)).toBeGreaterThan(crawlerIndex);
    }
    const spaIndex = configuration.rewrites.findIndex((rewrite) => rewrite.source === '/(.*)' && rewrite.has === undefined);
    const handoffIndex = configuration.rewrites.findIndex((rewrite) => rewrite.source === '/offer/(.*)' && rewrite.has === undefined);
    expect(spaIndex).toBeGreaterThan(handoffIndex);
    const staticPolicy = configuration.headers.find((header) => header.source.includes('?!api/'));
    expect(staticPolicy?.source).toContain('|offer/');
    expect(configuration.headers.filter((header) => header.source === '/offer/(.*)')).toEqual([
      ...offerRewrites.slice(0, 2).map((rewrite) => ({
        source: rewrite.source, has: rewrite.has, headers: staticPolicy?.headers,
      })),
      {
        source: '/offer/(.*)',
        has: [{ type: 'query', key: 'status', value: 'success' }],
        headers: staticPolicy?.headers.map((header) => header.key === 'Content-Security-Policy'
          ? { ...header, value: header.value.replace("script-src 'self'", "script-src 'self' https://www.googletagmanager.com/gtag/ https://connect.facebook.net") }
          : header),
      },
    ]);
  });
});

it('passes attribution in the script POST and every noscript hidden field', async () => {
  const attribution = { utmSource: 'meta', utmMedium: 'paid', utmCampaign: 'launch', utmContent: 'card', utmTerm: 'guide', fbclid: 'X', gclid: 'G' };
  const html = renderDirectSalesLinkPage({ ...page, attribution });
  for (const [name, value] of [['utm_source', 'meta'], ['utm_medium', 'paid'], ['utm_campaign', 'launch'], ['utm_content', 'card'], ['utm_term', 'guide'], ['fbclid', 'X'], ['gclid', 'G']]) {
    expect(html).toContain(`<input type="hidden" name="${name}" value="${value}">`);
  }
  expect(html).toContain('data-attribution="{&quot;utmSource&quot;:&quot;meta&quot;');
  const script = html.match(/<script nonce="safe-nonce">([\s\S]*?)<\/script>/)?.[1];
  if (script === undefined) throw new Error('Missing checkout script');
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { url: 'https://example.test/payment' } }) }));
  await new Function('document', 'fetch', 'location', `return ${script.trim()}`)(
    { querySelector: () => ({ dataset: { endpoint: page.endpoint, attribution: JSON.stringify(attribution) } }) },
    fetch, { replace: vi.fn() },
  );
  expect(fetch).toHaveBeenCalledExactlyOnceWith(page.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attribution }),
  });
});
