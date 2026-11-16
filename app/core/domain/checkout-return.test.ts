import { describe, expect, it } from 'vitest';

import { checkoutReturnOriginsSchema, checkoutReturnUrlSchema, resolveCheckoutReturnUrl } from './checkout-return.js';
import { checkoutCartInputSchema, checkoutSessionInputSchema } from './payment.js';
import { updateTenantSettingsInputSchema } from './tenant.js';

const allowed = ['https://shop.example.test'];

describe('checkout return origins setting', () => {
  it('normalizes exact https origins to their lower-case origin form', () => {
    expect(checkoutReturnOriginsSchema.parse([' https://Shop.Example.Test ', 'https://shop.example.test:8443', 'https://www.shop.example.test/', 'https://store.example.test:443/']))
      .toEqual(['https://shop.example.test', 'https://shop.example.test:8443', 'https://www.shop.example.test', 'https://store.example.test']);
  });

  it.each([
    ['a path', 'https://shop.example.test/cart'],
    ['a query', 'https://shop.example.test?x=1'],
    ['a fragment', 'https://shop.example.test#top'],
    ['a wildcard', 'https://*.example.test'],
    ['http', 'http://shop.example.test'],
    ['credentials', 'https://user:secret@shop.example.test'],
    ['no scheme', 'shop.example.test'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ])('refuses an origin entry with %s', (_label, origin) => {
    expect(updateTenantSettingsInputSchema.safeParse({ checkoutReturnOrigins: [origin] }).success).toBe(false);
  });

  it('refuses more than five origins', () => {
    const six = Array.from({ length: 6 }, (_, index) => `https://shop${String(index)}.example.test`);
    expect(updateTenantSettingsInputSchema.safeParse({ checkoutReturnOrigins: six.slice(0, 5) }).success).toBe(true);
    expect(updateTenantSettingsInputSchema.safeParse({ checkoutReturnOrigins: six }).success).toBe(false);
  });

  it('refuses the same origin twice after normalization', () => {
    expect(checkoutReturnOriginsSchema.safeParse(['https://shop.example.test', 'https://SHOP.example.test:443']).success).toBe(false);
  });

  it('accepts an IP literal, as the sales-link cancel return address does', () => {
    expect(checkoutReturnOriginsSchema.parse(['https://192.0.2.10', 'https://[2001:db8::1]:8443'])).toEqual(['https://192.0.2.10', 'https://[2001:db8::1]:8443']);
  });
});

describe('checkout return and cancel addresses', () => {
  it.each([
    ['the http scheme', 'http://shop.example.test/thanks'],
    ['a foreign origin', 'https://elsewhere.example.test/thanks'],
    ['the same host on another port', 'https://shop.example.test:8443/thanks'],
    ['a credentials part', 'https://buyer:secret@shop.example.test/thanks'],
    ['a user name only', 'https://buyer@shop.example.test/thanks'],
    ['a javascript: URL', 'javascript:alert(document.cookie)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a relative address', '/thanks'],
    ['a protocol-relative address', '//shop.example.test/thanks'],
    ['2001 characters', `https://shop.example.test/${'a'.repeat(2001 - 'https://shop.example.test/'.length)}`],
  ])('refuses %s', (_label, url) => {
    expect(resolveCheckoutReturnUrl(url, allowed)).toBeNull();
  });

  it('refuses everything when the workspace allows no origin', () => {
    expect(resolveCheckoutReturnUrl('https://shop.example.test/thanks', [])).toBeNull();
  });

  it('accepts exactly 2000 characters and drops the fragment', () => {
    const url = `https://shop.example.test/${'a'.repeat(2000 - 'https://shop.example.test/'.length)}`;
    expect(url).toHaveLength(2000);
    expect(resolveCheckoutReturnUrl(url, allowed)).toBe(url);
    expect(resolveCheckoutReturnUrl('https://shop.example.test/cart?step=2#summary', allowed)).toBe('https://shop.example.test/cart?step=2');
  });

  it('refuses the format errors in both request forms without echoing the address', () => {
    for (const [field, url] of [['returnUrl', 'http://shop.example.test/thanks'], ['cancelUrl', 'javascript:alert(1)'], ['returnUrl', 'https://buyer:secret@shop.example.test/x']] as const) {
      const legacy = checkoutSessionInputSchema.safeParse({ productId: 'p1', [field]: url });
      const cart = checkoutCartInputSchema.safeParse({ lines: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1 }], [field]: url });
      for (const parsed of [legacy, cart]) {
        expect(parsed.success).toBe(false);
        expect(Object.keys(parsed.error?.flatten().fieldErrors ?? {})).toEqual([field]);
        expect(JSON.stringify(parsed.error?.flatten())).not.toContain(url);
      }
    }
    expect(checkoutReturnUrlSchema.safeParse(`https://shop.example.test/${'a'.repeat(1975)}`).success).toBe(false);
  });
});
