import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import type { HtmlToText } from '#core/server/marketing-delivery-ports.js';

const excluded = new Set(['script', 'style', 'head', 'template', 'noscript']);
const blocks = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'blockquote', 'ul', 'ol', 'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const render = (node: DefaultTreeAdapterTypes.Node): string => {
  if ('value' in node) return node.value.replace(/\s+/gu, ' ');
  if (!('childNodes' in node)) return '';
  const tag = 'tagName' in node ? node.tagName : '';
  if (excluded.has(tag)) return '';
  const content = node.childNodes.map(render).join('');
  if (tag === 'br') return '\n';
  if (tag === 'li') return `\n- ${content.trim()}\n`;
  if (tag === 'td' || tag === 'th') return `${content.trim()}\t`;
  if (tag === 'a' && 'attrs' in node) {
    const href = node.attrs.find((attribute) => attribute.name === 'href')?.value;
    const label = content.trim();
    if (href !== undefined && href.trim() !== '') {
      return label === href || label === '' ? href : `${label} (${href})`;
    }
  }
  return blocks.has(tag) ? `\n\n${content.trim()}\n\n` : content;
};

export const createHtmlToText = (): HtmlToText => ({
  convert: (html) => {
    if (html.length > 1_000_000) throw new Error('HTML exceeds the conversion limit');
    const text = render(parse(html)).replace(/[ \t]+\n/gu, '\n').replace(/\n[ \t]+/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
    if (text.length > 1_000_000) throw new Error('Plaintext exceeds the conversion limit');
    return text;
  },
});
