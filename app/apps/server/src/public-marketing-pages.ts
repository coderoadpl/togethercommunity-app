import type { MarketingSignupForm } from '#core/domain/index.js';
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

const decodedEntities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };

const escapeMarkdownText = (value: string): string =>
  escapeHtml(value.replace(/&(?:amp|lt|gt);/g, (entity) => decodedEntities[entity] ?? entity));

const renderMarkdownText = (source: string): string => {
  let output = '';
  let cursor = 0;
  for (const match of source.matchAll(/`([^`\n]+)`|\\([\\`*_[\]~])|\*\*([^*\n]+)\*\*|\*(?![\s*])([^*\n]*[^\s*])\*|~~([^~\n]+)~~|(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu)) {
    const index = match.index;
    if (index === undefined) continue;
    output += escapeMarkdownText(source.slice(cursor, index));
    const [token, code, escaped, strong, starred, struck, underscored] = match;
    const emphasis = starred ?? underscored;
    if (code !== undefined) output += `<code>${escapeHtml(code)}</code>`;
    else if (escaped !== undefined) output += escapeHtml(escaped);
    else if (strong !== undefined) output += `<strong>${escapeMarkdownText(strong)}</strong>`;
    else if (struck !== undefined) output += `<del>${escapeMarkdownText(struck)}</del>`;
    else output += `<em>${escapeMarkdownText(emphasis ?? '')}</em>`;
    cursor = index + token.length;
  }
  return output + escapeMarkdownText(source.slice(cursor));
};

const renderInlineMarkdown = (source: string): string => {
  let output = '';
  let cursor = 0;
  for (const match of source.matchAll(/(!?)\[([^\]]+)]\(([^)\s]+)\)/g)) {
    const index = match.index;
    const label = match[2];
    const target = match[3];
    if (index === undefined || label === undefined || target === undefined) continue;
    output += renderMarkdownText(source.slice(cursor, index));
    if (match[1] === '!') {
      output += target.startsWith('https://') ? `<img src="${escapeHtml(target)}" alt="${escapeMarkdownText(label)}">` : '';
    } else {
      const safe = safeHref(target);
      output += safe === null
        ? renderMarkdownText(match[0])
        : `<a href="${escapeHtml(safe)}">${renderMarkdownText(label)}</a>`;
    }
    cursor = index + match[0].length;
  }
  return output + renderMarkdownText(source.slice(cursor));
};

const thematicBreakPattern = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const listItemPattern = /^(\s*)(?:[-*+]|(\d{1,9})[.)])\s+(.*)$/;
const quotePattern = /^ {0,3}>/;

interface ListItemStart {
  indent: number;
  ordered: boolean;
  number: number;
  content: string;
}

const listItemStart = (line: string): ListItemStart | null => {
  if (thematicBreakPattern.test(line)) return null;
  const match = listItemPattern.exec(line);
  return match === null
    ? null
    : {
        indent: (match[1] ?? '').length,
        ordered: match[2] !== undefined,
        number: Number(match[2] ?? '1'),
        content: match[3] ?? '',
      };
};

const withoutLeadingParagraph = (blocks: readonly string[]): string => {
  const [first, ...rest] = blocks;
  return first !== undefined && first.startsWith('<p>') && first.endsWith('</p>')
    ? first.slice(3, -4) + rest.join('')
    : blocks.join('');
};

const renderListBlock = (lines: readonly string[], start: number): { html: string; next: number } => {
  const first = listItemStart(lines[start] ?? '');
  const items: string[][] = [];
  let index = start;
  while (first !== null && index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      let following = index + 1;
      while (following < lines.length && (lines[following] ?? '').trim() === '') following += 1;
      const next = lines[following] ?? '';
      const sibling = listItemStart(next);
      const continuesList = sibling !== null && sibling.indent <= first.indent
        ? sibling.ordered === first.ordered
        : next.length - next.trimStart().length > first.indent && items.length > 0;
      if (!continuesList) break;
      if (sibling === null || sibling.indent > first.indent) items.at(-1)?.push('');
      index = following;
      continue;
    }
    const item = listItemStart(line);
    if (item !== null && item.indent <= first.indent) {
      if (item.ordered !== first.ordered) break;
      items.push([item.content]);
      index += 1;
      continue;
    }
    const current = items.at(-1);
    if (current === undefined || (item === null && !line.startsWith(' '))) break;
    current.push(item === null ? line.trim() : line);
    index += 1;
  }
  const ordered = first?.ordered === true;
  const tag = ordered ? 'ol' : 'ul';
  const startAttribute = ordered && first.number !== 1 ? ` start="${String(first.number)}"` : '';
  const body = items.map((item) => `<li>${withoutLeadingParagraph(renderMarkdownBlocks(item))}</li>`).join('');
  return { html: `<${tag}${startAttribute}>${body}</${tag}>`, next: Math.max(index, start + 1) };
};

