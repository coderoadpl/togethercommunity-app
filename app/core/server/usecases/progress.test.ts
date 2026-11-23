import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  type Course,
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
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  MemberCourseProgressRepository,
  MemberRepository,
  ProductGrantRepository,
} from '../ports.js';
import {
  getProgress,
  markLessonCompleted,
  resetMemberCourseProgress,
  unmarkLessonCompleted,
  updateLastViewed,
  type ProgressDeps,
  type ResetMemberCourseProgressDeps,
} from './progress.js';

const NOW = '2026-06-01T00:00:00.000Z';

const nn = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('unexpected undefined');
  return value;
};

const identity = (over: Partial<Identity>): Identity => ({
  userId: 'u1',
  email: 'member@together.dev',
  name: 'Member',
  emailVerified: true,
  tenantAccess: 'member',
  tenantId: 't1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: null,
  memberId: 'mem1',
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
  ...over,
});

const ctx = (over: Partial<Identity>): Ctx => ({ identity: identity(over) });

const course = (id: string, tenantId: string, moduleOrder: string[] = []): Course => ({
  id,
  tenantId,
  name: `Course ${id}`,
  description: '',
  imageUrl: null,
  moduleOrder,
  publiclyVisible: false,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const c1 = course('c1', 't1');

const m1: CourseModule = {
  id: 'm1',
  tenantId: 't1',
  courseIds: ['c1'],
  title: 'Module 1',
  prefix: null,
  name: computeCourseModuleName(null, 'Module 1'),
  chapters: [
    {
      id: 'ch1',
      name: 'Chapter 1',
      contents: [
        { id: 'c-l1', name: 'C L1', lessonId: 'l1' },
        { id: 'c-l2', name: 'C L2', lessonId: 'l2' },
      ],
    },
  ],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const pCourse: Product = {
  id: 'p-course',
  tenantId: 't1',
  type: 'course',
  slug: 'full-course',
  title: 'Full course',
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  visibility: 'listed',
  salesChannel: 'any',
  deliveryMethod: 'pickup',
  published: true,
  accessItems: [{ level: 'course', courseId: 'c1' }],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const activeGrant: ProductGrant = {
  mode: 'live',
  id: 'g1',
  tenantId: 't1',
  memberId: 'mem1',
  productId: 'p-course',
  source: 'manual',
  startsAt: '2026-05-01T00:00:00.000Z',
  expiresAt: '2026-07-01T00:00:00.000Z',
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const clock: Clock = { nowIso: () => NOW };

let idCounter = 0;
const ids: IdGenerator = { nextId: () => `pr-${++idCounter}` };

const coursesRepo = (rows: Course[]): CourseRepository => ({
  list: async (tenantId) => rows.filter((r) => r.tenantId === tenantId),
  findById: async (tenantId, id) => rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null,
  findByIds: async (tenantId, ids) => rows.filter((r) => r.tenantId === tenantId && ids.includes(r.id)),
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
});

const modulesRepo = (rows: CourseModule[]): CourseModuleRepository => ({
  list: async (tenantId) => rows.filter((r) => r.tenantId === tenantId),
  findById: async (tenantId, id) => rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null,
  findByIds: async (tenantId, ids) => rows.filter((r) => r.tenantId === tenantId && ids.includes(r.id)),
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

const makeProgressStore = (): {
  repo: MemberCourseProgressRepository;
  rows: MemberCourseProgress[];
  failWritesTo: Set<string>;
} => {
  const rows: MemberCourseProgress[] = [];
  const failWritesTo = new Set<string>();
  const repo: MemberCourseProgressRepository = {
    findByMemberAndCourse: async (tenantId, input) =>
      rows.find(
        (r) =>
          r.tenantId === tenantId && r.memberId === input.memberId && r.courseId === input.courseId,
      ) ?? null,
    listByMember: async (tenantId, memberId) =>
      rows.filter((r) => r.tenantId === tenantId && r.memberId === memberId),
    findOrCreate: async (tenantId, input) => {
      const existing = rows.find(
        (r) =>
          r.tenantId === tenantId && r.memberId === input.memberId && r.courseId === input.courseId,
      );
      if (existing) return existing;
      const created: MemberCourseProgress = {
        id: input.id,
        tenantId,
        memberId: input.memberId,
        courseId: input.courseId,
        completedLessonIds: [],
        updatedAt: input.now,
      };
      rows.push(created);
      return created;
    },
    update: async (tenantId, progress) => {
      if (failWritesTo.has(progress.courseId)) throw new Error('progress write failed');
      const idx = rows.findIndex((r) => r.tenantId === tenantId && r.id === progress.id);
      if (idx < 0) return null;
      rows[idx] = progress;
      return progress;
    },
    removeCompletedLesson: async (tenantId, input) => {
      const matching = rows.filter((r) => r.tenantId === tenantId && r.memberId === input.memberId && input.courseIds.includes(r.courseId));
      if (matching.some((r) => r.completedLessonIds.includes(input.lessonId) && failWritesTo.has(r.courseId))) {
        throw new Error('progress write failed');
      }
      return matching.map((r) => {
        if (!r.completedLessonIds.includes(input.lessonId)) return r;
        const updated = { ...r, completedLessonIds: r.completedLessonIds.filter((id) => id !== input.lessonId), updatedAt: input.now };
        rows[rows.indexOf(r)] = updated;
        return updated;
      });
    },
    countReferencingLesson: async (tenantId, lessonId) =>
      rows.filter(
        (r) =>
          r.tenantId === tenantId &&
          (r.completedLessonIds.includes(lessonId) || r.lastViewedLessonId === lessonId),
      ).length,
  };
  return { repo, rows, failWritesTo };
};

const deps = (
  progress: MemberCourseProgressRepository,
  grants: ProductGrant[] = [activeGrant],
  products: Product[] = [pCourse],
  courses: Course[] = [c1],
  modules: CourseModule[] = [m1],
): ProgressDeps => ({
  grants: grantsRepo(grants, products),
  courses: coursesRepo(courses),
  modules: modulesRepo(modules),
  progress,
  ids,
  clock,
});

describe('markLessonCompleted', () => {
  it('records completion for an accessible lesson', async () => {
    const store = makeProgressStore();
    const result = await markLessonCompleted(ctx({}), 'l1', deps(store.repo));
    expect(result).toMatchObject({ ok: true, value: { completedLessonIds: ['l1'] } });
    expect(store.rows).toHaveLength(1);
  });

  it('is idempotent — marking twice keeps a single entry', async () => {
    const store = makeProgressStore();
    const d = deps(store.repo);
    await markLessonCompleted(ctx({}), 'l1', d);
    const second = await markLessonCompleted(ctx({}), 'l1', d);
    expect(second).toMatchObject({ ok: true, value: { completedLessonIds: ['l1'] } });
    expect(store.rows).toHaveLength(1);
    expect(nn(store.rows[0]).completedLessonIds).toEqual(['l1']);
  });

  it('appends distinct lessons', async () => {
    const store = makeProgressStore();
    const d = deps(store.repo);
    await markLessonCompleted(ctx({}), 'l1', d);
    const result = await markLessonCompleted(ctx({}), 'l2', d);
    expect(result).toMatchObject({ ok: true, value: { completedLessonIds: ['l1', 'l2'] } });
  });

  it('forbids completing an inaccessible lesson', async () => {
    const store = makeProgressStore();
    const result = await markLessonCompleted(ctx({}), 'l1', deps(store.repo, [], []));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store.rows).toHaveLength(0);
  });

  it('is not found for an unknown lesson', async () => {
    const store = makeProgressStore();
    const result = await markLessonCompleted(ctx({}), 'nope', deps(store.repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('forbids non-members', async () => {
    const store = makeProgressStore();
    const result = await markLessonCompleted(
      ctx({ memberId: null, staffRole: 'owner' }),
      'l1',
      deps(store.repo),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('progress on a module that two courses share', () => {
  const c2 = course('c2', 't1');
  const shared: CourseModule = { ...m1, courseIds: ['c1', 'c2'] };
  const sharedDeps = (progress: MemberCourseProgressRepository, accessItems: Product['accessItems']) =>
    deps(progress, [activeGrant], [{ ...pCourse, accessItems }], [c1, c2], [shared]);

  it('records completion under the course that opens the lesson when the item of the other course excludes its module', async () => {
    const store = makeProgressStore();
    const d = sharedDeps(store.repo, [{ level: 'course', courseId: 'c1', excludedModuleIds: ['m1'] }, { level: 'course', courseId: 'c2' }]);
    expect(await markLessonCompleted(ctx({}), 'l1', d)).toMatchObject({ ok: true, value: { courseId: 'c2', completedLessonIds: ['l1'] } });
    expect(await unmarkLessonCompleted(ctx({}), 'l1', d)).toMatchObject({ ok: true, value: { courseId: 'c2', completedLessonIds: [] } });
  });

  it('keeps recording under the first course when that course opens the lesson', async () => {
    const store = makeProgressStore();
    const d = sharedDeps(store.repo, [{ level: 'course', courseId: 'c1' }, { level: 'course', courseId: 'c2' }]);
    expect(await markLessonCompleted(ctx({}), 'l1', d)).toMatchObject({ ok: true, value: { courseId: 'c1' } });
  });

  describe('with the course the member is viewing', () => {
    const c3 = course('c3', 't1');
    const inThree: CourseModule = { ...m1, courseIds: ['c1', 'c2', 'c3'] };
    const threeDeps = (progress: MemberCourseProgressRepository, accessItems: Product['accessItems']) =>
      deps(progress, [activeGrant], [{ ...pCourse, accessItems }], [c1, c2, c3], [inThree]);
    const c1WithoutM1 = { level: 'course' as const, courseId: 'c1', excludedModuleIds: ['m1'] };

    it('records and removes completion under the viewed course when it opens the lesson', async () => {
      const store = makeProgressStore();
      const d = threeDeps(store.repo, [c1WithoutM1, { level: 'course', courseId: 'c2' }, { level: 'course', courseId: 'c3' }]);
      expect(await markLessonCompleted(ctx({}), 'l1', d, 'c3')).toMatchObject({ ok: true, value: { courseId: 'c3', completedLessonIds: ['l1'] } });
      expect(await getProgress(ctx({}), 'c3', { ...d, lessons: { list: async () => [] } })).toMatchObject({ ok: true, value: { completedLessonIds: ['l1'] } });
      expect(await unmarkLessonCompleted(ctx({}), 'l1', d, 'c3')).toMatchObject({ ok: true, value: { courseId: 'c3', completedLessonIds: [] } });
    });

    it('falls back to the first course that opens the lesson when the viewed course does not', async () => {
      const store = makeProgressStore();
      const d = threeDeps(store.repo, [c1WithoutM1, { level: 'course', courseId: 'c2' }]);
      expect(await markLessonCompleted(ctx({}), 'l1', d, 'c1')).toMatchObject({ ok: true, value: { courseId: 'c2' } });
      expect(await markLessonCompleted(ctx({}), 'l1', d, 'c-unknown')).toMatchObject({ ok: true, value: { courseId: 'c2' } });
    });

    it('records under the first opening course when the viewed course is held but lacks the lesson, or lives in another workspace', async () => {
      const store = makeProgressStore();
      const held = course('c4', 't1');
      const elsewhere = course('c-elsewhere', 't2');
      const m4: CourseModule = { ...m1, id: 'm4', courseIds: ['c4'], chapters: [] };
      const d = deps(
        store.repo, [activeGrant],
        [{ ...pCourse, accessItems: [c1WithoutM1, { level: 'course', courseId: 'c2' }, { level: 'course', courseId: 'c4' }] }],
        [c1, c2, c3, held, elsewhere], [inThree, m4],
      );

      expect(await markLessonCompleted(ctx({}), 'l1', d, 'c4')).toMatchObject({ ok: true, value: { courseId: 'c2', completedLessonIds: ['l1'] } });
      expect(await markLessonCompleted(ctx({}), 'l2', d, 'c-elsewhere')).toMatchObject({ ok: true, value: { courseId: 'c2', completedLessonIds: ['l1', 'l2'] } });
      expect(store.rows.map((row) => row.courseId)).toEqual(['c2']);
    });

    it('records under the first course that opens the lesson when no course is sent', async () => {
      const store = makeProgressStore();
      const d = threeDeps(store.repo, [{ level: 'course', courseId: 'c1' }, { level: 'course', courseId: 'c3' }]);
      expect(await markLessonCompleted(ctx({}), 'l1', d)).toMatchObject({ ok: true, value: { courseId: 'c1' } });
    });

    it('records staff completion under the viewed course and under the first course without one', async () => {
      const store = makeProgressStore();
      const d = threeDeps(store.repo, []);
      expect(await markLessonCompleted(ctx({ staffRole: 'admin' }), 'l1', d, 'c2')).toMatchObject({ ok: true, value: { courseId: 'c2' } });
      expect(await markLessonCompleted(ctx({ staffRole: 'admin' }), 'l2', d)).toMatchObject({ ok: true, value: { courseId: 'c1' } });
    });

    it('removes the completion from the viewed course row when that course holds the lesson but no longer opens it', async () => {
      const store = makeProgressStore();
      const open = threeDeps(store.repo, [{ level: 'course', courseId: 'c1' }, { level: 'course', courseId: 'c2' }]);
      expect(await markLessonCompleted(ctx({}), 'l1', open, 'c1')).toMatchObject({ ok: true, value: { courseId: 'c1', completedLessonIds: ['l1'] } });

      const closed = threeDeps(store.repo, [c1WithoutM1, { level: 'course', courseId: 'c2' }]);
      expect(await unmarkLessonCompleted(ctx({}), 'l1', closed, 'c1')).toMatchObject({ ok: true, value: { courseId: 'c2', completedLessonIds: [] } });
      expect(await getProgress(ctx({}), 'c1', { ...closed, lessons: { list: async () => [] } })).toMatchObject({ ok: true, value: { completedLessonIds: [] } });
    });

    it('leaves both rows completed when removing the completion from the opening course fails after the viewed course row', async () => {
      const store = makeProgressStore();
      const open = threeDeps(store.repo, [{ level: 'course', courseId: 'c1' }, { level: 'course', courseId: 'c2' }]);
      await markLessonCompleted(ctx({}), 'l1', open, 'c1');
      await markLessonCompleted(ctx({}), 'l1', open, 'c2');

      const closed = threeDeps(store.repo, [c1WithoutM1, { level: 'course', courseId: 'c2' }]);
      store.failWritesTo.add('c2');
      await expect(unmarkLessonCompleted(ctx({}), 'l1', closed, 'c1')).rejects.toThrow('progress write failed');
      expect(store.rows.map((row) => [row.courseId, row.completedLessonIds])).toEqual([['c1', ['l1']], ['c2', ['l1']]]);

      store.failWritesTo.clear();
      expect(await unmarkLessonCompleted(ctx({}), 'l1', closed, 'c1')).toMatchObject({ ok: true, value: { courseId: 'c2', completedLessonIds: [] } });
      expect(store.rows.map((row) => [row.courseId, row.completedLessonIds])).toEqual([['c1', []], ['c2', []]]);
    });

    it('leaves rows of courses that do not hold the lesson, of other members and of other workspaces untouched', async () => {
      const store = makeProgressStore();
      const elsewhere = course('c-elsewhere', 't2');
      const unrelated = course('c4', 't1');
      const row = (id: string, tenantId: string, memberId: string, courseId: string): MemberCourseProgress => ({
        id, tenantId, memberId, courseId, completedLessonIds: ['l1'], updatedAt: NOW,
      });
      store.rows.push(
        row('r-unrelated', 't1', 'mem1', 'c4'),
        row('r-other-member', 't1', 'mem2', 'c1'),
        row('r-elsewhere', 't2', 'mem1', 'c-elsewhere'),
      );
      const d = deps(
        store.repo, [activeGrant],
        [{ ...pCourse, accessItems: [c1WithoutM1, { level: 'course', courseId: 'c2' }] }],
        [c1, c2, c3, unrelated, elsewhere], [inThree],
      );

      expect(await unmarkLessonCompleted(ctx({}), 'l1', d, 'c4')).toMatchObject({ ok: true, value: { courseId: 'c2' } });
      expect(await unmarkLessonCompleted(ctx({}), 'l1', d, 'c-elsewhere')).toMatchObject({ ok: true, value: { courseId: 'c2' } });
      expect(await unmarkLessonCompleted(ctx({}), 'l1', d, 'c1')).toMatchObject({ ok: true, value: { courseId: 'c2' } });
      expect(store.rows.filter((r) => r.id.startsWith('r-')).map((r) => r.completedLessonIds)).toEqual([['l1'], ['l1'], ['l1']]);
    });

    it('stays forbidden when the viewed course is named but no course opens the lesson', async () => {
      const store = makeProgressStore();
      const d = threeDeps(store.repo, [c1WithoutM1]);
      expect(await markLessonCompleted(ctx({}), 'l1', d, 'c1')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(store.rows).toHaveLength(0);
    });
  });

  it('forbids completion when the only course item excludes the module', async () => {
    const store = makeProgressStore();
    const d = sharedDeps(store.repo, [{ level: 'course', courseId: 'c1', excludedModuleIds: ['m1'] }]);
    expect(await markLessonCompleted(ctx({}), 'l1', d)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store.rows).toHaveLength(0);
  });
});

describe('unmarkLessonCompleted', () => {
  it('removes a completed lesson and keeps the rest', async () => {
    const store = makeProgressStore();
    const d = deps(store.repo);
    await markLessonCompleted(ctx({}), 'l1', d);
    await markLessonCompleted(ctx({}), 'l2', d);
    const result = await unmarkLessonCompleted(ctx({}), 'l1', d);
    expect(result).toMatchObject({ ok: true, value: { completedLessonIds: ['l2'] } });
    expect(nn(store.rows[0]).completedLessonIds).toEqual(['l2']);
  });

  it('keeps lastViewed pointers untouched', async () => {
    const store = makeProgressStore();
    const d = deps(store.repo);
    await updateLastViewed(ctx({}), { courseId: 'c1', lessonId: 'l1', moduleId: 'm1' }, d);
    await markLessonCompleted(ctx({}), 'l1', d);
    const result = await unmarkLessonCompleted(ctx({}), 'l1', d);
    expect(result).toMatchObject({
      ok: true,
      value: { completedLessonIds: [], lastViewedLessonId: 'l1', lastViewedModuleId: 'm1' },
    });
  });

  it('is an idempotent no-op success when the lesson is not completed', async () => {
    const store = makeProgressStore();
    const result = await unmarkLessonCompleted(ctx({}), 'l1', deps(store.repo));
    expect(result).toMatchObject({ ok: true, value: { completedLessonIds: [] } });
  });

  it('forbids un-marking an inaccessible lesson', async () => {
    const store = makeProgressStore();
    const result = await unmarkLessonCompleted(ctx({}), 'l1', deps(store.repo, [], []));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store.rows).toHaveLength(0);
  });

  it('is not found for an unknown lesson', async () => {
    const store = makeProgressStore();
    const result = await unmarkLessonCompleted(ctx({}), 'nope', deps(store.repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('forbids non-members', async () => {
    const store = makeProgressStore();
    const result = await unmarkLessonCompleted(
      ctx({ memberId: null, staffRole: 'owner' }),
      'l1',
      deps(store.repo),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

const mem1: Member = {
  id: 'mem1',
  tenantId: 't1',
  userId: 'u-mem1',
  email: 'member@together.dev',
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
    dmOptOutAt: null,
};

const membersRepo = (rows: Member[]): MemberRepository => ({
  findById: async (tenantId, memberId) =>
    rows.find((r) => r.tenantId === tenantId && r.id === memberId) ?? null,
  findByEmail: async () => null,
  listWithProductIds: async () => [],
  create: async () => undefined,
  updateEmail: async () => null,
  updateLanguage: async () => null,
  updateVideoAutoplay: async () => null,
  updateDisplayName: async () => null,
  updateDmOptOut: async () => null,
setBanned: async () => null,
});

const resetDeps = (progress: MemberCourseProgressRepository): ResetMemberCourseProgressDeps => ({
  members: membersRepo([mem1]),
  courses: coursesRepo([c1]),
  progress,
  clock,
});

describe('resetMemberCourseProgress', () => {
  const staffCtx = ctx({ memberId: null, staffRole: 'admin' });

  it('clears completed lessons and lastViewed, reporting the cleared count', async () => {
    const store = makeProgressStore();
    const d = deps(store.repo);
    await updateLastViewed(ctx({}), { courseId: 'c1', lessonId: 'l2', moduleId: 'm1' }, d);
    await markLessonCompleted(ctx({}), 'l1', d);
    await markLessonCompleted(ctx({}), 'l2', d);

    const result = await resetMemberCourseProgress(
      staffCtx,
      { memberId: 'mem1', courseId: 'c1' },
      resetDeps(store.repo),
    );
    expect(result).toEqual({
      ok: true,
      value: { memberId: 'mem1', courseId: 'c1', clearedLessonCount: 2 },
    });
    const row = nn(store.rows[0]);
    expect(row.completedLessonIds).toEqual([]);
    expect(row.lastViewedLessonId).toBeUndefined();
    expect(row.lastViewedModuleId).toBeUndefined();
  });

  it('succeeds with zero cleared lessons when no progress row exists', async () => {
    const store = makeProgressStore();
    const result = await resetMemberCourseProgress(
      staffCtx,
      { memberId: 'mem1', courseId: 'c1' },
      resetDeps(store.repo),
    );
    expect(result).toEqual({
      ok: true,
      value: { memberId: 'mem1', courseId: 'c1', clearedLessonCount: 0 },
    });
    expect(store.rows).toHaveLength(0);
  });

  it('forbids non-staff', async () => {
    const store = makeProgressStore();
    const result = await resetMemberCourseProgress(
      ctx({}),
      { memberId: 'mem1', courseId: 'c1' },
      resetDeps(store.repo),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('is not found for an unknown member', async () => {
    const store = makeProgressStore();
    const result = await resetMemberCourseProgress(
      staffCtx,
      { memberId: 'ghost', courseId: 'c1' },
      resetDeps(store.repo),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects resetting progress for an erased member', async () => {
    const store = makeProgressStore();
    const result = await resetMemberCourseProgress(
      staffCtx,
      { memberId: 'mem1', courseId: 'c1' },
      {
        ...resetDeps(store.repo),
        members: membersRepo([{ ...mem1, deletedAt: '2026-07-14T10:00:00.000Z' }]),
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('is not found for an unknown course', async () => {
    const store = makeProgressStore();
    const result = await resetMemberCourseProgress(
      staffCtx,
      { memberId: 'mem1', courseId: 'ghost' },
      resetDeps(store.repo),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('updateLastViewed', () => {
  it('creates a progress row and sets the pointers', async () => {
    const store = makeProgressStore();
    const result = await updateLastViewed(
      ctx({}),
      { courseId: 'c1', lessonId: 'l1', moduleId: 'm1', chapterId: 'ch1' },
      deps(store.repo),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { lastViewedLessonId: 'l1', lastViewedModuleId: 'm1', lastViewedChapterId: 'ch1' },
    });
  });

  it('keeps previously-set pointers when a field is omitted', async () => {
    const store = makeProgressStore();
    const d = deps(store.repo);
    await updateLastViewed(ctx({}), { courseId: 'c1', lessonId: 'l1', moduleId: 'm1' }, d);
    const result = await updateLastViewed(ctx({}), { courseId: 'c1', lessonId: 'l2' }, d);
    expect(result).toMatchObject({
      ok: true,
      value: { lastViewedLessonId: 'l2', lastViewedModuleId: 'm1' },
    });
  });

  it('is not found for an unknown course', async () => {
    const store = makeProgressStore();
    const result = await updateLastViewed(ctx({}), { courseId: 'nope' }, deps(store.repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('getProgress', () => {
  it('returns an empty view when no row exists (no accidental create)', async () => {
    const store = makeProgressStore();
    const result = await getProgress(ctx({}), 'c1', { ...deps(store.repo), lessons: { list: async () => [] } });
    expect(result).toMatchObject({ ok: true, value: { courseId: 'c1', completedLessonIds: [], resume: { target: { id: 'l1', name: 'C L1' }, isReview: false } } });
    expect(store.rows).toHaveLength(0);
  });

  it('derives the resume response from recorded visits and completions', async () => {
    const store = makeProgressStore();
    const d = { ...deps(store.repo), lessons: { list: async () => [] } };
    await updateLastViewed(ctx({}), { courseId: 'c1', lessonId: 'l2' }, d);
    expect(await getProgress(ctx({}), 'c1', d)).toMatchObject({ ok: true, value: {
      resume: { target: { id: 'l2', name: 'C L2' }, firstIncomplete: { id: 'l1' }, isReview: false },
    } });
    await markLessonCompleted(ctx({}), 'l2', d);
    expect(await getProgress(ctx({}), 'c1', d)).toMatchObject({ ok: true, value: {
      resume: { target: { id: 'l1' }, isReview: false },
    } });
    await markLessonCompleted(ctx({}), 'l1', d);
    expect(await getProgress(ctx({}), 'c1', d)).toMatchObject({ ok: true, value: {
      resume: { target: { id: 'l2' }, firstIncomplete: null, isReview: true },
    } });
  });

  it('returns the stored progress', async () => {
    const store = makeProgressStore();
    await markLessonCompleted(ctx({}), 'l1', deps(store.repo));
    const result = await getProgress(ctx({}), 'c1', { ...deps(store.repo), lessons: { list: async () => [] } });
    expect(result).toMatchObject({ ok: true, value: { completedLessonIds: ['l1'] } });
  });
});

describe('progress isolation', () => {
  it('keeps progress separate between two members of one tenant', async () => {
    const store = makeProgressStore();
    await markLessonCompleted(ctx({ memberId: 'mem1' }), 'l1', deps(store.repo));

    const otherGrant: ProductGrant = { ...activeGrant, id: 'g2', memberId: 'mem2' };
    await markLessonCompleted(
      ctx({ memberId: 'mem2' }),
      'l2',
      deps(store.repo, [activeGrant, otherGrant]),
    );

    const a = await getProgress(ctx({ memberId: 'mem1' }), 'c1', { ...deps(store.repo), lessons: { list: async () => [] } });
    const b = await getProgress(ctx({ memberId: 'mem2' }), 'c1', { ...deps(store.repo), lessons: { list: async () => [] } });
    expect(a).toMatchObject({ ok: true, value: { completedLessonIds: ['l1'] } });
    expect(b).toMatchObject({ ok: true, value: { completedLessonIds: ['l2'] } });
  });

  it('keeps progress separate between two tenants for the same member id', async () => {
    const store = makeProgressStore();
    await markLessonCompleted(ctx({ tenantId: 't1' }), 'l1', deps(store.repo));

    const t2 = await getProgress(ctx({ tenantId: 't2' }), 'c1', { ...deps(store.repo), lessons: { list: async () => [] } });
    expect(t2).toMatchObject({ ok: true, value: { courseId: 'c1', completedLessonIds: [], resume: { target: null } } });
  });
});


describe('staff self progress', () => {
  it.each(['owner', 'admin'] as const)('resumes the last visited lesson for %s without a purchase grant', async (staffRole) => {
    const store = makeProgressStore();
    const dependencies = { ...deps(store.repo, [], []), lessons: { list: async () => [] } };
    const own = ctx({ staffRole });
    await updateLastViewed(own, { courseId: 'c1', lessonId: 'l2' }, dependencies);

    expect(await getProgress(own, 'c1', dependencies)).toMatchObject({
      ok: true,
      value: {
        resume: {
          target: { id: 'l2', name: 'C L2' },
          firstIncomplete: { id: 'l1', name: 'C L1' },
          isReview: false,
        },
      },
    });
  });

  it.each(['owner', 'admin'] as const)('lets %s complete and uncomplete an accessible staff lesson without a purchase grant', async (staffRole) => {
    const store = makeProgressStore();
    const dependencies = deps(store.repo, [], []);
    const own = ctx({ staffRole });
    expect(await markLessonCompleted(own, 'l1', dependencies)).toMatchObject({ ok: true, value: { memberId: own.identity.memberId, completedLessonIds: ['l1'] } });
    expect(await unmarkLessonCompleted(own, 'l1', dependencies)).toMatchObject({ ok: true, value: { memberId: own.identity.memberId, completedLessonIds: [] } });
    expect(await markLessonCompleted(own, 'missing', dependencies)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
