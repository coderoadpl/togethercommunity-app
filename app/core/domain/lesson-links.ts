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

const mailtoAddress = (value: string): string | null => {
  const trimmed = value.trim();
  return /^mailto:/iu.test(trimmed) ? trimmed.slice('mailto:'.length).split('?')[0] ?? '' : null;
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
  const address = mailtoAddress(value);
  if (address !== null)
    return { host: address, key: `mailto:${address.toLowerCase()}`, fallbackLabel: address };
  const url = parseHttpUrl(value);
  if (url === null) {
    const trimmed = value.trim();
    return { host: trimmed, key: trimmed.toLowerCase(), fallbackLabel: trimmed };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./u, '');
  const path = url.pathname.replace(/\/+$/u, '');
  return { host, key: `${host}${path}${url.search}${url.hash}`, fallbackLabel: derivedLabel(host, url) };
};

const withoutUrlChrome = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, '')
    .replace(/^www\./u, '')
    .replace(/\/+$/u, '');

const hostWithPathPattern = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?\/\S*$/iu;

const isUrlText = (text: string, href: string): boolean => {
  if (parseHttpUrl(text) !== null || mailtoAddress(text) !== null) return true;
  if (hostWithPathPattern.test(text.trim())) return true;
  const bare = withoutUrlChrome(text);
  if (bare === withoutUrlChrome(href)) return true;
  return bare === linkTarget(href).host;
};

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

const decodeEntities = (value: string): string =>
  value.replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/gu, (match, name: string) => HTML_ENTITIES[name] ?? match);

const singleAnchorPattern =
  /^(?:<p(?:\s[^>]*)?>\s*)?<a\s[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([^<]*)<\/a>(?:\s*<\/p>)?$/iu;

const anchorLink = (html: string): { url: string; label: LinkLabel | null } | null => {
  const match = singleAnchorPattern.exec(html.trim());
  if (match === null) return null;
  const href = decodeEntities(match[1] ?? match[2] ?? '').trim();
  if (!/^(?:https?:\/\/|mailto:)/iu.test(href)) return null;
  const text = decodeEntities(match[3] ?? '').trim();
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
