import { describe, expect, it, vi } from 'vitest';

import { marketingFooterCopy } from '#core/domain/index.js';

import { renderMarketingPayload } from './marketing-render.js';

const footerCopy = marketingFooterCopy('en');
const input = {
  subject: 'Hello {{name}}', bodyHtml: '<p>{{name}}</p>', bodyText: null,
  data: { name: 'Alice & Bob' }, unsubscribeUrl: 'https://courses.example.org/u/token',
  unsubscribeLabel: footerCopy.unsubscribe, legalName: 'Example & Company', address: '123 Example Street',
  consentReference: 'Updates about courses', consentBasisPrefix: footerCopy.basisPrefix,
  consentBasisSuffix: footerCopy.basisSuffix, layoutHtml: null,
};

describe('marketing rendering', () => {
  it('generates plaintext and independently adds mandatory content to both parts', () => {
    const convert = vi.fn(() => 'Alice & Bob');
    const result = renderMarketingPayload(input, { htmlToText: { convert } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.subject).toBe('Hello Alice & Bob');
    expect(result.value.html).toContain('Alice &amp; Bob');
    expect(result.value.html).toContain('Example &amp; Company');
    expect(result.value.text).toContain('Example & Company\n123 Example Street\nYou receive this message based on your consent: “Updates about courses”.');
    expect(result.value.text).toContain(`Unsubscribe: ${input.unsubscribeUrl}`);
    expect(result.value.html).toContain(input.unsubscribeUrl);
    expect(result.value.headers['List-Unsubscribe']).toBe(`<${input.unsubscribeUrl}>`);
  });
  it('renders explicit plaintext without escaping and cannot omit the footer', () => {
    const convert = vi.fn();
    const result = renderMarketingPayload({ ...input, bodyText: 'Dear {{name}}' }, { htmlToText: { convert } });
    expect(result.ok && result.value.text).toBe(`Dear Alice & Bob\n\nExample & Company\n123 Example Street\nYou receive this message based on your consent: “Updates about courses”.\n\nUnsubscribe: ${input.unsubscribeUrl}`);
    expect(convert).not.toHaveBeenCalled();
  });
  it('renders Polish footer copy for Polish tenants', () => {
    const copy = marketingFooterCopy('pl');
    const result = renderMarketingPayload({
      ...input,
      unsubscribeLabel: copy.unsubscribe,
      consentBasisPrefix: copy.basisPrefix,
      consentBasisSuffix: copy.basisSuffix,
      consentReference: 'Course & product updates',
    }, { htmlToText: { convert: () => 'Alice & Bob' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain(`${copy.basisPrefix}Course &amp; product updates${copy.basisSuffix}`);
    expect(result.value.html).toContain(`>${copy.unsubscribe}</a>`);
    expect(result.value.text).toContain(`${copy.basisPrefix}Course & product updates${copy.basisSuffix}`);
    expect(result.value.text).toContain(`${copy.unsubscribe}: ${input.unsubscribeUrl}`);
  });
  it.each([' ', '{{name()}}'])('rejects invalid explicit plaintext %s', (bodyText) => {
    expect(renderMarketingPayload({ ...input, bodyText }, { htmlToText: { convert: () => '' } }).ok).toBe(false);
  });
});
