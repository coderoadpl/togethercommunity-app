import { describe, expect, it } from 'vitest';

import type {
  Course,
  CourseLesson,
  CourseModule,
  Identity,
  Product,
  StaffRole,
} from '@core/domain/index.js';

import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  ProductRepository,
} from '../ports.js';
import {
  attachModuleToCourse,
  createCourse,
  createLesson,
  createModule,
  listCourses,
  updateCourse,
  updateLesson,
  updateModule,
  updateProductAccessItems,
  type CourseManagementDeps,
} from './course-management.js';

const now = '2026-07-12T00:00:00.000Z';

const identity = (tenantId: string | null, staffRole: StaffRole | null): Identity => ({
  userId: 'u1',
  email: 'creator@together.dev',
  name: 'Creator',
  tenantId,
  tenantSlug: tenantId ? 'studio' : null,
  tenantName: tenantId ? 'Studio' : null,
  staffRole,
  memberId: null,
});

const course = (id: string, tenantId: string): Course => ({
  id,
  tenantId,
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  legacyId: null,
  createdAt: now,
});

const lesson = (id: string, tenantId: string): CourseLesson => ({
  id,
  tenantId,
  name: `Lesson ${id}`,
  contents: [],
  legacyId: null,
  createdAt: now,
});

const module = (id: string, tenantId: string, courseIds: string[] = []): CourseModule => ({
  id,
  tenantId,
  courseIds,
  title: `Module ${id}`,
  prefix: null,
  name: `Module ${id}`,
  chapters: [],
  legacyId: null,
  createdAt: now,
});

const product = (id: string, tenantId: string): Product => ({
  id,
  tenantId,
  title: `Product ${id}`,
  description: '',
  priceCents: 1000,
  currency: 'PLN',
  published: false,
  accessItems: [],
  legacyId: null,
  createdAt: now,
});

const courseRepo = (store: Course[]): CourseRepository => ({
  list: async (tenantId) => store.filter((item) => item.tenantId === tenantId),
  findById: async (tenantId, id) =>
    store.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
  findByIds: async (tenantId, ids) =>
    store.filter((item) => item.tenantId === tenantId && ids.includes(item.id)),
  create: async (_tenantId, item) => {
    store.push(item);
  },
  update: async (tenantId, item) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === item.id);
    if (index < 0) return null;
    store[index] = item;
    return item;
  },
  delete: async (tenantId, id) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === id);
    if (index < 0) return false;
    store.splice(index, 1);
    return true;
  },
});

const moduleRepo = (store: CourseModule[]): CourseModuleRepository => ({
  list: async (tenantId) => store.filter((item) => item.tenantId === tenantId),
  findById: async (tenantId, id) =>
    store.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
  findByIds: async (tenantId, ids) =>
    store.filter((item) => item.tenantId === tenantId && ids.includes(item.id)),
  create: async (_tenantId, item) => {
    store.push(item);
  },
  update: async (tenantId, item) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === item.id);
    if (index < 0) return null;
    store[index] = item;
    return item;
  },
  delete: async (tenantId, id) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === id);
    if (index < 0) return false;
    store.splice(index, 1);
    return true;
  },
});

const lessonRepo = (store: CourseLesson[]): CourseLessonRepository => ({
  list: async (tenantId) => store.filter((item) => item.tenantId === tenantId),
  findById: async (tenantId, id) =>
    store.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
  findByIds: async (tenantId, ids) =>
    store.filter((item) => item.tenantId === tenantId && ids.includes(item.id)),
  create: async (_tenantId, item) => {
    store.push(item);
  },
  update: async (tenantId, item) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === item.id);
    if (index < 0) return null;
    store[index] = item;
    return item;
  },
  delete: async (tenantId, id) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === id);
    if (index < 0) return false;
    store.splice(index, 1);
    return true;
  },
});

const productRepo = (store: Product[]): ProductRepository => ({
  listByTenant: async (tenantId) => store.filter((item) => item.tenantId === tenantId),
  listPublishedByTenant: async (tenantId) =>
    store.filter((item) => item.tenantId === tenantId && item.published),
  findById: async (tenantId, id) =>
    store.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
  create: async (_tenantId, item) => {
    store.push(item);
  },
  updateAccessItems: async (tenantId, id, accessItems) => {
    const found = store.find((item) => item.tenantId === tenantId && item.id === id);
    if (!found) return null;
    found.accessItems = accessItems;
    return found;
  },
  setPublished: async (tenantId, id, published) => {
    const found = store.find((item) => item.tenantId === tenantId && item.id === id);
    if (found) found.published = published;
  },
  bumpContentVersion: async () => undefined,
});

const deps = (input: {
  courses?: Course[];
  modules?: CourseModule[];
  lessons?: CourseLesson[];
  products?: Product[];
  ids?: string[];
} = {}): CourseManagementDeps => {
  const ids = input.ids ?? ['generated-id'];
  return {
    courses: courseRepo(input.courses ?? []),
    modules: moduleRepo(input.modules ?? []),
    lessons: lessonRepo(input.lessons ?? []),
    products: productRepo(input.products ?? []),
    ids: {
      nextId: () => {
        const next = ids.shift();
        if (!next) throw new Error('No fake ID available');
        return next;
      },
    },
    clock: { nowIso: () => now },
  };
};

