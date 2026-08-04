import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type MemberCourseProgress,
  type Product,
  type ProductGrant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  MemberCourseProgressRepository,
  ProductGrantRepository,
  ProductRepository,
} from '../ports.js';
import {
  getAccessibleLesson,
  getCourseStructureWithAccess,
  getNextLesson,
  isLessonAccessible,
  listMyCourses,
  resolveMemberEntitlements,
  type CourseAccessDeps,
} from './entitlements.js';

const NOW = '1998-06-01T00:00:00.000Z';

const nn = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('unexpected undefined');
  return value;
};

const identity = (over: Partial<Identity>): Identity => ({
  userId: 'u1',
  email: 'member@together.dev',
  name: 'Member',
  tenantId: 't1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'mem1',
  memberBannedAt: null,
  ...over,
});

const ctx = (over: Partial<Identity>): Ctx => ({ identity: identity(over) });

const lesson = (id: string): CourseLesson => ({
  id,
  tenantId: 't1',
  name: `Lesson ${id}`,
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
});

const module = (
  id: string,
  createdAt: string,
  chapters: CourseModule['chapters'],
  courseIds: string[],
): CourseModule => ({
  id,
  tenantId: 't1',
  courseIds,
  title: `Module ${id}`,
  prefix: null,
  name: computeCourseModuleName(null, `Module ${id}`),
  chapters,
  legacyId: null,
  createdAt,
});

const course = (id: string, moduleOrder: string[] = []): Course => ({
  id,
  tenantId: 't1',
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  moduleOrder,
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
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
  createdAt: '1998-01-01T00:00:00.000Z',
});

const grant = (
  id: string,
  productId: string,
  startsAt: string,
  expiresAt: string | null,
): ProductGrant => ({
  id,
  tenantId: 't1',
  memberId: 'mem1',
  productId,
  source: 'manual',
  startsAt,
  expiresAt,
  legacyId: null,
  createdAt: '1998-01-01T00:00:00.000Z',
});

// Course c1: module m1 (ch1:[l1,l2], ch2:[l3]) then module m2 (ch3:[l4,l5], ch4:[l6]).
const m1 = module(
  'm1',
  '1998-01-01T00:00:00.000Z',
  [
    { id: 'ch1', name: 'Chapter 1', contents: [
      { id: 'c-l1', name: 'C L1', lessonId: 'l1' },
      { id: 'c-l2', name: 'C L2', lessonId: 'l2' },
    ] },
    { id: 'ch2', name: 'Chapter 2', contents: [{ id: 'c-l3', name: 'C L3', lessonId: 'l3' }] },
  ],
  ['c1'],
);
const m2 = module(
  'm2',
  '1998-02-01T00:00:00.000Z',
  [
    { id: 'ch3', name: 'Chapter 3', contents: [
      { id: 'c-l4', name: 'C L4', lessonId: 'l4' },
      { id: 'c-l5', name: 'C L5', lessonId: 'l5' },
    ] },
    { id: 'ch4', name: 'Chapter 4', contents: [{ id: 'c-l6', name: 'C L6', lessonId: 'l6' }] },
  ],
  ['c1'],
);

const c1 = course('c1');
const c2 = course('c2');
const lessons = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].map(lesson);

const pCourse = product('p-course', [{ level: 'course', courseId: 'c1' }]);
const pModule = product('p-module', [{ level: 'modules', courseId: 'c1', moduleIds: ['m1'] }]);
const pLesson = product('p-lesson', [{ level: 'lessons', courseId: 'c1', lessonIds: ['l4'] }]);
const pCourseExceptM2 = product('p-course-except-m2', [
  { level: 'course', courseId: 'c1', excludedModuleIds: ['m2'] },
]);

const clock: Clock = { nowIso: () => NOW };

const coursesRepo = (rows: Course[]): CourseRepository => ({
  list: async () => rows,
  findById: async (_t, id) => rows.find((r) => r.id === id) ?? null,
  findByIds: async (_t, ids) => rows.filter((r) => ids.includes(r.id)),
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
});

const modulesRepo = (rows: CourseModule[]): CourseModuleRepository => ({
  list: async () => rows,
  findById: async (_t, id) => rows.find((r) => r.id === id) ?? null,
  findByIds: async (_t, ids) => rows.filter((r) => ids.includes(r.id)),
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
});

