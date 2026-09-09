import { describe, expect, it, vi } from 'vitest';

import { renderMarketingPayload } from './marketing-render.js';

const input = {
  subject: 'Hello {{name}}', bodyHtml: '<p>{{name}}</p>', bodyText: null,
  data: { name: 'Alice & Bob' }, unsubscribeUrl: 'https://courses.example.org/u/token',
  legalName: 'Example & Company', address: '123 Example Street', consentReference: 'Updates about courses', layoutHtml: null,
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
    expect(result.value.text).toContain('Example & Company\n123 Example Street\nUpdates about courses');
    expect(result.value.text).toContain(`Unsubscribe: ${input.unsubscribeUrl}`);
    expect(result.value.html).toContain(input.unsubscribeUrl);
    expect(result.value.headers['List-Unsubscribe']).toBe(`<${input.unsubscribeUrl}>`);
  });
  it('renders explicit plaintext without escaping and cannot omit the footer', () => {
    const convert = vi.fn();
    const result = renderMarketingPayload({ ...input, bodyText: 'Dear {{name}}' }, { htmlToText: { convert } });
    expect(result.ok && result.value.text).toBe(`Dear Alice & Bob\n\nExample & Company\n123 Example Street\nUpdates about courses\n\nUnsubscribe: ${input.unsubscribeUrl}`);
    expect(convert).not.toHaveBeenCalled();
  });
  it.each([' ', '{{name()}}'])('rejects invalid explicit plaintext %s', (bodyText) => {
    expect(renderMarketingPayload({ ...input, bodyText }, { htmlToText: { convert: () => '' } }).ok).toBe(false);
  });
});
