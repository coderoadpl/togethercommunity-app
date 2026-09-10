import { DEFAULT_LANGUAGE, deriveDarkAccent, deriveLightAccent, languageSchema, resolveTenantLogo, type Language, type Tenant, type TenantSettings } from '#core/domain/index.js';

import { publicMarketingMessagesEn } from './public-marketing-pages.en.js';
import type { PublicMarketingMessages } from './public-marketing-pages-messages.js';
import { publicMarketingMessagesPl } from './public-marketing-pages.pl.js';

const messages: Record<Language, PublicMarketingMessages> = {
  pl: publicMarketingMessagesPl,
  en: publicMarketingMessagesEn,
};

export interface PublicBrand {
  tenant: Tenant;
  settings: TenantSettings | null;
}

export interface PublicPreferenceDefinition {
  id: string;
  label: string;
  active: boolean;
  pendingConfirmation: boolean;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] ?? character);

const safeHref = (value: string): string | null => {
  if (value.startsWith('/') || value.startsWith('#')) return value;
  if (!URL.canParse(value)) return null;
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? value : null;
};

const renderMarkdownText = (source: string): string => {
  let output = '';
  let cursor = 0;
  for (const match of source.matchAll(/`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu)) {
    const index = match.index;
    if (index === undefined) continue;
    output += escapeHtml(source.slice(cursor, index));
    const [token, code, strong, emphasis] = match;
    if (code !== undefined) output += `<code>${escapeHtml(code)}</code>`;
    else if (strong !== undefined) output += `<strong>${escapeHtml(strong)}</strong>`;
    else output += `<em>${escapeHtml(emphasis ?? '')}</em>`;
    cursor = index + token.length;
  }
  return output + escapeHtml(source.slice(cursor));
};

const renderInlineMarkdown = (source: string): string => {
  let output = '';
  let cursor = 0;
  for (const match of source.matchAll(/\[([^\]]+)]\(([^)\s]+)\)/g)) {
    const index = match.index;
    const label = match[1];
    const href = match[2];
    if (index === undefined || label === undefined || href === undefined) continue;
    output += renderMarkdownText(source.slice(cursor, index));
    const safe = safeHref(href);
    output += safe === null
      ? renderMarkdownText(match[0])
      : `<a href="${escapeHtml(safe)}">${renderMarkdownText(label)}</a>`;
    cursor = index + match[0].length;
  }
  return output + renderMarkdownText(source.slice(cursor));
};

export const renderHostedMarkdown = (source: string): string => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length > 0) blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      if (code === null) code = [];
      else {
        blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      blocks.push(`<h${String(level)}>${renderInlineMarkdown(heading[2] ?? '')}</h${String(level)}>`);
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item !== null) {
      flushParagraph();
      list.push(item[1] ?? '');
      continue;
    }
    const quote = /^>\s?(.+)$/.exec(line);
    if (quote !== null) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInlineMarkdown(quote[1] ?? '')}</blockquote>`);
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (code !== null) blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return blocks.join('\n');
};

export const languageFromRequest = (request: Request, defaultLanguage: Language = DEFAULT_LANGUAGE): Language => {
  const queryLanguage = languageSchema.safeParse(new URL(request.url).searchParams.get('lang'));
  if (queryLanguage.success) return queryLanguage.data;
  const cookieLanguage = request.headers.get('cookie')?.match(/(?:^|;\s*)together-language=(pl|en)(?:;|$)/)?.[1];
  const parsedCookie = languageSchema.safeParse(cookieLanguage);
  if (parsedCookie.success) return parsedCookie.data;
  const browserLanguage = languageSchema.safeParse(
    request.headers.get('accept-language')?.split(',')[0]?.trim().toLowerCase().split(';')[0]?.split('-')[0],
  );
  return browserLanguage.success ? browserLanguage.data : defaultLanguage;
};

const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT_RANGE = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const fontFace = (family: string, weight: number, file: string, range: string): string =>
  `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${String(weight)};src:url(/fonts/${file}.woff2) format('woff2');unicode-range:${range}}`;
const publicFontFaces = [
  ...[400, 500, 600, 700].flatMap((weight) => [
    fontFace('Inter', weight, `inter-latin-${String(weight)}-normal`, LATIN_RANGE),
    fontFace('Inter', weight, `inter-latin-ext-${String(weight)}-normal`, LATIN_EXT_RANGE),
  ]),
  ...[600, 700].flatMap((weight) => [
    fontFace('Poppins', weight, `poppins-latin-${String(weight)}-normal`, LATIN_RANGE),
    fontFace('Poppins', weight, `poppins-latin-ext-${String(weight)}-normal`, LATIN_EXT_RANGE),
  ]),
].join('');

const publicStyles = `${publicFontFaces}:root{color-scheme:light dark;--bg:#F7F4EF;--surface:#FFFFFF;--muted-surface:#F4F4F2;--pressed:#ECEBE9;--ink:#1B1A18;--muted:#63615C;--line:#E6E5E2;--line-strong:#D6D4D0;--toggle-selected:#FFFFFF;--primary:#1B1A18;--primary-hover:#2F2D2A;--primary-active:#3B3936;--primary-ink:#FFFFFF;--danger:#C21E1E;--danger-strong:#A81A1A;--danger-ink:#FFFFFF;--shadow:0 1px 2px 0 rgba(0,0,0,.05);--accent:var(--accent-light);--radius:8px;--radius-card:12px;--font-body:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;--font-display:'Poppins','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-family:var(--font-body)}
@media(prefers-color-scheme:dark){:root{--bg:#0F1012;--surface:#17181B;--muted-surface:#1B1D20;--pressed:#26282D;--ink:#EDEEF0;--muted:#A0A3A8;--line:#26282C;--line-strong:#33363C;--toggle-selected:#26282D;--primary:#EDEEF0;--primary-hover:#D9DBDE;--primary-active:#C9CCD0;--primary-ink:#101113;--danger:#F0857A;--danger-strong:#F0857A;--danger-ink:#2A0F0B;--shadow:0 1px 2px 0 rgba(0,0,0,.45);--accent:var(--accent-dark)}}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font-size:1rem;line-height:1.6;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
a{color:var(--accent);font-weight:500;text-decoration-line:underline;text-decoration-color:color-mix(in srgb,var(--accent) 40%,transparent);text-underline-offset:.15em}
a:hover{text-decoration-color:currentColor}
button,input{font:inherit}
button{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:48px;padding:.7rem 1rem;border:1px solid transparent;border-radius:var(--radius);background:var(--primary);color:var(--primary-ink);box-shadow:var(--shadow);font-size:.875rem;font-weight:500;line-height:1.45;letter-spacing:0;cursor:pointer}
button:hover{background:var(--primary-hover)}
button:active{background:var(--primary-active);box-shadow:inset 0 1px 2px rgba(0,0,0,.18)}
button.secondary{border-color:var(--line);background:var(--surface);color:var(--ink)}
button.secondary:hover{border-color:var(--line-strong);background:var(--muted-surface)}
button.secondary:active{background:var(--pressed);box-shadow:var(--shadow)}
button.danger{border-color:var(--danger);background:var(--danger);color:var(--danger-ink)}
button.danger:hover{border-color:var(--danger-strong);background:var(--danger-strong)}
button.danger:active{background:var(--danger-strong);box-shadow:inset 0 1px 2px rgba(0,0,0,.18)}
button:disabled{border-color:transparent;background:var(--pressed);color:var(--muted);box-shadow:none;cursor:not-allowed}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.shell{width:min(calc(100% - 2rem),40rem);margin:0 auto;padding:1.5rem 0 4rem}
.brand{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding-bottom:1rem}
.brand-mark{display:flex;align-items:center;gap:.6rem;min-width:0}
.brand img{display:block;width:auto;height:auto;min-width:0;max-width:min(10rem,100%);max-height:2.5rem;object-fit:contain}
.brand-logo--dark{display:none}
.brand-name{font-family:var(--font-display);font-size:1.25rem;font-weight:600;letter-spacing:-.015em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.languages{display:inline-flex;flex:none;gap:.125rem;padding:.1875rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--muted-surface);font-size:.8125rem;white-space:nowrap}
.languages a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:.35rem .85rem;border-radius:6px;color:var(--muted);font-weight:500;line-height:1.45;text-decoration:none}
.languages a:hover{color:var(--ink)}
.languages a[aria-current="page"]{background:var(--toggle-selected);color:var(--ink);box-shadow:var(--shadow)}
.page{padding-top:2.5rem}
.eyebrow{margin:0 0 .5rem;color:var(--muted);font-size:.75rem;font-weight:500;letter-spacing:0;line-height:1.7;text-transform:none}
.page h1{margin:0;font-family:var(--font-display);font-size:1.75rem;font-weight:700;line-height:1.14;letter-spacing:-.03em}
.lede{margin:.5rem 0 0;color:var(--muted);font-size:1rem}
.card{margin-top:1.75rem;border:1px solid var(--line);border-radius:var(--radius-card);background:var(--surface);box-shadow:var(--shadow);padding:1.25rem}
.card h2{margin:0 0 .35rem;font-family:var(--font-display);font-size:1.125rem;font-weight:600;letter-spacing:-.015em;line-height:1.4}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.25rem}
.danger-zone{border-color:color-mix(in srgb,var(--danger) 50%,transparent)}
.fine{margin:.25rem 0 0;color:var(--muted);font-size:.875rem}
.choice{display:grid;grid-template-columns:auto 1fr;align-items:start;gap:.15rem .75rem;min-height:44px;padding:.85rem 0;border-bottom:1px solid var(--line)}
.choice:last-of-type{border-bottom:0}
.choice input{width:1.15rem;height:1.15rem;margin:.28rem 0 0;accent-color:var(--accent)}
.choice span{font-size:.9375rem}
.choice small{grid-column:2;color:var(--muted);font-size:.8125rem}
.notice{margin-top:1.5rem;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));border-radius:10px;background:color-mix(in srgb,var(--accent) 7%,var(--surface));padding:.85rem 1rem;font-size:.9375rem}
.status{padding-block:clamp(2.5rem,10vw,5rem);text-align:center}
.status .lede{max-width:32rem;margin-inline:auto}
.status .actions{justify-content:center}
.prose{margin-top:2rem}
.prose h1,.prose h2,.prose h3{font-family:var(--font-display);font-weight:600;letter-spacing:-.015em;line-height:1.35;margin:2rem 0 .6rem}
.prose h1{font-size:1.5rem}
.prose h2{font-size:1.25rem}
.prose h3{font-size:1.0625rem}
.prose p,.prose ul,.prose blockquote{margin:0 0 1rem}
.prose ul{padding-left:1.25rem}
.prose blockquote{border-left:3px solid var(--line);padding-left:1rem;color:var(--muted)}
.prose pre{overflow:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--muted-surface);padding:1rem}
.prose code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
.social-links{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--line);font-size:.875rem}
.social-links a{display:inline-flex;align-items:center;min-height:44px;color:var(--muted);font-weight:400;text-decoration-color:color-mix(in srgb,var(--muted) 45%,transparent)}
@media(min-width:600px){.shell{padding:2.5rem 0 5rem}.page{padding-top:3.5rem}.page > h1{font-size:2.5rem}.brand-name{font-size:1.5rem}.card{padding:1.75rem}}
@media(max-width:520px){.brand{gap:.75rem}.brand img{max-width:8rem}.brand-name{font-size:1.125rem}.actions{flex-direction:column;align-items:stretch}.actions button{width:100%}}
@media(prefers-color-scheme:dark){.brand-logo--light{display:none}.brand-logo--dark{display:block}}`;

const renderPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  path: string;
  title: string;
  eyebrow: string;
  body: string;
  testId: string;
}): string => {
  const t = messages[input.language];
  const settings = input.brand.settings;
  const accentSource = settings?.accentColor ?? '#7c3aed';
  const accentLight = settings?.accentLight ?? deriveLightAccent(accentSource);
  const accentDark = deriveDarkAccent(accentSource);
  const logoLight = settings == null ? null : resolveTenantLogo(settings, 'light');
  const logoDark = settings == null ? null : resolveTenantLogo(settings, 'dark');
  const brandName = escapeHtml(input.brand.tenant.name);
  const brandImage = (url: string, className: string): string =>
    `<img class="${className}" src="${escapeHtml(url)}" alt="${brandName}">`;
  const faviconUrl = input.brand.settings?.faviconUrl;
  const brandMark = logoLight === null
    ? `<span class="brand-name">${brandName}</span>`
    : logoDark === null || logoDark === logoLight
      ? brandImage(logoLight, 'brand-logo')
      : `${brandImage(logoLight, 'brand-logo brand-logo--light')}${brandImage(logoDark, 'brand-logo brand-logo--dark')}`;
  const favicon = faviconUrl === null || faviconUrl === undefined
    ? ''
    : `<link rel="icon" href="${escapeHtml(faviconUrl)}">`;
  const socialLinks = input.brand.settings?.socialLinks ?? [];
  const socialNavigation = socialLinks.length === 0
    ? ''
    : `<nav class="social-links" aria-label="${escapeHtml(t.socialProfiles)}">${socialLinks
      .map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.label)}</a>`)
      .join('')}</nav>`;
  return `<!doctype html><html lang="${input.language}" style="--accent-light:${escapeHtml(accentLight)};--accent-dark:${escapeHtml(accentDark)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#F7F4EF"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0F1012">${favicon}<title>${escapeHtml(input.title)} · ${brandName}</title><link rel="preload" as="font" type="font/woff2" href="/fonts/inter-latin-400-normal.woff2" crossorigin><link rel="preload" as="font" type="font/woff2" href="/fonts/poppins-latin-700-normal.woff2" crossorigin><style>${publicStyles}</style></head><body><main class="shell" data-testid="${escapeHtml(input.testId)}"><header class="brand"><div class="brand-mark">${brandMark}</div><nav class="languages" aria-label="${escapeHtml(t.language)}"><a href="${escapeHtml(input.path)}?lang=pl"${input.language === 'pl' ? ' aria-current="page"' : ''}>${escapeHtml(t.polish)}</a><a href="${escapeHtml(input.path)}?lang=en"${input.language === 'en' ? ' aria-current="page"' : ''}>${escapeHtml(t.english)}</a></nav></header><section class="page"><p class="eyebrow">${escapeHtml(input.eyebrow)}</p><h1>${escapeHtml(input.title)}</h1>${input.body}</section>${socialNavigation}</main></body></html>`;
};

