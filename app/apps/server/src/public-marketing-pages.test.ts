import { describe, expect, it } from 'vitest';

import {
  languageFromRequest,
  renderHostedMarkdown,
  renderLegalDocumentPage,
  renderPreferencesPage,
} from './public-marketing-pages.js';

const brand = {
  tenant: { id: 'tenant-1', slug: 'studio', name: 'Studio Demo', contentVersion: 1 },
  settings: {
    billingPortalUrl: null, bunnyStreamLibraryId: null, logoUrl: '/brand.svg',
    accentColor: '#0E7490', faviconUrl: '/favicon.svg',
    ogTitle: null, ogDescription: null, ogImageUrl: null,
    supportEmail: null, supportUrl: null, termsUrl: null, privacyUrl: null,
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
    expect(html).toContain('Unsubscribe me from this scope');
    expect(html).toContain('Unsubscribe me from everything from Studio Demo');
    expect(html).toContain('name="consent" value="newsletter" checked');
    expect(html).toContain('.languages a{display:inline-flex');
    expect(html).toContain('min-height:44px');
    expect(html).toContain('<script nonce="test-nonce">');
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
    const html = renderLegalDocumentPage({
      nonce: 'test-nonce',
      brand, language: 'pl', path: '/legal/privacy/v/2', title: 'Prywatność', content: 'Treść',
      immutableVersion: { version: 2, publishedAt: '2026-07-22T10:00:00.000Z' },
    });
    expect(html).toContain('niezmienna wersja 2');
    expect(html).toContain('22 lipca 2026');
  });

  it('selects PL or EN from the explicit query, cookie, and accepted language', () => {
    expect(languageFromRequest(new Request('https://tenant.test/u/token?lang=en'))).toBe('en');
    expect(languageFromRequest(new Request('https://tenant.test/u/token', { headers: { cookie: 'together-language=en' } }))).toBe('en');
    expect(languageFromRequest(new Request('https://tenant.test/u/token', { headers: { 'accept-language': 'pl-PL' } }))).toBe('pl');
  });
});