const lessonsRepo = (rows: CourseLesson[]): CourseLessonRepository => ({
  list: async () => rows,
  listPreviews: async () => [],
  findById: async (_t, id) => rows.find((r) => r.id === id) ?? null,
  findByIds: async (_t, ids) => rows.filter((r) => ids.includes(r.id)),
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
});

const grantsRepo = (grants: ProductGrant[], products: Product[]): ProductGrantRepository => ({
  findById: async (_t, id) => grants.find((g) => g.id === id) ?? null,
  findGrant: async () => null,
  createGrant: async () => true,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async (tenantId, memberId, now) =>
    grants.filter(
      (g) =>
        g.tenantId === tenantId &&
        g.memberId === memberId &&
        g.startsAt <= now &&
        (g.expiresAt === null || g.expiresAt >= now),
    ),
  listGrantedProducts: async (tenantId, memberId) => {
    const ids = new Set(
      grants.filter((g) => g.tenantId === tenantId && g.memberId === memberId).map((g) => g.productId),
    );
    return products.filter((p) => p.tenantId === tenantId && ids.has(p.id));
  },
});

const progressRepo = (rows: MemberCourseProgress[]): MemberCourseProgressRepository => ({
  findByMemberAndCourse: async (tenantId, input) =>
    rows.find(
      (r) => r.tenantId === tenantId && r.memberId === input.memberId && r.courseId === input.courseId,
    ) ?? null,
  listByMember: async (tenantId, memberId) =>
    rows.filter((r) => r.tenantId === tenantId && r.memberId === memberId),
  findOrCreate: async (tenantId, input) => ({
    id: input.id,
    tenantId,
    memberId: input.memberId,
    courseId: input.courseId,
    completedLessonIds: [],
    updatedAt: input.now,
  }),
  update: async (_t, progress) => progress,
  countReferencingLesson: async (tenantId, lessonId) =>
    rows.filter(
      (r) =>
        r.tenantId === tenantId &&
        (r.completedLessonIds.includes(lessonId) || r.lastViewedLessonId === lessonId),
    ).length,
});

const productsRepo = (rows: Product[]): ProductRepository => ({
  listByTenant: async (tenantId) => rows.filter((p) => p.tenantId === tenantId),
  listPublishedByTenant: async (tenantId) =>
    rows.filter((p) => p.tenantId === tenantId && p.published),
  findById: async (tenantId, id) => rows.find((p) => p.tenantId === tenantId && p.id === id) ?? null,
  create: async () => undefined,
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
});

const deps = (
  grants: ProductGrant[],
  products: Product[],
  courses: Course[] = [c1],
  modules: CourseModule[] = [m1, m2],
  progress: MemberCourseProgress[] = [],
  lessonRows: CourseLesson[] = lessons,
): CourseAccessDeps => ({
  grants: grantsRepo(grants, products),
  courses: coursesRepo(courses),
  modules: modulesRepo(modules),
  lessons: lessonsRepo(lessonRows),
  progress: progressRepo(progress),
  products: productsRepo(products),
  clock,
});

