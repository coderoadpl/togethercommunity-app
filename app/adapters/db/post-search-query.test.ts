import { describe, expect, it } from 'vitest';

import { buildPrefixTsquery } from './post-search-query.js';

describe('buildPrefixTsquery', () => {
  it('prefix-matches a single stem so inflected forms are reachable', () => {
    expect(buildPrefixTsquery('zmienn')).toBe('zmienn:*');
    expect(buildPrefixTsquery('Zmienne')).toBe('zmienne:*');
  });

  it('ANDs multiple terms with only the last one prefix-matched', () => {
    expect(buildPrefixTsquery('typy zmienn')).toBe('typy & zmienn:*');
    expect(buildPrefixTsquery('  pętla   for  ')).toBe('pętla & for:*');
  });

  it('strips characters that would otherwise inject to_tsquery operators', () => {
    expect(buildPrefixTsquery('zmienn:* | typy')).toBe('zmienn & typy:*');
    expect(buildPrefixTsquery('a & b')).toBe('a & b:*');
    expect(buildPrefixTsquery('(drop)')).toBe('drop:*');
  });

  it('keeps unicode letters and digits', () => {
    expect(buildPrefixTsquery('funkcja42')).toBe('funkcja42:*');
    expect(buildPrefixTsquery('ĄĘŻ')).toBe('ąęż:*');
  });

  it('returns null when nothing searchable remains', () => {
    expect(buildPrefixTsquery('')).toBeNull();
    expect(buildPrefixTsquery('   ')).toBeNull();
    expect(buildPrefixTsquery('!@#$%')).toBeNull();
  });
});
