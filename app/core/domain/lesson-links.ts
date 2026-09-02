import { z } from 'zod';

import type { PlayableLessonBlock } from './course.js';

type SandboxEmbedProvider = 'codesandbox' | 'stackblitz' | 'codepen';

const SANDBOX_PROVIDER_LABEL: Record<SandboxEmbedProvider, string> = {
  codesandbox: 'CodeSandbox',
  stackblitz: 'StackBlitz',
  codepen: 'CodePen',
};

export type SandboxEmbedInspection =
  | { kind: 'embeddable'; provider: SandboxEmbedProvider; embedUrl: string; canonicalUrl: string }
  | { kind: 'not-embeddable' };

const NOT_EMBEDDABLE: SandboxEmbedInspection = { kind: 'not-embeddable' };

const sandboxHosts: Record<string, SandboxEmbedProvider> = {
  'codesandbox.io': 'codesandbox',
  'www.codesandbox.io': 'codesandbox',
  'stackblitz.com': 'stackblitz',
  'www.stackblitz.com': 'stackblitz',
  'codepen.io': 'codepen',
  'www.codepen.io': 'codepen',
};

const parseHttpUrl = (value: string): URL | null => {
  const parsed = z.string().trim().url().safeParse(value);
  if (!parsed.success) return null;
  const url = new URL(parsed.data);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
};

const pathSegments = (url: URL): string[] =>
  url.pathname.split('/').filter((segment) => segment.length > 0);

const buildUrl = (host: string, segments: string[], search: string, embedded = false): string => {
  const url = new URL(`https://${host}/${segments.join('/')}`);
  url.search = search;
  if (embedded) url.searchParams.set('embed', '1');
  return url.toString();
};

const codesandboxSandboxPath = (segments: string[]): string[] | null => {
  if (segments[0] === 's' && segments.length >= 2) return segments.slice(1);
  if (segments[0] === 'p' && segments[1] === 'sandbox' && segments.length === 3) return segments.slice(2);
  return null;
};

type SandboxUrls = { embedUrl: string; canonicalUrl: string };

const codesandboxUrls = (url: URL): SandboxUrls | null => {
  const segments = pathSegments(url);
  if (segments[0] === 'embed' && segments.length >= 2) {
    return {
      embedUrl: buildUrl('codesandbox.io', segments, url.search),
      canonicalUrl: buildUrl('codesandbox.io', ['s', ...segments.slice(1)], url.search),
    };
  }
  const sandboxPath = codesandboxSandboxPath(segments);
  if (sandboxPath === null) return null;
  return {
    embedUrl: buildUrl('codesandbox.io', ['embed', ...sandboxPath], url.search),
    canonicalUrl: buildUrl('codesandbox.io', segments, url.search),
  };
};

const withoutParam = (search: string, name: string): string => {
  const params = new URLSearchParams(search);
  params.delete(name);
  return params.toString();
};

const stackblitzUrls = (url: URL): SandboxUrls | null => {
  const segments = pathSegments(url);
  const embeddablePath =
    (segments[0] === 'edit' && segments.length >= 2) || (segments[0] === 'github' && segments.length >= 3);
  if (!embeddablePath) return null;
  return {
    embedUrl: buildUrl('stackblitz.com', segments, url.search, true),
    canonicalUrl: buildUrl('stackblitz.com', segments, withoutParam(url.search, 'embed')),
  };
};

const codepenUrls = (url: URL): SandboxUrls | null => {
  const segments = pathSegments(url);
  const [user, kind, hash] = segments;
  if (segments.length !== 3 || user === undefined || hash === undefined) return null;
  if (kind !== 'pen' && kind !== 'embed') return null;
  return {
    embedUrl: buildUrl('codepen.io', [user, 'embed', hash], url.search),
    canonicalUrl: buildUrl('codepen.io', [user, 'pen', hash], url.search),
  };
};

const urlsByProvider: Record<SandboxEmbedProvider, (url: URL) => SandboxUrls | null> = {
  codesandbox: codesandboxUrls,
  stackblitz: stackblitzUrls,
  codepen: codepenUrls,
};

/** Sandboxes run untrusted author code, so only the hosts listed here may reach an iframe. */
export const inspectSandboxEmbedUrl = (value: string): SandboxEmbedInspection => {
  const url = parseHttpUrl(value);
  if (url === null) return NOT_EMBEDDABLE;
  const provider = sandboxHosts[url.hostname.toLowerCase()];
  if (provider === undefined) return NOT_EMBEDDABLE;
  const urls = urlsByProvider[provider](url);
  return urls === null ? NOT_EMBEDDABLE : { kind: 'embeddable', provider, ...urls };
};

type LessonLinkChip = { url: string; label: string; host: string };