const renderMarkdownBlocks = (lines: readonly string[]): string[] => {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().startsWith('```')) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      const level = Math.min((heading[1]?.length ?? 1) + 1, 6);
      blocks.push(`<h${String(level)}>${renderInlineMarkdown(heading[2] ?? '')}</h${String(level)}>`);
      index += 1;
      continue;
    }
    if (thematicBreakPattern.test(line)) {
      flushParagraph();
      blocks.push('<hr>');
      index += 1;
      continue;
    }
    if (listItemStart(line) !== null) {
      flushParagraph();
      const list = renderListBlock(lines, index);
      blocks.push(list.html);
      index = list.next;
      continue;
    }
    if (quotePattern.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && quotePattern.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^ {0,3}> ?/, ''));
        index += 1;
      }
      const inner = renderMarkdownBlocks(quoted);
      blocks.push(`<blockquote>${inner.length === 1 ? withoutLeadingParagraph(inner) : inner.join('')}</blockquote>`);
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flushParagraph();
  return blocks;
};

export const renderHostedMarkdown = (source: string): string =>
  renderMarkdownBlocks(source.replace(/\r\n?/g, '\n').split('\n')).join('\n');

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

const publicStyles = `${publicFontFaces}:root{color-scheme:light dark;--bg:#F7F4EF;--surface:#FFFFFF;--muted-surface:#F4F4F2;--pressed:#ECEBE9;--ink:#1B1A18;--muted:#63615C;--line:#E6E5E2;--line-strong:#D6D4D0;--input-border:#8C8A85;--toggle-selected:#FFFFFF;--primary:#1B1A18;--primary-hover:#2F2D2A;--primary-active:#3B3936;--primary-ink:#FFFFFF;--danger:#C21E1E;--danger-strong:#A81A1A;--danger-ink:#FFFFFF;--shadow:0 1px 2px 0 rgba(0,0,0,.05);--accent:var(--accent-light);--radius:8px;--radius-card:12px;--font-body:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;--font-display:'Poppins','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-family:var(--font-body)}
@media(prefers-color-scheme:dark){:root{--bg:#0F1012;--surface:#17181B;--muted-surface:#1B1D20;--pressed:#26282D;--ink:#EDEEF0;--muted:#A0A3A8;--line:#26282C;--line-strong:#33363C;--input-border:#6B6F76;--toggle-selected:#26282D;--primary:#EDEEF0;--primary-hover:#D9DBDE;--primary-active:#C9CCD0;--primary-ink:#101113;--danger:#F0857A;--danger-strong:#F0857A;--danger-ink:#2A0F0B;--shadow:0 1px 2px 0 rgba(0,0,0,.45);--accent:var(--accent-dark)}}
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
.brand-mark{display:flex;align-items:center;gap:.6rem;min-width:0;color:inherit;text-decoration:none}
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
.lede{margin:.5rem 0 0;color:var(--muted);font-size:1rem;overflow-wrap:anywhere}
.card{margin-top:1.75rem;border:1px solid var(--line);border-radius:var(--radius-card);background:var(--surface);box-shadow:var(--shadow);padding:1.25rem}
.card h2,.card legend{margin:0 0 .35rem;font-family:var(--font-display);font-size:1.125rem;font-weight:600;letter-spacing:-.015em;line-height:1.4}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.25rem}
.choices{min-width:0;margin:0;padding:0;border:0}
.choices legend{padding:0}
.unsubscribe-option{display:grid;justify-items:start;gap:.75rem;margin-top:.75rem}
.unsubscribe-option + .unsubscribe-option{margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid var(--line)}
.unsubscribe-option .fine{margin:0}
.state-line{margin:0;font-weight:500;overflow-wrap:anywhere}
button.secondary.danger-text{color:var(--danger)}
button.secondary.danger-text:hover{color:var(--danger-strong)}
.fine{margin:.25rem 0 0;color:var(--muted);font-size:.875rem;overflow-wrap:anywhere}
.choice{display:grid;grid-template-columns:auto 1fr;align-items:start;gap:.15rem .75rem;min-height:44px;padding:.85rem 0;border-bottom:1px solid var(--line)}
.choice:last-of-type{border-bottom:0}
.choice input{width:1.15rem;height:1.15rem;margin:.28rem 0 0;accent-color:var(--accent)}
.choice span{font-size:.9375rem;overflow-wrap:anywhere}
.choice small{grid-column:2;color:var(--muted);font-size:.8125rem}
.notice{margin-top:1.5rem;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));border-radius:10px;background:color-mix(in srgb,var(--accent) 7%,var(--surface));padding:.85rem 1rem;font-size:.9375rem;overflow-wrap:anywhere}
.status{margin-top:1rem}
.status .lede,.status .fine{max-width:36rem}
.status .lede{color:var(--ink)}
.status-cue{display:flex;align-items:center;justify-content:center;width:2.5rem;height:2.5rem;margin:0 0 1rem;border-radius:999px;background:color-mix(in srgb,var(--accent) 12%,var(--surface));color:var(--accent)}
.status-cue--error{background:color-mix(in srgb,var(--danger) 12%,var(--surface));color:var(--danger)}
.status-cue svg{width:1.25rem;height:1.25rem}
.button-link{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.7rem 1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--ink);box-shadow:var(--shadow);font-size:.875rem;font-weight:500;line-height:1.45;text-decoration:none}
.button-link:hover{border-color:var(--line-strong);background:var(--muted-surface)}
.button-link:active{background:var(--pressed)}
.button-link--primary{border-color:transparent;background:var(--primary);color:var(--primary-ink)}
.button-link--primary:hover{border-color:transparent;background:var(--primary-hover)}
.button-link--primary:active{background:var(--primary-active);box-shadow:inset 0 1px 2px rgba(0,0,0,.18)}
.prose{margin-top:2rem;overflow-wrap:anywhere}
.prose h2,.prose h3,.prose h4,.prose h5,.prose h6{font-family:var(--font-display);font-weight:600;letter-spacing:-.015em;line-height:1.35;margin:2rem 0 .6rem}
.prose h2{font-size:1.5rem}
.prose h3{font-size:1.25rem}
.prose h4{font-size:1.0625rem}
.prose h5,.prose h6{font-size:1rem}
.prose p,.prose ul,.prose ol,.prose blockquote{margin:0 0 1rem}
.prose ul,.prose ol{padding-left:1.25rem}
.prose blockquote{border-left:3px solid var(--line);padding-left:1rem;color:var(--muted)}
.prose hr{border:0;border-top:1px solid var(--line);margin:0 0 1rem}
.prose img{display:block;max-width:100%;height:auto;border-radius:var(--radius);margin:0 0 1rem}
.prose pre{overflow:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--muted-surface);padding:1rem}
.prose code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
.signup-field{display:grid;gap:.5rem;margin-block:1.25rem}.signup-field:first-child{margin-top:0}.signup-field input{width:100%;min-height:48px;padding:.75rem;border:1px solid var(--input-border);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}.signup-trap{display:none}
.signup-consent{margin:1.25rem 0 0;color:var(--ink);font-size:.9375rem;overflow-wrap:anywhere}
.signup-form .actions{margin-top:.75rem}
.signup-field input[aria-invalid="true"]{border-color:var(--danger)}
.field-error{margin:0;color:var(--danger);font-size:.875rem;font-weight:500;overflow-wrap:anywhere}
.signup-alert{margin:1.75rem 0 0;border:1px solid color-mix(in srgb,var(--danger) 45%,var(--line));border-radius:10px;background:color-mix(in srgb,var(--danger) 7%,var(--surface));padding:.85rem 1rem;font-size:.9375rem;overflow-wrap:anywhere}
.signup-alert + .card{margin-top:1rem}
.site-footer{margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--line);color:var(--muted);font-size:.875rem}
.site-footer-line{margin:0;overflow-wrap:anywhere}
.site-footer-line a{color:var(--muted);font-weight:400;text-decoration-color:color-mix(in srgb,var(--muted) 45%,transparent)}
.document-version{margin:.5rem 0 0;font-size:.875rem}
.social-links{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin-bottom:.5rem}
.social-links a{display:inline-flex;align-items:center;min-height:44px;color:var(--muted);font-weight:400;text-decoration-color:color-mix(in srgb,var(--muted) 45%,transparent)}
@media(min-width:600px){.shell{padding:2.5rem 0 5rem}.page{padding-top:3.5rem}.page > h1{font-size:2.5rem}.brand-name{font-size:1.5rem}.card{padding:1.75rem}}
@media(max-width:520px){.brand{gap:.75rem}.brand img{max-width:8rem}.brand-name{font-size:1.125rem}.actions{flex-direction:column;align-items:stretch}.actions button,.actions .button-link,.unsubscribe-option form,.unsubscribe-option button{width:100%}}
@media(prefers-color-scheme:dark){.brand-logo--light{display:none}.brand-logo--dark{display:block}}`;

