import { describe, expect, it } from 'vitest';

import { resolveEmailLanguage } from './language.js';

describe('resolveEmailLanguage', () => {
  it('prefers the recipient preference over the tenant default', () => {
    expect(resolveEmailLanguage('en', 'pl')).toBe('en');
    expect(resolveEmailLanguage('pl', 'en')).toBe('pl');
  });

  it('falls back to the tenant default when the recipient has no preference', () => {
    expect(resolveEmailLanguage(null, 'en')).toBe('en');
    expect(resolveEmailLanguage(undefined, 'en')).toBe('en');
  });

  it('falls back to Polish when nothing is set or the value is unsupported', () => {
    expect(resolveEmailLanguage()).toBe('pl');
    expect(resolveEmailLanguage(null, null)).toBe('pl');
    expect(resolveEmailLanguage('de', 'fr')).toBe('pl');
  });

  it('skips unsupported values and keeps looking down the chain', () => {
    expect(resolveEmailLanguage('de', 'en')).toBe('en');
  });
});
