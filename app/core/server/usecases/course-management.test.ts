import { describe, expect, it } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type LessonAttachment,
  type MemberCourseProgress,
  type Product,
  type StaffRole,
} from '#core/domain/index.js';

import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  EntityVersionRecord,
  MemberCourseProgressRepository,
  ProductRepository,
} from '../ports.js';
import {
  attachModuleToCourse,
  createCourse,
  createLesson,
  createModule,
  deleteLesson,
  detachModuleFromCourse,
  listCourses,
  listLessonReferences,
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
  emailVerified: true,
  tenantId,
  tenantSlug: tenantId ? 'studio' : null,
  tenantName: tenantId ? 'Studio' : null,
  staffRole,
  memberId: null,
memberBannedAt: null,
});

const course = (
  id: string,
  tenantId: string,
  moduleOrder: string[] = [],
  publiclyVisible = false,
): Course => ({
  id,
  tenantId,
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  moduleOrder,
  publiclyVisible,
  legacyId: null,
  createdAt: now,
});

const lesson = (id: string, tenantId: string): CourseLesson => ({
  id,
  tenantId,
  name: `Lesson ${id}`,
  isPreview: false,
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
  type: 'course',
  slug: id,
  title: `Product ${id}`,
  description: '',
  coverUrl: null,
  priceCents: 1000,
  currency: 'PLN',
  published: false,
  accessItems: [],
  legacyId: null,
  createdAt: now,
});

