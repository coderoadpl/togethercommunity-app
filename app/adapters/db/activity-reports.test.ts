import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { memberActivityQuerySchema } from '#core/domain/index.js';
import type { Db } from './client.js';
import { createTestDatabase } from './test-database-name.js';
import { createActivityReportRepository } from './activity-reports.js';
import { courses, memberCourseProgress, memberEvents, members, session, tenants, user } from './schema.js';

let db: Db;
let close: (() => Promise<void>) | undefined;
const from = '1998-08-01T00:00:00.000Z';
const pivot = '1998-08-02T00:00:00.000Z';
const to = '1998-08-03T00:00:00.000Z';
const query = memberActivityQuerySchema.parse({ from, to, pivot });

beforeAll(async () => {
  const database = await createTestDatabase('together_activity_reports_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  db = database.db;
  close = database.close;
  for (const tenantId of ['a', 'b']) {
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: from });
    for (const id of ['one', 'two', 'inactive']) {
      const userId = `${tenantId}-${id}`;
      await db.insert(user).values({ id: userId, email: `${userId}@example.test`, name: id });
      await db.insert(members).values({ id, tenantId, userId, email: `${userId}@example.test`, displayName: id, createdAt: from });
      if (id === 'inactive') continue;
      for (const at of [from, pivot, to]) {
        await db.insert(memberEvents).values({ id: `sign-in-${id}-${at}`, tenantId, memberId: id, type: 'sign-in', payload: {}, occurredAt: at });
      }
    }
    for (const [index, at] of [from, pivot, to].entries()) {
      const courseId = `course-${index}`;
      await db.insert(courses).values({ id: courseId, tenantId, name: 'Course', description: '', createdAt: from });
      await db.insert(memberCourseProgress).values({ id: courseId, tenantId, memberId: 'one', courseId, updatedAt: at });
      await db.insert(memberEvents).values({ id: `completion-${index}`, tenantId, memberId: 'one', type: 'lesson-completion', payload: { lessonId: `lesson-${index}` }, occurredAt: at });
    }
  }
});
afterAll(async () => { await close?.(); });

