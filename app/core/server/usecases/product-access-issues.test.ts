import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type Product,
  type StaffRole,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  ProductRepository,
} from '../ports.js';
import {
  listProductAccessIssues,
  type ProductAccessIssuesDeps,
} from './product-access-issues.js';

const identity = (tenantId: string | null, staffRole: StaffRole | null): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme' : null,
  staffRole,
  memberId: null,
});

const ctx = (tenantId: string | null, staffRole: StaffRole | null): Ctx => ({
  identity: identity(tenantId, staffRole),
});

const course = (id: string): Course => ({
  id,
  tenantId: 't1',
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  moduleOrder: [],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const module = (id: string, courseIds: string[]): CourseModule => ({
  id,
  tenantId: 't1',
  courseIds,
  title: `Module ${id}`,
  prefix: null,
  name: computeCourseModuleName(null, `Module ${id}`),
  chapters: [],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const product = (id: string, accessItems: Product['accessItems']): Product => ({
  id,
  tenantId: 't1',
  title: `Product ${id}`,
  description: '',
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const repos = (
  products: Product[],
  courses: Course[],
  modules: CourseModule[],
  lessons: CourseLesson[],
): ProductAccessIssuesDeps => ({
  products: {
    listByTenant: async () => products,
    listPublishedByTenant: async () => products.filter((p) => p.published),
    findById: async (_t, id) => products.find((p) => p.id === id) ?? null,
    create: async () => undefined,
    updateAccessItems: async () => null,
    setPublished: async () => undefined,
    bumpContentVersion: async () => undefined,
  } satisfies ProductRepository,
  courses: {
    list: async () => courses,
    findById: async (_t, id) => courses.find((c) => c.id === id) ?? null,
    findByIds: async (_t, ids) => courses.filter((c) => ids.includes(c.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  } satisfies CourseRepository,
  modules: {
    list: async () => modules,
    findById: async (_t, id) => modules.find((m) => m.id === id) ?? null,
    findByIds: async (_t, ids) => modules.filter((m) => ids.includes(m.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  } satisfies CourseModuleRepository,
  lessons: {
    list: async () => lessons,
    findById: async (_t, id) => lessons.find((l) => l.id === id) ?? null,
    findByIds: async (_t, ids) => lessons.filter((l) => ids.includes(l.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  } satisfies CourseLessonRepository,
});

describe('listProductAccessIssues', () => {
  it('requires staff tenant context', async () => {
    const deps = repos([], [], [], []);
    expect(await listProductAccessIssues(ctx(null, null), deps)).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
    expect(await listProductAccessIssues(ctx('t1', null), deps)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('returns no issues when every reference resolves', async () => {
    const deps = repos(
      [product('p1', [{ level: 'modules', courseId: 'c1', moduleIds: ['m1'] }])],
      [course('c1')],
      [module('m1', ['c1'])],
      [],
    );
    const result = await listProductAccessIssues(ctx('t1', 'owner'), deps);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('flags granted content that exists but is unreachable in the referenced course tree', async () => {
    const lesson = (id: string): CourseLesson => ({
      id,
      tenantId: 't1',
      name: `Lesson ${id}`,
      contents: [],
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const attachedModule: CourseModule = {
      ...module('m1', ['c1']),
      chapters: [{ id: 'ch1', name: 'Chapter', contents: [{ id: 'e1', name: 'L1', lessonId: 'l1' }] }],
    };
    const deps = repos(
      [
        product('p1', [
          { level: 'lessons', courseId: 'c1', lessonIds: ['l1', 'l2'] },
          { level: 'modules', courseId: 'c1', moduleIds: ['m1', 'm2'] },
        ]),
      ],
      [course('c1')],
      [attachedModule, module('m2', ['c-other'])],
      [lesson('l1'), lesson('l2')],
    );
    const result = await listProductAccessIssues(ctx('t1', 'owner'), deps);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      {
        productId: 'p1',
        productTitle: 'Product p1',
        missingCourseIds: [],
        missingModuleIds: [],
        missingLessonIds: [],
        unreachableModuleIds: ['m2'],
        unreachableLessonIds: ['l2'],
      },
    ]);
  });

  it('reports dangling course, module, lesson and excluded-module references', async () => {
    const deps = repos(
      [
        product('p1', [
          { level: 'course', courseId: 'ghost-course', excludedModuleIds: ['ghost-module'] },
          { level: 'modules', courseId: 'c1', moduleIds: ['m1', 'missing-module'] },
          { level: 'lessons', courseId: 'c1', lessonIds: ['missing-lesson'] },
        ]),
        product('p2', [{ level: 'course', courseId: 'c1' }]),
      ],
      [course('c1')],
      [module('m1', ['c1'])],
      [],
    );
    const result = await listProductAccessIssues(ctx('t1', 'owner'), deps);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([
      {
        productId: 'p1',
        productTitle: 'Product p1',
        missingCourseIds: ['ghost-course'],
        missingModuleIds: ['ghost-module', 'missing-module'],
        missingLessonIds: ['missing-lesson'],
        unreachableModuleIds: [],
        unreachableLessonIds: [],
      },
    ]);
  });
});
