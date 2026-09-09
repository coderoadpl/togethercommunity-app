import { describe, expect, it } from 'vitest';

import { slugify } from './slug.js';

describe('slugify', () => {
  it('maps Latin diacritics to their base letters', () => {
    expect(slugify('\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c')).toBe('acelnoszz');
    expect(slugify('\u0141\u00d3\u0106')).toBe('loc');
  });

  it('collapses punctuation and whitespace into single hyphens', () => {
    expect(slugify('Course: HTML & CSS!')).toBe('course-html-css');
    expect(slugify('  Course Together   101 ')).toBe('course-together-101');
  });

  it('transliterates German and Nordic letters that NFKD keeps intact', () => {
    expect(slugify('Straße für Anfänger')).toBe('strasse-fur-anfanger');
    expect(slugify('Smørrebrød og øl')).toBe('smorrebrod-og-ol');
    expect(slugify('Þ\u00f3runn Ægir Œuvre')).toBe('thorunn-aegir-oeuvre');
    expect(slugify('Đakovo')).toBe('dakovo');
  });

  it('returns an empty slug for blank or unslugable input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('');
  });

  it('never ends with a hyphen after truncating to maxLength', () => {
    expect(slugify('alpha beta gamma', { maxLength: 6 })).toBe('alpha');
    expect(slugify('alpha beta gamma', { maxLength: 5 })).toBe('alpha');
    expect(slugify('alpha beta gamma', { maxLength: 8 })).toBe('alpha-be');
    expect(slugify(`${'a'.repeat(99)} b`, { maxLength: 100 })).toBe('a'.repeat(99));
  });
});
