import DOMPurify from 'dompurify';
import { Marked, Renderer } from 'marked';

import { renderMarketingTemplate } from '@core/domain/index.js';

const escapeAttribute = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const renderer = new Renderer();
renderer.link = function ({ href, title, tokens }) {
  const titleAttribute = title === null || title === undefined ? '' : ` title="${escapeAttribute(title)}"`;
  return `<a href="${escapeAttribute(href)}"${titleAttribute}>${this.parser.parseInline(tokens)}</a>`;
};
renderer.image = ({ href, title, text }) => {
  if (!href.startsWith('https://')) return '';
  const titleAttribute = title === null || title === undefined ? '' : ` title="${escapeAttribute(title)}"`;
  return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttribute}>`;
};

const parser = new Marked({ async: false, gfm: true, renderer });

const emailTags = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];

const emailAttributes = ['align', 'alt', 'checked', 'disabled', 'href', 'src', 'title', 'type'];

export const sanitizeCampaignHtml = (html: string): string => {
  const restrictImageSources = (node: Element, event: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    if (node.tagName === 'IMG' && event.attrName === 'src' && !event.attrValue.startsWith('https://')) {
      event.keepAttr = false;
    }
  };
  DOMPurify.addHook('uponSanitizeAttribute', restrictImageSources);
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_ATTR: emailAttributes,
    ALLOWED_TAGS: emailTags,
  });
  DOMPurify.removeHook('uponSanitizeAttribute', restrictImageSources);
  return sanitized.replace(/<img(?![^>]*\ssrc=)[^>]*>/giu, '');
};

export const renderCampaignMarkdown = (source: string): string => {
  const rendered = parser.parse(source);
  return sanitizeCampaignHtml(typeof rendered === 'string' ? rendered : '');
};

export const prepareCampaignHtml = (
  source: string,
  mode: 'markdown' | 'html',
): string => mode === 'markdown' ? renderCampaignMarkdown(source) : sanitizeCampaignHtml(source);

const previewData = {
  brand: { identity: 'Studio Razem', name: 'Studio Razem' },
  member: { email: 'anna@example.com', name: 'Anna Kowalska' },
  tenant: { address: 'ul. Wspólna 1, Warszawa', legalName: 'Studio Razem sp. z o.o.', name: 'Studio Razem' },
  unsubscribeUrl: 'https://example.com/u/sample',
};

export const renderCampaignPreview = (
  source: string,
  mode: 'markdown' | 'html' = 'markdown',
): string => {
  const prepared = prepareCampaignHtml(source, mode);
  const rendered = renderMarketingTemplate(prepared, previewData);
  return rendered.ok ? rendered.value : prepared;
};
