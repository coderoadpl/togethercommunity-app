import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type Member,
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
  MemberRepository,
  ProductGrantRepository,
} from '../ports.js';
import { getMemberLearningSummary, type MemberLearningSummaryDeps } from './member-learning.js';

const NOW = '2026-06-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const EARLIER = '2026-05-01T00:00:00.000Z';
const LATER = '2026-05-20T00:00:00.000Z';

const identity = (over: Partial<Identity>): Identity => ({
  userId: 'u-staff',
  email: 'owner@together.dev',
  name: 'Owner',
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  ...over,
});

const staff = (tenantId: string | null = 't1'): Ctx => ({
  identity: identity({ tenantId, staffRole: tenantId ? 'owner' : null }),
});

const plainMember = (): Ctx => ({ identity: identity({ staffRole: null, memberId: 'mem1' }) });

const member = (id: string): Member => ({
  id,
  tenantId: 't1',
  userId: `u-${id}`,
  email: `${id}@together.dev`,
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: PAST,
  deletedAt: null,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
    dmOptOutAt: null,
});

const lesson = (id: string): CourseLesson => ({
  id,
  tenantId: 't1',
  name: `Lesson ${id}`,
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: PAST,
});

const module = (
  id: string,
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
  createdAt: PAST,
});

const course = (id: string): Course => ({
  id,
  tenantId: 't1',
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  moduleOrder: [],
  publiclyVisible: false,
  legacyId: null,
  createdAt: PAST,
});

const product = (id: string, accessItems: Product['accessItems']): Product => ({
  id,
  tenantId: 't1',
  type: 'course',
  slug: id,
  title: `Product ${id}`,
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems,
  legacyId: null,
  createdAt: PAST,
});

const grant = (id: string, productId: string, expiresAt: string | null): ProductGrant => ({
  id,
  tenantId: 't1',
  memberId: 'mem1',
  productId,
  source: 'manual',
  startsAt: PAST,
  expiresAt,
  legacyId: null,
  createdAt: PAST,
});

const progressRow = (
  courseId: string,
  completedLessonIds: string[],
  updatedAt: string,
): MemberCourseProgress => ({
  id: `prog-${courseId}`,
  tenantId: 't1',
  memberId: 'mem1',
  courseId,
  completedLessonIds,
  updatedAt,
});

// Course c1: module m1 (l1, l2, l3) then m2 (l4, l5, l6); course c2: module m3 (l7).
const m1 = module(
  'm1',
  [
    {
      id: 'ch1',
      name: 'Chapter 1',
      contents: [
        { id: 'c-l1', name: 'C L1', lessonId: 'l1' },
        { id: 'c-l2', name: 'C L2', lessonId: 'l2' },
        { id: 'c-l3', name: 'C L3', lessonId: 'l3' },
      ],
    },
  ],
  ['c1'],
);
const m2 = module(
  'm2',
  [
    {
      id: 'ch2',
      name: 'Chapter 2',
      contents: [
        { id: 'c-l4', name: 'C L4', lessonId: 'l4' },
        { id: 'c-l5', name: 'C L5', lessonId: 'l5' },
        { id: 'c-l6', name: 'C L6', lessonId: 'l6' },
      ],
    },
  ],
  ['c1'],
);
const m3 = module(
  'm3',
  [{ id: 'ch3', name: 'Chapter 3', contents: [{ id: 'c-l7', name: 'C L7', lessonId: 'l7' }] }],
  ['c2'],
);

const allCourses = [course('c1'), course('c2')];
const allModules = [m1, m2, m3];
const allLessons = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'].map(lesson);

const pCourseC1 = product('p-course-c1', [{ level: 'course', courseId: 'c1' }]);
const pModuleM1 = product('p-module-m1', [{ level: 'modules', courseId: 'c1', moduleIds: ['m1'] }]);
const pCourseC2 = product('p-course-c2', [{ level: 'course', courseId: 'c2' }]);

const clock: Clock = { nowIso: () => NOW };

