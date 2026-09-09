import { describe, expect, it } from 'vitest';

import { publicMarketingMessagesPl } from './public-marketing-pages.pl.js';
import { contrastRatio, deriveLightAccent } from '#core/domain/index.js';

import {
  languageFromRequest,
  renderHostedMarkdown,
  renderLegalDocumentPage,
  renderPreferencesPage,
  type PublicBrand,
} from './public-marketing-pages.js';

const brand: PublicBrand = {
  tenant: {
    id: 'tenant-1', slug: 'studio', name: 'Studio Demo', status: 'active', plan: 'hosted', contentVersion: 1,
  },
  settings: {
    name: 'Studio Demo',
    socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@studio' }],
    billingPortalUrl: null, bunnyStreamLibraryId: null, bunnyStreamCdnHostname: null, logoUrl: '/brand.svg', logoDarkUrl: null,
    accentColor: '#0E7490',
    accentLight: null, faviconUrl: '/favicon.svg',
    ogTitle: null, ogDescription: null, ogImageUrl: null,
    supportEmail: null, supportUrl: null, termsUrl: null, privacyUrl: null,
    defaultHomeSpaceId: null,
  },
};

describe('public marketing pages', () => {
  it('renders a branded, localized preference form with scoped and global actions', () => {
    const html = renderPreferencesPage({
      nonce: 'test-nonce',
      brand, language: 'en', token: 'token_1234567890123456789012', email: 'member@example.test',
      scope: 'consent:newsletter', scopeLabel: 'Product news', globallySuppressed: false,
      definitions: [{ id: 'newsletter', label: 'Product news', active: true, pendingConfirmation: false }],
    });
    expect(html).toContain('lang="en"');
    expect(html).toContain('/brand.svg');
    expect(html).toContain('<nav class="social-links" aria-label="Social profiles">');
    expect(html).toContain(
      '<a href="https://youtube.com/@studio" target="_blank" rel="noreferrer">YouTube</a>',
    );
    expect(html).toContain('Unsubscribe me from this scope');
    expect(html).toContain('Unsubscribe me from everything from Studio Demo');
    expect(html).toContain('name="consent" value="newsletter" checked');
    expect(html).toContain('.brand img{display:block;width:auto;height:auto;min-width:0;max-width:min(10rem,100%)');
    expect(html).toContain('.languages a{display:inline-flex');
    expect(html).toContain('min-height:44px');
    expect(html).toContain('--bg:#fafafa;--surface:#fff;--ink:#09090b');
    expect(html).not.toContain('together-theme-mode');
  });

  it.each([null, '#786000'])('uses the light accent %s on hosted pages', (accentLight) => {
    if (brand.settings == null) throw new Error('Missing brand settings');
    const html = renderLegalDocumentPage({
      nonce: 'test-nonce',
      brand: { ...brand, settings: { ...brand.settings, accentColor: '#F5C842', accentLight } },
      language: 'en', path: '/legal/privacy', title: 'Privacy', content: '[Policy](https://courses.example.org/privacy)', immutableVersion: null,
    });
    const accent = /<html[^>]+style="--accent:(#[0-9a-f]{6})"/i.exec(html)?.[1] ?? '';
    expect(accent).toBe(accentLight ?? deriveLightAccent('#F5C842'));
    for (const background of ['#fafafa', '#ffffff']) {
      expect(contrastRatio(accent, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('renders hosted markdown as prose while escaping markup and unsafe links', () => {
    const rendered = renderHostedMarkdown('# Privacy\n\n**Safe** [link](https://example.test)\n\n<script>alert(1)</script> [bad](javascript:alert(1))');
    expect(rendered).toContain('<h1>Privacy</h1>');
    expect(rendered).toContain('<strong>Safe</strong>');
    expect(rendered).toContain('href="https://example.test"');
    expect(rendered).toContain('&lt;script&gt;');
    expect(rendered).not.toContain('<script>alert');
    expect(rendered).not.toContain('href="javascript:');
  });

  it('applies inline markdown only to text without changing URL attributes or intra-word underscores', () => {
    const rendered = renderHostedMarkdown([
      '[our policy](https://acme.example/privacy_policy_v2)',
      '',
      'Keep snake_case_name intact and render _emphasis_, `code`, and **strong**.',
      '',
      '[literal URL](https://acme.example/`code`/**strong**/privacy_policy_v2)',
    ].join('\n'));
    expect(rendered).toContain('href="https://acme.example/privacy_policy_v2"');
    expect(rendered).toContain('>our policy</a>');
    expect(rendered).toContain('Keep snake_case_name intact');
    expect(rendered).toContain('<em>emphasis</em>, <code>code</code>, and <strong>strong</strong>');
    expect(rendered).toContain('href="https://acme.example/`code`/**strong**/privacy_policy_v2"');
    expect(rendered).not.toContain('href="https://acme.example/privacy<em>policy</em>v2"');
  });

  it('adds a locale-aware immutable version notice only to versioned legal pages', () => {
    const publishedAt = '2026-07-22T10:00:00.000Z';
    const publishedDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long' }).format(new Date(publishedAt));
    const html = renderLegalDocumentPage({
      nonce: 'test-nonce',
      brand, language: 'pl', path: '/legal/privacy/v/2', title: 'Privacy', content: 'Body',
      immutableVersion: { version: 2, publishedAt },
    });
    expect(html).toContain(publicMarketingMessagesPl.immutableVersion({ version: 2, date: publishedDate }));
  });

  it('selects PL or EN from the explicit query, cookie, and accepted language', () => {
    expect(languageFromRequest(new Request('https://tenant.test/u/token?lang=en'))).toBe('en');
    expect(languageFromRequest(new Request('https://tenant.test/u/token', { headers: { cookie: 'together-language=en' } }))).toBe('en');
    expect(languageFromRequest(new Request('https://tenant.test/u/token', { headers: { 'accept-language': 'pl-PL' } }))).toBe('pl');
  });
});

it('uses the tenant default only when the visitor has no supported preference', () => {
  expect(languageFromRequest(new Request('https://tenant.test/u/token'), 'pl')).toBe('pl');
  expect(languageFromRequest(new Request('https://tenant.test/u/token'))).toBe('en');
  expect(languageFromRequest(new Request('https://tenant.test/u/token?lang=en'), 'pl')).toBe('en');
  expect(languageFromRequest(new Request('https://tenant.test/u/token', {
    headers: { 'accept-language': 'de-DE' },
  }), 'pl')).toBe('pl');
});

it('recognizes a browser preference with a quality parameter', () => {
  expect(languageFromRequest(new Request('https://tenant.test/u/token', {
    headers: { 'accept-language': 'en;q=0.9' },
  }), 'pl')).toBe('en');
});