export const renderPreferencesPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  token: string;
  email: string;
  scope: string;
  scopeLabel: string | null;
  globallySuppressed: boolean;
  definitions: PublicPreferenceDefinition[];
}): string => {
  const t = messages[input.language];
  const path = `/u/${encodeURIComponent(input.token)}`;
  const formSuffix = `?lang=${input.language}`;
  const scope = input.scope === 'all_marketing'
    ? t.scopeAll
    : t.scopeNamed({ scope: input.scopeLabel ?? input.scope.slice('consent:'.length) });
  const choices = input.definitions.length === 0
    ? `<p class="fine">${escapeHtml(t.noOptionalConsents)}</p>`
    : input.definitions.map((definition) => `<label class="choice"><input type="hidden" name="present-consent" value="${escapeHtml(definition.id)}"><input type="checkbox" name="consent" value="${escapeHtml(definition.id)}"${definition.active || definition.pendingConfirmation ? ' checked' : ''}${input.globallySuppressed ? ' disabled' : ''}><span>${escapeHtml(definition.label)}</span>${definition.pendingConfirmation ? `<small>${escapeHtml(t.pendingConfirmation)}</small>` : ''}</label>`).join('');
  const preferenceForm = input.globallySuppressed
    ? `<p class="notice">${escapeHtml(t.globallyUnsubscribed({ tenant: input.brand.tenant.name }))}</p>`
    : `<form method="post" action="${path}/preferences${formSuffix}">${choices}<div class="actions"><button type="submit">${escapeHtml(t.savePreferences)}</button></div></form>`;
  const body = `<p class="lede">${escapeHtml(t.preferencesFor({ email: input.email }))}</p><p class="notice">${escapeHtml(t.scopeIntro({ scope }))}</p><section class="card danger-zone"><h2>${escapeHtml(t.unsubscribeScope)}</h2><p class="fine">${escapeHtml(t.unsubscribeWarning)}</p><div class="actions"><form method="post" action="${path}/confirm${formSuffix}"><button class="danger" type="submit">${escapeHtml(t.unsubscribeScope)}</button></form><form method="post" action="${path}/all${formSuffix}"><button class="secondary" type="submit">${escapeHtml(t.unsubscribeEverything({ tenant: input.brand.tenant.name }))}</button></form></div></section><section class="card"><h2>${escapeHtml(t.consentsTitle)}</h2><p class="fine">${escapeHtml(t.consentsIntro)}</p>${preferenceForm}</section>`;
  return renderPage({ nonce: input.nonce, brand: input.brand, language: input.language, path, title: t.preferencesTitle, eyebrow: t.preferencesEyebrow, body, testId: 'marketing-preferences' });
};

