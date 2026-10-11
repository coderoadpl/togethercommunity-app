import type { Language } from '#core/domain/index.js';

import { directSalesLinkCopyEn } from './direct-sales-link-copy.en.js';
import { directSalesLinkCopyPl } from './direct-sales-link-copy.pl.js';

export const directSalesLinkCopy = (language: Language) => language === 'pl' ? directSalesLinkCopyPl : directSalesLinkCopyEn;

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] ?? character);

export const renderDirectSalesLinkPage = (input: {
  heading: string;
  description: string;
  tenantName: string;
  faviconUrl: string | null;
  canonicalUrl: string;
  language: Language;
  mode: 'test' | 'live';
  endpoint: string;
  crawler: boolean;
  nonce: string;
  error?: string;
}): string => {
  const copy = directSalesLinkCopy(input.language);
  const canSubmit = !input.crawler && input.error === undefined;
  return `<!doctype html>
<html lang="${input.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.heading)}</title>
<meta name="description" content="${escapeHtml(input.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(input.tenantName)}">
<meta property="og:title" content="${escapeHtml(input.heading)}">
<meta property="og:description" content="${escapeHtml(input.description)}">
<meta property="og:url" content="${escapeHtml(input.canonicalUrl)}">
<link rel="canonical" href="${escapeHtml(input.canonicalUrl)}">
${input.faviconUrl === null ? '' : `<link rel="icon" href="${escapeHtml(input.faviconUrl)}">`}
</head>
<body>
<main data-endpoint="${escapeHtml(input.endpoint)}" data-mode="${input.mode}">
${input.mode === 'test' ? '<strong>TEST</strong>' : ''}
<p role="status">${escapeHtml(input.error ?? copy.redirecting)}</p>
${canSubmit ? `<noscript><form method="post" action="${escapeHtml(input.endpoint)}"><input type="hidden" name="mode" value="${input.mode}"><button type="submit">${escapeHtml(copy.continueToPayment)}</button></form></noscript>` : ''}
</main>
${canSubmit ? `<script nonce="${escapeHtml(input.nonce)}">
(async () => {
  const page = document.querySelector('main');
  const status = document.querySelector('[role="status"]');
  try {
    const response = await fetch(page.dataset.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: page.dataset.mode }) });
    const result = await response.json();
    if (!response.ok || result.ok !== true || typeof result.data?.url !== 'string') throw new Error(result.error?.message || 'Checkout is unavailable');
    location.replace(result.data.url);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Checkout is unavailable';
  }
})();
</script>` : ''}
</body>
</html>`;
};
