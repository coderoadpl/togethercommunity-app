import { z } from 'zod';

import { persistedJsonPreference } from '../../theme-mode.js';

const lessonTextAutoExpandPreference = persistedJsonPreference(
  'together-lesson-text-auto-expand',
  (value) => {
    const parsed = z.boolean().safeParse(value);
    return parsed.success ? parsed.data : undefined;
  },
  false,
);

export const readLessonTextAutoExpand = (): boolean => lessonTextAutoExpandPreference.load();

export const writeLessonTextAutoExpand = (value: boolean): void => lessonTextAutoExpandPreference.save(value);
