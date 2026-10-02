import { describe, expect, it } from 'vitest';

import { headingIdBase, headingIds } from './heading-id.js';

describe('lesson heading ids', () => {
  it('normalizes case, punctuation, diacritics, and Polish stroke letters', () => {
    expect(headingIdBase('  \u017b\u00f3\u0142\u0107 & \u0141\u0104KA!  ')).toBe('zolc-laka');
  });

  it('deduplicates normalized headings in document order', () => {
    expect(headingIds(['Setup', 'Setup!', '\u015aetup', ''])).toEqual([
      'setup',
      'setup-2',
      'setup-3',
      'section',
    ]);
  });

  it('skips generated suffixes that another heading already uses', () => {
    expect(headingIds(['Setup', 'Setup', 'Setup 2', 'Setup'])).toEqual([
      'setup',
      'setup-2',
      'setup-2-2',
      'setup-3',
    ]);
  });

  it('caps base and suffixed ids at eighty characters', () => {
    const longHeading = 'A'.repeat(90);

    expect(headingIds([longHeading, longHeading])).toEqual([
      'a'.repeat(80),
      `${'a'.repeat(78)}-2`,
    ]);
  });

  it('removes a trailing separator introduced by truncation', () => {
    expect(headingIdBase(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79));
  });
});