export const renderPreferenceResultPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  token: string;
  result: 'saved' | 'scope_unsubscribed' | 'all_unsubscribed';
  scopeLabel: string | null;
  pendingConfirmations?: number;
}): string => {
  const t = messages[input.language];
  const path = `/u/${encodeURIComponent(input.token)}`;
  const saved = input.result === 'saved';
  const title = saved ? t.preferencesSavedTitle : t.unsubscribedTitle;
  const summary = input.result === 'saved'
    ? `${t.preferencesSavedBody}${(input.pendingConfirmations ?? 0) > 0 ? ` ${t.preferencesPendingBody}` : ''}`
    : input.result === 'all_unsubscribed'
      ? t.unsubscribedAllBody({ tenant: input.brand.tenant.name })
      : t.unsubscribedScopeBody({ scope: input.scopeLabel ?? t.scopeAll });
  const hint = input.result === 'scope_unsubscribed'
    ? `<p class="fine">${escapeHtml(t.resubscribeHint)}</p>`
    : '';
  const body = `<div class="status"><p class="lede">${escapeHtml(summary)}</p>${hint}<div class="actions"><a href="${path}?lang=${input.language}">${escapeHtml(t.backToPreferences)}</a></div></div>`;
  return renderPage({ nonce: input.nonce, brand: input.brand, language: input.language, path, title, eyebrow: t.preferencesEyebrow, body, testId: 'marketing-preference-result' });
};

