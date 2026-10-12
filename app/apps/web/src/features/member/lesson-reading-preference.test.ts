import { describe, expect, it } from 'vitest';

import { readLessonTextAutoExpand, writeLessonTextAutoExpand } from './lesson-reading-preference.js';

describe('lesson text preference', () => {
  it('defaults to collapsed without a stored preference', () => {
    expect(readLessonTextAutoExpand()).toBe(false);
  });

  it.each(['broken', 'null', '1', '"true"'])('ignores invalid stored preference %s', (value) => {
    window.localStorage.setItem('together-lesson-text-auto-expand', value);
    expect(readLessonTextAutoExpand()).toBe(false);
  });

  it.each([true, false])('remembers a boolean preference %s', (value) => {
    writeLessonTextAutoExpand(value);
    expect(readLessonTextAutoExpand()).toBe(value);
    expect(window.localStorage.getItem('together-lesson-text-auto-expand')).toBe(String(value));
  });
});
