import { describe, expect, it } from 'vitest';

import { compareLessonEditionNumbers, lessonEditionInputSchema, lessonEditionNumberSchema } from './lesson-editions.js';
import { importLessonRecordSchema } from './import.js';

describe('lesson edition validation', () => {
  it.each(['0', '1', '2.1', '3.0.1', '123456789012'])('accepts %s', (number) => {
    expect(lessonEditionNumberSchema.safeParse(number).success).toBe(true);
  });
  it.each(['', '01', '1.01', '1.0.01', '-1', '1.2.3.4', '1.', '1e2', '1234567890123', '1\n', '1\r', ' 1', '1 '])('rejects %s', (number) => {
    expect(lessonEditionNumberSchema.safeParse(number).success).toBe(false);
  });
  it('sorts each segment numerically', () => {
    expect(['10', '2.10', '2.2', '2', '2.0', '2.0.1'].sort(compareLessonEditionNumbers))
      .toEqual(['2', '2.0', '2.0.1', '2.2', '2.10', '10']);
  });
  it('accepts optional notes and limits them to 200 characters', () => {
    expect(lessonEditionInputSchema.safeParse({ number: '2', note: 'x'.repeat(200) }).success).toBe(true);
    expect(lessonEditionInputSchema.safeParse({ number: '2', note: 'x'.repeat(201) }).success).toBe(false);
  });
  it('parses edition metadata on imported lessons', () => {
    expect(importLessonRecordSchema.parse({ importKey: 'chapter-3', name: 'Chapter 3', contents: [], isPreview: false,
      edition: { number: '2.1', note: 'Revised examples' } }).edition)
      .toEqual({ number: '2.1', note: 'Revised examples' });
  });
});