describe('course management use-cases', () => {
  it('lists only courses from the staff tenant', async () => {
    const result = await listCourses(
      { identity: identity('t-acme', 'owner') },
      deps({ courses: [course('c1', 't-acme'), course('c2', 't-other')] }),
    );
    expect(result.ok && result.value.map((item) => item.id)).toEqual(['c1']);
  });

  it('creates and updates a course', async () => {
    const store: Course[] = [];
    const d = deps({ courses: store, ids: ['course-1'] });
    const created = await createCourse(
      { identity: identity('t-acme', 'admin') },
      { name: 'Course', imageUrl: null },
      d,
    );
    expect(created).toMatchObject({ ok: true, value: { id: 'course-1', tenantId: 't-acme' } });

    const updated = await updateCourse(
      { identity: identity('t-acme', 'admin') },
      { id: 'course-1', name: 'Updated' },
      d,
    );
    expect(updated).toMatchObject({ ok: true, value: { name: 'Updated' } });
    expect(store[0]?.name).toBe('Updated');
  });

  it('creates a lesson with closed typed blocks and rejects unknown block shapes', async () => {
    const d = deps({ lessons: [], ids: ['lesson-1'] });
    const created = await createLesson(
      { identity: identity('t-acme', 'owner') },
      {
        name: 'Intro',
        contents: [{ type: 'link', url: 'https://example.com', description: 'Read' }],
      },
      d,
    );
    expect(created).toMatchObject({ ok: true, value: { id: 'lesson-1' } });

    const invalid = await createLesson(
      { identity: identity('t-acme', 'owner') },
      { name: 'Broken', contents: [{ type: 'audio', url: 'https://example.com' }] },
      d,
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('updates a lesson by replacing ordered contents', async () => {
    const d = deps({ lessons: [lesson('l1', 't-acme')] });
    const result = await updateLesson(
      { identity: identity('t-acme', 'owner') },
      { id: 'l1', contents: [{ type: 'html', html: '<p>Hi</p>' }] },
      d,
    );
    expect(result).toMatchObject({ ok: true, value: { contents: [{ type: 'html' }] } });
  });

  it('creates and updates modules with computed names', async () => {
    const d = deps({
      courses: [course('c1', 't-acme')],
      lessons: [lesson('l1', 't-acme')],
      modules: [],
      ids: ['module-1'],
    });
    const created = await createModule(
      { identity: identity('t-acme', 'owner') },
      {
        courseIds: ['c1'],
        title: 'Basics',
        prefix: '01',
        chapters: [{ id: 'chapter-1', name: 'Start', contents: [{ id: 'content-1', name: 'Intro', lessonId: 'l1' }] }],
      },
      d,
    );
    expect(created).toMatchObject({ ok: true, value: { name: '01 - Basics' } });

    const updated = await updateModule(
      { identity: identity('t-acme', 'owner') },
      { id: 'module-1', prefix: null, title: 'Advanced' },
      d,
    );
    expect(updated).toMatchObject({ ok: true, value: { name: 'Advanced' } });
  });

  it('rejects module chapters that reference lessons outside the tenant', async () => {
    const result = await createModule(
      { identity: identity('t-acme', 'owner') },
      {
        title: 'Bad module',
        chapters: [{ id: 'chapter-1', name: 'Start', contents: [{ id: 'content-1', name: 'Intro', lessonId: 'l-other' }] }],
      },
      deps({ lessons: [lesson('l-other', 't-other')] }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('attaches a module to a course idempotently', async () => {
    const modules = [module('m1', 't-acme')];
    const d = deps({ courses: [course('c1', 't-acme')], modules });
    const first = await attachModuleToCourse(
      { identity: identity('t-acme', 'owner') },
      { courseId: 'c1', moduleId: 'm1' },
      d,
    );
    const second = await attachModuleToCourse(
      { identity: identity('t-acme', 'owner') },
      { courseId: 'c1', moduleId: 'm1' },
      d,
    );
    expect(first).toMatchObject({ ok: true, value: { courseIds: ['c1'] } });
    expect(second).toMatchObject({ ok: true, value: { courseIds: ['c1'] } });
    expect(modules[0]?.courseIds).toEqual(['c1']);
  });

  it('validates product access item references and module-course ownership', async () => {
    const products = [product('p1', 't-acme')];
    const d = deps({
      courses: [course('c1', 't-acme'), course('c2', 't-acme')],
      modules: [module('m1', 't-acme', ['c2'])],
      lessons: [lesson('l1', 't-acme')],
      products,
    });

    const invalid = await updateProductAccessItems(
      { identity: identity('t-acme', 'owner') },
      {
        id: 'p1',
        accessItems: [{ courseId: 'c1', courseLevelAccess: false, moduleIds: ['m1'], lessonIds: [] }],
      },
      d,
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });

    const valid = await updateProductAccessItems(
      { identity: identity('t-acme', 'owner') },
      {
        id: 'p1',
        accessItems: [{ courseId: 'c2', courseLevelAccess: false, moduleIds: ['m1'], lessonIds: ['l1'] }],
      },
      d,
    );
    expect(valid).toMatchObject({ ok: true });
    expect(products[0]?.accessItems).toEqual([
      { courseId: 'c2', courseLevelAccess: false, moduleIds: ['m1'], lessonIds: ['l1'] },
    ]);
  });

  it('requires staff tenant context for management operations', async () => {
    const result = await createCourse(
      { identity: identity('t-acme', null) },
      { name: 'Course' },
      deps(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
