import { describe, expect, it } from 'vitest';

import { buildPrefixTsquery } from './post-search-query.js';

describe('buildPrefixTsquery', () => {
  it('prefix-matches a single stem so inflected forms are reachable', () => {
    expect(buildPrefixTsquery('variabl')).toBe('variabl:*');
    expect(buildPrefixTsquery('Variable')).toBe('variable:*');
  });

  it('ANDs multiple terms with only the last one prefix-matched', () => {
    expect(buildPrefixTsquery('types variabl')).toBe('types & variabl:*');
    expect(buildPrefixTsquery('  loop   for  ')).toBe('loop & for:*');
  });

  it('strips characters that would otherwise inject to_tsquery operators', () => {
    expect(buildPrefixTsquery('variabl:* | types')).toBe('variabl & types:*');
    expect(buildPrefixTsquery('a & b')).toBe('a & b:*');
    expect(buildPrefixTsquery('(drop)')).toBe('drop:*');
  });

  it('keeps unicode letters and digits', () => {
    expect(buildPrefixTsquery('function42')).toBe('function42:*');
    expect(buildPrefixTsquery('CAFÉ')).toBe('café:*');
  });

  it('returns null when nothing searchable remains', () => {
    expect(buildPrefixTsquery('')).toBeNull();
    expect(buildPrefixTsquery('   ')).toBeNull();
    expect(buildPrefixTsquery('!@#$%')).toBeNull();
  });
});
