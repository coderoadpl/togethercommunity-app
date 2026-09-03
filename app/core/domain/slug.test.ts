import { describe, expect, it } from 'vitest';

import { slugify } from './slug.js';

describe('slugify', () => {
  it('maps Polish diacritics to their base letters', () => {
    expect(slugify('Społeczność CodeRoad')).toBe('spolecznosc-coderoad');
    expect(slugify('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn');
    expect(slugify('Łódź')).toBe('lodz');
  });

  it('collapses punctuation and whitespace into single hyphens', () => {
    expect(slugify('Kurs: HTML & CSS!')).toBe('kurs-html-css');
    expect(slugify('  Kurs Together   101 ')).toBe('kurs-together-101');
  });

  it('transliterates German and Nordic letters that NFKD keeps intact', () => {
    expect(slugify('Straße für Anfänger')).toBe('strasse-fur-anfanger');
    expect(slugify('Smørrebrød og øl')).toBe('smorrebrod-og-ol');
    expect(slugify('Þórunn Ægir Œuvre')).toBe('thorunn-aegir-oeuvre');
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
