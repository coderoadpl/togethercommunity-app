import { describe, expect, it } from 'vitest';

import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { branchOfLesson, focusLesson } from './course-tree-state.js';

const lesson = (id: string) => ({
  contentId: `content-${id}`,
  lessonId: id,
  name: `Lesson ${id}`,
  accessStatus: 'fully-accessible' as const,
  completionStatus: 'not-completed' as const,
});

const structure: CourseStructureWithAccess = {
  courseId: 'course-1',
  name: 'JavaScript Foundations',
  accessStatus: 'fully-accessible',
  completionStatus: 'not-completed',
  modules: [
    {
      id: 'm1',
      name: 'Module one',
      accessStatus: 'fully-accessible',
      completionStatus: 'not-completed',
      chapters: [
        {
          id: 'c1',
          name: 'Chapter one',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [lesson('l1'), lesson('l2')],
        },
        {
          id: 'c2',
          name: 'Chapter two',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [lesson('l3')],
        },
      ],
    },
    {
      id: 'm2',
      name: 'Module two',
      accessStatus: 'fully-accessible',
      completionStatus: 'not-completed',
      chapters: [
        {
          id: 'c3',
          name: 'Chapter three',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [lesson('l4')],
        },
      ],
    },
  ],
};

const empty: CourseStructureWithAccess = { ...structure, modules: [] };

describe('focusLesson', () => {
  it('follows the open lesson over the last viewed one', () => {
    expect(focusLesson(structure, { currentLessonId: 'l4', lastViewedLessonId: 'l1' })).toBe('l4');
  });

  it('falls back to the last viewed lesson outside a lesson route', () => {
    expect(focusLesson(structure, { currentLessonId: null, lastViewedLessonId: 'l3' })).toBe('l3');
  });

  it('falls back to the first lesson when nothing was viewed yet', () => {
    expect(focusLesson(structure, { currentLessonId: null, lastViewedLessonId: undefined })).toBe(
      'l1',
    );
  });

  it('ignores a last viewed lesson the course no longer contains', () => {
    expect(focusLesson(structure, { lastViewedLessonId: 'gone' })).toBe('l1');
  });

  it('ignores an open lesson the course no longer contains', () => {
    expect(focusLesson(structure, { currentLessonId: 'gone', lastViewedLessonId: 'l4' })).toBe('l4');
  });

  it('has nothing to focus in a course without lessons', () => {
    expect(focusLesson(empty, { currentLessonId: 'l1' })).toBeNull();
  });
});

describe('branchOfLesson', () => {
  it('expands only the module and chapter holding the lesson', () => {
    expect([...branchOfLesson(structure, 'l3')]).toEqual(['m1', 'c2']);
    expect([...branchOfLesson(structure, 'l4')]).toEqual(['m2', 'c3']);
  });

  it('expands nothing for an unknown or absent lesson', () => {
    expect([...branchOfLesson(structure, 'gone')]).toEqual([]);
    expect([...branchOfLesson(structure, null)]).toEqual([]);
  });
});
