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

  it('posts an empty body and redirects to the checkout response URL', async () => {
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
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
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
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnUrl }),
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
    expect(configuration.headers.filter((header) => header.source === '/offer/(.*)')).toEqual(offerRewrites.slice(0, 2).map((rewrite) => ({ source: rewrite.source, has: rewrite.has, headers: staticPolicy?.headers })));
  });
});

it('renders the hidden offer code field with an escaped uppercase prefill only when codes are allowed', () => {
  const html = renderDirectSalesLinkPage({ ...page, allowsCodes: true, code: 'save10"<' });
  expect(html).toContain('id="code-toggle">I have a discount code</button>');
  expect(html).toContain('<form id="code-form" hidden>');
  expect(html).toContain('maxlength="40"');
  expect(html).toContain('value="SAVE10&quot;&lt;"');
  expect(renderDirectSalesLinkPage({ ...page, allowsCodes: false, code: 'SAVE10' })).not.toContain('id="code-toggle"');
});

it.each(['toggle:click', 'field:input'])('cancels scheduled automatic checkout on %s and permits checkout without a code', async (event) => {
  const html = renderDirectSalesLinkPage({ ...page, allowsCodes: true });
  const script = html.match(/<script nonce="safe-nonce">([\s\S]*?)<\/script>/)?.[1];
  if (script === undefined) throw new Error('Missing script');
  type Listener = (event: { preventDefault(): void }) => void | Promise<void>;
  const handlers = new Map<string, Listener>();
  const status = { textContent: '' };
  const main = { dataset: { endpoint: page.endpoint, code: '', state: '', couponUnavailable: directSalesLinkCopyEn.couponUnavailable, checkoutUnavailable: directSalesLinkCopyEn.checkoutUnavailable } };
  const field = { value: '', focus: vi.fn(), addEventListener: (event: string, listener: Listener) => handlers.set(`field:${event}`, listener) };
  const form = { hidden: true, querySelector: () => ({ disabled: false }), addEventListener: (event: string, listener: Listener) => handlers.set(`form:${event}`, listener) };
  const toggle = { hidden: false, disabled: false, addEventListener: (event: string, listener: Listener) => handlers.set(`toggle:${event}`, listener) };
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { url: 'https://example.test/payment' } }) }));
  const timers: (() => Promise<void>)[] = [];
  const replace = vi.fn();
  await new Function('document', 'fetch', 'location', 'setTimeout', `return ${script.trim()}`)(
    { querySelector: (selector: string) => selector === 'main' ? main : selector === '[role="status"]' ? status : selector === '#code-form' ? form : selector === '#discount-code' ? field : toggle },
    fetch, { replace }, (callback: () => Promise<void>) => timers.push(callback),
  );
  await handlers.get(event)?.({ preventDefault: () => undefined });
  expect(form.hidden).toBe(false);
  expect(main.dataset.state).toBe('editing');
  await Promise.all(timers.map((callback) => callback()));
  expect(fetch).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  await handlers.get('form:submit')?.({ preventDefault: () => undefined });
  expect(fetch).toHaveBeenLastCalledWith(page.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(replace).toHaveBeenCalledWith('https://example.test/payment');
});

