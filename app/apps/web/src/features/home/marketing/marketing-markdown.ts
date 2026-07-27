import DOMPurify from 'dompurify';
import { Marked } from 'marked';

import { renderMarketingTemplate } from '@core/domain/index.js';

const parser = new Marked({ async: false, gfm: true });

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

const emailAttributes = ['align', 'checked', 'disabled', 'href', 'title', 'type'];

export const sanitizeCampaignHtml = (html: string): string => DOMPurify.sanitize(html, {
  ALLOWED_ATTR: emailAttributes,
  ALLOWED_TAGS: emailTags,
});

export const renderCampaignMarkdown = (source: string): string => {
  const rendered = parser.parse(source);
  return sanitizeCampaignHtml(typeof rendered === 'string' ? rendered : '');
};

const previewData = {
  brand: { identity: 'Studio Razem', name: 'Studio Razem' },
  member: { email: 'anna@example.com', name: 'Anna Kowalska' },
  tenant: { address: 'ul. Wspólna 1, Warszawa', legalName: 'Studio Razem sp. z o.o.', name: 'Studio Razem' },
  unsubscribeUrl: 'https://example.com/u/sample',
};

export const renderCampaignPreview = (source: string): string => {
  const rendered = renderMarketingTemplate(renderCampaignMarkdown(source), previewData);
  return rendered.ok ? rendered.value : renderCampaignMarkdown(source);
};
