import { createDirectoryFixture, directoryCtx, directoryValue } from '#adapters/db/marketing-contact-test-fixture.js';
import { signupConfirmationToken } from '#adapters/db/marketing-signup-test-helpers.js';
import { emailOutbox, marketingConsents, marketingDirectoryEvents, marketingListMemberships, marketingSignupSubmissions, consentConfirmationTokens } from '#adapters/db/schema.js';
import { createMarketingSignupForm } from '#core/server/index.js';
import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';
import { describe, expect, it } from 'vitest';

import { publicMarketingMessagesPl } from './public-marketing-pages.pl.js';
import { contrastRatio, deriveLightAccent } from '#core/domain/index.js';

import {
  languageFromRequest,
  renderHostedErrorPage,
  renderHostedMarkdown,
  renderLegalDocumentPage,
  renderPreferenceResultPage,
  renderPreferencesPage,
  renderStatusPage,
  type PublicBrand,
} from './public-marketing-pages.js';

const brand: PublicBrand = {
  tenant: {
    id: 'tenant-1', slug: 'studio', name: 'Studio Demo', status: 'active', plan: 'hosted', contentVersion: 1,
  },
  settings: {
    name: 'Studio Demo',
    socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@studio' }],
    signInNotice: { enabled: false, text: '' },
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
      definitions: [
        { id: 'newsletter', label: 'Product news', active: true, pendingConfirmation: false },
        { id: 'events', label: 'Event announcements', active: false, pendingConfirmation: true },
        { id: 'offers', label: 'Partner offers', active: false, pendingConfirmation: false },
      ],
    });
    expect(html).toContain('lang="en"');
    expect(html).toContain('/brand.svg');
    expect(html).toContain('<nav class="social-links" aria-label="Social profiles">');
    expect(html).toContain(
      '<a href="https://youtube.com/@studio" target="_blank" rel="noreferrer">YouTube</a>',
    );
    expect(html).toContain('<section class="card" data-state="consent-link"><h2>Unsubscribe</h2>');
    expect(html).toContain('<p class="fine">You will stop receiving messages sent under the consent “Product news”.</p><form method="post" action="/u/token_1234567890123456789012/confirm?lang=en"><button type="submit">Unsubscribe</button></form>');
    expect(html).toContain('<p class="fine">Stops every marketing e-mail from Studio Demo. You cannot undo this from this page.</p><form method="post" action="/u/token_1234567890123456789012/all?lang=en"><button class="secondary danger-text" type="submit">Unsubscribe from all marketing e-mails</button></form>');
    expect(html).toContain('<fieldset class="choices"><legend>Optional consents</legend>');
    expect(html).not.toContain('scope');
    expect(html).not.toContain('class="danger"');
    expect(html).not.toContain('danger-zone');
    expect(html).not.toContain('class="notice"');
    expect(html).toContain('name="present-consent" value="newsletter"');
    expect(html).toContain('name="present-consent" value="events"');
    expect(html).toContain('name="present-consent" value="offers"');
    expect(html).toContain('name="consent" value="newsletter" checked');
    expect(html).toContain('name="consent" value="events" checked');
    expect(html).toContain('name="consent" value="offers"');
    expect(html).not.toContain('name="consent" value="offers" checked');
    expect(html).toContain('Waiting for confirmation from the email we sent.');
    const plHtml = renderPreferencesPage({
      nonce: 'test-nonce',
      brand, language: 'pl', token: 'token_1234567890123456789012', email: 'member@example.test',
      scope: 'consent:events', scopeLabel: 'Event announcements', globallySuppressed: false,
      definitions: [{ id: 'events', label: 'Event announcements', active: false, pendingConfirmation: true }],
    });
    expect(plHtml).toContain(publicMarketingMessagesPl.pendingConfirmation);
    expect(html).toContain('.brand img{display:block;width:auto;height:auto;min-width:0;max-width:min(10rem,100%)');
    expect(html).toContain('.languages{display:inline-flex;flex:none;gap:.125rem;padding:.1875rem;border:1px solid var(--line);');
    expect(html).toContain('.languages a{display:inline-flex');
    expect(html).toContain('min-height:44px');
    expect(html).toContain('@media(min-width:600px){.shell{padding:2.5rem 0 5rem}.page{padding-top:3.5rem}.page > h1{font-size:2.5rem}');
    expect(html).toContain('.prose h2{font-size:1.5rem}');
    expect(html).toContain('<div class="brand-mark"><img class="brand-logo" src="/brand.svg" alt="Studio Demo"></div>');
    expect(html).toContain('--bg:#F7F4EF;--surface:#FFFFFF;--muted-surface:#F4F4F2;--pressed:#ECEBE9;--ink:#1B1A18');
    expect(html).toContain(':root{color-scheme:light dark;');
    expect(html).not.toContain('together-theme-mode');
  });

  const preferenceInput = (overrides: Partial<Parameters<typeof renderPreferencesPage>[0]> = {}) => ({
    nonce: 'test-nonce',
    brand, language: 'en' as const, token: 'token_1234567890123456789012', email: 'member@example.test',
    scope: 'consent:newsletter', scopeLabel: 'Product news', globallySuppressed: false,
    definitions: [
      { id: 'newsletter', label: 'Product news', active: true, pendingConfirmation: false },
      { id: 'offers', label: 'Partner offers', active: false, pendingConfirmation: false },
    ],
    ...overrides,
  });

  it('shows only the unsubscribed status and the way to reach the sender once the address left everything', () => {
    if (brand.settings == null) throw new Error('Missing brand settings');
    const html = renderPreferencesPage(preferenceInput({
      globallySuppressed: true,
      brand: { ...brand, settings: { ...brand.settings, supportEmail: 'help@studio.test' } },
    }));
    expect(html).toContain('<section class="card" data-state="unsubscribed-all"><p class="state-line">You are unsubscribed from all marketing e-mails from Studio Demo.</p><p class="fine">You cannot subscribe again from this page; contact the sender.</p><p class="fine"><a href="mailto:help@studio.test">help@studio.test</a></p></section>');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Select the messages');
    expect(html).not.toContain('<h2>Unsubscribe</h2>');
    const polish = renderPreferencesPage(preferenceInput({ globallySuppressed: true, language: 'pl' }));
    expect(polish).toContain('Ten adres jest wypisany ze wszystkich wiadomości marketingowych od nadawcy Studio Demo.');
    expect(polish).toContain('Na tej stronie nie zapiszesz się ponownie; skontaktuj się z nadawcą.');
    expect(polish).not.toContain('<a href="mailto:');
  });

  it('links the support page when the workspace has no support address', () => {
    if (brand.settings == null) throw new Error('Missing brand settings');
    const withUrl = renderPreferencesPage(preferenceInput({
      globallySuppressed: true,
      brand: { ...brand, settings: { ...brand.settings, supportUrl: 'https://studio.test/help' } },
    }));
    expect(withUrl).toContain('<p class="fine"><a href="https://studio.test/help">Help and contact</a></p>');
    const unsafe = renderPreferencesPage(preferenceInput({
      globallySuppressed: true,
      brand: { ...brand, settings: { ...brand.settings, supportUrl: 'javascript:alert(1)' } },
    }));
    expect(unsafe).not.toContain('javascript:');
  });

  it('replaces the scoped button with the withdrawn state and keeps the rest', () => {
    const html = renderPreferencesPage(preferenceInput({
      definitions: [{ id: 'newsletter', label: 'Product news', active: false, pendingConfirmation: false }],
    }));
    expect(html).toContain('data-state="consent-withdrawn"');
    expect(html).toContain('<p class="state-line">You are unsubscribed from “Product news”.</p>');
    expect(html).not.toContain('/confirm?lang=en');
    expect(html).toContain('/all?lang=en"><button class="secondary danger-text" type="submit">Unsubscribe from all marketing e-mails</button>');
    expect(html).toContain('<fieldset class="choices">');
    const pending = renderPreferencesPage(preferenceInput({
      definitions: [{ id: 'newsletter', label: 'Product news', active: false, pendingConfirmation: true }],
    }));
    expect(pending).toContain('data-state="consent-link"');
    expect(pending).toContain('/confirm?lang=en');
  });

  it('offers one unsubscribe button on a link issued for all marketing', () => {
    const html = renderPreferencesPage(preferenceInput({ scope: 'all_marketing', scopeLabel: null }));
    expect(html).toContain('data-state="all-marketing-link"');
    expect(html.match(/<button[^>]*>Unsubscribe from all marketing e-mails<\/button>/g)).toHaveLength(1);
    expect(html).toContain('<p class="fine">Stops every marketing e-mail from Studio Demo. You cannot undo this from this page.</p><form method="post" action="/u/token_1234567890123456789012/all?lang=en"><button type="submit">');
    expect(html).not.toContain('/confirm?lang=en');
  });

  it('names a consent without a label as this list and never shows its id', () => {
    const html = renderPreferencesPage(preferenceInput({ scope: 'consent:archived-definition', scopeLabel: null }));
    expect(html).toContain('You will stop receiving messages from this list.');
    expect(html).not.toContain('archived-definition');
    const polish = renderPreferencesPage(preferenceInput({ scope: 'consent:archived-definition', scopeLabel: null, language: 'pl' }));
    expect(polish).toContain('Przestaniesz otrzymywać wiadomości z tej listy.');
    expect(polish).toContain('<h2>Wypisz się</h2>');
    expect(polish).toContain('>Wypisz mnie</button>');
    expect(polish).toContain('>Wypisz mnie ze wszystkich wiadomości marketingowych</button>');
    expect(polish).toContain('Zatrzymuje wszystkie wiadomości marketingowe od nadawcy Studio Demo. Tego wyboru nie cofniesz na tej stronie.');
  });

  it('escapes consent labels and the workspace name in every preference state', () => {
    const html = renderPreferencesPage(preferenceInput({
      brand: { ...brand, tenant: { ...brand.tenant, name: 'Studio <b>' } },
      scopeLabel: 'News <script>',
      definitions: [{ id: 'newsletter', label: 'News <script>', active: false, pendingConfirmation: false }],
    }));
    expect(html).toContain('You are unsubscribed from “News &lt;script&gt;”.');
    expect(html).toContain('from Studio &lt;b&gt;. You cannot undo');
    expect(html).not.toContain('<script>');
  });

  const resultInput = (overrides: Partial<Parameters<typeof renderPreferenceResultPage>[0]> = {}) => ({
    nonce: 'test-nonce', brand, language: 'en' as const, token: 'token_1234567890123456789012',
    result: 'scope_unsubscribed' as const, scopeLabel: 'Product news', ...overrides,
  });

  it('confirms a scoped unsubscribe with the consent label and the way back', () => {
    const html = renderPreferenceResultPage(resultInput());
    expect(html).toContain('data-testid="marketing-preference-result"');
    expect(html).toContain('<h1>Unsubscribe confirmed</h1>');
    expect(html).toContain('<p class="lede">You will no longer receive messages sent under the consent “Product news”.</p><p class="fine">If you change your mind, come back here and select the consents again.</p>');
    expect(html).toContain('<a class="button-link" href="/u/token_1234567890123456789012?lang=en">Back to preferences</a>');
    expect(html).toContain('status-cue--success');
    expect(html).not.toContain('all marketing');
    const polish = renderPreferenceResultPage(resultInput({ language: 'pl' }));
    expect(polish).toContain('Nie będziesz już otrzymywać wiadomości objętych zgodą „Product news”.');
    expect(polish).toContain('Jeśli zmienisz zdanie, wróć tutaj i zaznacz zgody ponownie.');
  });

  it('confirms a scoped unsubscribe without a label as this list', () => {
    expect(renderPreferenceResultPage(resultInput({ scopeLabel: null })))
      .toContain('<p class="lede">You will no longer receive messages from this list.</p>');
    expect(renderPreferenceResultPage(resultInput({ scopeLabel: null, language: 'pl' })))
      .toContain('<p class="lede">Nie będziesz już otrzymywać wiadomości z tej listy.</p>');
  });

  it('says that an unsubscribe from everything cannot be reversed from the page', () => {
    const html = renderPreferenceResultPage(resultInput({ result: 'all_unsubscribed', scopeLabel: null }));
    expect(html).toContain('<p class="lede">You will no longer receive any marketing messages from Studio Demo.</p><p class="fine">You cannot subscribe again from this page; contact the sender.</p>');
    expect(html).not.toContain('If you change your mind');
    const polish = renderPreferenceResultPage(resultInput({ result: 'all_unsubscribed', scopeLabel: null, language: 'pl' }));
    expect(polish).toContain('Nie będziesz już otrzymywać żadnych wiadomości marketingowych od nadawcy Studio Demo.');
    expect(polish).toContain('Na tej stronie nie zapiszesz się ponownie; skontaktuj się z nadawcą.');
  });

  it('confirms saved preferences and announces pending confirmations', () => {
    expect(renderPreferenceResultPage(resultInput({ result: 'saved', scopeLabel: null, pendingConfirmations: 2 })))
      .toContain('<p class="lede">Your settings have been updated. We will send a confirmation link for each newly selected consent.</p>');
    expect(renderPreferenceResultPage(resultInput({ result: 'saved', scopeLabel: null })))
      .toContain('<p class="lede">Your settings have been updated.</p>');
  });

  it('wraps long unbroken text and names each language in its own language', () => {
    const html = renderPreferencesPage({
      nonce: 'test-nonce',
      brand, language: 'en', token: 'token_1234567890123456789012', email: 'member@example.test',
      scope: 'consent:newsletter', scopeLabel: 'Product news', globallySuppressed: false,
      definitions: [{ id: 'newsletter', label: 'Product news', active: true, pendingConfirmation: false }],
    });
    expect(html).toContain('.lede{margin:.5rem 0 0;color:var(--muted);font-size:1rem;overflow-wrap:anywhere}');
    expect(html).toContain('.fine{margin:.25rem 0 0;color:var(--muted);font-size:.875rem;overflow-wrap:anywhere}');
    expect(html).toContain('.choice span{font-size:.9375rem;overflow-wrap:anywhere}');
    expect(html).toContain('font-size:.9375rem;overflow-wrap:anywhere}\n.status');
    expect(html).toContain('.prose{margin-top:2rem;overflow-wrap:anywhere}');
    expect(html).toContain('?lang=pl">Polski</a>');
    expect(html).toContain('?lang=en" aria-current="page">English</a>');
  });

  it('renders a reusable status page with escaped lines, a state cue and a link to the workspace home', () => {
    const html = renderStatusPage({
      nonce: 'test-nonce', brand, language: 'en', path: null, eyebrow: 'Status', title: 'Done <now>',
      lines: ['First <line>', 'Second & last'], testId: 'status-test', cue: 'success',
      links: [{ label: 'Back', href: '/u/token?lang=en' }],
    });
    expect(html).toContain('data-testid="status-test"');
    expect(html).toContain('<h1>Done &lt;now&gt;</h1>');
    expect(html).toContain('<span class="status-cue status-cue--success" aria-hidden="true"><svg');
    expect(html).toContain('<div class="status"><p class="lede">First &lt;line&gt;</p><p class="fine">Second &amp; last</p><div class="actions"><a class="button-link" href="/u/token?lang=en">Back</a><a class="button-link" href="/">Go to the home page</a></div></div>');
    expect(html).not.toContain('class="languages"');
    expect(html).toContain('.status{margin-top:1rem}');
    expect(html).toContain('.status .lede{color:var(--ink)}');
    expect(html).not.toContain('text-align:center');
  });

  it.each([
    ['link_invalid', 'en', 'marketing-link-invalid', 'This link does not work'],
    ['link_invalid', 'pl', 'marketing-link-invalid', 'Link jest niepełny albo nieaktualny. Otwórz link z najnowszej wiadomości albo skontaktuj się z nadawcą.'],
    ['document_not_found', 'en', 'hosted-legal-not-found', 'This document does not exist or has been withdrawn.'],
    ['document_not_found', 'pl', 'hosted-legal-not-found', 'Nie znaleziono dokumentu'],
    ['request_failed', 'en', 'marketing-request-failed', 'Something went wrong'],
  ] as const)('renders the %s error page in %s', (kind, language, testId, text) => {
    const html = renderHostedErrorPage({ nonce: 'test-nonce', brand, language, path: '/u/token', kind });
    expect(html).toContain(`data-testid="${testId}"`);
    expect(html).toContain(text);
    expect(html).toContain('status-cue--error');
    expect(html).toContain('<a href="/u/token?lang=pl"');
  });

  it.each([null, '#786000'])('uses the light accent %s on hosted pages', (accentLight) => {
    if (brand.settings == null) throw new Error('Missing brand settings');
    const html = renderLegalDocumentPage({
      nonce: 'test-nonce',
      brand: { ...brand, settings: { ...brand.settings, accentColor: '#F5C842', accentLight } },
      language: 'en', path: '/legal/privacy', title: 'Privacy', content: '[Policy](https://courses.example.org/privacy)', immutableVersion: null,
    });
    const match = /<html[^>]+style="--accent-light:(#[0-9a-f]{6});--accent-dark:(#[0-9a-f]{6})"/i.exec(html);
    if (match === null) throw new Error('Missing accent variables');
    const light = match[1] ?? '';
    const dark = match[2] ?? '';
    expect(light).toBe(accentLight ?? deriveLightAccent('#F5C842'));
    for (const background of ['#F7F4EF', '#FFFFFF']) {
      expect(contrastRatio(light, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of ['#0F1012', '#17181B']) {
      expect(contrastRatio(dark, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses self-hosted fonts and the no-JS dark scheme switch', () => {
    const html = renderPreferencesPage({
      nonce: 'test-nonce',
      brand, language: 'en', token: 'token_1234567890123456789012', email: 'member@example.test',
      scope: 'consent:newsletter', scopeLabel: 'Product news', globallySuppressed: false,
      definitions: [{ id: 'newsletter', label: 'Product news', active: true, pendingConfirmation: false }],
    });
    expect(html).toContain('<link rel="preload" as="font" type="font/woff2" href="/fonts/inter-latin-400-normal.woff2" crossorigin>');
    expect(html).toContain('<link rel="preload" as="font" type="font/woff2" href="/fonts/poppins-latin-700-normal.woff2" crossorigin>');
    expect(html).toContain('@media(prefers-color-scheme:dark)');
    expect(html).toContain("src:url(/fonts/inter-latin-400-normal.woff2) format('woff2')");
    expect(html).toContain("src:url(/fonts/poppins-latin-700-normal.woff2) format('woff2')");
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('Fraunces');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('together-theme-mode');
  });

  it('renders hosted markdown as prose while escaping markup and unsafe links', () => {
    const rendered = renderHostedMarkdown('# Privacy\n\n**Safe** [link](https://example.test)\n\n<script>alert(1)</script> [bad](javascript:alert(1))');
    expect(rendered).toContain('<h2>Privacy</h2>');
    expect(rendered).not.toContain('<h1>');
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

  it('renders numbered lists, escaped punctuation, and encoded entities the way the editor writes them', () => {
    const rendered = renderHostedMarkdown([
      '1. First step',
      '2. Second step',
      '',
      '- Only bullet',
      '',
      'Keep snake\\_case readable, show R&amp;D and 5 &lt; 6, and render _emphasis_.',
    ].join('\n'));
    expect(rendered).toContain('<ol><li>First step</li><li>Second step</li></ol>');
    expect(rendered).toContain('<ul><li>Only bullet</li></ul>');
    expect(rendered).toContain('Keep snake_case readable, show R&amp;D and 5 &lt; 6, and render <em>emphasis</em>.');
  });

  it('keeps a loose numbered list as one list and keeps its first number', () => {
    const loose = renderHostedMarkdown(['1. First clause', '', '2. Second clause', '', '3. Third clause'].join('\n'));
    expect(loose).toBe('<ol><li>First clause</li><li>Second clause</li><li>Third clause</li></ol>');
    const continued = renderHostedMarkdown(['## Part two', '', '5. Fifth clause', '6. Sixth clause', '', '7. Seventh clause'].join('\n'));
    expect(continued).toContain('<ol start="5"><li>Fifth clause</li><li>Sixth clause</li><li>Seventh clause</li></ol>');
    const bullets = renderHostedMarkdown(['- one', '', '- two', '', 'After the list'].join('\n'));
    expect(bullets).toBe('<ul><li>one</li><li>two</li></ul>\n<p>After the list</p>');
    const continuation = renderHostedMarkdown(['1. Clause', '', '   Second paragraph of the clause', '', '2. Next clause'].join('\n'));
    expect(continuation).toBe('<ol><li>Clause<p>Second paragraph of the clause</p></li><li>Next clause</li></ol>');
    const switched = renderHostedMarkdown(['1. Numbered', '', '- Bullet'].join('\n'));
    expect(switched).toBe('<ol><li>Numbered</li></ol>\n<ul><li>Bullet</li></ul>');
  });

  it('shifts headings one level below the page title and accepts single-asterisk emphasis', () => {
    const rendered = renderHostedMarkdown(['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six', '', 'Read *carefully* but keep 5 * 3 * 2 and \\*literal\\*.'].join('\n'));
    expect(rendered).toContain('<h2>One</h2>');
    expect(rendered).toContain('<h3>Two</h3>');
    expect(rendered).toContain('<h4>Three</h4>');
    expect(rendered).toContain('<h5>Four</h5>');
    expect(rendered).toContain('<h6>Five</h6>');
    expect(rendered).toContain('<h6>Six</h6>');
    expect(rendered).not.toContain('#');
    expect(rendered).toContain('Read <em>carefully</em> but keep 5 * 3 * 2 and *literal*.');
  });

  it('renders an h4 from a level-three heading of the document', () => {
    expect(renderHostedMarkdown('### Retention')).toBe('<h4>Retention</h4>');
  });

  it('renders the block structures the visual editor can produce', () => {
    const rendered = renderHostedMarkdown([
      '- one',
      '  - nested',
      '- two',
      '',
      '> first paragraph',
      '>',
      '> second paragraph',
      '',
      '---',
      '',
      '~~withdrawn~~ and ![diagram](https://acme.example/diagram.png)',
      '',
      '![blocked](http://acme.example/tracker.gif)',
    ].join('\n'));
    expect(rendered).toContain('<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>');
    expect(rendered).toContain('<blockquote><p>first paragraph</p><p>second paragraph</p></blockquote>');
    expect(rendered).toContain('<hr>');
    expect(rendered).toContain('<del>withdrawn</del>');
    expect(rendered).toContain('<img src="https://acme.example/diagram.png" alt="diagram">');
    expect(rendered).not.toContain('http://acme.example/tracker.gif');
    expect(rendered).not.toContain('!<a');
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

const signupHttpFixture = async (doubleOptIn: boolean) => {
  const fixture = await createDirectoryFixture();
  const definition = await fixture.deps.definitions.findById('directory-a', 'newsletter');
  if (definition === null) throw new Error('Missing definition');
  await fixture.deps.definitions.update('directory-a', { ...definition, doubleOptIn });
  const deps = createDeps(envSchema.parse({ NODE_ENV: 'test', DATABASE_URL: fixture.url, REALTIME_TRANSPORT: 'in-process', APP_BASE_DOMAIN: 'example.org', APP_BASE_URL: 'https://platform.example.org', SECRETS_MASTER_KEY: Buffer.alloc(32, 1).toString('base64') }), { db: fixture.db, clock: fixture.deps.clock });
  if (deps.marketingSignup === undefined) throw new Error('Missing signup dependencies');
  const now = fixture.deps.clock.nowIso();
  directoryValue(await fixture.deps.lists.save('directory-a', { list: { id: 'newsletter-list', tenantId: 'directory-a', key: 'newsletter', name: 'Newsletter', kind: 'static', rule: null, revision: 1, createdAt: now, updatedAt: now, archivedAt: null }, expectedRevision: null }));
  const { form } = directoryValue(await createMarketingSignupForm(directoryCtx(), { slug: 'newsletter', name: 'Newsletter', consentDefinitionId: 'newsletter', listId: 'newsletter-list', tags: ['signup'], collectName: true, successText: { en: 'Thank you', pl: 'Thank you' } }, deps.marketingSignup));
  const { contact } = await fixture.deps.contacts.upsertByEmail('directory-a', { email: 'reader@example.org', displayName: 'Real Name', source: 'import', tags: ['existing'] });
  await fixture.deps.contacts.archive('directory-a', { contactId: contact.id, archivedAt: now });
  const app = buildApp(deps);
  const request = (path: string, init: RequestInit = {}) => app.request(`https://directory-a.example.org${path}`, { ...init, headers: { host: 'directory-a.example.org', ...init.headers } });
  const submit = () => request('/api/public/marketing/forms/newsletter/submit', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: contact.email, displayName: 'Fake', token: form.token }) });
  const snapshot = async () => ({
    contact: await fixture.deps.contacts.findByEmail('directory-a', contact.email),
    consents: await fixture.db.select().from(marketingConsents),
    outbox: await fixture.db.select().from(emailOutbox),
    events: await fixture.db.select().from(marketingDirectoryEvents),
    memberships: await fixture.db.select().from(marketingListMemberships),
    submissions: await fixture.db.select().from(marketingSignupSubmissions),
    confirmations: await fixture.db.select().from(consentConfirmationTokens),
  });
  return { ...fixture, deps, contact, now, request, submit, snapshot };
};

describe('public signup persistence and confirmation', () => {
  it.each([false, true])('returns the thanks page without writes for a suppressed contact with double opt-in=%s', async (doubleOptIn) => {
    const fixture = await signupHttpFixture(doubleOptIn);
    try {
      const suppression = { id: 'suppression', tenantId: 'directory-a', email: fixture.contact.email, emailHmac: fixture.contact.emailHmac, reason: doubleOptIn ? 'unsubscribe_global' as const : 'manual' as const, sourceRef: null, meta: null, createdAt: fixture.now, liftedAt: null, liftedBy: null };
      await fixture.deps.marketing?.suppressions.record('directory-a', suppression);
      const before = await fixture.snapshot();
      const result = await fixture.submit();
      expect(result.status).toBe(303);
      const location = result.headers.get('location') ?? '';
      expect(location).toMatch(/^\/marketing\/forms\/newsletter\/thanks\?lang=/);
      const thanks = await fixture.request(location);
      expect(thanks.status).toBe(200);
      expect(await thanks.text()).toContain('Thank you');
      expect(await fixture.snapshot()).toEqual(before);
      expect(await fixture.deps.marketing?.suppressions.findActive('directory-a', fixture.contact.emailHmac)).toEqual(suppression);
    } finally { await fixture.close(); }
  });
  it('rolls back token consumption, consent and contact effects when membership fails', async () => {
    const fixture = await signupHttpFixture(true);
    try {
      const marketing = fixture.deps.marketing;
      if (marketing === undefined) throw new Error('Missing marketing dependencies');
      expect((await fixture.submit()).status).toBe(303);
      const pending = await fixture.snapshot();
      const consent = pending.consents[0];
      if (consent === undefined) throw new Error('Missing consent');
      const token = await signupConfirmationToken(fixture.db, 'directory-a', consent.id);
      const transaction = marketing.confirmationTransaction;
      marketing.confirmationTransaction = { run: (tenantId, operation) => transaction.run(tenantId, (repos) => operation({ ...repos, lists: { ...repos.lists, addMembers: async () => { throw new Error('Membership write failed'); } } })) };
      const response = await fixture.request(`/marketing/confirm/${token}?lang=en`, { method: 'POST' });
      expect(response.status).toBe(500);
      expect(await fixture.snapshot()).toEqual(pending);
    } finally { await fixture.close(); }
  });
  it('applies deferred effects through the composed public confirmation route exactly once', async () => {
    const fixture = await signupHttpFixture(true);
    try {
      const before = await fixture.snapshot();
      expect((await fixture.submit()).status).toBe(303);
      const pending = await fixture.snapshot();
      expect(pending.contact).toEqual(before.contact);
      expect(pending.memberships).toEqual([]);
      expect(pending.outbox).toHaveLength(1);
      expect(pending.submissions).toHaveLength(1);
      const consent = pending.consents[0];
      if (consent === undefined) throw new Error('Missing consent');
      const token = await signupConfirmationToken(fixture.db, 'directory-a', consent.id);
      const path = `/marketing/confirm/${token}?lang=en`;
      expect((await fixture.request(path)).status).toBe(200);
      expect(await fixture.snapshot()).toEqual(pending);
      const response = await fixture.request(path, { method: 'POST' });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Email address confirmed');
      const confirmed = await fixture.snapshot();
      expect(confirmed.contact).toMatchObject({ displayName: 'Real Name', source: 'import', archivedAt: null, tags: ['existing', 'signup'] });
      expect(confirmed.memberships).toMatchObject([{ listId: 'newsletter-list', contactId: fixture.contact.id, removedAt: null }]);
      expect(confirmed.consents).toHaveLength(2);
      expect(confirmed.consents).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'confirmed', previousId: consent.id })]));
      expect(Date.parse(confirmed.confirmations[0]?.usedAt ?? '')).toBe(Date.parse(fixture.now));
      expect(await (await fixture.request(path, { method: 'POST' })).text()).toContain('Email address confirmed');
      expect(await fixture.snapshot()).toEqual(confirmed);
    } finally { await fixture.close(); }
  });
});
