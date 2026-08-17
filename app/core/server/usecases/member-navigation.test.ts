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
  type Space,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  MemberCourseProgressRepository,
  PostRepository,
  ProductGrantRepository,
  ProductRepository,
  SpaceRepository,
  SpaceSeenRepository,
  SpaceSubscription,
  SpaceSubscriptionRepository,
} from '../ports.js';
import { getMemberNavigation, type MemberNavigationDeps } from './member-navigation.js';

const NOW = '2026-06-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const EARLIER = '2026-05-01T00:00:00.000Z';

const identity = (over: Partial<Identity>): Identity => ({
  userId: 'u-mem1',
  email: 'mem1@together.dev',
  name: 'Member One',
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'mem1',
  memberBannedAt: null,
  ...over,
});

const memberCtx = (over: Partial<Identity> = {}): Ctx => ({ identity: identity(over) });

const staffCtx = (): Ctx => ({
  identity: identity({ userId: 'u-staff', staffRole: 'owner', memberId: null }),
});

const space = (over: Partial<Space>): Space => ({
  id: 's-open',
  tenantId: 't1',
  slug: 's-open',
  name: 'Open space',
  description: null,
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: PAST,
  ...over,
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
  lessonIds: string[],
  courseIds: string[],
): CourseModule => ({
  id,
  tenantId: 't1',
  courseIds,
  title: `Module ${id}`,
  prefix: null,
  name: computeCourseModuleName(null, `Module ${id}`),
  chapters: [
    {
      id: `ch-${id}`,
      name: `Chapter ${id}`,
      contents: lessonIds.map((lessonId) => ({
        id: `c-${lessonId}`,
        name: `C ${lessonId}`,
        lessonId,
      })),
    },
  ],
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

const grant = (id: string, productId: string): ProductGrant => ({
  id,
  tenantId: 't1',
  memberId: 'mem1',
  productId,
  source: 'manual',
  startsAt: PAST,
  expiresAt: null,
  legacyId: null,
  createdAt: PAST,
});

const progressRow = (
  courseId: string,
  completedLessonIds: string[],
  lastViewedLessonId?: string,
): MemberCourseProgress => ({
  id: `prog-${courseId}`,
  tenantId: 't1',
  memberId: 'mem1',
  courseId,
  completedLessonIds,
  ...(lastViewedLessonId === undefined ? {} : { lastViewedLessonId }),
  updatedAt: EARLIER,
});

const m1 = module('m1', ['l1', 'l2', 'l3'], ['c1']);
const m2 = module('m2', ['l4'], ['c1']);
const m3 = module('m3', ['l5'], ['c2']);

const allCourses = [course('c1'), course('c2')];
const allModules = [m1, m2, m3];
const allLessons = ['l1', 'l2', 'l3', 'l4', 'l5'].map(lesson);

const pModuleM1 = product('p-module-m1', [{ level: 'modules', courseId: 'c1', moduleIds: ['m1'] }]);
const pCourseC2 = product('p-course-c2', [{ level: 'course', courseId: 'c2' }]);

const openSpace = space({});
const entitledSpace = space({
  id: 's-module',
  slug: 's-module',
  name: 'Module space',
  visibility: 'product',
  productIds: ['p-module-m1'],
  position: 1,
});
const lockedSpace = space({
  id: 's-locked',
  slug: 's-locked',
  name: 'Locked space',
  description: 'Sold separately',
  visibility: 'product',
  productIds: ['p-course-c2'],
  position: 2,
});
const archivedSpace = space({
  id: 's-archived',
  slug: 's-archived',
  name: 'Archived space',
  position: 3,
  archivedAt: EARLIER,
});

const allSpaces = [openSpace, entitledSpace, lockedSpace, archivedSpace];

const clock: Clock = { nowIso: () => NOW };

const deps = (input: {
  spaces?: Space[];
  products?: Product[];
  grants?: ProductGrant[];
  progress?: MemberCourseProgress[];
  follows?: SpaceSubscription[];
  latestRootPostAt?: Record<string, string>;
  seenMarks?: Array<{ spaceId: string; seenAt: string }>;
}): MemberNavigationDeps => {
  const spaces = input.spaces ?? allSpaces;
  const products = input.products ?? [];
  const grants = input.grants ?? [];
  const progress = input.progress ?? [];
  const follows = input.follows ?? [];
  const latestRootPostAt = input.latestRootPostAt ?? {};
  const seenMarks = input.seenMarks ?? [];

  const spacesRepo: SpaceRepository = {
    list: async (tenantId, options) =>
      spaces.filter(
        (row) =>
          row.tenantId === tenantId && (options?.includeArchived === true || row.archivedAt === null),
      ),
    findById: async () => null,
    findBySlug: async () => null,
    create: async () => undefined,
    update: async () => null,
    setArchived: async () => null,
    delete: async () => false,
    stats: async () => new Map(),
  };

  const spaceSubscriptionsRepo: SpaceSubscriptionRepository = {
    follow: async () => undefined,
    unfollow: async () => false,
    listFollowersForSpace: async () => [],
    listForUser: async (tenantId, query) =>
      follows.filter(
        (row) =>
          row.tenantId === tenantId &&
          row.userId === query.userId &&
          query.spaceIds.includes(row.spaceId),
      ),
  };

  const postsRepo: PostRepository = {
    createPost: async (_tenantId, post) => post,
    findById: async () => null,
    findByIds: async () => [],
    countByAuthorSince: async () => 0,
    listRecentBodiesByAuthor: async () => [],
    listByAuthor: async () => [],
    listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
    listThreadsForSpaces: async () => ({ threads: [], nextCursor: null }),
    listReplies: async () => [],
    updateBody: async () => null,
    softDelete: async () => null,
    setPinned: async () => null,
    listPinnedForContext: async () => [],
    countPinnedForContext: async () => 0,
    latestRootPostAt: async (_tenantId, spaceIds) =>
      new Map(Object.entries(latestRootPostAt).filter(([spaceId]) => spaceIds.includes(spaceId))),
    search: async () => [],
  };

  const spaceSeenRepo: SpaceSeenRepository = {
    markSeen: async () => undefined,
    listForUser: async (_tenantId, query) =>
      seenMarks.filter((row) => query.spaceIds.includes(row.spaceId)),
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
        (row) =>
          row.tenantId === tenantId &&
          row.memberId === memberId &&
          row.startsAt <= now &&
          (row.expiresAt === null || row.expiresAt >= now),
      ),
    listGrantedProducts: async (tenantId, memberId) => {
      const ids = new Set(
        grants
          .filter((row) => row.tenantId === tenantId && row.memberId === memberId)
          .map((row) => row.productId),
      );
      return products.filter((row) => row.tenantId === tenantId && ids.has(row.id));
    },
  };

  const productsRepo: ProductRepository = {
    listByTenant: async (tenantId) => products.filter((row) => row.tenantId === tenantId),
    listPublishedByTenant: async (tenantId) =>
      products.filter((row) => row.tenantId === tenantId && row.published),
    findById: async (_t, id) => products.find((row) => row.id === id) ?? null,
    create: async () => 'created',
    updateAccessItems: async () => null,
    setPublished: async () => undefined,
    bumpContentVersion: async () => undefined,
  };

  const coursesRepo: CourseRepository = {
    list: async () => allCourses,
    findById: async (_t, id) => allCourses.find((row) => row.id === id) ?? null,
    findByIds: async (_t, ids) => allCourses.filter((row) => ids.includes(row.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  };

  const modulesRepo: CourseModuleRepository = {
    list: async () => allModules,
    findById: async (_t, id) => allModules.find((row) => row.id === id) ?? null,
    findByIds: async (_t, ids) => allModules.filter((row) => ids.includes(row.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  };

  const lessonsRepo: CourseLessonRepository = {
    list: async () => allLessons,
    listPreviews: async () => [],
    findById: async (_t, id) => allLessons.find((row) => row.id === id) ?? null,
    findByIds: async (_t, ids) => allLessons.filter((row) => ids.includes(row.id)),
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  };

  const progressRepo: MemberCourseProgressRepository = {
    findByMemberAndCourse: async () => null,
    listByMember: async (tenantId, memberId) =>
      progress.filter((row) => row.tenantId === tenantId && row.memberId === memberId),
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
    spaces: spacesRepo,
    spaceSubscriptions: spaceSubscriptionsRepo,
    spaceSeen: spaceSeenRepo,
    posts: postsRepo,
    grants: grantsRepo,
    products: productsRepo,
    courses: coursesRepo,
    modules: modulesRepo,
    lessons: lessonsRepo,
    progress: progressRepo,
    clock,
  };
};

const entitledToModuleM1 = {
  products: [pModuleM1],
  grants: [grant('g1', 'p-module-m1')],
};

const pBothCourses = product('p-both', [
  { level: 'course', courseId: 'c1' },
  { level: 'lessons', courseId: 'c2', lessonIds: ['l5'] },
]);
const pForgottenCourse = product('p-forgotten', [{ level: 'course', courseId: 'c-removed' }]);

const secondModuleSpace = space({
  id: 's-module-2',
  slug: 's-module-2',
  name: 'Second module space',
  visibility: 'product',
  productIds: ['p-module-m1'],
  position: 4,
});

const sharedSpace = space({
  id: 's-shared',
  slug: 's-shared',
  name: 'Shared space',
  visibility: 'product',
  productIds: ['p-both'],
  position: 5,
});

const forgottenCourseSpace = space({
  id: 's-forgotten',
  slug: 's-forgotten',
  name: 'Forgotten course space',
  visibility: 'product',
  productIds: ['p-forgotten'],
  position: 6,
});

describe('getMemberNavigation', () => {
  it('requires a tenant', async () => {
    const result = await getMemberNavigation(memberCtx({ tenantId: null }), deps({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('forbids an identity that is neither a member nor staff', async () => {
    const result = await getMemberNavigation(memberCtx({ memberId: null }), deps({}));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('splits spaces by entitlement and never exposes an archived space', async () => {
    const result = await getMemberNavigation(memberCtx(), deps(entitledToModuleM1));
    expect(result).toMatchObject({
      ok: true,
      value: {
        spaces: [
          { id: 's-open', visibility: 'members', position: 0, isFollowing: false },
          { id: 's-module', visibility: 'product', position: 1, isFollowing: false },
        ],
        lockedSpaces: [
          {
            id: 's-locked',
            slug: 's-locked',
            name: 'Locked space',
            description: 'Sold separately',
            productIds: ['p-course-c2'],
          },
        ],
      },
    });
  });

  it('joins the follow state of the viewing user', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({
        ...entitledToModuleM1,
        follows: [{ tenantId: 't1', userId: 'u-mem1', spaceId: 's-module', createdAt: PAST }],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        spaces: [{ id: 's-open', isFollowing: false }, { id: 's-module', isFollowing: true }],
      },
    });
  });

  it('counts completions inside the entitled lessons and carries the last viewed lesson', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({
        ...entitledToModuleM1,
        progress: [progressRow('c1', ['l1', 'l4'], 'l2')],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        courses: [
          {
            courseId: 'c1',
            courseName: 'Course c1',
            completedLessonCount: 1,
            accessibleLessonCount: 3,
            lastViewedLessonId: 'l2',
            lastActivityAt: EARLIER,
          },
        ],
      },
    });
  });

  it('skips courses without an accessible lesson', async () => {
    const result = await getMemberNavigation(memberCtx(), deps(entitledToModuleM1));
    expect(result).toMatchObject({ ok: true, value: { courses: [{ courseId: 'c1' }] } });
  });

  it('omits the last viewed lesson and the activity stamp before the first visit', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({ products: [pCourseC2], grants: [grant('g1', 'p-course-c2')] }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        courses: [
          {
            courseId: 'c2',
            completedLessonCount: 0,
            accessibleLessonCount: 1,
            lastActivityAt: null,
          },
        ],
      },
    });
    expect(result.ok && result.value.courses[0]).not.toHaveProperty('lastViewedLessonId');
  });

  it('flags a space whose newest root post is younger than the viewer mark', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({
        ...entitledToModuleM1,
        latestRootPostAt: { 's-open': '2026-05-20T00:00:00.000Z', 's-module': '2026-05-20T00:00:00.000Z' },
        seenMarks: [{ spaceId: 's-open', seenAt: '2026-05-10T00:00:00.000Z' }, { spaceId: 's-module', seenAt: '2026-05-25T00:00:00.000Z' }],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { spaces: [{ id: 's-open', unread: true }, { id: 's-module', unread: false }] },
    });
  });

  it('flags a never-seen space with posts and stays quiet for an empty one', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({ ...entitledToModuleM1, latestRootPostAt: { 's-open': EARLIER } }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { spaces: [{ id: 's-open', unread: true }, { id: 's-module', unread: false }] },
    });
  });

  it('never flags a locked space', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({ ...entitledToModuleM1, latestRootPostAt: { 's-locked': NOW } }),
    );
    expect(result.ok && result.value.lockedSpaces[0]).not.toHaveProperty('unread');
  });

  it('associates a product-gated space with the course its product grants', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({ spaces: [openSpace, entitledSpace], ...entitledToModuleM1 }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        spaces: [
          { id: 's-open', courseIds: [] },
          { id: 's-module', courseIds: ['c1'] },
        ],
      },
    });
  });

  it('associates every space gated by the same product with that course', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({ spaces: [entitledSpace, secondModuleSpace], ...entitledToModuleM1 }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        spaces: [
          { id: 's-module', courseIds: ['c1'] },
          { id: 's-module-2', courseIds: ['c1'] },
        ],
      },
    });
  });

  it('carries every course a shared gating product grants', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({
        spaces: [sharedSpace],
        products: [pBothCourses],
        grants: [grant('g1', 'p-both')],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { spaces: [{ id: 's-shared', courseIds: ['c1', 'c2'] }] },
    });
  });

  it('leaves a space unassociated when its products grant no course of this tenant', async () => {
    const result = await getMemberNavigation(
      memberCtx(),
      deps({
        spaces: [forgottenCourseSpace],
        products: [pForgottenCourse],
        grants: [grant('g1', 'p-forgotten')],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { spaces: [{ id: 's-forgotten', courseIds: [] }] },
    });
  });

  it('gives staff every space and course without any entitlement', async () => {
    const result = await getMemberNavigation(staffCtx(), deps({}));
    expect(result).toMatchObject({
      ok: true,
      value: {
        spaces: [{ id: 's-open' }, { id: 's-module' }, { id: 's-locked' }],
        lockedSpaces: [],
        courses: [
          { courseId: 'c1', accessibleLessonCount: 4, completedLessonCount: 0 },
          { courseId: 'c2', accessibleLessonCount: 1, completedLessonCount: 0 },
        ],
      },
    });
  });
});