type LinkLabel = { text: string; source: 'description' | 'anchorText' };

const LABEL_RANK: Record<LinkLabel['source'], number> = { anchorText: 1, description: 2 };

const labelRank = (label: LinkLabel | null): number => (label === null ? 0 : LABEL_RANK[label.source]);

type LinkTarget = { host: string; key: string; fallbackLabel: string };

const isSpace = (char: string): boolean => /\s/u.test(char);

const everyChar = (value: string, allowed: (char: string) => boolean): boolean =>
  [...value].every(allowed);

const isSchemeName = (value: string): boolean =>
  /[a-z]/u.test(value.charAt(0)) && everyChar(value, (char) => /[a-z0-9+.-]/u.test(char));

const withoutScheme = (value: string): string => {
  const separator = value.indexOf('://');
  if (separator <= 0) return value;
  return isSchemeName(value.slice(0, separator)) ? value.slice(separator + 3) : value;
};

const withoutWww = (value: string): string => (value.startsWith('www.') ? value.slice(4) : value);

const withoutTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === '/') end -= 1;
  return value.slice(0, end);
};

type MailtoParts = { address: string; query: string };

const mailtoParts = (value: string): MailtoParts | null => {
  const trimmed = value.trim();
  if (!/^mailto:/iu.test(trimmed)) return null;
  const rest = trimmed.slice('mailto:'.length);
  const queryStart = rest.indexOf('?');
  if (queryStart < 0) return { address: rest, query: '' };
  return { address: rest.slice(0, queryStart), query: rest.slice(queryStart) };
};

const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const derivedLabel = (host: string, url: URL): string => {
  const tail = pathSegments(url).at(-1);
  const fragment = url.hash.length > 1 ? decodeSegment(url.hash) : '';
  return `${host}${tail === undefined ? '' : ` / ${decodeSegment(tail)}`}${fragment}`;
};

const linkTarget = (value: string): LinkTarget => {
  const mail = mailtoParts(value);
  if (mail !== null)
    return {
      host: mail.address,
      key: `mailto:${mail.address.toLowerCase()}${mail.query}`,
      fallbackLabel: mail.address,
    };
  const url = parseHttpUrl(value);
  if (url === null) {
    const trimmed = value.trim();
    return { host: trimmed, key: trimmed.toLowerCase(), fallbackLabel: trimmed };
  }
  const host = withoutWww(url.hostname.toLowerCase());
  const authority = url.port === '' ? host : `${host}:${url.port}`;
  const path = withoutTrailingSlashes(url.pathname);
  return {
    host,
    key: `${url.protocol}//${authority}${path}${url.search}${url.hash}`,
    fallbackLabel: derivedLabel(host, url),
  };
};

const withoutUrlChrome = (value: string): string =>
  withoutTrailingSlashes(withoutWww(withoutScheme(value.trim().toLowerCase())));

const isHostLabel = (value: string): boolean =>
  value.length > 0 && everyChar(value, (char) => /[a-z0-9-]/u.test(char));

const isDottedHost = (value: string): boolean => {
  const labels = value.split('.');
  return labels.length >= 2 && labels.every(isHostLabel);
};

const isPort = (value: string): boolean =>
  value.length > 0 && everyChar(value, (char) => /[0-9]/u.test(char));

const schemelessAuthority = (value: string): string | null => {
  const authorityWithPath = withoutScheme(value.trim().toLowerCase());
  const pathStart = authorityWithPath.indexOf('/');
  if (pathStart < 0 || /\s/u.test(authorityWithPath.slice(pathStart + 1))) return null;
  const authority = authorityWithPath.slice(0, pathStart);
  const portStart = authority.indexOf(':');
  if (portStart < 0) return isDottedHost(authority) ? authority : null;
  const name = authority.slice(0, portStart);
  return isDottedHost(name) && isPort(authority.slice(portStart + 1)) ? authority : null;
};

const matchesHrefAuthority = (authority: string, href: string, host: string): boolean => {
  if (authority === host) return true;
  const port = parseHttpUrl(href)?.port ?? '';
  return port !== '' && authority === `${host}:${port}`;
};

const isUrlText = (text: string, href: string): boolean => {
  if (parseHttpUrl(text) !== null || mailtoParts(text) !== null) return true;
  const { host } = linkTarget(href);
  const bare = withoutUrlChrome(text);
  if (bare === withoutUrlChrome(href) || bare === host) return true;
  const authority = schemelessAuthority(text);
  if (authority !== null && matchesHrefAuthority(withoutWww(authority), href, host)) return true;
  return host.length > 0 && bare.startsWith(`${host}/`);
};

