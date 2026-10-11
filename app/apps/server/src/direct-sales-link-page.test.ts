import { describe, expect, it, vi } from 'vitest';

import configuration from '../../../vercel.json' with { type: 'json' };
import { directSalesLinkCopyPl } from './direct-sales-link-copy.pl.js';
import { renderDirectSalesLinkPage } from './direct-sales-link-page.js';
import { SOCIAL_CRAWLER_PATTERN } from './social-preview.js';

const page = {
  heading: 'Offer "<name>', description: 'A <bundle>', tenantName: 'Acme',
  faviconUrl: 'https://example.test/favicon.png', canonicalUrl: 'https://example.test/offer/bundle',
  language: 'en' as const, mode: 'live' as const, endpoint: '/api/public/sales-links/bundle/checkout', crawler: false, nonce: 'safe-nonce',
};

describe('direct sales-link page', () => {
  it.each(['checkoutUnavailable', 'legalUrlsMissing'] as const)('localizes the Polish %s error without checkout actions', (error) => {
    const html = renderDirectSalesLinkPage({ ...page, language: 'pl', error });
    expect(html).toContain('<html lang="pl">');
    expect(html).toContain(`<p role="status">${directSalesLinkCopyPl[error]}</p>`);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<form');
  });

  it.each(['validation', 'malformed', 'network'] as const)('localizes a %s failure without exposing server or network messages', async (failure) => {
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
        ? { dataset: { endpoint: page.endpoint, mode: page.mode, checkoutUnavailable: directSalesLinkCopyPl.checkoutUnavailable } }
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
    expect(configuration.headers.filter((header) => header.source === '/offer/(.*)')).toEqual(offerRewrites.slice(0, 2).map((rewrite) => ({ source: rewrite.source, has: rewrite.has, headers: staticPolicy?.headers })));
  });
});
