import { describe, expect, it } from 'vitest';

import type {
  CourseStructureLesson,
  CourseStructureWithAccess,
} from '#core/domain/index.js';

import { continueLessonId } from './CourseRail.js';

const lesson = (
  lessonId: string,
  completed: boolean,
  accessible = true,
): CourseStructureLesson => ({
  contentId: `content-${lessonId}`,
  lessonId,
  name: lessonId.toUpperCase(),
  accessStatus: accessible ? 'fully-accessible' : 'not-accessible',
  completionStatus: completed ? 'fully-completed' : 'not-completed',
});

const structureOf = (lessons: CourseStructureLesson[]): CourseStructureWithAccess => ({
  courseId: 'c1',
  name: 'Kurs',
  accessStatus: 'fully-accessible',
  completionStatus: 'partially-completed',
  modules: [
    {
      id: 'm1',
      name: 'Moduł',
      accessStatus: 'fully-accessible',
      completionStatus: 'partially-completed',
      chapters: [
        {
          id: 'ch1',
          name: 'Rozdział',
          accessStatus: 'fully-accessible',
          completionStatus: 'partially-completed',
          lessons,
        },
      ],
    },
  ],
});

describe('continueLessonId', () => {
  it('stays on the last viewed lesson while it is unfinished', () => {
    const structure = structureOf([lesson('l1', true), lesson('l2', false), lesson('l3', false)]);

    expect(continueLessonId(structure, 'l2')).toBe('l2');
  });

  it('moves forward from a completed last viewed lesson instead of back to the intro', () => {
    const structure = structureOf([
      lesson('l1', false),
      lesson('l2', true),
      lesson('l3', false),
    ]);

    expect(continueLessonId(structure, 'l2')).toBe('l3');
  });

  it('skips completed lessons that follow the last viewed one', () => {
    const structure = structureOf([
      lesson('l1', false),
      lesson('l2', true),
      lesson('l3', true),
      lesson('l4', false),
    ]);

    expect(continueLessonId(structure, 'l2')).toBe('l4');
  });

  it('wraps to the first unfinished lesson when nothing unfinished follows', () => {
    const structure = structureOf([
      lesson('l1', false),
      lesson('l2', true),
      lesson('l3', true),
    ]);

    expect(continueLessonId(structure, 'l3')).toBe('l1');
  });

  it('ignores lessons the member cannot open when moving forward', () => {
    const structure = structureOf([
      lesson('l1', true),
      lesson('l2', true),
      lesson('l3', false, false),
      lesson('l4', false),
    ]);

    expect(continueLessonId(structure, 'l2')).toBe('l4');
  });

  it('falls back to the first unfinished lesson when the last viewed one is unknown', () => {
    const structure = structureOf([lesson('l1', true), lesson('l2', false)]);

    expect(continueLessonId(structure, 'gone')).toBe('l2');
  });

  it('offers the first lesson for review once the course is finished', () => {
    const structure = structureOf([lesson('l1', true), lesson('l2', true)]);

    expect(continueLessonId(structure, 'l2')).toBe('l1');
  });

  it('has nothing to continue without accessible lessons', () => {
    const structure = structureOf([lesson('l1', false, false)]);

    expect(continueLessonId(structure, undefined)).toBeNull();
  });
});
