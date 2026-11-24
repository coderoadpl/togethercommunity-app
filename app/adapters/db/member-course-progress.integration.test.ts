import { and, eq, inArray } from 'drizzle-orm';
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
const OTHER_TENANT = 'other-workspace';

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
let clockTick = 0;
const nextInstant = () => new Date(Date.parse(NOW) + ++clockTick * 1000).toISOString();
const deps = (): ProgressDeps => {
  const now = nextInstant();
  return {
    grants: createProductGrantRepository(database.db),
    courses: createCourseRepository(database.db),
    modules: createCourseModuleRepository(database.db),
    progress: createMemberCourseProgressRepository(database.db),
    ids: { nextId: () => `${PROGRESS}-${++idCounter}` },
    clock: { nowIso: () => now },
  };
};

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

const insertProgress = (completedLessonIds: string[] = []) => database.db.insert(memberCourseProgress).values({
  id: PROGRESS, tenantId: TENANT, memberId: MEMBER, courseId: COURSE, completedLessonIds, updatedAt: NOW,
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

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

const settle = <T>(write: Promise<T>): Promise<Settled<T>> => write.then(
  (value) => ({ ok: true as const, value }),
  (error: unknown) => ({ ok: false as const, error }),
);

const overlapOnLockedRow = async <T>(writes: Array<() => Promise<T>>): Promise<T[]> => {
  const holder = new pg.Client({ connectionString: database.url });
  await holder.connect();
  const pending: Array<Promise<Settled<T>>> = [];
  let settled: Array<Settled<T>> = [];
  try {
    await holder.query('begin');
    await holder.query('select id from member_course_progress where tenant_id = $1 and id = $2 for update', [TENANT, PROGRESS]);
    for (const write of writes) {
      pending.push(settle(write()));
      await waitForLockWaiters(pending.length);
    }
  } finally {
    await holder.query('commit');
    await holder.end();
    settled = await Promise.all(pending);
  }
  return settled.map((outcome) => {
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  });
};

const completedIn = (result: Result<MemberCourseProgress, AppError>) => (
  result.ok ? [...result.value.completedLessonIds].sort() : result
);

beforeAll(async () => {
  database = await createTestDatabase('together_member_course_progress', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: TENANT, slug: TENANT, name: 'Workspace', createdAt: NOW });
  await database.db.insert(user).values({ id: 'learner', email: 'learner@example.org', name: 'Learner' });
  await database.db.insert(members).values({ id: MEMBER, tenantId: TENANT, userId: 'learner', email: 'learner@example.org', createdAt: NOW });
  await database.db.insert(courses).values({ id: COURSE, tenantId: TENANT, name: 'Course', description: '', moduleOrder: ['module'], createdAt: NOW });
  await database.db.insert(tenants).values({ id: OTHER_TENANT, slug: OTHER_TENANT, name: 'Other workspace', createdAt: NOW });
  await database.db.insert(members).values({ id: MEMBER, tenantId: OTHER_TENANT, userId: 'learner', email: 'learner@example.org', createdAt: NOW });
  await database.db.insert(courses).values({ id: COURSE, tenantId: OTHER_TENANT, name: 'Course', description: '', moduleOrder: [], createdAt: NOW });
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
  await database.db.delete(memberEvents).where(inArray(memberEvents.tenantId, [TENANT, OTHER_TENANT]));
  await database.db.delete(memberCourseProgress).where(inArray(memberCourseProgress.tenantId, [TENANT, OTHER_TENANT]));
});

it('keeps both completions when two completions of one member overlap on the same progress row', async () => {
  await insertProgress();
  const results = await overlapOnLockedRow([
    () => markLessonCompleted(ctx, 'lesson-1', deps()),
    () => markLessonCompleted(ctx, 'lesson-2', deps()),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect([...(await storedProgress())?.completedLessonIds ?? []].sort()).toEqual(['lesson-1', 'lesson-2']);
  expect(await completionEvents()).toHaveLength(2);
}, 60_000);

it('keeps the completion and the last-viewed pointer when they overlap on the same progress row', async () => {
  await insertProgress();
  const results = await overlapOnLockedRow<Result<MemberCourseProgress, AppError>>([
    () => markLessonCompleted(ctx, 'lesson-1', deps()),
    () => updateLastViewed(ctx, { courseId: COURSE, lessonId: 'lesson-2', moduleId: 'module' }, deps()),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(await storedProgress()).toMatchObject({
    completedLessonIds: ['lesson-1'],
    lastViewedLessonId: 'lesson-2',
    lastViewedModuleId: 'module',
  });
}, 60_000);

it('records one completion event when the same lesson is completed twice at once', async () => {
  await insertProgress();
  const results = await overlapOnLockedRow([
    () => markLessonCompleted(ctx, 'lesson-1', deps()),
    () => markLessonCompleted(ctx, 'lesson-1', deps()),
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

it('records the completion event of a lesson with a very long id', async () => {
  const longLessonId = 'l'.repeat(1000);

  const stored = await createMemberCourseProgressRepository(database.db).addCompletedLesson(TENANT, {
    memberId: MEMBER, courseId: COURSE, id: 'long-lesson-request', lessonId: longLessonId, now: nextInstant(),
  });

  expect(stored.completedLessonIds).toEqual([longLessonId]);
  expect(await completionEvents()).toEqual([{ courseId: COURSE, lessonId: longLessonId }]);
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

const sameInstant = (): ProgressDeps => ({ ...deps(), clock: { nowIso: () => NOW } });

it('records a completion event for each completion transition that shares one clock reading', async () => {
  await markLessonCompleted(ctx, 'lesson-1', sameInstant());
  await unmarkLessonCompleted(ctx, 'lesson-1', sameInstant());
  await markLessonCompleted(ctx, 'lesson-1', sameInstant());
  await markLessonCompleted(ctx, 'lesson-1', sameInstant());

  expect((await storedProgress())?.completedLessonIds).toEqual(['lesson-1']);
  expect(await completionEvents()).toEqual([
    { courseId: COURSE, lessonId: 'lesson-1' },
    { courseId: COURSE, lessonId: 'lesson-1' },
  ]);
}, 60_000);

it('records a repeated completion that shares one clock reading once', async () => {
  await markLessonCompleted(ctx, 'lesson-1', sameInstant());
  await markLessonCompleted(ctx, 'lesson-1', sameInstant());

  expect(await completionEvents()).toHaveLength(1);
}, 60_000);

const mark = () => markLessonCompleted(ctx, 'lesson-1', deps());
const unmark = () => unmarkLessonCompleted(ctx, 'lesson-1', deps());

it.each([
  { initial: [], order: 'mark then unmark', writes: [mark, unmark], responses: [['lesson-1'], []], stored: [], events: 1 },
  { initial: [], order: 'unmark then mark', writes: [unmark, mark], responses: [[], ['lesson-1']], stored: ['lesson-1'], events: 1 },
  { initial: ['lesson-1'], order: 'mark then unmark', writes: [mark, unmark], responses: [['lesson-1'], []], stored: [], events: 0 },
  { initial: ['lesson-1'], order: 'unmark then mark', writes: [unmark, mark], responses: [[], ['lesson-1']], stored: ['lesson-1'], events: 1 },
])('answers overlapping $order from $initial as if they ran one after the other', async ({ initial, writes, responses, stored, events }) => {
  await insertProgress(initial);

  const results = await overlapOnLockedRow(writes);

  expect(results.map(completedIn)).toEqual(responses);
  expect((await storedProgress())?.completedLessonIds).toEqual(stored);
  expect(await completionEvents()).toHaveLength(events);
}, 60_000);

it('changes only the calling tenant when another tenant has the same member and course ids', async () => {
  const progress = createMemberCourseProgressRepository(database.db);
  const otherRow = {
    id: PROGRESS,
    tenantId: OTHER_TENANT,
    memberId: MEMBER,
    courseId: COURSE,
    completedLessonIds: ['lesson-1'],
    lastViewedLessonId: 'lesson-1',
    lastViewedModuleId: 'module',
    lastViewedChapterId: 'chapter',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  await database.db.insert(memberCourseProgress).values(otherRow);
  await database.db.insert(memberEvents).values({
    id: 'other-completion',
    tenantId: OTHER_TENANT,
    memberId: MEMBER,
    type: 'lesson-completion',
    payload: { courseId: COURSE, lessonId: 'lesson-1' },
    occurredAt: otherRow.updatedAt,
  });
  const otherEvents = () => database.db
    .select({ id: memberEvents.id, payload: memberEvents.payload, occurredAt: memberEvents.occurredAt })
    .from(memberEvents)
    .where(eq(memberEvents.tenantId, OTHER_TENANT));
  const otherProgress = () => database.db
    .select()
    .from(memberCourseProgress)
    .where(eq(memberCourseProgress.tenantId, OTHER_TENANT));
  const eventsBefore = await otherEvents();
  const pair = { memberId: MEMBER, courseId: COURSE };

  expect(await progress.removeCompletedLesson(TENANT, { ...pair, lessonId: 'lesson-1', now: nextInstant() })).toBeNull();
  expect(await storedProgress()).toBeUndefined();
  expect(await completionEvents()).toEqual([]);

  await progress.addCompletedLesson(TENANT, { ...pair, id: PROGRESS, lessonId: 'lesson-2', now: nextInstant() });
  await progress.setLastViewed(TENANT, { ...pair, id: 'own-pointer', lessonId: 'lesson-2', moduleId: 'module', chapterId: 'chapter', now: nextInstant() });
  await progress.removeCompletedLesson(TENANT, { ...pair, lessonId: 'lesson-2', now: nextInstant() });

  expect(await otherProgress()).toEqual([otherRow]);
  expect(await otherEvents()).toEqual(eventsBefore);
  expect(await storedProgress()).toMatchObject({ completedLessonIds: [], lastViewedLessonId: 'lesson-2' });
}, 60_000);