export const renderLegalDocumentPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  path: string;
  title: string;
  content: string;
  immutableVersion: { version: number; publishedAt: string } | null;
}): string => {
  const t = messages[input.language];
  const locale = input.language === 'pl' ? 'pl-PL' : 'en-US';
  const notice = input.immutableVersion === null
    ? ''
    : `<p class="notice">${escapeHtml(t.immutableVersion({
        version: input.immutableVersion.version,
        date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(input.immutableVersion.publishedAt)),
      }))}</p>`;
  const body = `${notice}<article class="prose">${renderHostedMarkdown(input.content)}</article>`;
  return renderPage({ nonce: input.nonce, brand: input.brand, language: input.language, path: input.path, title: input.title, eyebrow: t.legalEyebrow, body, testId: 'hosted-legal-document' });
};

export const renderConfirmationPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  path: string;
  state: 'prompt' | 'success' | 'expired';
}): string => {
  const t = messages[input.language];
  const success = input.state === 'success';
  const prompt = input.state === 'prompt';
  const title = prompt ? t.confirmationPromptTitle : success ? t.confirmationSuccessTitle : t.confirmationExpiredTitle;
  const summary = success
    ? t.confirmationSuccessBody({ tenant: input.brand.tenant.name })
    : prompt
      ? t.confirmationPromptBody({ tenant: input.brand.tenant.name })
      : t.confirmationExpiredBody;
  const action = prompt
    ? `<form class="actions" method="post" action="${input.path}?lang=${input.language}"><button type="submit">${escapeHtml(t.confirmationSubmit)}</button></form>`
    : '';
  return renderPage({
    nonce: input.nonce,
    brand: input.brand,
    language: input.language,
    path: input.path,
    title,
    eyebrow: t.confirmationEyebrow,
    body: `<div class="status"><p class="lede">${escapeHtml(summary)}</p>${action}</div>`,
    testId: `marketing-confirmation-${input.state}`,
  });
};
