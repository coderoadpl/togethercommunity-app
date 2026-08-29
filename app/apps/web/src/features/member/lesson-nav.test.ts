import { describe, expect, it } from 'vitest';

import type { CourseStructureWithAccess } from '#core/domain/index.js';

import { lessonNeighbours, lessonPath, linearizeCourse } from './lesson-nav.js';

const lesson = (lessonId: string, accessible = true) => ({
  contentId: `ct-${lessonId}`,
  lessonId,
  name: `Lesson ${lessonId}`,
  accessStatus: accessible ? ('fully-accessible' as const) : ('not-accessible' as const),
  completionStatus: 'not-completed' as const,
});

const course = (
  chapters: { id: string; lessons: ReturnType<typeof lesson>[] }[][],
): CourseStructureWithAccess => ({
  courseId: 'course-1',
  name: 'Course',
  accessStatus: 'fully-accessible',
  completionStatus: 'not-completed',
  modules: chapters.map((moduleChapters, index) => ({
    id: `m${index + 1}`,
    name: `Module ${index + 1}`,
    accessStatus: 'fully-accessible',
    completionStatus: 'not-completed',
    chapters: moduleChapters.map((chapter) => ({
      ...chapter,
      name: `Chapter ${chapter.id}`,
      accessStatus: 'fully-accessible' as const,
      completionStatus: 'not-completed' as const,
    })),
  })),
});

describe('linearizeCourse', () => {
  it('reads lessons in module, then chapter, then lesson order', () => {
    const structure = course([
      [
        { id: 'c1', lessons: [lesson('l1'), lesson('l2')] },
        { id: 'c2', lessons: [lesson('l3')] },
      ],
      [{ id: 'c3', lessons: [lesson('l4')] }],
    ]);

    expect(linearizeCourse(structure).map((entry) => entry.lessonId)).toEqual([
      'l1',
      'l2',
      'l3',
      'l4',
    ]);
  });

  it('keeps inaccessible lessons in the list and flags them as locked', () => {
    const structure = course([[{ id: 'c1', lessons: [lesson('l1'), lesson('l2', false)] }]]);

    expect(linearizeCourse(structure)).toEqual([
      { lessonId: 'l1', name: 'Lesson l1', locked: false },
      { lessonId: 'l2', name: 'Lesson l2', locked: true },
    ]);
  });

  it('returns an empty list for a course without content', () => {
    expect(linearizeCourse(course([]))).toEqual([]);
  });
});

describe('lessonNeighbours', () => {
  const linear = linearizeCourse(
    course([
      [
        { id: 'c1', lessons: [lesson('l1'), lesson('l2', false)] },
        { id: 'c2', lessons: [lesson('l3'), lesson('l4')] },
      ],
    ]),
  );

  it('returns null when the lesson is not part of the course', () => {
    expect(lessonNeighbours(linear, 'unknown')).toBeNull();
  });

  it('has no previous lesson at the start of the course', () => {
    expect(lessonNeighbours(linear, 'l1')?.previous).toBeNull();
  });

  it('has no next lesson at the end of the course', () => {
    const last = lessonNeighbours(linear, 'l4');
    expect(last?.next).toBeNull();
    expect(last?.nextUnlocked).toBeNull();
  });

  it('skips locked lessons for the next unlocked target but keeps the direct neighbour', () => {
    const first = lessonNeighbours(linear, 'l1');
    expect(first?.next?.lessonId).toBe('l2');
    expect(first?.nextUnlocked?.lessonId).toBe('l3');
  });

  it('reports a locked previous lesson so it can be shown as disabled', () => {
    expect(lessonNeighbours(linear, 'l3')?.previous).toEqual({
      lessonId: 'l2',
      name: 'Lesson l2',
      locked: true,
    });
  });

  it('has no unlocked next when every remaining lesson is locked', () => {
    const tail = linearizeCourse(
      course([[{ id: 'c1', lessons: [lesson('l1'), lesson('l2', false)] }]]),
    );
    const neighbours = lessonNeighbours(tail, 'l1');
    expect(neighbours?.next?.lessonId).toBe('l2');
    expect(neighbours?.nextUnlocked).toBeNull();
  });
});

describe('lessonPath', () => {
  it('encodes course and lesson identifiers', () => {
    expect(lessonPath('course 1', 'l/2')).toBe('/my/courses/course%201/lessons/l%2F2');
  });
});
