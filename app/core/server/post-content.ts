import { marked, type Tokens } from 'marked';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

import {
  renderPost,
  toPublicPost,
  type Post,
  type PostBodyFormat,
  type PublicPost,
} from '#core/domain/index.js';

const LINK_REL = 'noopener noreferrer nofollow ugc';
const ALLOWED_ELEMENTS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'ul',
]);
const DROP_CONTENT_ELEMENTS = new Set([
  'embed',
  'iframe',
  'math',
  'object',
  'script',
  'style',
  'svg',
  'template',
]);
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const trimTrailingPunctuation = (value: string): string => {
  let trimmed = value.replace(/[.,!?;:]+$/u, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
    while (trimmed.endsWith(close) && trimmed.split(close).length > trimmed.split(open).length) {
      trimmed = trimmed.slice(0, -1).replace(/[.,!?;:]+$/u, '');
    }
  }
  return trimmed;
};

const normalizeLinkDestination = (value: string): string | null => {
  const candidate = value.trim();
  if (/^www\./iu.test(candidate)) {
    try {
      return new URL(`https://${candidate}`).href;
    } catch {
      return null;
    }
  }
  if (!/^(?:https?:|mailto:)/iu.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

const anchor = (href: string, labelHtml: string): string =>
  `<a href="${escapeHtml(href)}" target="_blank" rel="${LINK_REL}">${labelHtml}</a>`;

const linkifyPlain = (body: string): string => {
  const chunks: string[] = [];
  let cursor = 0;
  for (const match of body.matchAll(/\b(?:https?:\/\/|mailto:|www\.)[^\s<>"']+/giu)) {
    const index = match.index;
    const visible = trimTrailingPunctuation(match[0]);
    const href = normalizeLinkDestination(visible);
    if (href === null) continue;
    chunks.push(escapeHtml(body.slice(cursor, index)));
    chunks.push(anchor(href, escapeHtml(visible)));
    cursor = index + visible.length;
  }
  chunks.push(escapeHtml(body.slice(cursor)));
  return chunks.join('').replaceAll('\n', '<br>');
};

class CommunityMarkdownRenderer extends marked.Renderer {
  override html({ text, block }: Tokens.HTML | Tokens.Tag): string {
    const escaped = escapeHtml(text);
    return block ? `<p>${escaped}</p>` : escaped;
  }

  override link({ href, tokens }: Tokens.Link): string {
    const label = this.parser.parseInline(tokens);
    const destination = normalizeLinkDestination(href);
    return destination === null ? label : anchor(destination, label);
  }

  override image({ text }: Tokens.Image): string {
    return escapeHtml(text);
  }

  override heading({ tokens, depth }: Tokens.Heading): string {
    const content = this.parser.parseInline(tokens);
    return depth <= 3 ? `<h${String(depth)}>${content}</h${String(depth)}>` : `<p>${content}</p>`;
  }

  override table({ raw }: Tokens.Table): string {
    return `<p>${escapeHtml(raw).replaceAll('\n', '<br>')}</p>`;
  }

  override hr({ raw }: Tokens.Hr): string {
    return `<p>${escapeHtml(raw)}</p>`;
  }

  override del({ tokens }: Tokens.Del): string {
    return this.parser.parseInline(tokens);
  }

  override checkbox(): string {
    return '';
  }

  override listitem(item: Tokens.ListItem): string {
    return `<li>${this.parser.parse(item.tokens)}</li>`;
  }
}

const childrenHtml = (node: { childNodes: DefaultTreeAdapterTypes.ChildNode[] }): string =>
  node.childNodes.map(sanitizeNode).join('');

const sanitizeNode = (node: DefaultTreeAdapterTypes.ChildNode): string => {
  if ('value' in node) return escapeHtml(node.value);
  if (!('tagName' in node)) return '';
  const tag = node.tagName.toLowerCase();
  if (node.namespaceURI !== HTML_NAMESPACE || DROP_CONTENT_ELEMENTS.has(tag)) return '';
  const content = childrenHtml(node);
  if (!ALLOWED_ELEMENTS.has(tag)) return content;
  if (tag === 'br') return '<br>';
  if (tag === 'a') {
    const href = node.attrs.find((attribute) => attribute.name === 'href')?.value ?? '';
    const destination = normalizeLinkDestination(href);
    return destination === null ? content : anchor(destination, content);
  }
  if (tag === 'ol') {
    const start = node.attrs.find((attribute) => attribute.name === 'start')?.value;
    const startAttribute = start !== undefined && /^[1-9]\d*$/u.test(start)
      ? ` start="${start}"`
      : '';
    return `<ol${startAttribute}>${content}</ol>`;
  }
  return `<${tag}>${content}</${tag}>`;
};

const sanitizeCommunityHtml = (html: string): string =>
  parseFragment(html).childNodes.map(sanitizeNode).join('');

const blockText = (node: DefaultTreeAdapterTypes.ChildNode): string => {
  if ('value' in node) return node.value;
  if (!('tagName' in node)) return '';
  if (node.tagName === 'br') return '\n';
  const content = node.childNodes.map(blockText).join('');
  if (node.tagName === 'li') return `${content}\n`;
  return ['blockquote', 'h1', 'h2', 'h3', 'p', 'pre'].includes(node.tagName)
    ? `${content}\n\n`
    : content;
};

const plainTextFromHtml = (html: string): string =>
  parseFragment(html).childNodes
    .map(blockText)
    .join('')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

const linkDestinationsFromHtml = (html: string): string[] => {
  const destinations: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.ChildNode): void => {
    if (!('tagName' in node)) return;
    if (node.tagName === 'a') {
      const href = node.attrs.find((attribute) => attribute.name === 'href')?.value;
      if (href !== undefined) {
        const normalized = normalizeLinkDestination(href);
        if (normalized !== null) destinations.push(normalized);
      }
    }
    node.childNodes.forEach(visit);
  };
  parseFragment(html).childNodes.forEach(visit);
  return destinations;
};

const renderHtml = (body: string, format: PostBodyFormat): string => {
  if (format === 'plain') return linkifyPlain(body);
  const rendered = marked.parse(body, {
    async: false,
    breaks: true,
    gfm: true,
    renderer: new CommunityMarkdownRenderer(),
  });
  return sanitizeCommunityHtml(rendered);
};

export interface RenderedPostContent {
  html: string;
  plainText: string;
  linkDestinations: string[];
}

export const renderPostContent = (
  body: string,
  format: PostBodyFormat,
): RenderedPostContent => {
  const html = renderHtml(body, format);
  return {
    html,
    plainText: format === 'plain' ? body : plainTextFromHtml(html),
    linkDestinations: linkDestinationsFromHtml(html),
  };
};

export const toRenderedPublicPost = (
  post: Post,
  viewerUserId: string,
  authorAvatarUrl: string | null = null,
  renderedContent?: RenderedPostContent,
): PublicPost => {
  const visible = renderPost(post);
  const rendered = renderedContent ?? renderPostContent(visible.body, visible.bodyFormat);
  return toPublicPost(
    visible,
    viewerUserId,
    rendered.html,
    rendered.plainText,
    authorAvatarUrl,
  );
};
