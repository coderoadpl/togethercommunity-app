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

type LinkTarget = { host: string; derivedLabel: string; detailedLabel: string };

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

const mailtoAddress = (value: string): string | null => {
  const trimmed = value.trim();
  if (!/^mailto:/iu.test(trimmed)) return null;
  const rest = trimmed.slice('mailto:'.length);
  const queryStart = rest.indexOf('?');
  return queryStart < 0 ? rest : rest.slice(0, queryStart);
};

const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const detailedLabel = (host: string, url: URL): string => {
  const tail = pathSegments(url).at(-1);
  const fragment = url.hash.length > 1 ? decodeSegment(url.hash) : '';
  return `${host}${tail === undefined ? '' : ` / ${decodeSegment(tail)}`}${fragment}`;
};

const sameLabels = (value: string): LinkTarget => ({
  host: value,
  derivedLabel: value,
  detailedLabel: value,
});

const linkTarget = (value: string): LinkTarget => {
  const address = mailtoAddress(value);
  if (address !== null) return sameLabels(address);
  const url = parseHttpUrl(value);
  if (url === null) return sameLabels(value.trim());
  const host = withoutWww(url.hostname.toLowerCase());
  return { host, derivedLabel: host, detailedLabel: detailedLabel(host, url) };
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
  if (parseHttpUrl(text) !== null || mailtoAddress(text) !== null) return true;
  const { host } = linkTarget(href);
  const bare = withoutUrlChrome(text);
  if (bare === withoutUrlChrome(href) || bare === host) return true;
  const authority = schemelessAuthority(text);
  if (authority !== null && matchesHrefAuthority(withoutWww(authority), href, host)) return true;
  return host.length > 0 && bare.startsWith(`${host}/`);
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

type PendingLink = { kind: 'link'; url: string; label: string | null } & LinkTarget;

type PendingEntry = { kind: 'block'; block: RenderableLessonBlock } | LessonSandboxGroup | PendingLink;

const sandboxGroup = (
  inspection: Extract<SandboxEmbedInspection, { kind: 'embeddable' }>,
  caption: string | null,
): LessonSandboxGroup => ({
  kind: 'sandbox',
  provider: inspection.provider,
  providerName: SANDBOX_PROVIDER_LABEL[inspection.provider],
  embedUrl: inspection.embedUrl,
  canonicalUrl: inspection.canonicalUrl,
  caption,
});

const describedLabel = (description: string | undefined, url: string): string | null =>
  description === undefined || isUrlText(description, url) ? null : description;

const classifyBlock = (block: PlayableLessonBlock): PendingEntry => {
  if (block.type === 'link') {
    const inspection = inspectSandboxEmbedUrl(block.url);
    const label = describedLabel(block.description, block.url);
    if (inspection.kind === 'embeddable') return sandboxGroup(inspection, label);
    return { kind: 'link', url: block.url, label, ...linkTarget(block.url) };
  }
  if (block.type === 'embed') {
    const inspection = inspectSandboxEmbedUrl(block.embedUrl);
    if (inspection.kind === 'embeddable') return sandboxGroup(inspection, null);
  }
  return { kind: 'block', block };
};

const chipsOf = (links: readonly PendingLink[]): LessonLinkChip[] => {
  const detailedByLabel = new Map<string, Set<string>>();
  for (const link of links) {
    const label = link.label ?? link.derivedLabel;
    const detailed = detailedByLabel.get(label) ?? new Set<string>();
    detailedByLabel.set(label, detailed.add(link.label ?? link.detailedLabel));
  }
  const derived = (link: PendingLink): string =>
    (detailedByLabel.get(link.derivedLabel)?.size ?? 0) > 1 ? link.detailedLabel : link.derivedLabel;
  return links.map((link) => ({ url: link.url, label: link.label ?? derived(link), host: link.host }));
};

export const groupLessonBlocks = (blocks: readonly PlayableLessonBlock[]): LessonContentGroup[] => {
  const groups: LessonContentGroup[] = [];
  let run: PendingLink[] = [];
  const closeRun = () => {
    if (run.length === 0) return;
    groups.push({ kind: 'links', links: chipsOf(run) });
    run = [];
  };
  for (const entry of blocks.map(classifyBlock)) {
    if (entry.kind === 'link') {
      run.push(entry);
      continue;
    }
    closeRun();
    groups.push(entry);
  }
  closeRun();
  return groups;
};
