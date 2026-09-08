import { describe, expect, it } from 'vitest';

import type {
  CourseStructureLesson,
  CourseStructureWithAccess,
} from '#core/domain/index.js';

import { resolveCourseResume } from './course-resume.js';

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
  name: 'Course',
  accessStatus: 'fully-accessible',
  completionStatus: 'partially-completed',
  modules: [
    {
      id: 'm1',
      name: 'Module',
      accessStatus: 'fully-accessible',
      completionStatus: 'partially-completed',
      chapters: [
        {
          id: 'ch1',
          name: 'Chapter',
          accessStatus: 'fully-accessible',
          completionStatus: 'partially-completed',
          lessons,
        },
      ],
    },
  ],
});

describe('resolveCourseResume', () => {
  it('starts with the first incomplete lesson without a visit', () => {
    const structure = structureOf([lesson('l1', true), lesson('l2', false)]);
    expect(resolveCourseResume(structure, undefined)).toEqual({
      target: { id: 'l2', name: 'L2' },
      firstIncomplete: { id: 'l2', name: 'L2' },
      isReview: false,
    });
  });

  it('stays on the last viewed lesson while it is unfinished', () => {
    const structure = structureOf([lesson('l1', true), lesson('l2', false), lesson('l3', false)]);

    expect(resolveCourseResume(structure, 'l2').target?.id ?? null).toBe('l2');
  });

  it('moves forward from a completed last viewed lesson instead of back to the intro', () => {
    const structure = structureOf([
      lesson('l1', false),
      lesson('l2', true),
      lesson('l3', false),
    ]);

    expect(resolveCourseResume(structure, 'l2').target?.id ?? null).toBe('l3');
  });

  it('skips completed lessons that follow the last viewed one', () => {
    const structure = structureOf([
      lesson('l1', false),
      lesson('l2', true),
      lesson('l3', true),
      lesson('l4', false),
    ]);

    expect(resolveCourseResume(structure, 'l2').target?.id ?? null).toBe('l4');
  });

  it('wraps to the first unfinished lesson when nothing unfinished follows', () => {
    const structure = structureOf([
      lesson('l1', false),
      lesson('l2', true),
      lesson('l3', true),
    ]);

    expect(resolveCourseResume(structure, 'l3').target?.id ?? null).toBe('l1');
  });

  it('ignores lessons the member cannot open when moving forward', () => {
    const structure = structureOf([
      lesson('l1', true),
      lesson('l2', true),
      lesson('l3', false, false),
      lesson('l4', false),
    ]);

    expect(resolveCourseResume(structure, 'l2').target?.id ?? null).toBe('l4');
  });

  it('falls back to the first unfinished lesson when the last viewed one is unknown', () => {
    const structure = structureOf([lesson('l1', true), lesson('l2', false)]);

    expect(resolveCourseResume(structure, 'gone').target?.id ?? null).toBe('l2');
  });

  it('offers the last visited lesson for review once the course is finished', () => {
    const structure = structureOf([lesson('l1', true), lesson('l2', true)]);

    expect(resolveCourseResume(structure, 'l2')).toEqual({
      target: { id: 'l2', name: 'L2' }, firstIncomplete: null, isReview: true,
    });
  });

  it('has nothing to continue without accessible lessons', () => {
    const structure = structureOf([lesson('l1', false, false)]);

    expect(resolveCourseResume(structure, undefined).target).toBeNull();
  });
});
