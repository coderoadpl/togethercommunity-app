import { describe, expect, it } from 'vitest';

import { marketingSignupFormInputSchema, marketingSignupSubmissionSchema } from './marketing-signup-form.js';

const form = { slug: 'weekly-news', name: 'Weekly news', consentDefinitionId: 'newsletter', successText: { en: 'Thank you', pl: 'Thank you' } };
describe('signup form boundaries', () => {
  it('normalizes email and limits optional display names', () => {
    expect(marketingSignupSubmissionSchema.parse({ email: ' Reader@Example.org ', token: 't'.repeat(32) }).email).toBe('reader@example.org');
    expect(marketingSignupSubmissionSchema.safeParse({ email: 'reader@example.org', token: 't'.repeat(32), displayName: 'a'.repeat(121) }).success).toBe(false);
  });
  it('ignores extra fields posted by an adapted embed', () => {
    const parsed = marketingSignupSubmissionSchema.safeParse({ email: 'reader@example.org', token: 't'.repeat(32), submit: 'Sign up', utm_source: 'blog' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty('utm_source');
  });
  it('rejects a form name beyond the stored limit', () => {
    expect(marketingSignupFormInputSchema.safeParse({ ...form, name: 'a'.repeat(200) }).success).toBe(true);
    expect(marketingSignupFormInputSchema.safeParse({ ...form, name: 'a'.repeat(201) }).success).toBe(false);
  });
  it.each(['http://example.org', 'javascript:alert(1)', 'https://user:password@example.org'])('rejects unsafe redirects: %s', (redirectUrl) => {
    expect(marketingSignupFormInputSchema.safeParse({ ...form, redirectUrl }).success).toBe(false);
  });
  it.each(['https://example.org/', 'https://example.org/path', 'null', '*', 'https://*.example.org'])('rejects non-exact origins: %s', (origin) => {
    expect(marketingSignupFormInputSchema.safeParse({ ...form, allowedOrigins: [origin] }).success).toBe(false);
  });
  it('accepts exact origins and prevents path injection', () => {
    expect(marketingSignupFormInputSchema.parse({ ...form, allowedOrigins: ['https://example.org'] }).allowedOrigins).toEqual(['https://example.org']);
    expect(marketingSignupFormInputSchema.safeParse({ ...form, slug: '../other' }).success).toBe(false);
  });
});
