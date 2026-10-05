import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseLessonEditionNumber } from './lesson-edition-search.js';

describe('lesson edition URLs', () => {
  it.each(['0', '2', '2.0', '2.1', '3.0.1'])('preserves the exact edition %s through a shareable URL', (number) => {
    const url = defaultStringifySearch({ edition: number });
    const search = z.object({ edition: z.unknown() }).parse(defaultParseSearch(url));
    expect(parseLessonEditionNumber(search['edition'])).toBe(number);
  });

  it.each(['01', '1.02', '1.2.3.4', '', '-1', '1234567890123', 2, null])('rejects malformed or lossy edition input %s', (input) => {
    expect(parseLessonEditionNumber(input)).toBeUndefined();
  });
});