const HTML_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['ndash', '–'],
  ['mdash', '—'],
  ['rsquo', '’'],
  ['lsquo', '‘'],
  ['rdquo', '”'],
  ['ldquo', '“'],
  ['hellip', '…'],
  ['laquo', '«'],
  ['raquo', '»'],
  ['bull', '•'],
  ['middot', '·'],
]);

const NUMERIC_ENTITY = /^#(?:x([0-9a-f]+)|([0-9]+))$/iu;

const isScalarCodePoint = (code: number): boolean =>
  Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);

const decodeNumericEntity = (body: string): string | null => {
  const match = NUMERIC_ENTITY.exec(body);
  if (match === null) return null;
  const [, hex, decimal] = match;
  const code = hex === undefined ? Number.parseInt(decimal ?? '', 10) : Number.parseInt(hex, 16);
  return isScalarCodePoint(code) ? String.fromCodePoint(code) : null;
};

const ENTITY = /&([a-z0-9#]+);/giu;

const decodeEntity = (body: string): string | null =>
  HTML_ENTITIES.get(body.toLowerCase()) ?? decodeNumericEntity(body);

const decodeEntities = (value: string): string | null => {
  let unrecognised = false;
  const decoded = value.replace(ENTITY, (match, body: string) => {
    const entity = decodeEntity(body);
    if (entity === null) unrecognised = true;
    return entity ?? match;
  });
  return unrecognised ? null : decoded;
};

const PARAGRAPH_OPEN = '<p';
const PARAGRAPH_CLOSE = '</p>';
const ANCHOR_OPEN = '<a';
const ANCHOR_CLOSE = '</a>';

const matchesTagAt = (html: string, index: number, tag: string): boolean =>
  html.slice(index, index + tag.length).toLowerCase() === tag;

const scanUntil = (html: string, from: number, stops: (char: string) => boolean): number => {
  let index = from;
  while (index < html.length && !stops(html.charAt(index))) index += 1;
  return index;
};

const skipSpaces = (html: string, from: number): number => scanUntil(html, from, (char) => !isSpace(char));

const endsAttributeName = (char: string): boolean => isSpace(char) || char === '=' || char === '>';

const endsUnquotedValue = (char: string): boolean => isSpace(char) || char === '>';

const readQuotedValue = (html: string, from: number): { value: string; end: number } | null => {
  const quote = html.charAt(from);
  if (quote !== '"' && quote !== "'") return null;
  const close = html.indexOf(quote, from + 1);
  return close < 0 ? null : { value: html.slice(from + 1, close), end: close + 1 };
};

const readAnchorTag = (html: string, from: number): { href: string | null; end: number } | null => {
  let index = from;
  let href: string | null = null;
  while (index < html.length) {
    index = skipSpaces(html, index);
    if (html.charAt(index) === '>') return { href, end: index + 1 };
    const nameEnd = scanUntil(html, index, endsAttributeName);
    if (nameEnd === index) return null;
    const name = html.slice(index, nameEnd).toLowerCase();
    const equals = skipSpaces(html, nameEnd);
    if (html.charAt(equals) !== '=') {
      index = nameEnd;
      continue;
    }
    const valueStart = skipSpaces(html, equals + 1);
    const quoted = readQuotedValue(html, valueStart);
    if (quoted === null) {
      index = scanUntil(html, valueStart, endsUnquotedValue);
      continue;
    }
    if (name === 'href' && href === null) href = quoted.value;
    index = quoted.end;
  }
  return null;
};

const afterParagraphOpen = (html: string): number => {
  if (!matchesTagAt(html, 0, PARAGRAPH_OPEN)) return 0;
  const next = html.charAt(PARAGRAPH_OPEN.length);
  if (next !== '>' && !isSpace(next)) return 0;
  const close = html.indexOf('>', PARAGRAPH_OPEN.length);
  return close < 0 ? 0 : close + 1;
};

const singleAnchor = (html: string): { href: string; text: string } | null => {
  const start = skipSpaces(html, afterParagraphOpen(html));
  if (!matchesTagAt(html, start, ANCHOR_OPEN)) return null;
  const attributes = start + ANCHOR_OPEN.length;
  if (!isSpace(html.charAt(attributes))) return null;
  const tag = readAnchorTag(html, attributes + 1);
  if (tag === null || tag.href === null) return null;
  const textEnd = html.indexOf('<', tag.end);
  if (textEnd < 0 || !matchesTagAt(html, textEnd, ANCHOR_CLOSE)) return null;
  const tail = html.slice(textEnd + ANCHOR_CLOSE.length);
  if (tail !== '' && tail.trimStart().toLowerCase() !== PARAGRAPH_CLOSE) return null;
  return { href: tag.href, text: html.slice(tag.end, textEnd) };
};

const anchorLink = (html: string): { url: string; label: LinkLabel | null } | null => {
  const anchor = singleAnchor(html.trim());
  if (anchor === null) return null;
  const decodedHref = decodeEntities(anchor.href);
  const decodedText = decodeEntities(anchor.text);
  if (decodedHref === null || decodedText === null) return null;
  const href = decodedHref.trim();
  if (!/^(?:https?:\/\/|mailto:)/iu.test(href)) return null;
  const text = decodedText.trim();
  const describes = text.length > 0 && !isUrlText(text, href);
  return { url: href, label: describes ? { text, source: 'anchorText' } : null };
};

export type RenderableLessonBlock = Exclude<PlayableLessonBlock, { type: 'link' }>;

type LessonSandboxGroup = {
  kind: 'sandbox';
  provider: SandboxEmbedProvider;
  providerName: string;
  embedUrl: string;
  canonicalUrl: string;
  caption: string | null;
};

export type LessonContentGroup =
  | { kind: 'block'; block: RenderableLessonBlock }
  | LessonSandboxGroup
  | { kind: 'links'; links: LessonLinkChip[] };

type PendingLink = { kind: 'link'; url: string; label: LinkLabel | null } & LinkTarget;

type PendingSandbox = { kind: 'sandbox'; key: string; group: LessonSandboxGroup };

type PendingEntry = { kind: 'block'; block: RenderableLessonBlock } | PendingSandbox | PendingLink;

const pendingSandbox = (
  inspection: Extract<SandboxEmbedInspection, { kind: 'embeddable' }>,
  caption: string | null,
): PendingSandbox => ({
  kind: 'sandbox',
  key: `sandbox:${inspection.embedUrl}`,
  group: {
    kind: 'sandbox',
    provider: inspection.provider,
    providerName: SANDBOX_PROVIDER_LABEL[inspection.provider],
    embedUrl: inspection.embedUrl,
    canonicalUrl: inspection.canonicalUrl,
    caption,
  },
});

const classifyLink = (url: string, label: LinkLabel | null): PendingEntry => {
  const inspection = inspectSandboxEmbedUrl(url);
  if (inspection.kind === 'embeddable') return pendingSandbox(inspection, label?.text ?? null);
  return { kind: 'link', url, label, ...linkTarget(url) };
};

const describedLabel = (description: string | undefined, url: string): LinkLabel | null =>
  description === undefined || isUrlText(description, url) ? null : { text: description, source: 'description' };

const classifyBlock = (block: PlayableLessonBlock): PendingEntry => {
  if (block.type === 'link') return classifyLink(block.url, describedLabel(block.description, block.url));
  if (block.type === 'embed') {
    const inspection = inspectSandboxEmbedUrl(block.embedUrl);
    if (inspection.kind === 'embeddable') return pendingSandbox(inspection, null);
    return { kind: 'block', block };
  }
  if (block.type === 'html') {
    const anchor = anchorLink(block.html);
    if (anchor !== null) return classifyLink(anchor.url, anchor.label);
  }
  return { kind: 'block', block };
};

const bestDescribed = (first: PendingEntry, duplicate: PendingEntry): PendingEntry => {
  if (first.kind === 'link' && duplicate.kind === 'link')
    return labelRank(duplicate.label) > labelRank(first.label) ? { ...first, label: duplicate.label } : first;
  if (first.kind === 'sandbox' && duplicate.kind === 'sandbox')
    return first.group.caption === null ? duplicate : first;
  return first;
};

const dedupeTargets = (entries: PendingEntry[]): PendingEntry[] => {
  const positionByKey = new Map<string, number>();
  const kept: PendingEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'block') {
      kept.push(entry);
      continue;
    }
    const position = positionByKey.get(entry.key);
    if (position === undefined) {
      positionByKey.set(entry.key, kept.length);
      kept.push(entry);
      continue;
    }
    const first = kept[position];
    if (first !== undefined) kept[position] = bestDescribed(first, entry);
  }
  return kept;
};

export const groupLessonBlocks = (blocks: readonly PlayableLessonBlock[]): LessonContentGroup[] => {
  const groups: LessonContentGroup[] = [];
  for (const entry of dedupeTargets(blocks.map(classifyBlock))) {
    if (entry.kind === 'block') {
      groups.push(entry);
      continue;
    }
    if (entry.kind === 'sandbox') {
      groups.push(entry.group);
      continue;
    }
    const chip: LessonLinkChip = {
      url: entry.url,
      label: entry.label?.text ?? entry.fallbackLabel,
      host: entry.host,
    };
    const last = groups.at(-1);
    if (last?.kind === 'links') last.links.push(chip);
    else groups.push({ kind: 'links', links: [chip] });
  }
  return groups;
};
