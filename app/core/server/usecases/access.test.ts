import { describe, expect, it } from 'vitest';

import type { AccessItem, Course, CourseModule } from '#core/domain/index.js';

import {
  buildAccessLookup,
  fullCourseLookup,
  isLessonAccessibleByLookup,
  lessonIdsOpenedByLookup,
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

// Copied from release 8141fd15 (pooled buildAccessLookup and the first-location locateLesson gate): it is the baseline the table below compares against, so it must never be updated to follow access.ts.
const releasedLookup = (items: AccessItem[]) => {
  const courseLevel = new Set<string>();
  const moduleIds = new Set<string>();
  const lessonIds = new Set<string>();
  const perCourse = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.level === 'course') {
      courseLevel.add(item.courseId);
      const excluded = new Set(item.excludedModuleIds ?? []);
      const current = perCourse.get(item.courseId);
      perCourse.set(item.courseId, current ? new Set([...current].filter((id) => excluded.has(id))) : excluded);
    } else if (item.level === 'modules') {
      for (const moduleId of item.moduleIds) moduleIds.add(moduleId);
    } else {
      for (const lessonId of item.lessonIds) lessonIds.add(lessonId);
    }
  }
  const excludedModuleIds = new Set<string>();
  for (const excluded of perCourse.values()) {
    for (const moduleId of excluded) if (!moduleIds.has(moduleId)) excludedModuleIds.add(moduleId);
  }
  return (location: { courseId: string; moduleId: string; lessonId: string }): boolean =>
    (courseLevel.has(location.courseId) && !excludedModuleIds.has(location.moduleId)) ||
    moduleIds.has(location.moduleId) ||
    lessonIds.has(location.lessonId);
};

const releasedFirstLocation = (lessonId: string, courses: Course[], modules: CourseModule[]) => {
  for (const candidate of [...modules].sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)))) {
    for (const chapter of candidate.chapters) {
      if (!chapter.contents.some((content) => content.lessonId === lessonId)) continue;
      const owner = candidate.courseIds.map((id) => courses.find((row) => row.id === id)).find((row) => row !== undefined);
      if (owner) return { courseId: owner.id, moduleId: candidate.id, lessonId };
    }
  }
  return null;
};

const expectedOpen = (items: AccessItem[], row: { courseId: string; moduleId: string; lessonId: string }): boolean =>
  items.some((item) => {
    if (item.level === 'course') return item.courseId === row.courseId && !(item.excludedModuleIds ?? []).includes(row.moduleId);
    if (item.level === 'modules') return item.moduleIds.includes(row.moduleId);
    return item.lessonIds.includes(row.lessonId);
  });

describe('every set of up to three items from a fixed pool opens exactly what its items name and at least what release 8141fd15 opened', () => {
  const courseRow = (id: string): Course => ({ ...course([]), id });
  const holding = (id: string, createdAt: string, courseIds: string[], lessonIds: string[]): CourseModule => ({
    ...module(id, createdAt, courseIds),
    chapters: [{ id: `${id}-chapter`, name: 'Chapter', contents: lessonIds.map((lessonId) => ({ id: `${id}-${lessonId}`, name: lessonId, lessonId })) }],
  });
  const courses = [courseRow('c1'), courseRow('c2')];
  const modules = [
    holding('m-shared', '2026-01-01T00:00:00.000Z', ['c1', 'c2'], ['l-shared']),
    holding('m-first', '2026-01-02T00:00:00.000Z', ['c1'], ['l-first', 'l-twice']),
    holding('m-again', '2026-01-03T00:00:00.000Z', ['c1'], ['l-twice']),
    holding('m-second', '2026-01-04T00:00:00.000Z', ['c2'], ['l-second', 'l-across']),
    holding('m-across', '2026-01-05T00:00:00.000Z', ['c1'], ['l-across']),
  ];
  const lessonIds = ['l-shared', 'l-first', 'l-twice', 'l-second', 'l-across'];
  const rows = modules.flatMap((row) => row.courseIds.flatMap((courseId) =>
    row.chapters.flatMap((chapter) => chapter.contents.map((content) => ({ courseId, moduleId: row.id, lessonId: content.lessonId })))));
  const pool: AccessItem[] = [
    { level: 'course', courseId: 'c1' },
    { level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] },
    { level: 'course', courseId: 'c1', excludedModuleIds: ['m-first'] },
    { level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared', 'm-again'] },
    { level: 'course', courseId: 'c2' },
    { level: 'course', courseId: 'c2', excludedModuleIds: ['m-shared'] },
    { level: 'course', courseId: 'c2', excludedModuleIds: ['m-second'] },
    { level: 'modules', courseId: 'c1', moduleIds: ['m-shared'] },
    { level: 'modules', courseId: 'c1', moduleIds: ['m-again'] },
    { level: 'lessons', courseId: 'c1', lessonIds: ['l-twice'] },
    { level: 'lessons', courseId: 'c2', lessonIds: ['l-shared'] },
  ];
  const combinations: AccessItem[][] = [[]];
  for (const [i, a] of pool.entries()) {
    combinations.push([a]);
    for (const [j, b] of pool.entries()) {
      if (j <= i) continue;
      combinations.push([a, b]);
      for (const c of pool.slice(j + 1)) combinations.push([a, b, c]);
    }
  }

  it.each([
    ['a course row', 'row'],
    ['a lesson request', 'lesson'],
  ])('opens %s exactly when its items name it and never closes one the release opened', (_label, kind) => {
    let gained = 0;
    for (const items of combinations) {
      const released = releasedLookup(items);
      const lookup = buildAccessLookup(items);
      if (kind === 'row') {
        for (const row of rows) {
          const before = released(row);
          const after = isLessonAccessibleByLookup(lookup, row);
          expect({ items, row, after }).toEqual({ items, row, after: expectedOpen(items, row) });
          expect({ items, row, after: before ? after : true }).toEqual({ items, row, after: true });
          if (after && !before) gained += 1;
        }
      } else {
        for (const lessonId of lessonIds) {
          const first = releasedFirstLocation(lessonId, courses, modules);
          const before = first !== null && released(first);
          const after = locateAccessibleLesson(lessonId, courses, modules, lookup) !== null;
          const expected = rows.some((row) => row.lessonId === lessonId && expectedOpen(items, row));
          expect({ items, lessonId, after }).toEqual({ items, lessonId, after: expected });
          expect({ items, lessonId, after: before ? after : true }).toEqual({ items, lessonId, after: true });
          if (after && !before) gained += 1;
        }
      }
    }
    expect(combinations).toHaveLength(232);
    expect(gained).toBeGreaterThan(0);
  });

  it('collects in one walk exactly the lessons a lesson request opens', () => {
    for (const items of combinations) {
      const lookup = buildAccessLookup(items);
      const expected = lessonIds.filter((lessonId) => locateAccessibleLesson(lessonId, courses, modules, lookup) !== null);
      expect({ items, opened: [...lessonIdsOpenedByLookup(courses, modules, lookup)].sort() }).toEqual({ items, opened: expected.sort() });
    }
    expect(lessonIdsOpenedByLookup([courseRow('c2')], modules, buildAccessLookup([{ level: 'course', courseId: 'c1' }]))).toEqual(new Set());
  });
});
