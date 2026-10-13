import { describe, expect, it } from 'vitest';

import { resolveCancelReturnUrl, salesLinkInputSchema, salesLinkOfferSchema, salesLinkSchema, salesLinkUpdateSchema } from './sales-link.js';

const input = { slug: 'bundle', title: 'Bundle', heading: 'Your bundle', productIds: ['product'] };
const configured = 'https://sales.example/offer#buy';
const oversized = `https://sales.example/${'x'.repeat(2001 - 'https://sales.example/'.length)}`;

describe('sales-link cancel return URL', () => {
  it('accepts and trims an optional nullable https address across management schemas', () => {
    const fields = { ...input, cancelReturnUrl: `  ${configured}  ` };
    expect(salesLinkInputSchema.parse(fields).cancelReturnUrl).toBe(configured);
    expect(salesLinkUpdateSchema.parse({ ...fields, id: 'link', expectedRevision: 1 }).cancelReturnUrl).toBe(configured);
    expect(salesLinkSchema.parse({ ...fields, id: 'link', tenantId: 'workspace', revision: 1, createdAt: '2026-10-12T12:00:00.000Z', updatedAt: '2026-10-12T12:00:00.000Z' }).cancelReturnUrl).toBe(configured);
    expect(salesLinkInputSchema.parse(input)).not.toHaveProperty('cancelReturnUrl');
    expect(salesLinkInputSchema.parse({ ...input, cancelReturnUrl: null }).cancelReturnUrl).toBeNull();
    expect(salesLinkOfferSchema.shape.salesLink.shape).not.toHaveProperty('cancelReturnUrl');
  });

  it.each(['', '   '])('normalizes an empty address %j to null', (cancelReturnUrl) => {
    expect(salesLinkInputSchema.parse({ ...input, cancelReturnUrl }).cancelReturnUrl).toBeNull();
  });

  it.each(['http://sales.example/offer', 'javascript:alert(1)', '/offer', oversized])('rejects invalid configured address %s', (cancelReturnUrl) => {
    expect(salesLinkInputSchema.safeParse({ ...input, cancelReturnUrl }).success).toBe(false);
  });

  it('accepts exactly 2000 characters', () => {
    expect(salesLinkInputSchema.safeParse({ ...input, cancelReturnUrl: oversized.slice(0, 2000) }).success).toBe(true);
  });
});

describe('resolveCancelReturnUrl', () => {
  it.each([
    'https://sales.example/another?source=offer#buy',
    'https://SALES.example:443/offer#section',
  ])('accepts a same-origin https request %s without changing its text', (requested) => {
    expect(resolveCancelReturnUrl(configured, requested)).toBe(requested);
  });

  it.each([
    undefined,
    '',
    'https://other.example/offer',
    'https://sales.example:444/offer',
    'http://sales.example/offer',
    'ftp://sales.example/offer',
    'javascript:alert(1)',
    '/offer',
    'https://sales.example.other.example/offer',
    'https://sales.example@other.example/offer',
    oversized,
  ])('falls back to the configured address for %s', (requested) => {
    expect(resolveCancelReturnUrl(configured, requested)).toBe(configured);
  });

  it.each([undefined, null])('returns undefined without configuration %s, even with a request', (value) => {
    expect(resolveCancelReturnUrl(value)).toBeUndefined();
    expect(resolveCancelReturnUrl(value, configured)).toBeUndefined();
  });
});