describe('activity report repository', () => {
  it('aggregates by UTC day without multiplying joined records', async () => {
    expect(await createActivityReportRepository(db).activitySummary('a', query)).toEqual({
      days: ['1998-08-01', '1998-08-02'].map((day) => ({ day, signIns: 2, distinctSignInMembers: 2, progressUpdates: 1, distinctProgressMembers: 1, lessonCompletions: 1 })),
      totals: { membersTotal: 3, membersActive: 2 },
    });
  });
  it('splits at the pivot, excludes the upper boundary and isolates colliding tenant IDs', async () => {
    const report = await createActivityReportRepository(db).memberActivity('a', query);
    expect(report.members[0]).toEqual({ memberId: 'one', displayName: 'one', email: 'a-one@example.test', signInsBefore: 1, signInsAfter: 1, firstSignIn: from, lastSignIn: pivot, progressBefore: 1, progressAfter: 1, coursesTouched: 2, lessonsCompletedTotal: 2, lastProgress: pivot, completionsBefore: 1, completionsAfter: 1 });
    expect(report.members.map((row) => row.email)).toEqual(['a-one@example.test', 'a-two@example.test']);
    expect((await createActivityReportRepository(db).memberActivity('b', query)).members[0]?.email).toBe('b-one@example.test');
  });
  it('paginates and applies parameterized case-insensitive SQL patterns', async () => {
    const repository = createActivityReportRepository(db);
    const first = await repository.memberActivity('a', { ...query, limit: 1 });
    expect(first.nextCursor).toBe('one');
    const second = await repository.memberActivity('a', { ...query, cursor: first.nextCursor ?? '', limit: 1 });
    expect(second.members.map((row) => row.memberId)).toEqual(['two']);
    expect(second.nextCursor).toBeNull();
    expect((await repository.memberActivity('a', { ...query, excludeEmailPatterns: 'A-ONE@%,unused%' })).members.map((row) => row.memberId)).toEqual(['two']);
    expect((await repository.memberActivity('a', { ...query, excludeEmailPatterns: "' OR true --" })).members).toHaveLength(2);
    expect(await repository.activitySummary('missing', query)).toEqual({ days: [], totals: { membersTotal: 0, membersActive: 0 } });
  });
  it('excludes another tenant sign-in for a shared user with colliding member IDs', async () => {
    await db.insert(tenants).values({ id: 'shared', slug: 'shared', name: 'Workspace', createdAt: from });
    await db.insert(members).values({ id: 'one', tenantId: 'shared', userId: 'a-one', email: 'shared@example.test', createdAt: from });
    const repository = createActivityReportRepository(db);
    expect(await repository.memberActivity('shared', query)).toEqual({ members: [], nextCursor: null });
    expect(await repository.activitySummary('shared', query)).toEqual({ days: [], totals: { membersTotal: 1, membersActive: 0 } });
    await db.insert(memberEvents).values({ id: 'local-sign-in', tenantId: 'shared', memberId: 'one', type: 'sign-in', payload: {}, occurredAt: pivot });
    expect((await repository.memberActivity('shared', query)).members[0]).toMatchObject({ signInsBefore: 0, signInsAfter: 1, firstSignIn: pivot, lastSignIn: pivot });
    expect((await repository.activitySummary('shared', query)).days).toEqual([{ day: '1998-08-02', signIns: 1, distinctSignInMembers: 1, progressUpdates: 0, distinctProgressMembers: 0, lessonCompletions: 0 }]);
  });
  it('retains sign-in counts after session deletion and ignores global sessions', async () => {
    const repository = createActivityReportRepository(db);
    const before = await repository.memberActivity('a', query);
    await db.insert(session).values({ id: 'global-session', token: 'global-session', userId: 'a-inactive', createdAt: new Date(pivot), expiresAt: new Date(to) });
    expect(await repository.memberActivity('a', query)).toEqual(before);
    await db.delete(session).where(eq(session.id, 'global-session'));
    expect(await repository.memberActivity('a', query)).toEqual(before);
  });
  it('includes progress-only activity and excludes completion-only members', async () => {
    await db.insert(tenants).values({ id: 'edge', slug: 'edge', name: 'Workspace', createdAt: from });
    for (const id of ['progress', 'completion']) {
      await db.insert(members).values({ id, tenantId: 'edge', userId: id, email: `${id}@example.test`, createdAt: from });
    }
    await db.insert(courses).values({ id: 'course', tenantId: 'edge', name: 'Course', description: '', createdAt: from });
    await db.insert(memberCourseProgress).values({ id: 'progress', tenantId: 'edge', memberId: 'progress', courseId: 'course', updatedAt: pivot });
    await db.insert(memberEvents).values({ id: 'completion', tenantId: 'edge', memberId: 'completion', type: 'lesson-completion', payload: { lessonId: 'lesson' }, occurredAt: from });
    const repository = createActivityReportRepository(db);
    const report = await repository.memberActivity('edge', query);
    expect(report.members.map((row) => row.memberId)).toEqual(['progress']);
    expect(report.members[0]).toMatchObject({ firstSignIn: null, lastSignIn: null, signInsBefore: 0, signInsAfter: 0, progressBefore: 0, progressAfter: 1 });
    expect((await repository.activitySummary('edge', query)).totals).toEqual({ membersTotal: 2, membersActive: 1 });
  });
  it('sanitizes infrastructure errors before exception telemetry can see email filters', async () => {
    const original = new Error('Bound params: private@example.test', { cause: { code: '57014', message: 'private@example.test' } });
    const execute = vi.spyOn(db, 'execute').mockRejectedValueOnce(original);
    try {
      await expect(createActivityReportRepository(db).memberActivity('a', { ...query, excludeEmailPatterns: 'private@example.test' })).rejects.toMatchObject({
        message: 'Activity report database query failed',
        cause: new Error('PostgreSQL SQLSTATE 57014'),
      });
    } finally {
      execute.mockRestore();
    }
  });
});
