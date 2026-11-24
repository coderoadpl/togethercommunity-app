import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  type AppError,
  type Identity,
  type MemberCourseProgress,
  type Result,
} from '#core/domain/index.js';
import type { Ctx } from '#core/server/context.js';
import {
  markLessonCompleted,
  unmarkLessonCompleted,
  updateLastViewed,
  type ProgressDeps,
} from '#core/server/usecases/progress.js';

import {
  createCourseModuleRepository,
  createCourseRepository,
  createMemberCourseProgressRepository,
  createProductGrantRepository,
} from './repositories.js';
import { courses, memberCourseProgress, memberEvents, members, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-11-20T10:00:00.000Z';
const TENANT = 'workspace';
const MEMBER = 'member';
const COURSE = 'course';
const PROGRESS = 'progress';

let database: Awaited<ReturnType<typeof createTestDatabase>>;

const identity: Identity = {
  userId: 'learner',
  email: 'learner@example.org',
  name: 'Learner',
  emailVerified: true,
  tenantAccess: 'staff',
  tenantId: TENANT,
  tenantSlug: TENANT,
  tenantName: 'Workspace',
  staffRole: 'owner',
  memberId: MEMBER,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
};
const ctx: Ctx = { identity };

let idCounter = 0;
const deps = (): ProgressDeps => ({
  grants: createProductGrantRepository(database.db),
  courses: createCourseRepository(database.db),
  modules: createCourseModuleRepository(database.db),
  progress: createMemberCourseProgressRepository(database.db),
  ids: { nextId: () => `${PROGRESS}-${++idCounter}` },
  clock: { nowIso: () => NOW },
});

const storedProgress = async () => {
  const [row] = await database.db
    .select()
    .from(memberCourseProgress)
    .where(and(eq(memberCourseProgress.tenantId, TENANT), eq(memberCourseProgress.memberId, MEMBER)));
  return row;
};

const completionEvents = async () => {
  const rows = await database.db
    .select({ payload: memberEvents.payload })
    .from(memberEvents)
    .where(and(eq(memberEvents.tenantId, TENANT), eq(memberEvents.type, 'lesson-completion')));
  return rows.map((row) => row.payload);
};

const insertEmptyProgress = () => database.db.insert(memberCourseProgress).values({
  id: PROGRESS, tenantId: TENANT, memberId: MEMBER, courseId: COURSE, completedLessonIds: [], updatedAt: NOW,
});

const countLockWaiters = async (): Promise<number> => {
  const observer = new pg.Client({ connectionString: database.url });
  await observer.connect();
  try {
    const result = await observer.query<{ waiting: number }>(
      "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
    );
    return result.rows[0]?.waiting ?? 0;
  } finally {
    await observer.end();
  }
};

const waitForLockWaiters = async (count: number): Promise<void> => {
  const deadline = Date.now() + 20_000;
  while (await countLockWaiters() < count) {
    if (Date.now() > deadline) throw new Error(`Expected ${count} writers blocked on the progress row`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const overlapOnLockedRow = async <T>(writes: () => Promise<T>[]): Promise<T[]> => {
  const holder = new pg.Client({ connectionString: database.url });
  await holder.connect();
  let pending: Promise<T>[] = [];
  try {
    await holder.query('begin');
    await holder.query('select id from member_course_progress where tenant_id = $1 and id = $2 for update', [TENANT, PROGRESS]);
    pending = writes();
    await waitForLockWaiters(pending.length);
  } finally {
    await holder.query('commit');
    await holder.end();
  }
  return Promise.all(pending);
};

beforeAll(async () => {
  database = await createTestDatabase('together_member_course_progress', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: TENANT, slug: TENANT, name: 'Workspace', createdAt: NOW });
  await database.db.insert(user).values({ id: 'learner', email: 'learner@example.org', name: 'Learner' });
  await database.db.insert(members).values({ id: MEMBER, tenantId: TENANT, userId: 'learner', email: 'learner@example.org', createdAt: NOW });
  await database.db.insert(courses).values({ id: COURSE, tenantId: TENANT, name: 'Course', description: '', moduleOrder: ['module'], createdAt: NOW });
  await createCourseModuleRepository(database.db).create(TENANT, {
    id: 'module',
    tenantId: TENANT,
    courseIds: [COURSE],
    title: 'Module',
    prefix: null,
    name: computeCourseModuleName(null, 'Module'),
    chapters: [{
      id: 'chapter',
      name: 'Chapter',
      contents: [
        { id: 'content-1', name: 'Lesson 1', lessonId: 'lesson-1' },
        { id: 'content-2', name: 'Lesson 2', lessonId: 'lesson-2' },
      ],
    }],
    legacyId: null,
    createdAt: NOW,
  });
}, 60_000);

afterAll(async () => { await database?.close(); });

beforeEach(async () => {
  await database.db.delete(memberEvents).where(eq(memberEvents.tenantId, TENANT));
  await database.db.delete(memberCourseProgress).where(eq(memberCourseProgress.tenantId, TENANT));
});

it('keeps both completions when two completions of one member overlap on the same progress row', async () => {
  await insertEmptyProgress();
  const results = await overlapOnLockedRow(() => [
    markLessonCompleted(ctx, 'lesson-1', deps()),
    markLessonCompleted(ctx, 'lesson-2', deps()),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect([...(await storedProgress())?.completedLessonIds ?? []].sort()).toEqual(['lesson-1', 'lesson-2']);
  expect(await completionEvents()).toHaveLength(2);
}, 60_000);

it('keeps the completion and the last-viewed pointer when they overlap on the same progress row', async () => {
  await insertEmptyProgress();
  const results = await overlapOnLockedRow<Result<MemberCourseProgress, AppError>>(() => [
    markLessonCompleted(ctx, 'lesson-1', deps()),
    updateLastViewed(ctx, { courseId: COURSE, lessonId: 'lesson-2', moduleId: 'module' }, deps()),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(await storedProgress()).toMatchObject({
    completedLessonIds: ['lesson-1'],
    lastViewedLessonId: 'lesson-2',
    lastViewedModuleId: 'module',
  });
}, 60_000);

it('records one completion event when the same lesson is completed twice at once', async () => {
  await insertEmptyProgress();
  const results = await overlapOnLockedRow(() => [
    markLessonCompleted(ctx, 'lesson-1', deps()),
    markLessonCompleted(ctx, 'lesson-1', deps()),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect((await storedProgress())?.completedLessonIds).toEqual(['lesson-1']);
  expect(await completionEvents()).toHaveLength(1);
}, 60_000);

it('records a repeated completion once, with a single completion event', async () => {
  const first = await markLessonCompleted(ctx, 'lesson-1', deps());
  const repeated = await markLessonCompleted(ctx, 'lesson-1', deps());

  expect(first).toMatchObject({ ok: true, value: { completedLessonIds: ['lesson-1'] } });
  expect(repeated).toMatchObject({ ok: true, value: { completedLessonIds: ['lesson-1'] } });
  expect((await storedProgress())?.completedLessonIds).toEqual(['lesson-1']);
  expect(await completionEvents()).toEqual([{ courseId: COURSE, lessonId: 'lesson-1' }]);
}, 60_000);

it('removes only the un-completed lesson and keeps the pointers', async () => {
  await updateLastViewed(ctx, { courseId: COURSE, lessonId: 'lesson-1', moduleId: 'module' }, deps());
  await markLessonCompleted(ctx, 'lesson-1', deps());
  await markLessonCompleted(ctx, 'lesson-2', deps());

  const removed = await unmarkLessonCompleted(ctx, 'lesson-1', deps());
  const repeated = await unmarkLessonCompleted(ctx, 'lesson-1', deps());

  expect(removed).toMatchObject({ ok: true, value: { completedLessonIds: ['lesson-2'] } });
  expect(repeated).toMatchObject({ ok: true, value: { completedLessonIds: ['lesson-2'] } });
  expect(await storedProgress()).toMatchObject({
    completedLessonIds: ['lesson-2'],
    lastViewedLessonId: 'lesson-1',
    lastViewedModuleId: 'module',
  });
}, 60_000);

it('leaves no progress row behind when un-completing without any progress', async () => {
  const result = await unmarkLessonCompleted(ctx, 'lesson-1', deps());

  expect(result).toMatchObject({ ok: true, value: { courseId: COURSE, completedLessonIds: [] } });
  expect(await storedProgress()).toBeUndefined();
}, 60_000);

it('moves only the given last-viewed pointers and keeps completions', async () => {
  await markLessonCompleted(ctx, 'lesson-1', deps());
  await updateLastViewed(ctx, { courseId: COURSE, lessonId: 'lesson-1', moduleId: 'module', chapterId: 'chapter' }, deps());

  const result = await updateLastViewed(ctx, { courseId: COURSE, lessonId: 'lesson-2' }, deps());

  expect(result).toMatchObject({ ok: true, value: { lastViewedLessonId: 'lesson-2' } });
  expect(await storedProgress()).toMatchObject({
    completedLessonIds: ['lesson-1'],
    lastViewedLessonId: 'lesson-2',
    lastViewedModuleId: 'module',
    lastViewedChapterId: 'chapter',
  });
  expect(await completionEvents()).toHaveLength(1);
}, 60_000);