describe('resolveMemberEntitlements', () => {
  it('aggregates access items from active grants', async () => {
    const result = await resolveMemberEntitlements(
      ctx({}),
      deps([grant('g1', 'p-course', '1998-05-01T00:00:00.000Z', '1998-07-01T00:00:00.000Z')], [pCourse]),
    );
    expect(result).toEqual({
      ok: true,
      value: [{ level: 'course', courseId: 'c1' }],
    });
  });

  it('ignores expired grants', async () => {
    const result = await resolveMemberEntitlements(
      ctx({}),
      deps([grant('g1', 'p-course', '1998-01-01T00:00:00.000Z', '1998-02-01T00:00:00.000Z')], [pCourse]),
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('ignores future-dated grants', async () => {
    const result = await resolveMemberEntitlements(
      ctx({}),
      deps([grant('g1', 'p-course', '1998-12-01T00:00:00.000Z', null)], [pCourse]),
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('honours perpetual grants (null expiresAt)', async () => {
    const result = await resolveMemberEntitlements(
      ctx({}),
      deps([grant('g1', 'p-module', '1998-01-01T00:00:00.000Z', null)], [pModule]),
    );
    expect(result).toMatchObject({ ok: true, value: [{ moduleIds: ['m1'] }] });
  });

  it('forbids staff without a member row', async () => {
    const result = await resolveMemberEntitlements(
      ctx({ memberId: null, staffRole: 'owner' }),
      deps([], []),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a resolved tenant', async () => {
    const result = await resolveMemberEntitlements(ctx({ tenantId: null }), deps([], []));
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});

describe('isLessonAccessible — 3-tier semantics', () => {
  const active = (productId: string): ProductGrant[] => [
    grant('g1', productId, '1998-05-01T00:00:00.000Z', '1998-07-01T00:00:00.000Z'),
  ];

  it('course-level grant unlocks every lesson', async () => {
    const d = deps(active('p-course'), [pCourse]);
    expect(await isLessonAccessible(ctx({}), 'l1', d)).toMatchObject({ ok: true });
    expect(await isLessonAccessible(ctx({}), 'l6', d)).toMatchObject({ ok: true });
  });

  it('module-level grant unlocks only that module', async () => {
    const d = deps(active('p-module'), [pModule]);
    expect(await isLessonAccessible(ctx({}), 'l1', d)).toMatchObject({ ok: true });
    expect(await isLessonAccessible(ctx({}), 'l4', d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('lesson-level grant unlocks only that lesson', async () => {
    const d = deps(active('p-lesson'), [pLesson]);
    expect(await isLessonAccessible(ctx({}), 'l4', d)).toMatchObject({ ok: true });
    expect(await isLessonAccessible(ctx({}), 'l1', d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('staff are always accessible without any grant', async () => {
    const d = deps([], []);
    expect(await isLessonAccessible(ctx({ staffRole: 'admin', memberId: null }), 'l1', d)).toMatchObject({
      ok: true,
    });
  });

  it('a member with no grant is forbidden', async () => {
    const d = deps([], []);
    expect(await isLessonAccessible(ctx({}), 'l1', d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('expired and future grants do not grant access', async () => {
    const expired = deps(
      [grant('g1', 'p-course', '1998-01-01T00:00:00.000Z', '1998-02-01T00:00:00.000Z')],
      [pCourse],
    );
    const future = deps([grant('g1', 'p-course', '1998-12-01T00:00:00.000Z', null)], [pCourse]);
    expect(await isLessonAccessible(ctx({}), 'l1', expired)).toMatchObject({ ok: false });
    expect(await isLessonAccessible(ctx({}), 'l1', future)).toMatchObject({ ok: false });
  });

  it('unknown lesson is not found', async () => {
    const d = deps(active('p-course'), [pCourse]);
    expect(await isLessonAccessible(ctx({}), 'nope', d)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('anonymous (no tenant) is tenant_not_found', async () => {
    const d = deps([], []);
    expect(await isLessonAccessible(ctx({ tenantId: null, memberId: null }), 'l1', d)).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });
});

describe('isLessonAccessible — course-level exclusions', () => {
  const active = (productId: string, id = 'g1'): ProductGrant =>
    grant(id, productId, '1998-05-01T00:00:00.000Z', '1998-07-01T00:00:00.000Z');

  it('a course grant with an excluded module locks that module but not the rest', async () => {
    const d = deps([active('p-course-except-m2')], [pCourseExceptM2]);
    expect(await isLessonAccessible(ctx({}), 'l1', d)).toMatchObject({ ok: true });
    expect(await isLessonAccessible(ctx({}), 'l4', d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('a second module-level grant overrides the exclusion', async () => {
    const d = deps(
      [active('p-course-except-m2'), active('p-module-m2', 'g2')],
      [pCourseExceptM2, product('p-module-m2', [{ level: 'modules', courseId: 'c1', moduleIds: ['m2'] }])],
    );
    expect(await isLessonAccessible(ctx({}), 'l1', d)).toMatchObject({ ok: true });
    expect(await isLessonAccessible(ctx({}), 'l4', d)).toMatchObject({ ok: true });
  });

  it('ignores dangling ids without crashing or granting', async () => {
    const dangling = product('p-dangling', [
      { level: 'course', courseId: 'ghost-course' },
      { level: 'modules', courseId: 'c1', moduleIds: ['ghost-module'] },
      { level: 'lessons', courseId: 'c1', lessonIds: ['ghost-lesson'] },
    ]);
    const d = deps([active('p-dangling')], [dangling]);
    expect(await isLessonAccessible(ctx({}), 'l1', d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});

describe('getCourseStructureWithAccess — course-level exclusions', () => {
  const active = (productId: string): ProductGrant[] => [
    grant('g1', productId, '1998-05-01T00:00:00.000Z', '1998-07-01T00:00:00.000Z'),
  ];

  it('renders an excluded module as not-accessible and the course as partially-accessible', async () => {
    const result = await getCourseStructureWithAccess(
      ctx({}),
      'c1',
      deps(active('p-course-except-m2'), [pCourseExceptM2]),
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.accessStatus).toBe('partially-accessible');
    const modA = nn(result.value.modules[0]);
    const modB = nn(result.value.modules[1]);
    expect(modA.accessStatus).toBe('fully-accessible');
    expect(modB.accessStatus).toBe('not-accessible');
  });
});

describe('getCourseStructureWithAccess', () => {
  const active = (productId: string): ProductGrant[] => [
    grant('g1', productId, '1998-05-01T00:00:00.000Z', '1998-07-01T00:00:00.000Z'),
  ];

  it('always returns the full syllabus regardless of access', async () => {
    const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps([], []));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.modules.map((m) => m.id)).toEqual(['m1', 'm2']);
    const mod0 = nn(result.value.modules[0]);
    expect(mod0.chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);
    const ch0 = nn(mod0.chapters[0]);
    expect(ch0.lessons.map((l) => l.lessonId)).toEqual(['l1', 'l2']);
    expect(nn(ch0.lessons[0]).name).toBe('Lesson l1');
  });

  it('marks everything not-accessible for a member with no grant', async () => {
    const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps([], []));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.accessStatus).toBe('not-accessible');
    expect(result.value.modules.every((m) => m.accessStatus === 'not-accessible')).toBe(true);
  });

  it('marks everything fully-accessible under a course-level grant', async () => {
    const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps(active('p-course'), [pCourse]));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.accessStatus).toBe('fully-accessible');
    expect(result.value.modules.every((m) => m.accessStatus === 'fully-accessible')).toBe(true);
  });

  it('module-level access makes the course partially-accessible', async () => {
    const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps(active('p-module'), [pModule]));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.accessStatus).toBe('partially-accessible');
    const modA = nn(result.value.modules[0]);
    const modB = nn(result.value.modules[1]);
    expect(modA.accessStatus).toBe('fully-accessible');
    expect(modB.accessStatus).toBe('not-accessible');
    expect(modA.chapters.every((c) => c.accessStatus === 'fully-accessible')).toBe(true);
    expect(modB.chapters.every((c) => c.accessStatus === 'not-accessible')).toBe(true);
  });

  it('lesson-level access makes the containing chapter and module partially-accessible', async () => {
    const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps(active('p-lesson'), [pLesson]));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.accessStatus).toBe('partially-accessible');
    const modB = nn(result.value.modules[1]);
    expect(modB.accessStatus).toBe('partially-accessible');
    const ch3 = nn(modB.chapters[0]);
    expect(ch3.accessStatus).toBe('partially-accessible');
    expect(nn(ch3.lessons[0]).accessStatus).toBe('fully-accessible');
    expect(nn(ch3.lessons[1]).accessStatus).toBe('not-accessible');
  });

  it('staff see the full course as fully-accessible', async () => {
    const result = await getCourseStructureWithAccess(
      ctx({ staffRole: 'owner', memberId: null }),
      'c1',
      deps([], []),
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.accessStatus).toBe('fully-accessible');
  });

  it('rolls completion up from lessons through chapters, modules and course', async () => {
    const progress: MemberCourseProgress = {
      id: 'pr1',
      tenantId: 't1',
      memberId: 'mem1',
      courseId: 'c1',
      completedLessonIds: ['l1', 'l2', 'l3'],
      updatedAt: NOW,
    };
    const result = await getCourseStructureWithAccess(
      ctx({}),
      'c1',
      deps(active('p-course'), [pCourse], [c1], [m1, m2], [progress]),
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.completionStatus).toBe('partially-completed');
    const modA = nn(result.value.modules[0]);
    const modB = nn(result.value.modules[1]);
    expect(modA.completionStatus).toBe('fully-completed');
    expect(modB.completionStatus).toBe('not-completed');
    expect(nn(modA.chapters[0]).completionStatus).toBe('fully-completed');
  });

  it('a single completed lesson makes its chapter partially-completed', async () => {
    const progress: MemberCourseProgress = {
      id: 'pr1',
      tenantId: 't1',
      memberId: 'mem1',
      courseId: 'c1',
      completedLessonIds: ['l1'],
      updatedAt: NOW,
    };
    const result = await getCourseStructureWithAccess(
      ctx({}),
      'c1',
      deps(active('p-course'), [pCourse], [c1], [m1, m2], [progress]),
    );
    if (!result.ok) throw new Error('expected ok');
    expect(nn(nn(result.value.modules[0]).chapters[0]).completionStatus).toBe('partially-completed');
  });

  it('unknown course is not found', async () => {
    const result = await getCourseStructureWithAccess(ctx({}), 'nope', deps([], []));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('getCourseStructureWithAccess — durations and upsell', () => {
  const priced = (id: string, priceCents: number, accessItems: Product['accessItems'], published = true): Product => ({
    ...product(id, accessItems),
    priceCents,
    published,
  });

  const catalogue = [
    priced('p-full', 10000, [{ level: 'course', courseId: 'c1' }]),
    priced('p-m2', 5000, [{ level: 'modules', courseId: 'c1', moduleIds: ['m2'] }]),
    priced('p-l4', 1972, [{ level: 'lessons', courseId: 'c1', lessonIds: ['l4'] }]),
    priced('p-draft', 100, [{ level: 'course', courseId: 'c1' }], false),
  ];

  const lessonsAt = (result: Awaited<ReturnType<typeof getCourseStructureWithAccess>>) => {
    if (!result.ok) throw new Error('expected ok');
    return result.value.modules.flatMap((m) => m.chapters.flatMap((c) => c.lessons));
  };

  it('points each locked lesson at the cheapest published covering product', async () => {
    const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps([], catalogue));
    const all = lessonsAt(result);
    const byId = new Map(all.map((l) => [l.lessonId, l]));
    expect(nn(byId.get('l1')).unlockProductId).toBe('p-full');
    expect(nn(byId.get('l4')).unlockProductId).toBe('p-l4');
    expect(nn(byId.get('l5')).unlockProductId).toBe('p-m2');
  });

  it('prefers the cheapest paid covering product regardless of catalogue ordering', async () => {
    const free = priced('p-free', 0, [{ level: 'course', courseId: 'c1' }]);
    const paid = priced('p-paid', 3900, [{ level: 'course', courseId: 'c1' }]);
    for (const products of [[free, paid], [paid, free]]) {
      const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps([], products));
      expect(lessonsAt(result).every((lessonRow) => lessonRow.unlockProductId === 'p-paid')).toBe(true);
    }
  });

  it('falls back to a free covering product when no paid product covers the lesson', async () => {
    const free = priced('p-free', 0, [{ level: 'course', courseId: 'c1' }]);
    const unrelatedPaid = priced('p-paid-other', 100, [{ level: 'course', courseId: 'other' }]);
    for (const products of [[free, unrelatedPaid], [unrelatedPaid, free]]) {
      const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps([], products));
      expect(lessonsAt(result).every((lessonRow) => lessonRow.unlockProductId === 'p-free')).toBe(true);
    }
  });

  it('never suggests unpublished products even when they are cheapest', async () => {
    const result = await getCourseStructureWithAccess(ctx({}), 'c1', deps([], catalogue));
    expect(lessonsAt(result).some((l) => l.unlockProductId === 'p-draft')).toBe(false);
  });

  it('omits the upsell on accessible lessons and when nothing covers a lesson', async () => {
    const covered = await getCourseStructureWithAccess(
      ctx({}),
      'c1',
      deps([grant('g1', 'p-full', '1998-05-01T00:00:00.000Z', null)], catalogue),
    );
    expect(lessonsAt(covered).every((l) => l.unlockProductId === undefined)).toBe(true);

    const uncovered = await getCourseStructureWithAccess(ctx({}), 'c1', deps([], []));
    expect(lessonsAt(uncovered).every((l) => l.unlockProductId === undefined)).toBe(true);
  });

  it('carries lesson durations into the structure', async () => {
    const timed = lessons.map((l) => (l.id === 'l1' ? { ...l, durationMinutes: 12 } : l));
    const result = await getCourseStructureWithAccess(
      ctx({}),
      'c1',
      deps([], [], [c1], [m1, m2], [], timed),
    );
    const byId = new Map(lessonsAt(result).map((l) => [l.lessonId, l]));
    expect(nn(byId.get('l1')).durationMinutes).toBe(12);
    expect(nn(byId.get('l2')).durationMinutes).toBeUndefined();
  });
});

describe('listMyCourses', () => {
  const active = (productId: string): ProductGrant[] => [
    grant('g1', productId, '1998-05-01T00:00:00.000Z', '1998-07-01T00:00:00.000Z'),
  ];

  it('returns courses with at least partial access', async () => {
    const result = await listMyCourses(ctx({}), deps(active('p-module'), [pModule], [c1, c2]));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((c) => c.id)).toEqual(['c1']);
  });

  it('excludes courses with no access', async () => {
    const result = await listMyCourses(ctx({}), deps([], [], [c1, c2]));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([]);
  });

  it('staff see every course', async () => {
    const result = await listMyCourses(
      ctx({ staffRole: 'admin', memberId: null }),
      deps([], [], [c1, c2]),
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('getAccessibleLesson', () => {
  const active = (productId: string): ProductGrant[] => [
    grant('g1', productId, '1998-05-01T00:00:00.000Z', '1998-07-01T00:00:00.000Z'),
  ];

  it('returns the lesson with its contents when accessible', async () => {
    const result = await getAccessibleLesson(ctx({}), 'l1', deps(active('p-module'), [pModule]));
    expect(result).toMatchObject({ ok: true, value: { id: 'l1', name: 'Lesson l1' } });
  });

  it('is forbidden when the lesson is outside the granted module', async () => {
    const result = await getAccessibleLesson(ctx({}), 'l4', deps(active('p-module'), [pModule]));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('is forbidden once the only grant has expired', async () => {
    const expired = deps(
      [grant('g1', 'p-course', '1998-01-01T00:00:00.000Z', '1998-02-01T00:00:00.000Z')],
      [pCourse],
    );
    expect(await getAccessibleLesson(ctx({}), 'l1', expired)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('serves a free preview lesson to a member without a matching grant', async () => {
    const withPreview = deps([], [], [c1], [m1, m2], [], lessons.map(
      (row) => (row.id === 'l4' ? { ...row, isPreview: true } : row),
    ));

    expect(await getAccessibleLesson(ctx({}), 'l4', withPreview)).toMatchObject({
      ok: true,
      value: { id: 'l4', isPreview: true },
    });
    expect(await getAccessibleLesson(ctx({}), 'l1', withPreview)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('lets staff read any lesson without a grant', async () => {
    const result = await getAccessibleLesson(ctx({ staffRole: 'owner', memberId: null }), 'l6', deps([], []));
    expect(result).toMatchObject({ ok: true, value: { id: 'l6' } });
  });
});

describe('getNextLesson', () => {
  const d = deps([], []);

  it('returns the following lesson within a chapter', async () => {
    expect(await getNextLesson(ctx({}), 'l1', d)).toEqual({ ok: true, value: { id: 'l2', name: 'Lesson l2' } });
  });

  it('crosses chapter and module boundaries', async () => {
    // l3 is the last lesson of module m1; l4 is the first of module m2.
    expect(await getNextLesson(ctx({}), 'l3', d)).toEqual({ ok: true, value: { id: 'l4', name: 'Lesson l4' } });
  });

  it('returns null at the very end of the course', async () => {
    expect(await getNextLesson(ctx({}), 'l6', d)).toEqual({ ok: true, value: null });
  });

  it('unknown lesson is not found', async () => {
    expect(await getNextLesson(ctx({}), 'nope', d)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});
