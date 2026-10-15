import type { CheckoutBranding } from '#core/domain/checkout-appearance.js';
import { attributionFields, type Attribution } from '#core/domain/index.js';
import type { Language } from '#core/domain/index.js';

import { directSalesLinkCopyEn } from './direct-sales-link-copy.en.js';
import { directSalesLinkCopyPl } from './direct-sales-link-copy.pl.js';

export const directSalesLinkCopy = (language: Language) => language === 'pl' ? directSalesLinkCopyPl : directSalesLinkCopyEn;

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] ?? character);

export const renderDirectSalesLinkPage = (input: {
  attribution?: Attribution | undefined;
  heading: string;
  description: string;
  tenantName: string;
  branding?: CheckoutBranding | undefined;
  faviconUrl: string | null;
  canonicalUrl: string;
  language: Language;
  mode: 'test' | 'live';
  endpoint: string;
  returnUrl?: string;
  crawler: boolean;
  nonce: string;
  error?: 'checkoutUnavailable' | 'legalUrlsMissing';
}): string => {
  const copy = directSalesLinkCopy(input.language);
  const displayName = input.branding?.displayName ?? input.tenantName;
  const appearance = [
    input.branding?.buttonColor ? `--accent: ${input.branding.buttonColor}` : '',
    input.branding?.backgroundColor ? `--background: ${input.branding.backgroundColor}` : '',
  ].filter(Boolean).join('; ');
  const canSubmit = !input.crawler && input.error === undefined;
  const attribution = Object.entries(attributionFields).flatMap(([fieldName, parameter]) => {
    const value = Object.entries(input.attribution ?? {}).find(([key]) => key === fieldName)?.[1];
    return value === undefined ? [] : [{ fieldName, parameter, value }];
  });
  return `<!doctype html>
<html lang="${escapeHtml(input.language)}">
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
<style>
:root { color-scheme: light dark; --background: #f4f5f7; --surface: #ffffff; --text: #20232b; --muted: #636977; --border: #e2e5eb; --accent: #635bff; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: var(--background); color: var(--text); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 440px; padding: 40px 32px; border: 1px solid var(--border); border-radius: 24px; background: var(--surface); box-shadow: 0 16px 64px rgb(0 0 0 / 8%); text-align: center; overflow-wrap: anywhere; }
.logo { display: block; max-width: 200px; max-height: 80px; margin: 0 auto 24px; object-fit: contain; }
h1 { margin: 0 0 24px; font-size: 1.5rem; font-weight: 650; line-height: 1.3; }
p { margin: 0; color: var(--muted); line-height: 1.6; }
.spinner { width: 36px; height: 36px; margin: 0 auto 24px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 900ms linear infinite; }
[data-state="error"] .spinner { display: none; }
strong { display: inline-block; margin: 0 0 24px; padding: 4px 10px; border: 1px solid currentColor; border-radius: 6px; color: var(--accent); font-size: 0.75rem; letter-spacing: 0.08em; }
button { margin-top: 24px; padding: 12px 20px; border: 2px solid var(--accent); border-radius: 12px; background: var(--surface); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) { :root { --background: #111318; --surface: #1c1f27; --text: #f3f4f6; --muted: #b9bfcb; --border: #363c48; --accent: #a49eff; } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
</head>
<body style="${escapeHtml(appearance)}">
<main data-attribution="${escapeHtml(JSON.stringify(input.attribution ?? {}))}" data-endpoint="${escapeHtml(input.endpoint)}"${input.returnUrl === undefined ? '' : ` data-return-url="${escapeHtml(input.returnUrl)}"`} data-mode="${escapeHtml(input.mode)}" data-checkout-unavailable="${escapeHtml(copy.checkoutUnavailable)}">
${input.branding?.logoUrl ? `<img class="logo" src="${escapeHtml(input.branding.logoUrl)}" alt="">` : ''}
<h1>${escapeHtml(displayName)}</h1>
${input.mode === 'test' ? '<strong>TEST</strong>' : ''}
${canSubmit ? '<div class="spinner" aria-hidden="true"></div>' : ''}
<p role="status">${escapeHtml(input.error === undefined ? copy.redirecting : copy[input.error])}</p>
${canSubmit ? `<noscript><form method="post" action="${escapeHtml(input.endpoint)}">${input.returnUrl === undefined ? '' : `<input type="hidden" name="returnUrl" value="${escapeHtml(input.returnUrl)}">`}${attribution.map(({ parameter, value }) => `<input type="hidden" name="${parameter}" value="${escapeHtml(value)}">`).join('')}<button type="submit">${escapeHtml(copy.continueToPayment)}</button></form></noscript>` : ''}
</main>
${canSubmit ? `<script nonce="${escapeHtml(input.nonce)}">
(async () => {
  const page = document.querySelector('main');
  const status = document.querySelector('[role="status"]');
  try {
    const response = await fetch(page.dataset.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attribution: JSON.parse(page.dataset.attribution ?? '{}'), ...(page.dataset.returnUrl === undefined ? {} : { returnUrl: page.dataset.returnUrl }) }) });
    const result = await response.json();
    if (!response.ok || result?.ok !== true || typeof result.data?.url !== 'string') throw new Error();
    location.replace(result.data.url);
  } catch {
    page.dataset.state = 'error';
    status.textContent = page.dataset.checkoutUnavailable;
  }
})();
</script>` : ''}
</body>
</html>`;
};