const courseRepo = (store: Course[], versions: EntityVersionRecord[] = []): CourseRepository => ({
  list: async (tenantId) => store.filter((item) => item.tenantId === tenantId),
  findById: async (tenantId, id) =>
    store.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
  findByIds: async (tenantId, ids) =>
    store.filter((item) => item.tenantId === tenantId && ids.includes(item.id)),
  create: async (_tenantId, item) => {
    store.push(item);
  },
  update: async (tenantId, item, version) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === item.id);
    if (index < 0) return null;
    if (version) versions.push(version);
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

const moduleRepo = (store: CourseModule[], versions: EntityVersionRecord[] = []): CourseModuleRepository => ({
  list: async (tenantId) => store.filter((item) => item.tenantId === tenantId),
  findById: async (tenantId, id) =>
    store.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
  findByIds: async (tenantId, ids) =>
    store.filter((item) => item.tenantId === tenantId && ids.includes(item.id)),
  create: async (_tenantId, item) => {
    store.push(item);
  },
  update: async (tenantId, item, version) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === item.id);
    if (index < 0) return null;
    if (version) versions.push(version);
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

const lessonRepo = (store: CourseLesson[], versions: EntityVersionRecord[] = []): CourseLessonRepository => ({
  list: async (tenantId) => store.filter((item) => item.tenantId === tenantId),
  listPreviews: async () => [],
  findById: async (tenantId, id) =>
    store.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
  findByIds: async (tenantId, ids) =>
    store.filter((item) => item.tenantId === tenantId && ids.includes(item.id)),
  create: async (_tenantId, item) => {
    store.push(item);
  },
  update: async (tenantId, item, version) => {
    const index = store.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === item.id);
    if (index < 0) return null;
    if (version) versions.push(version);
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

const productRepo = (
  store: Product[],
  versions: EntityVersionRecord[] = [],
  contentVersionBumps: string[] = [],
): ProductRepository => ({
  listByTenant: async (tenantId) => store.filter((item) => item.tenantId === tenantId),
  listPublishedByTenant: async (tenantId) =>
    store.filter((item) => item.tenantId === tenantId && item.published),
  findById: async (tenantId, id) =>
    store.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
  create: async (_tenantId, item) => {
    store.push(item);
    return 'created';
  },
  updateAccessItems: async (tenantId, id, accessItems, version) => {
    const found = store.find((item) => item.tenantId === tenantId && item.id === id);
    if (!found) return null;
    if (version) versions.push(version);
    found.accessItems = accessItems;
    return found;
  },
  setPublished: async (tenantId, id, published) => {
    const found = store.find((item) => item.tenantId === tenantId && item.id === id);
    if (found) found.published = published;
  },
  bumpContentVersion: async (tenantId) => {
    contentVersionBumps.push(tenantId);
  },
});

const progressRepo = (store: MemberCourseProgress[] = []): MemberCourseProgressRepository => ({
  findByMemberAndCourse: async () => null,
  listByMember: async (tenantId, memberId) =>
    store.filter((progress) => progress.tenantId === tenantId && progress.memberId === memberId),
  findOrCreate: async (_tenantId, { id, memberId, courseId, now: createdAt }) => ({
    id,
    tenantId: _tenantId,
    memberId,
    courseId,
    completedLessonIds: [],
    updatedAt: createdAt,
  }),
  update: async (_tenantId, progress) => progress,
  countReferencingLesson: async (tenantId, lessonId) =>
    store.filter(
      (progress) =>
        progress.tenantId === tenantId &&
        (progress.completedLessonIds.includes(lessonId) || progress.lastViewedLessonId === lessonId),
    ).length,
});

const deps = (input: {
  courses?: Course[];
  modules?: CourseModule[];
  lessons?: CourseLesson[];
  products?: Product[];
  progress?: MemberCourseProgress[];
  ids?: string[];
  versions?: EntityVersionRecord[];
  contentVersionBumps?: string[];
  attachments?: LessonAttachment[];
  removedObjects?: string[];
  storageDeleteFails?: boolean;
} = {}): CourseManagementDeps => {
  const ids = input.ids ?? ['generated-id'];
  const versions = input.versions ?? [];
  const attachments = input.attachments ?? [];
  return {
    courses: courseRepo(input.courses ?? [], versions),
    modules: moduleRepo(input.modules ?? [], versions),
    lessons: lessonRepo(input.lessons ?? [], versions),
    products: productRepo(input.products ?? [], versions, input.contentVersionBumps),
    progress: progressRepo(input.progress ?? []),
    attachments: {
      create: async (_tenantId, attachment) => {
        attachments.push(attachment);
      },
      findById: async (tenantId, attachmentId) =>
        attachments.find((item) => item.tenantId === tenantId && item.id === attachmentId) ?? null,
      listByLesson: async (tenantId, lessonId) =>
        attachments.filter((item) => item.tenantId === tenantId && item.lessonId === lessonId),
      listReadyByLesson: async (tenantId, lessonId) =>
        attachments.filter(
          (item) => item.tenantId === tenantId && item.lessonId === lessonId && item.status === 'ready',
        ),
      markReady: async () => null,
      delete: async () => false,
    },
    storage: {
      objectUrl: (configuration, key) =>
        new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
      probe: async () => ok({ code: 'storage.available', message: 'ok' }),
      presignPut: (request) => ok(request.url),
      presignGet: (request) => ok(request.url),
      delete: async (request) => {
        if (input.storageDeleteFails) return err(integrationUnavailable('Storage unavailable'));
        input.removedObjects?.push(request.url);
        return ok({ deleted: true });
      },
      head: async () => ok({ sizeBytes: 1 }),
      healthcheck: async () => ok({ healthy: true }),
      test: async () => ok({ code: 'storage.available', message: 'ok' }),
    },
    secretResolver: {
      resolve: async () => ok(JSON.stringify({
        provider: 'minio',
        endpoint: 'https://storage.example.test/prefix',
        region: 'eu-central-1',
        bucket: 'creator-files',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      })),
    },
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

  it('enforces the declared course capability independently for reads and writes', async () => {
    const d = deps({ courses: [course('c1', 't-acme')] });
    const ctx = {
      identity: identity('t-acme', 'owner'),
      capabilities: ['course:read'] as const,
    };
    expect(await listCourses(ctx, d)).toMatchObject({ ok: true });
    expect(await createCourse(ctx, { name: 'Course', imageUrl: null }, d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('creates and updates a course', async () => {
    const store: Course[] = [];
    const d = deps({ courses: store, ids: ['course-1', 'course-snapshot-1'] });
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

  it('invalidates the public offer only when the public visibility of a course changes', async () => {
    const contentVersionBumps: string[] = [];
    const d = deps({
      courses: [course('c1', 't-acme')],
      ids: ['snapshot-1', 'snapshot-2', 'snapshot-3'],
      contentVersionBumps,
    });
    const ctx = { identity: identity('t-acme', 'owner') };

    expect(await updateCourse(ctx, { id: 'c1', name: 'Renamed' }, d)).toMatchObject({ ok: true });
    expect(contentVersionBumps).toEqual([]);

    expect(await updateCourse(ctx, { id: 'c1', publiclyVisible: true }, d)).toMatchObject({
      ok: true,
      value: { publiclyVisible: true },
    });
    expect(contentVersionBumps).toEqual(['t-acme']);

    expect(await updateCourse(ctx, { id: 'c1', publiclyVisible: true }, d)).toMatchObject({ ok: true });
    expect(contentVersionBumps).toEqual(['t-acme']);
  });

  it('refuses to make a lesson a free preview outside a publicly visible course', async () => {
    const chapters = [
      { id: 'ch1', name: 'Chapter', contents: [{ id: 'ct1', name: 'Intro', lessonId: 'l1' }] },
    ];
    const d = deps({
      courses: [course('c1', 't-acme')],
      lessons: [lesson('l1', 't-acme')],
      modules: [{ ...module('m1', 't-acme', ['c1']), chapters }],
      ids: ['snapshot-1'],
    });

    expect(
      await updateLesson({ identity: identity('t-acme', 'owner') }, { id: 'l1', isPreview: true }, d),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('allows a free preview once a referencing course is publicly visible', async () => {
    const chapters = [
      { id: 'ch1', name: 'Chapter', contents: [{ id: 'ct1', name: 'Intro', lessonId: 'l1' }] },
    ];
    const lessons = [lesson('l1', 't-acme')];
    const d = deps({
      courses: [course('c1', 't-acme'), course('c2', 't-acme', [], true)],
      lessons,
      modules: [{ ...module('m1', 't-acme', ['c1', 'c2']), chapters }],
      ids: ['snapshot-1', 'snapshot-2'],
    });
    const ctx = { identity: identity('t-acme', 'owner') };

    expect(await updateLesson(ctx, { id: 'l1', isPreview: true }, d)).toMatchObject({
      ok: true,
      value: { isPreview: true },
    });
    expect(await updateLesson(ctx, { id: 'l1', isPreview: false }, d)).toMatchObject({
      ok: true,
      value: { isPreview: false },
    });
  });

  it('refuses to create a lesson that is a free preview from the start', async () => {
    const store: CourseLesson[] = [];
    const d = deps({ lessons: store, ids: ['lesson-1'] });

    expect(
      await createLesson({ identity: identity('t-acme', 'owner') }, { name: 'Intro', isPreview: true }, d),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(store).toEqual([]);
  });

  it('snapshots the previous course state before applying an update', async () => {
    const versions: EntityVersionRecord[] = [];
    const d = deps({
      courses: [course('c1', 't-acme')],
      ids: ['snapshot-1'],
      versions,
    });
    const result = await updateCourse(
      { identity: identity('t-acme', 'owner') },
      { id: 'c1', name: 'Renamed' },
      d,
    );
    expect(result.ok).toBe(true);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: 'snapshot-1',
      entityKind: 'course',
      entityId: 'c1',
      schemaVersion: 4,
      createdBy: 'u1',
    });
    // The snapshot captures the PREVIOUS name, not the new one.
    expect(versions[0]?.payload).toMatchObject({ id: 'c1', name: 'Course c1' });
  });

  it('snapshots module, lesson and product updates in the same write-through path', async () => {
    const versions: EntityVersionRecord[] = [];
    const d = deps({
      courses: [course('c1', 't-acme')],
      modules: [module('m1', 't-acme', ['c1'])],
      lessons: [lesson('l1', 't-acme')],
      products: [product('p1', 't-acme')],
      ids: ['v-module', 'v-lesson', 'v-product'],
      versions,
    });
    const ctx = { identity: identity('t-acme', 'owner') };

    await updateModule(ctx, { id: 'm1', title: 'New title' }, d);
    await updateLesson(ctx, { id: 'l1', name: 'New lesson name' }, d);
    await updateProductAccessItems(ctx, { id: 'p1', accessItems: [] }, d);

    expect(versions.map((v) => v.entityKind)).toEqual(['course_module', 'course_lesson', 'product']);
    expect(versions.map((v) => v.schemaVersion)).toEqual([1, 5, 4]);
    expect(versions[0]?.payload).toMatchObject({ id: 'm1', title: 'Module m1' });
    expect(versions[1]?.payload).toMatchObject({ id: 'l1', name: 'Lesson l1' });
    expect(versions[2]?.payload).toMatchObject({ id: 'p1', title: 'Product p1' });
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
      ids: ['module-1', 'module-snapshot-1'],
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
        accessItems: [{ level: 'modules', courseId: 'c1', moduleIds: ['m1'] }],
      },
      d,
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });

    const valid = await updateProductAccessItems(
      { identity: identity('t-acme', 'owner') },
      {
        id: 'p1',
        accessItems: [
          { level: 'modules', courseId: 'c2', moduleIds: ['m1'] },
          { level: 'lessons', courseId: 'c2', lessonIds: ['l1'] },
        ],
      },
      d,
    );
    expect(valid).toMatchObject({ ok: true });
    expect(products[0]?.accessItems).toEqual([
      { level: 'modules', courseId: 'c2', moduleIds: ['m1'] },
      { level: 'lessons', courseId: 'c2', lessonIds: ['l1'] },
    ]);
  });

  it('invalidates the public offer after changing checkout consent definitions', async () => {
    const contentVersionBumps: string[] = [];
    const d = deps({
      products: [product('p1', 't-acme')],
      ids: ['product-snapshot'],
      contentVersionBumps,
    });

    const result = await updateProductAccessItems(
      { identity: identity('t-acme', 'owner') },
      {
        id: 'p1',
        accessItems: [],
        checkoutConsentDefinitionIds: ['consent-1'],
      },
      d,
    );

    expect(result).toMatchObject({ ok: true });
    expect(contentVersionBumps).toEqual(['t-acme']);
  });

  it('rejects a course item whose excludedModuleIds do not belong to the course', async () => {
    const products = [product('p1', 't-acme')];
    const d = deps({
      courses: [course('c1', 't-acme'), course('c2', 't-acme')],
      modules: [module('m1', 't-acme', ['c2'])],
      products,
    });

    const invalid = await updateProductAccessItems(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1', accessItems: [{ level: 'course', courseId: 'c1', excludedModuleIds: ['m1'] }] },
      d,
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });

    const valid = await updateProductAccessItems(
      { identity: identity('t-acme', 'owner') },
      { id: 'p1', accessItems: [{ level: 'course', courseId: 'c2', excludedModuleIds: ['m1'] }] },
      d,
    );
    expect(valid).toMatchObject({ ok: true });
    expect(products[0]?.accessItems).toEqual([
      { level: 'course', courseId: 'c2', excludedModuleIds: ['m1'] },
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

  it('creates a course with an empty module order', async () => {
    const store: Course[] = [];
    const created = await createCourse(
      { identity: identity('t-acme', 'admin') },
      { name: 'Course' },
      deps({ courses: store, ids: ['course-1'] }),
    );
    expect(created).toMatchObject({ ok: true, value: { moduleOrder: [] } });
  });

  it('appends an attached module to the course module order and cleans it on detach', async () => {
    const courses = [course('c1', 't-acme')];
    const modules = [module('m1', 't-acme'), module('m2', 't-acme')];
    const d = deps({ courses, modules, ids: ['snap-1', 'snap-2', 'snap-3'] });

    await attachModuleToCourse({ identity: identity('t-acme', 'owner') }, { courseId: 'c1', moduleId: 'm1' }, d);
    await attachModuleToCourse({ identity: identity('t-acme', 'owner') }, { courseId: 'c1', moduleId: 'm2' }, d);
    expect(courses[0]?.moduleOrder).toEqual(['m1', 'm2']);

    const detached = await detachModuleFromCourse(
      { identity: identity('t-acme', 'owner') },
      { courseId: 'c1', moduleId: 'm1' },
      d,
    );
    expect(detached).toMatchObject({ ok: true, value: { courseIds: [] } });
    expect(courses[0]?.moduleOrder).toEqual(['m2']);
    expect(modules.find((m) => m.id === 'm1')?.courseIds).toEqual([]);
  });

  it('reorders modules through updateCourse and appends unlisted attached modules', async () => {
    const courses = [course('c1', 't-acme', ['m1', 'm2', 'm3'])];
    const modules = [
      module('m1', 't-acme', ['c1']),
      module('m2', 't-acme', ['c1']),
      module('m3', 't-acme', ['c1']),
    ];
    const d = deps({ courses, modules, ids: ['snap-1'] });

    const reordered = await updateCourse(
      { identity: identity('t-acme', 'owner') },
      { id: 'c1', moduleOrder: ['m3', 'm1'] },
      d,
    );
    expect(reordered).toMatchObject({ ok: true });
    expect(courses[0]?.moduleOrder).toEqual(['m3', 'm1', 'm2']);
  });

  it('rejects a module order referencing modules not attached to the course', async () => {
    const d = deps({
      courses: [course('c1', 't-acme', ['m1'])],
      modules: [module('m1', 't-acme', ['c1']), module('m2', 't-acme')],
    });
    const result = await updateCourse(
      { identity: identity('t-acme', 'owner') },
      { id: 'c1', moduleOrder: ['m1', 'm2'] },
      d,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects a module order with duplicate ids', async () => {
    const d = deps({
      courses: [course('c1', 't-acme', ['m1'])],
      modules: [module('m1', 't-acme', ['c1'])],
    });
    const result = await updateCourse(
      { identity: identity('t-acme', 'owner') },
      { id: 'c1', moduleOrder: ['m1', 'm1'] },
      d,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('lists what references a lesson before deletion', async () => {
    const chapters = [
      { id: 'ch1', name: 'Chapter', contents: [{ id: 'ct1', name: 'Intro', lessonId: 'l1' }] },
    ];
    const d = deps({
      lessons: [lesson('l1', 't-acme')],
      modules: [{ ...module('m1', 't-acme', ['c1']), chapters }],
      products: [{ ...product('p1', 't-acme'), accessItems: [{ level: 'lessons', courseId: 'c1', lessonIds: ['l1'] }] }],
      progress: [
        {
          id: 'pr1',
          tenantId: 't-acme',
          memberId: 'mem1',
          courseId: 'c1',
          completedLessonIds: ['l1'],
          updatedAt: now,
        },
      ],
    });

    const result = await listLessonReferences({ identity: identity('t-acme', 'owner') }, { id: 'l1' }, d);
    expect(result.ok && result.value).toMatchObject({
      lessonId: 'l1',
      chapters: [{ moduleId: 'm1', chapterId: 'ch1', contentId: 'ct1' }],
      products: [{ productId: 'p1' }],
      progressCount: 1,
    });
  });

  it('reports the public visibility of every course a lesson is attached to', async () => {
    const chapters = [
      { id: 'ch1', name: 'Chapter', contents: [{ id: 'ct1', name: 'Intro', lessonId: 'l1' }] },
    ];
    const d = deps({
      courses: [course('c1', 't-acme', [], true), course('c2', 't-acme'), course('c3', 't-acme')],
      lessons: [lesson('l1', 't-acme')],
      modules: [{ ...module('m1', 't-acme', ['c1', 'c2']), chapters }],
    });

    const result = await listLessonReferences({ identity: identity('t-acme', 'owner') }, { id: 'l1' }, d);
    expect(result.ok && result.value.courses).toEqual([
      { courseId: 'c1', courseName: 'Course c1', publiclyVisible: true },
      { courseId: 'c2', courseName: 'Course c2', publiclyVisible: false },
    ]);
  });

  it('deletes a lesson and cleans chapter and product references, leaving progress', async () => {
    const chapters = [
      {
        id: 'ch1',
        name: 'Chapter',
        contents: [
          { id: 'ct1', name: 'Intro', lessonId: 'l1' },
          { id: 'ct2', name: 'Keep', lessonId: 'l2' },
        ],
      },
    ];
    const modules = [{ ...module('m1', 't-acme', ['c1']), chapters }];
    const products = [
      { ...product('p1', 't-acme'), accessItems: [{ level: 'lessons' as const, courseId: 'c1', lessonIds: ['l1', 'l2'] }] },
      { ...product('p2', 't-acme'), accessItems: [{ level: 'lessons' as const, courseId: 'c1', lessonIds: ['l1'] }] },
    ];
    const lessons = [lesson('l1', 't-acme'), lesson('l2', 't-acme')];
    const removedObjects: string[] = [];
    const d = deps({
      lessons,
      modules,
      products,
      attachments: [{
        id: 'attachment-1',
        tenantId: 't-acme',
        lessonId: 'l1',
        fileName: 'handout.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: 'lesson-attachments/l1/attachment-1/handout.pdf',
        status: 'ready',
        createdAt: now,
      }],
      removedObjects,
      ids: ['snap-module', 'snap-p1', 'snap-p2'],
    });

    const result = await deleteLesson({ identity: identity('t-acme', 'owner') }, { id: 'l1' }, d);
    expect(result).toMatchObject({ ok: true, value: { lessonId: 'l1' } });
    expect(lessons.map((item) => item.id)).toEqual(['l2']);
    expect(modules[0]?.chapters[0]?.contents.map((content) => content.id)).toEqual(['ct2']);
    expect(products[0]?.accessItems).toEqual([{ level: 'lessons', courseId: 'c1', lessonIds: ['l2'] }]);
    expect(products[1]?.accessItems).toEqual([]);
    expect(removedObjects).toEqual([
      'https://storage.example.test/prefix/creator-files/lesson-attachments/l1/attachment-1/handout.pdf',
    ]);
  });

  it('deletes the lesson even when storage cleanup fails', async () => {
    const lessons = [lesson('l1', 't-acme')];
    const d = deps({
      lessons,
      storageDeleteFails: true,
      attachments: [{
        id: 'attachment-1',
        tenantId: 't-acme',
        lessonId: 'l1',
        fileName: 'handout.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: 'lesson-attachments/l1/attachment-1/handout.pdf',
        status: 'ready',
        createdAt: now,
      }],
    });

    await expect(
      deleteLesson({ identity: identity('t-acme', 'owner') }, { id: 'l1' }, d),
    ).resolves.toMatchObject({ ok: true, value: { lessonId: 'l1' } });
    expect(lessons).toHaveLength(0);
  });

  it('reports not found when deleting a missing lesson', async () => {
    const result = await deleteLesson(
      { identity: identity('t-acme', 'owner') },
      { id: 'missing' },
      deps(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('course management guard and fallback branches', () => {
  const owner = { identity: identity('t-acme', 'owner') };

  it('rejects malformed create/update inputs with validation errors', async () => {
    const d = deps();
    expect(await createCourse(owner, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await updateCourse(owner, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await createModule(owner, { title: 5 }, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await updateModule(owner, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await updateLesson(owner, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await attachModuleToCourse(owner, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await detachModuleFromCourse(owner, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('reports not found when an update targets an absent entity', async () => {
    const d = deps();
    expect(await updateCourse(owner, { id: 'nope', name: 'X' }, d)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await updateModule(owner, { id: 'nope', title: 'X' }, d)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await updateLesson(owner, { id: 'nope', name: 'X' }, d)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await updateProductAccessItems(owner, { id: 'nope', accessItems: [] }, d)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('reports not found for attach/detach when the course or module is missing', async () => {
    const missingCourse = deps({ modules: [module('m1', 't-acme')] });
    expect(await attachModuleToCourse(owner, { courseId: 'c1', moduleId: 'm1' }, missingCourse)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await detachModuleFromCourse(owner, { courseId: 'c1', moduleId: 'm1' }, missingCourse)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });

    const missingModule = deps({ courses: [course('c1', 't-acme')] });
    expect(await attachModuleToCourse(owner, { courseId: 'c1', moduleId: 'm1' }, missingModule)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('is idempotent when detaching a module that is not attached to the course', async () => {
    const d = deps({ courses: [course('c1', 't-acme')], modules: [module('m1', 't-acme')] });
    const result = await detachModuleFromCourse(owner, { courseId: 'c1', moduleId: 'm1' }, d);
    expect(result).toMatchObject({ ok: true, value: { id: 'm1' } });
  });

  it('keeps existing fields on a partial course update and can set an image url', async () => {
    const store = [{ ...course('c1', 't-acme', ['m1']), description: 'Original', imageUrl: null }];
    const d = deps({ courses: store, ids: ['snap-1'] });
    const result = await updateCourse(owner, { id: 'c1', imageUrl: 'https://img.example/x.png' }, d);
    expect(result).toMatchObject({
      ok: true,
      value: { name: 'Course c1', description: 'Original', imageUrl: 'https://img.example/x.png' },
    });
  });

  it('keeps the existing prefix when a module update omits it', async () => {
    const existing = module('m1', 't-acme');
    const store = [{ ...existing, prefix: '01', name: '01 - Module m1' }];
    const d = deps({ modules: store, ids: ['snap-1'] });
    const result = await updateModule(owner, { id: 'm1', title: 'Renamed' }, d);
    expect(result).toMatchObject({ ok: true, value: { name: '01 - Renamed' } });
  });

  it('sets and then clears a lesson duration through updates', async () => {
    const d = deps({ lessons: [lesson('l1', 't-acme')], ids: ['s1', 's2'] });
    const withDuration = await updateLesson(owner, { id: 'l1', durationMinutes: 30 }, d);
    expect(withDuration).toMatchObject({ ok: true, value: { durationMinutes: 30 } });
    const cleared = await updateLesson(owner, { id: 'l1', durationMinutes: null }, d);
    expect(cleared.ok && 'durationMinutes' in cleared.value).toBe(false);
  });
});