it.each(['success', 'automatic', 'automatic-invalid-code', 'invalid-code', 'network', 'malformed'] as const)('preserves a capped-code checkout through pending edits and handles %s', async (outcome) => {
  const automatic = outcome.startsWith('automatic');
  const html = renderDirectSalesLinkPage({ ...page, allowsCodes: true, ...(automatic ? { code: 'SAVE10' } : {}) });
  const script = html.match(/<script nonce="safe-nonce">([\s\S]*?)<\/script>/)?.[1];
  if (script === undefined) throw new Error('Missing script');
  type Listener = (event: { preventDefault(): void }) => void | Promise<void>;
  const handlers = new Map<string, Listener>();
  const status = { textContent: '' };
  const main = { dataset: { endpoint: page.endpoint, code: automatic ? 'SAVE10' : '', state: '', couponUnavailable: directSalesLinkCopyEn.couponUnavailable, checkoutUnavailable: directSalesLinkCopyEn.checkoutUnavailable } };
  const field = { value: 'SAVE10', disabled: false, focus: vi.fn(), addEventListener: (event: string, listener: Listener) => handlers.set(`field:${event}`, listener) };
  const button = { disabled: false };
  const form = { hidden: true, querySelector: () => button, addEventListener: (event: string, listener: Listener) => handlers.set(`form:${event}`, listener) };
  const toggle = { hidden: false, disabled: false, addEventListener: (event: string, listener: Listener) => handlers.set(`toggle:${event}`, listener) };
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const success = { ok: true, json: async () => ({ ok: true, data: { url: 'https://example.test/payment' } }) };
  let remainingRedemptions = 1;
  const fetch = vi.fn(async () => {
    if (remainingRedemptions === 0) return { ok: false, json: async () => ({ ok: false, error: { message: 'Coupon cannot be applied' } }) };
    remainingRedemptions -= 1;
    await pending;
    return success;
  });
  fetch.mockImplementationOnce(async () => {
    if (outcome === 'success' || outcome === 'automatic') remainingRedemptions -= 1;
    await pending;
    if (outcome === 'network') throw new Error('Network failure');
    if (outcome === 'malformed') return { ok: false, json: async () => { throw new Error('Invalid JSON'); } };
    if (outcome === 'invalid-code' || outcome === 'automatic-invalid-code') return { ok: false, json: async () => ({ ok: false, error: { message: 'Coupon cannot be applied' } }) };
    return success;
  });
  const replace = vi.fn();
  const timers: (() => Promise<void>)[] = [];
  await new Function('document', 'fetch', 'location', 'setTimeout', `return ${script.trim()}`)(
    { querySelector: (selector: string) => selector === 'main' ? main : selector === '[role="status"]' ? status : selector === '#code-form' ? form : selector === '#discount-code' ? field : toggle },
    fetch, { replace }, (callback: () => Promise<void>) => timers.push(callback),
  );
  const event = { preventDefault: vi.fn() };
  if (!automatic) await handlers.get('toggle:click')?.(event);
  const firstSubmission = automatic ? timers[0]?.() : handlers.get('form:submit')?.(event);
  await handlers.get('form:submit')?.(event);
  await handlers.get('field:input')?.(event);
  await handlers.get('toggle:click')?.(event);
  if (!automatic) await Promise.all(timers.map((callback) => callback()));
  expect(main.dataset.state).toBe('loading');
  expect(fetch).toHaveBeenCalledExactlyOnceWith(page.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'SAVE10' }) });
  expect(field.disabled).toBe(true);
  expect(button.disabled).toBe(true);
  expect(toggle.disabled).toBe(true);
  expect(replace).not.toHaveBeenCalled();
  finish();
  await firstSubmission;
  if (outcome === 'success' || outcome === 'automatic') {
    await handlers.get('form:submit')?.(event);
    expect(fetch).toHaveBeenCalledOnce();
    expect(remainingRedemptions).toBe(0);
    expect(field.disabled).toBe(true);
    expect(button.disabled).toBe(true);
  } else {
    expect(main.dataset.state).toBe('error');
    expect(status.textContent).toBe(outcome === 'invalid-code' || outcome === 'automatic-invalid-code' ? directSalesLinkCopyEn.couponUnavailable : directSalesLinkCopyEn.checkoutUnavailable);
    expect(field.disabled).toBe(false);
    expect(button.disabled).toBe(false);
    expect(toggle.disabled).toBe(false);
    field.value = '';
    await handlers.get('field:input')?.(event);
    await handlers.get('form:submit')?.(event);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(page.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  }
  expect(replace).toHaveBeenCalledExactlyOnceWith('https://example.test/payment');
});
