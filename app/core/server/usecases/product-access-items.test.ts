import { describe, expect, it } from 'vitest';

import type { AccessItem, Course, CourseLesson, CourseModule } from '#core/domain/index.js';

import { checkProductAccessItems, type ProductAccessCatalog } from './product-access-items.js';

const TENANT = 'tenant-acme';
const CREATED_AT = '2026-01-01T00:00:00.000Z';

const course = (id: string): Course => ({
  id, tenantId: TENANT, name: id, description: '', imageUrl: null, moduleOrder: [], publiclyVisible: false, archivedAt: null, legacyId: null, createdAt: CREATED_AT,
});

const module = (id: string, courseIds: string[], lessonIds: string[]): CourseModule => ({
  id, tenantId: TENANT, courseIds, title: id, prefix: null, name: id, legacyId: null, createdAt: CREATED_AT,
  chapters: [{ id: `${id}-chapter`, name: 'Chapter', contents: lessonIds.map((lessonId) => ({ id: `${id}-${lessonId}`, lessonId, name: lessonId })) }],
});

const lesson = (id: string): CourseLesson => ({ id, tenantId: TENANT, name: id, isPreview: false, contents: [], legacyId: null, createdAt: CREATED_AT });

const LESSON_IDS = Array.from({ length: 40 }, (_unused, index) => `lesson-${String(index)}`);

const catalog = () => {
  const calls = { courses: 0, modules: 0, moduleList: 0, lessons: 0 };
  const courses = [course('course-intro'), course('course-deep')];
  const modules = [
    module('module-basics', ['course-intro'], LESSON_IDS.slice(0, 20)),
    module('module-more', ['course-intro'], LESSON_IDS.slice(20)),
    module('module-deep', ['course-deep'], ['lesson-deep']),
  ];
  const lessons = [...LESSON_IDS, 'lesson-deep'].map(lesson);
  const repositories: ProductAccessCatalog = {
    courses: { findByIds: async (_tenantId, ids) => { calls.courses += 1; return courses.filter((candidate) => ids.includes(candidate.id)); } },
    modules: {
      findByIds: async (_tenantId, ids) => { calls.modules += 1; return modules.filter((candidate) => ids.includes(candidate.id)); },
      list: async () => { calls.moduleList += 1; return modules; },
    },
    lessons: { findByIds: async (_tenantId, ids) => { calls.lessons += 1; return lessons.filter((candidate) => ids.includes(candidate.id)); } },
  };
  return { calls, repositories };
};

describe('checking what a product grants', () => {
  it('reads the lessons and the modules once for a list of many lesson and module items', async () => {
    const { calls, repositories } = catalog();
    const items: AccessItem[] = [
      ...LESSON_IDS.map((lessonId) => ({ level: 'lessons' as const, courseId: 'course-intro', lessonIds: [lessonId] })),
      { level: 'modules', courseId: 'course-intro', moduleIds: ['module-basics'] },
      { level: 'course', courseId: 'course-deep', excludedModuleIds: ['module-deep'] },
    ];

    expect(await checkProductAccessItems(TENANT, items, repositories)).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual({ courses: 1, modules: 1, moduleList: 1, lessons: 1 });
  });

  it.each([
    ['a missing lesson', [{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-0', 'lesson-gone'] }], 'Product access items may only reference existing lessons'],
    ['a lesson of another course', [{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-deep'] }], 'Product access lessonIds must belong to the item courseId through its modules and chapters'],
    ['a missing module', [{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-gone'] }], 'Product access items may only reference existing modules'],
    ['a module of another course', [{ level: 'modules', courseId: 'course-intro', moduleIds: ['module-deep'] }], 'Product access moduleIds must belong to the item courseId'],
    ['an exclusion of another course', [{ level: 'course', courseId: 'course-intro', excludedModuleIds: ['module-deep'] }], 'Product access excludedModuleIds must belong to the item courseId'],
    [
      'the first failing item first',
      [
        { level: 'modules', courseId: 'course-intro', moduleIds: ['module-deep'] },
        { level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-gone'] },
      ],
      'Product access moduleIds must belong to the item courseId',
    ],
  ] satisfies Array<[string, AccessItem[], string]>)('refuses %s with its message', async (_label, items, message) => {
    const { repositories } = catalog();
    expect(await checkProductAccessItems(TENANT, items, repositories)).toMatchObject({ ok: false, error: { code: 'validation', message } });
  });
});
