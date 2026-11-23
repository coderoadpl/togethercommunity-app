import { describe, expect, it } from 'vitest';

import type { AccessItem, Course, CourseModule } from '#core/domain/index.js';

import {
  buildAccessLookup,
  fullCourseLookup,
  isLessonAccessibleByLookup,
  lessonLocations,
  locateAccessibleLesson,
  locateLesson,
  modulesForCourse,
} from './access.js';

const course = (moduleOrder: string[]): Course => ({
  id: 'c1',
  tenantId: 't1',
  name: 'Course',
  description: '',
  imageUrl: null,
  moduleOrder,
  publiclyVisible: false,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const module = (id: string, createdAt: string, courseIds: string[] = ['c1']): CourseModule => ({
  id,
  tenantId: 't1',
  courseIds,
  title: id,
  prefix: null,
  name: id,
  chapters: [],
  legacyId: null,
  createdAt,
});

describe('modulesForCourse ordering', () => {
  it('orders attached modules by the course module order', () => {
    const modules = [
      module('m1', '2026-01-01T00:00:00.000Z'),
      module('m2', '2026-01-02T00:00:00.000Z'),
      module('m3', '2026-01-03T00:00:00.000Z'),
    ];
    const ordered = modulesForCourse(course(['m3', 'm1', 'm2']), modules);
    expect(ordered.map((item) => item.id)).toEqual(['m3', 'm1', 'm2']);
  });

  it('places modules missing from the order last, by creation time', () => {
    const modules = [
      module('m1', '2026-01-03T00:00:00.000Z'),
      module('m2', '2026-01-01T00:00:00.000Z'),
      module('m3', '2026-01-02T00:00:00.000Z'),
    ];
    const ordered = modulesForCourse(course(['m1']), modules);
    expect(ordered.map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('excludes modules not attached to the course', () => {
    const modules = [module('m1', '2026-01-01T00:00:00.000Z'), module('m2', '2026-01-02T00:00:00.000Z', ['other'])];
    const ordered = modulesForCourse(course([]), modules);
    expect(ordered.map((item) => item.id)).toEqual(['m1']);
  });
});

describe('buildAccessLookup — exclusions apply only inside the course whose item names them', () => {
  const inCourse = (courseId: string, moduleId = 'm-shared') => ({ courseId, moduleId, lessonId: 'l-shared' });
  const opens = (items: AccessItem[], courseId: string, moduleId?: string) =>
    isLessonAccessibleByLookup(buildAccessLookup(items), inCourse(courseId, moduleId));

  const c1WithoutShared: AccessItem = { level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] };

  it('keeps a module excluded from one course open in another course granted whole by another product', () => {
    const items = [{ level: 'course' as const, courseId: 'c2' }, c1WithoutShared];
    expect(opens(items, 'c2')).toBe(true);
    expect(opens(items, 'c1')).toBe(false);
  });

  it('keeps it open in the other course when one product names both courses', () => {
    const items: AccessItem[] = [c1WithoutShared, { level: 'course', courseId: 'c2' }];
    expect(opens(items, 'c2')).toBe(true);
    expect(opens(items, 'c1')).toBe(false);
    expect(opens(items, 'c1', 'm-other')).toBe(true);
  });

  it('opens the module when another item for the same course does not exclude it', () => {
    expect(opens([c1WithoutShared, { level: 'course', courseId: 'c1' }], 'c1')).toBe(true);
    expect(opens([c1WithoutShared, { level: 'course', courseId: 'c1', excludedModuleIds: ['m-other'] }], 'c1')).toBe(true);
    expect(opens([c1WithoutShared, { level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] }], 'c1')).toBe(false);
  });

  it('opens the module in every course when a modules item names it', () => {
    const items: AccessItem[] = [c1WithoutShared, { level: 'modules', courseId: 'c2', moduleIds: ['m-shared'] }];
    expect(opens(items, 'c1')).toBe(true);
    expect(opens(items, 'c2')).toBe(true);
    expect(opens(items, 'c3')).toBe(true);
  });

  it('opens a lesson item in a course whose item excludes its module', () => {
    const items: AccessItem[] = [c1WithoutShared, { level: 'lessons', courseId: 'c1', lessonIds: ['l-shared'] }];
    expect(opens(items, 'c1')).toBe(true);
  });

  it('grants nothing in a course no item names', () => {
    expect(opens([c1WithoutShared], 'c2')).toBe(false);
  });

  it('keeps the staff lookup open for every module of its course and closed elsewhere', () => {
    expect(isLessonAccessibleByLookup(fullCourseLookup('c1'), inCourse('c1'))).toBe(true);
    expect(isLessonAccessibleByLookup(fullCourseLookup('c1'), inCourse('c2'))).toBe(false);
  });

  it('holds each course its own exclusions', () => {
    const lookup = buildAccessLookup([c1WithoutShared, { level: 'course', courseId: 'c2', excludedModuleIds: ['m-other'] }]);
    expect(lookup.excludedModulesByWholeCourse).toEqual(new Map([['c1', new Set(['m-shared'])], ['c2', new Set(['m-other'])]]));
  });
});

describe('lesson locations across the courses of a shared module', () => {
  const courseRow = (id: string): Course => ({ ...course([]), id });
  const withLesson = (id: string, createdAt: string, courseIds: string[]): CourseModule => ({
    ...module(id, createdAt, courseIds),
    chapters: [{ id: `${id}-chapter`, name: 'Chapter', contents: [{ id: `${id}-content`, name: 'Lesson', lessonId: 'l-shared' }] }],
  });
  const courses = [courseRow('c1'), courseRow('c2')];
  const modules = [withLesson('m-shared', '2026-01-01T00:00:00.000Z', ['c1', 'c2'])];

  it('lists every course of every module holding the lesson, the first being the one locateLesson picks', () => {
    const locations = lessonLocations('l-shared', courses, modules);
    expect(locations.map((location) => location.course.id)).toEqual(['c1', 'c2']);
    expect(locateLesson('l-shared', courses, modules)?.course.id).toBe('c1');
  });

  it('finds the course where the lookup opens the lesson, or none', () => {
    const lookup = buildAccessLookup([
      { level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] },
      { level: 'course', courseId: 'c2' },
    ]);
    expect(locateAccessibleLesson('l-shared', courses, modules, lookup)?.course.id).toBe('c2');
    expect(locateAccessibleLesson('l-shared', courses, modules, buildAccessLookup([
      { level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] },
    ]))).toBeNull();
  });
});