const supportLink = (settings: TenantSettings | null, t: PublicMarketingMessages): string | null => {
  if (settings == null) return null;
  if (settings.supportEmail !== null) {
    return `<a href="${escapeHtml(`mailto:${settings.supportEmail}`)}">${escapeHtml(settings.supportEmail)}</a>`;
  }
  const url = settings.supportUrl === null ? null : safeHref(settings.supportUrl);
  return url === null ? null : `<a href="${escapeHtml(url)}">${escapeHtml(t.supportLink)}</a>`;
};

type StatusCue = 'success' | 'info' | 'error';

const statusCueIcons: Record<StatusCue, string> = {
  success: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  info: '<path d="M12 11v6"/><path d="M12 7.5h.01"/>',
  error: '<path d="M12 7v6"/><path d="M12 16.5h.01"/>',
};

const renderStatusCue = (cue: StatusCue): string =>
  `<span class="status-cue status-cue--${cue}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${statusCueIcons[cue]}</svg></span>`;

const renderPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  path: string | null;
  title: string;
  titlePrefix?: string;
  eyebrow: string;
  body: string;
  testId: string;
  cue?: StatusCue;
  script?: string;
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
  const languageSwitch = input.path === null
    ? ''
    : `<nav class="languages" aria-label="${escapeHtml(t.language)}"><a href="${escapeHtml(input.path)}?lang=pl"${input.language === 'pl' ? ' aria-current="page"' : ''}>${escapeHtml(t.polish)}</a><a href="${escapeHtml(input.path)}?lang=en"${input.language === 'en' ? ' aria-current="page"' : ''}>${escapeHtml(t.english)}</a></nav>`;
  const cue = input.cue === undefined ? '' : renderStatusCue(input.cue);
  const contact = supportLink(settings, t);
  const script = input.script === undefined || input.nonce === '' ? '' : `<script nonce="${escapeHtml(input.nonce)}">${input.script}</script>`;
  return `<!doctype html><html lang="${input.language}" style="--accent-light:${escapeHtml(accentLight)};--accent-dark:${escapeHtml(accentDark)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#F7F4EF"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0F1012">${favicon}<title>${escapeHtml(`${input.titlePrefix ?? ''}${input.title}`)} · ${brandName}</title><link rel="preload" as="font" type="font/woff2" href="/fonts/inter-latin-400-normal.woff2" crossorigin><link rel="preload" as="font" type="font/woff2" href="/fonts/poppins-latin-700-normal.woff2" crossorigin><style>${publicStyles}</style></head><body><main class="shell" data-testid="${escapeHtml(input.testId)}"><header class="brand"><a class="brand-mark" href="/">${brandMark}</a>${languageSwitch}</header><section class="page">${cue}<p class="eyebrow">${escapeHtml(input.eyebrow)}</p><h1>${escapeHtml(input.title)}</h1>${input.body}</section><footer class="site-footer">${socialNavigation}<p class="site-footer-line">${brandName}${contact === null ? '' : ` · ${contact}`}</p></footer></main>${script}</body></html>`;
};