const deps = (input: {
  members?: Member[];
  products?: Product[];
  grants?: ProductGrant[];
  progress?: MemberCourseProgress[];
}): MemberLearningSummaryDeps => {
  const members = input.members ?? [member('mem1')];
  const products = input.products ?? [];
  const grants = input.grants ?? [];
  const progress = input.progress ?? [];

  const membersRepo: MemberRepository = {
    findById: async (tenantId, id) => members.find((m) => m.tenantId === tenantId && m.id === id) ?? null,
    findByEmail: async () => null,
    listWithProductIds: async () => [],
    create: async () => undefined,
    updateEmail: async () => null,
    updateLanguage: async () => null,
    updateDisplayName: async () => null,
    updateDmOptOut: async () => null,
  setBanned: async () => null,
  };

  const grantsRepo: ProductGrantRepository = {
    findById: async () => null,
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
  };

  const coursesRepo: CourseRepository = {
    list: async () => allCourses,
    findById: async (_t, id) => allCourses.find((c) => c.id === id) ?? null,
    findByIds: async (_t, ids) => allCourses.filter((c) => ids.includes(c.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  };

  const modulesRepo: CourseModuleRepository = {
    list: async () => allModules,
    findById: async (_t, id) => allModules.find((m) => m.id === id) ?? null,
    findByIds: async (_t, ids) => allModules.filter((m) => ids.includes(m.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  };

  const lessonsRepo: CourseLessonRepository = {
    list: async () => allLessons,
    listPreviews: async () => [],
    findById: async (_t, id) => allLessons.find((l) => l.id === id) ?? null,
    findByIds: async (_t, ids) => allLessons.filter((l) => ids.includes(l.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  };

  const progressRepo: MemberCourseProgressRepository = {
    findByMemberAndCourse: async (tenantId, query) =>
      progress.find(
        (r) => r.tenantId === tenantId && r.memberId === query.memberId && r.courseId === query.courseId,
      ) ?? null,
    listByMember: async (tenantId, memberId) =>
      progress.filter((r) => r.tenantId === tenantId && r.memberId === memberId),
    findOrCreate: async (tenantId, query) => ({
      id: query.id,
      tenantId,
      memberId: query.memberId,
      courseId: query.courseId,
      completedLessonIds: [],
      updatedAt: query.now,
    }),
    update: async (_t, row) => row,
    countReferencingLesson: async () => 0,
  };

  return {
    members: membersRepo,
    grants: grantsRepo,
    courses: coursesRepo,
    modules: modulesRepo,
    lessons: lessonsRepo,
    progress: progressRepo,
    clock,
  };
};

describe('getMemberLearningSummary', () => {
  it('forbids a plain member identity', async () => {
    const result = await getMemberLearningSummary(plainMember(), 'mem1', deps({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('requires a tenant', async () => {
    const result = await getMemberLearningSummary(staff(null), 'mem1', deps({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('is not found for an unknown member', async () => {
    const result = await getMemberLearningSummary(staff(), 'mem-ghost', deps({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('returns the empty summary for a member with no grants and no progress', async () => {
    const result = await getMemberLearningSummary(staff(), 'mem1', deps({}));
    expect(result).toMatchObject({ ok: true, value: { lastActivityAt: null, courses: [] } });
  });

  it('counts only entitled lessons and completions within them', async () => {
    const result = await getMemberLearningSummary(
      staff(),
      'mem1',
      deps({
        products: [pModuleM1],
        grants: [grant('g1', 'p-module-m1', null)],
        progress: [progressRow('c1', ['l1', 'l4'], EARLIER)],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        lastActivityAt: EARLIER,
        courses: [
          {
            courseId: 'c1',
            courseName: 'Course c1',
            completedLessonCount: 1,
            accessibleLessonCount: 3,
            lastActivityAt: EARLIER,
            latestCompletedLesson: { lessonId: 'l1', name: 'Lesson l1' },
          },
        ],
      },
    });
  });

  it('reports the most recently completed accessible lesson', async () => {
    const result = await getMemberLearningSummary(
      staff(),
      'mem1',
      deps({
        products: [pCourseC1],
        grants: [grant('g1', 'p-course-c1', null)],
        progress: [progressRow('c1', ['l2', 'l5', 'l3'], LATER)],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        courses: [
          {
            courseId: 'c1',
            completedLessonCount: 3,
            accessibleLessonCount: 6,
            latestCompletedLesson: { lessonId: 'l3', name: 'Lesson l3' },
          },
        ],
      },
    });
  });

  it('drops courses whose grants expired but keeps their activity signal', async () => {
    const result = await getMemberLearningSummary(
      staff(),
      'mem1',
      deps({
        products: [pCourseC1],
        grants: [grant('g1', 'p-course-c1', PAST)],
        progress: [progressRow('c1', ['l1'], EARLIER)],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { lastActivityAt: EARLIER, courses: [] },
    });
  });

  it('surfaces per-course rows and the latest activity across courses', async () => {
    const result = await getMemberLearningSummary(
      staff(),
      'mem1',
      deps({
        products: [pCourseC1, pCourseC2],
        grants: [grant('g1', 'p-course-c1', null), grant('g2', 'p-course-c2', null)],
        progress: [progressRow('c1', [], EARLIER), progressRow('c2', ['l7'], LATER)],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        lastActivityAt: LATER,
        courses: [
          {
            courseId: 'c1',
            completedLessonCount: 0,
            accessibleLessonCount: 6,
            lastActivityAt: EARLIER,
            latestCompletedLesson: null,
          },
          {
            courseId: 'c2',
            completedLessonCount: 1,
            accessibleLessonCount: 1,
            lastActivityAt: LATER,
            latestCompletedLesson: { lessonId: 'l7', name: 'Lesson l7' },
          },
        ],
      },
    });
  });

  it('lists an entitled course the member never opened with a null activity', async () => {
    const result = await getMemberLearningSummary(
      staff(),
      'mem1',
      deps({
        products: [pCourseC2],
        grants: [grant('g1', 'p-course-c2', null)],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        lastActivityAt: null,
        courses: [
          {
            courseId: 'c2',
            completedLessonCount: 0,
            accessibleLessonCount: 1,
            lastActivityAt: null,
            latestCompletedLesson: null,
          },
        ],
      },
    });
  });
});
