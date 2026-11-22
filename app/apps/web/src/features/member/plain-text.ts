import { Marked } from 'marked';

const SKIPPED_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG']);
const BREAK_ELEMENTS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);

const markdown = new Marked({ async: false, gfm: true });

const collectText = (node: Node, parts: string[]): void => {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.nodeValue ?? '');
    return;
  }
  const tag = node instanceof Element ? node.tagName.toUpperCase() : '';
  if (SKIPPED_ELEMENTS.has(tag)) return;
  const breaks = BREAK_ELEMENTS.has(tag);
  if (breaks) parts.push(' ');
  node.childNodes.forEach((child) => collectText(child, parts));
  if (breaks) parts.push(' ');
};

export const htmlToPlainText = (html: string): string => {
  if (html.trim() === '') return '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  const parts: string[] = [];
  collectText(document.body, parts);
  return parts.join('').replace(/\s+/g, ' ').trim();
};

export const markdownToPlainText = (source: string): string => {
  if (source.trim() === '') return '';
  const rendered = markdown.parse(source);
  return typeof rendered === 'string' ? htmlToPlainText(rendered) : '';
};

export const plainTextExcerpt = (text: string, maxLength = 400): string =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}…`;