interface StatusLink {
  label: string;
  href: string;
  primary?: boolean;
}

export const renderStatusPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  path: string | null;
  eyebrow: string;
  title: string;
  lines: readonly [string, ...string[]];
  testId: string;
  cue?: StatusCue;
  links?: readonly StatusLink[];
}): string => {
  const t = messages[input.language];
  const [summary, ...details] = input.lines;
  const links = [...(input.links ?? []), { label: t.homeLink, href: '/' }]
    .map((link) => `<a class="button-link${link.primary === true ? ' button-link--primary' : ''}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
    .join('');
  const body = `<div class="status"><p class="lede">${escapeHtml(summary)}</p>${details
    .map((line) => `<p class="fine">${escapeHtml(line)}</p>`)
    .join('')}<div class="actions">${links}</div></div>`;
  return renderPage({
    nonce: input.nonce,
    brand: input.brand,
    language: input.language,
    path: input.path,
    title: input.title,
    eyebrow: input.eyebrow,
    body,
    testId: input.testId,
    ...(input.cue === undefined ? {} : { cue: input.cue }),
  });
};

type HostedErrorKind = 'link_invalid' | 'document_not_found' | 'request_failed';

export const renderHostedErrorPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  path: string | null;
  kind: HostedErrorKind;
}): string => {
  const t = messages[input.language];
  const copy = {
    link_invalid: { eyebrow: t.preferencesEyebrow, title: t.linkInvalidTitle, body: t.linkInvalidBody, testId: 'marketing-link-invalid' },
    document_not_found: { eyebrow: t.legalEyebrow, title: t.documentNotFoundTitle, body: t.documentNotFoundBody, testId: 'hosted-legal-not-found' },
    request_failed: { eyebrow: t.preferencesEyebrow, title: t.requestFailedTitle, body: t.requestFailedBody, testId: 'marketing-request-failed' },
  }[input.kind];
  return renderStatusPage({
    nonce: input.nonce,
    brand: input.brand,
    language: input.language,
    path: input.path,
    eyebrow: copy.eyebrow,
    title: copy.title,
    lines: [copy.body],
    testId: copy.testId,
    cue: 'error',
  });
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
  const tenant = input.brand.tenant.name;
  const path = `/u/${encodeURIComponent(input.token)}`;
  const formSuffix = `?lang=${input.language}`;
  const lede = `<p class="lede">${escapeHtml(t.preferencesFor({ email: input.email }))}</p>`;
  const page = (body: string): string => renderPage({
    nonce: input.nonce, brand: input.brand, language: input.language, path, title: t.preferencesTitle,
    eyebrow: t.preferencesEyebrow, body: `${lede}${body}`, testId: 'marketing-preferences',
  });
  const nothingLeftToWithdraw = input.definitions.every((definition) => !definition.active && !definition.pendingConfirmation);
  if (input.globallySuppressed && nothingLeftToWithdraw) {
    const contact = supportLink(input.brand.settings, t);
    return page(`<section class="card" data-state="unsubscribed-all"><p class="state-line">${escapeHtml(t.unsubscribedEverything({ tenant }))}</p><p class="fine">${escapeHtml(t.resubscribeBlocked)}</p>${contact === null ? '' : `<p class="fine">${contact}</p>`}</section>`);
  }
  const allMarketing = input.scope === 'all_marketing';
  const scopedDefinition = allMarketing
    ? undefined
    : input.definitions.find((definition) => `consent:${definition.id}` === input.scope);
  const scopedWithdrawn = scopedDefinition !== undefined && !scopedDefinition.active && !scopedDefinition.pendingConfirmation;
  const everythingForm = (className: string): string =>
    `<form method="post" action="${path}/all${formSuffix}"><button${className === '' ? '' : ` class="${className}"`} type="submit">${escapeHtml(t.unsubscribeAllSubmit)}</button></form>`;
  const everythingWarning = `<p class="fine">${escapeHtml(t.unsubscribeAllWarning({ tenant }))}</p>`;
  const scopedOption = scopedWithdrawn
    ? `<div class="unsubscribe-option"><p class="state-line">${escapeHtml(t.consentWithdrawn({ label: scopedDefinition.label }))}</p></div>`
    : `<div class="unsubscribe-option"><p class="fine">${escapeHtml(input.scopeLabel === null ? t.unsubscribeListBody : t.unsubscribeConsentBody({ label: input.scopeLabel }))}</p><form method="post" action="${path}/confirm${formSuffix}"><button type="submit">${escapeHtml(t.unsubscribeSubmit)}</button></form></div>`;
  const options = allMarketing
    ? `<div class="unsubscribe-option">${everythingWarning}${everythingForm('')}</div>`
    : `${scopedOption}<div class="unsubscribe-option">${everythingWarning}${everythingForm('secondary danger-text')}</div>`;
  const choices = input.definitions.length === 0
    ? `<p class="fine">${escapeHtml(t.noOptionalConsents)}</p>`
    : input.definitions.map((definition) => `<label class="choice"><input type="hidden" name="present-consent" value="${escapeHtml(definition.id)}"><input type="checkbox" name="consent" value="${escapeHtml(definition.id)}"${definition.active || definition.pendingConfirmation ? ' checked' : ''}><span>${escapeHtml(definition.label)}</span>${definition.pendingConfirmation ? `<small>${escapeHtml(t.pendingConfirmation)}</small>` : ''}</label>`).join('');
  return page(`<section class="card" data-state="${allMarketing ? 'all-marketing-link' : scopedWithdrawn ? 'consent-withdrawn' : 'consent-link'}"><h2>${escapeHtml(t.unsubscribeTitle)}</h2>${options}</section><div class="card"><form method="post" action="${path}/preferences${formSuffix}"><fieldset class="choices"><legend>${escapeHtml(t.consentsTitle)}</legend><p class="fine">${escapeHtml(t.consentsIntro)}</p>${input.globallySuppressed ? `<p class="fine">${escapeHtml(t.resubscribeBlocked)}</p>` : ''}${choices}</fieldset><div class="actions"><button type="submit">${escapeHtml(t.savePreferences)}</button></div></form></div>`);
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
  const lines: [string, ...string[]] = input.result === 'saved'
    ? [`${t.preferencesSavedBody}${(input.pendingConfirmations ?? 0) > 0 ? ` ${t.preferencesPendingBody}` : ''}`]
    : input.result === 'all_unsubscribed'
      ? [t.unsubscribedAllBody({ tenant: input.brand.tenant.name }), t.resubscribeBlocked]
      : [input.scopeLabel === null ? t.unsubscribedListBody : t.unsubscribedConsentBody({ label: input.scopeLabel }), t.resubscribeHint];
  return renderStatusPage({
    nonce: input.nonce,
    brand: input.brand,
    language: input.language,
    path,
    eyebrow: t.preferencesEyebrow,
    title: input.result === 'saved' ? t.preferencesSavedTitle : t.unsubscribedTitle,
    lines,
    testId: 'marketing-preference-result',
    cue: 'success',
    links: [{ label: t.backToPreferences, href: `${path}?lang=${input.language}` }],
  });
};

export const renderLegalDocumentPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  slug: string;
  title: string;
  content: string;
  version: { version: number; publishedAt: string };
  address: 'current' | 'permanent';
  latestVersion: number;
}): string => {
  const t = messages[input.language];
  const locale = input.language === 'pl' ? 'pl-PL' : 'en-US';
  const documentPath = `/legal/${encodeURIComponent(input.slug)}`;
  const details = {
    version: input.version.version,
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(input.version.publishedAt)),
  };
  const versionLine = input.address === 'current'
    ? `<p class="document-version"><a href="${documentPath}/v/${String(input.version.version)}">${escapeHtml(t.currentVersionLine(details))}</a></p>`
    : `<p class="notice">${escapeHtml(t.immutableVersion(details))}${input.latestVersion > input.version.version ? ` <a href="${documentPath}">${escapeHtml(t.viewCurrentVersion)}</a>` : ''}</p>`;
  const body = `${versionLine}<article class="prose">${renderHostedMarkdown(input.content)}</article>`;
  return renderPage({ nonce: input.nonce, brand: input.brand, language: input.language, path: null, title: input.title, eyebrow: t.legalEyebrow, body, testId: 'hosted-legal-document' });
};

export const renderConfirmationPage = (input: {
  nonce: string;
  brand: PublicBrand;
  language: Language;
  path: string;
  state: 'prompt' | 'success' | 'expired';
  signupHref?: string | null;
}): string => {
  const t = messages[input.language];
  const tenant = input.brand.tenant.name;
  const common = { nonce: input.nonce, brand: input.brand, language: input.language, path: input.path, eyebrow: t.confirmationEyebrow, testId: `marketing-confirmation-${input.state}` };
  if (input.state === 'success') {
    return renderStatusPage({ ...common, title: t.confirmationSuccessTitle, lines: [t.confirmationSuccessBody({ tenant })], cue: 'success' });
  }
  if (input.state === 'expired') {
    const signupHref = input.signupHref ?? null;
    return renderStatusPage({
      ...common,
      title: t.confirmationExpiredTitle,
      lines: [t.confirmationExpiredBody],
      cue: 'error',
      links: signupHref === null ? [] : [{ label: t.signupAgain, href: signupHref, primary: true }],
    });
  }
  const action = `<form class="actions" method="post" action="${escapeHtml(input.path)}?lang=${input.language}"><button type="submit">${escapeHtml(t.confirmationSubmit)}</button></form>`;
  return renderPage({
    ...common,
    title: t.confirmationPromptTitle,
    body: `<div class="status"><p class="lede">${escapeHtml(t.confirmationPromptBody({ tenant }))}</p>${action}</div>`,
    cue: 'info',
  });
};

export interface SignupConsentDocument {
  title: string;
  href: string;
}

const consentWording = (wording: string): string => wording.trim().replace(/\.+$/, '');

const renderSignupConsent = (input: {
  t: PublicMarketingMessages; tenant: string; wording: string; doubleOptIn: boolean; document: SignupConsentDocument | null;
}): string => {
  const sentences = [
    input.t.signupConsent({ tenant: input.tenant, wording: consentWording(input.wording) }),
    ...(input.doubleOptIn ? [input.t.signupConsentConfirm] : []),
    input.t.signupConsentUnsubscribe,
  ].map(escapeHtml).join(' ');
  const document = input.document === null
    ? ''
    : ` ${escapeHtml(input.t.signupConsentDocument)} <a href="${escapeHtml(input.document.href)}">${escapeHtml(input.document.title)}</a>`;
  return `<p class="signup-consent">${sentences}${document}</p>`;
};

export type SignupFormError = 'email' | 'generic' | 'rate_limited';

export interface SignupFormValues {
  email: string;
  displayName: string;
}

const submitPendingScript = "(()=>{const form=document.querySelector('form[data-pending-label]');const button=form&&form.querySelector('button[type=\"submit\"]');if(!form||!button)return;const label=button.textContent;form.addEventListener('submit',(event)=>{if(form.dataset.pending==='true'){event.preventDefault();return;}form.dataset.pending='true';button.setAttribute('aria-busy','true');button.textContent=form.dataset.pendingLabel||label;setTimeout(()=>{button.disabled=true;},0);});window.addEventListener('pageshow',(event)=>{if(!event.persisted)return;delete form.dataset.pending;button.disabled=false;button.removeAttribute('aria-busy');button.textContent=label;});})();";

const focusAlertScript = "document.getElementById('signup-error')?.focus();";

const valueAttribute = (value: string): string => value === '' ? '' : ` value="${escapeHtml(value)}"`;

export const renderSignupUnavailablePage = (input: {
  nonce: string; brand: PublicBrand; language: Language; path: string | null;
}): string => {
  const t = messages[input.language];
  return renderStatusPage({
    ...input,
    eyebrow: t.signupEyebrow,
    title: t.signupUnavailableTitle,
    lines: [t.signupUnavailableBody],
    testId: 'marketing-signup-unavailable',
    cue: 'error',
  });
};

export const renderSignupRateLimitedPage = (language: Language): string => {
  const t = messages[language];
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(`${t.errorTitlePrefix}${t.signupRateLimitedTitle}`)}</title><style>body{max-width:40rem;margin:0 auto;padding:2.5rem 1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6}h1{font-size:1.75rem;line-height:1.2}</style></head><body><main data-testid="marketing-signup-rate-limited"><h1>${escapeHtml(t.signupRateLimitedTitle)}</h1><p role="alert">${escapeHtml(t.signupRateLimited)}</p></main></body></html>`;
};

export const renderSignupFormPage = (input: {
  nonce: string; brand: PublicBrand; language: Language; form: MarketingSignupForm;
  wording: string; doubleOptIn: boolean; thanks: boolean; consentDocument?: SignupConsentDocument | null;
  values?: SignupFormValues; error?: SignupFormError;
}): string => {
  const t = messages[input.language];
  const tenant = input.brand.tenant.name;
  const path = `/marketing/forms/${encodeURIComponent(input.form.slug)}`;
  if (input.thanks) {
    const successText = input.form.successText[input.language];
    return renderStatusPage({
      nonce: input.nonce,
      brand: input.brand,
      language: input.language,
      path: `${path}/thanks`,
      eyebrow: t.signupEyebrow,
      title: input.doubleOptIn ? t.signupPendingTitle : t.signupThanks,
      lines: input.doubleOptIn ? [t.signupPending, t.signupPendingValidity, t.signupPendingSpam, successText] : [successText],
      testId: 'marketing-signup-thanks',
      cue: input.doubleOptIn ? 'info' : 'success',
      links: input.doubleOptIn ? [{ label: t.signupAgain, href: `${path}?lang=${input.language}` }] : [],
    });
  }
  const consent = renderSignupConsent({ t, tenant, wording: input.wording, doubleOptIn: input.doubleOptIn, document: input.consentDocument ?? null });
  const values = input.values ?? { email: '', displayName: '' };
  const emailError = input.error === 'email';
  const formError = input.error === 'generic' ? t.signupFailed : input.error === 'rate_limited' ? t.signupRateLimited : null;
  const alert = formError === null ? '' : `<p class="signup-alert" id="signup-error" role="alert" tabindex="-1">${escapeHtml(formError)}</p>`;
  const emailDescription = emailError ? ' aria-invalid="true" aria-describedby="signup-email-error" autofocus' : formError === null ? '' : ' aria-describedby="signup-error"';
  const emailField = `<div class="signup-field"><label for="signup-email">${escapeHtml(t.signupEmail)}</label><input id="signup-email" name="email" type="email" autocomplete="email" maxlength="254" required${valueAttribute(values.email)}${emailDescription}>${emailError ? `<p class="field-error" id="signup-email-error" role="alert">${escapeHtml(t.signupEmailInvalid)}</p>` : ''}</div>`;
  const nameField = input.form.collectName
    ? `<div class="signup-field"><label for="signup-name">${escapeHtml(t.signupName)}</label><input id="signup-name" name="displayName" autocomplete="name" maxlength="120"${valueAttribute(values.displayName)}></div>`
    : '';
  const body = `${alert}<form class="card signup-form" method="post" action="/api/public/marketing/forms/${encodeURIComponent(input.form.slug)}/submit?lang=${input.language}" data-pending-label="${escapeHtml(t.signupSubmitPending)}"${formError === null ? '' : ' aria-describedby="signup-error"'}>${emailField}${nameField}<div class="signup-trap" aria-hidden="true" hidden><input name="website" tabindex="-1" autocomplete="off"></div><input type="hidden" name="token" value="${escapeHtml(input.form.token)}">${consent}<div class="actions"><button type="submit">${escapeHtml(t.signupSubmit)}</button></div></form>`;
  return renderPage({
    nonce: input.nonce, brand: input.brand, language: input.language, path, title: t.signupTitle({ tenant }), eyebrow: t.signupEyebrow, body, testId: 'marketing-signup-form',
    script: formError === null ? submitPendingScript : `${submitPendingScript}${focusAlertScript}`,
    ...(input.error === undefined ? {} : { titlePrefix: t.errorTitlePrefix }),
  });
};
