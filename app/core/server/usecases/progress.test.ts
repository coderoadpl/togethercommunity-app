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
  published: true,
  accessItems: [{ level: 'course', courseId: 'c1' }],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const activeGrant: ProductGrant = {
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

const makeProgressStore = (): { repo: MemberCourseProgressRepository; rows: MemberCourseProgress[] } => {
  const rows: MemberCourseProgress[] = [];
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
      const idx = rows.findIndex((r) => r.tenantId === tenantId && r.id === progress.id);
      if (idx < 0) return null;
      rows[idx] = progress;
      return progress;
    },
    countReferencingLesson: async (tenantId, lessonId) =>
      rows.filter(
        (r) =>
          r.tenantId === tenantId &&
          (r.completedLessonIds.includes(lessonId) || r.lastViewedLessonId === lessonId),
      ).length,
  };
  return { repo, rows };
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
    const result = await getProgress(ctx({}), 'c1', { progress: store.repo });
    expect(result).toEqual({ ok: true, value: { courseId: 'c1', completedLessonIds: [] } });
    expect(store.rows).toHaveLength(0);
  });

  it('returns the stored progress', async () => {
    const store = makeProgressStore();
    await markLessonCompleted(ctx({}), 'l1', deps(store.repo));
    const result = await getProgress(ctx({}), 'c1', { progress: store.repo });
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

    const a = await getProgress(ctx({ memberId: 'mem1' }), 'c1', { progress: store.repo });
    const b = await getProgress(ctx({ memberId: 'mem2' }), 'c1', { progress: store.repo });
    expect(a).toMatchObject({ ok: true, value: { completedLessonIds: ['l1'] } });
    expect(b).toMatchObject({ ok: true, value: { completedLessonIds: ['l2'] } });
  });

  it('keeps progress separate between two tenants for the same member id', async () => {
    const store = makeProgressStore();
    await markLessonCompleted(ctx({ tenantId: 't1' }), 'l1', deps(store.repo));

    const t2 = await getProgress(ctx({ tenantId: 't2' }), 'c1', { progress: store.repo });
    expect(t2).toEqual({ ok: true, value: { courseId: 'c1', completedLessonIds: [] } });
  });
});
