import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
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
        await db.insert(session).values({ id: `${userId}-${at}`, token: `${userId}-${at}`, userId, createdAt: new Date(at), expiresAt: new Date(to) });
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
      days: ['1998-08-01', '1998-08-02'].map((day) => ({ day, sessions: 2, distinctUsers: 2, progressUpdates: 1, distinctProgressMembers: 1, lessonCompletions: 1 })),
      totals: { membersTotal: 3, membersActive: 2 },
    });
  });
  it('splits at the pivot, excludes the upper boundary and isolates colliding tenant IDs', async () => {
    const report = await createActivityReportRepository(db).memberActivity('a', query);
    expect(report.members[0]).toEqual({ memberId: 'one', displayName: 'one', email: 'a-one@example.test', sessionsBefore: 1, sessionsAfter: 1, firstSession: from, lastSession: pivot, progressBefore: 1, progressAfter: 1, coursesTouched: 2, lessonsCompletedTotal: 2, lastProgress: pivot, completionsBefore: 1, completionsAfter: 1 });
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
  it('includes progress-only activity, excludes completion-only members and attributes shared sessions by membership', async () => {
    await db.insert(tenants).values({ id: 'edge', slug: 'edge', name: 'Workspace', createdAt: from });
    for (const id of ['shared', 'progress', 'completion']) {
      await db.insert(members).values({ id, tenantId: 'edge', userId: id === 'shared' ? 'a-one' : id, email: `${id}@example.test`, createdAt: from });
    }
    await db.insert(courses).values({ id: 'course', tenantId: 'edge', name: 'Course', description: '', createdAt: from });
    await db.insert(memberCourseProgress).values({ id: 'progress', tenantId: 'edge', memberId: 'progress', courseId: 'course', updatedAt: pivot });
    await db.insert(memberEvents).values({ id: 'completion', tenantId: 'edge', memberId: 'completion', type: 'lesson-completion', payload: { lessonId: 'lesson' }, occurredAt: from });
    const repository = createActivityReportRepository(db);
    const report = await repository.memberActivity('edge', query);
    expect(report.members.map((row) => row.memberId)).toEqual(['progress', 'shared']);
    expect(report.members[0]).toMatchObject({ firstSession: null, lastSession: null, sessionsBefore: 0, sessionsAfter: 0, progressBefore: 0, progressAfter: 1 });
    expect((await repository.activitySummary('edge', query)).totals).toEqual({ membersTotal: 3, membersActive: 2 });
  });
  it('sanitizes infrastructure errors before exception telemetry can see email filters', async () => {
    const execute = vi.spyOn(db, 'execute').mockRejectedValueOnce(new Error('Bound params: private@example.test'));
    try {
      await expect(createActivityReportRepository(db).memberActivity('a', { ...query, excludeEmailPatterns: 'private@example.test' })).rejects.toThrow('Activity report database query failed');
    } finally {
      execute.mockRestore();
    }
  });
  it('checks the session join plan against the existing user index', async () => {
    await db.execute(sql`insert into "user" (id, name, email) select 'plan-' || n, 'Plan', 'plan-' || n || '@example.test' from generate_series(1, 10000) n`);
    await db.execute(sql`insert into session (id, token, user_id, created_at, updated_at, expires_at) select id, id, id, now(), now(), now() from "user" where id like 'plan-%'`);
    await db.execute(sql`analyze session`);
    await db.execute(sql`analyze members`);
    const result = await db.execute(sql`explain (analyze, buffers, format text) select s.id from members m join session s on s.user_id = m.user_id where m.tenant_id = 'a' and s.created_at >= ${from}::timestamp and s.created_at < ${to}::timestamp`);
    const plan = JSON.stringify(result);
    expect(plan).toContain('session_userId_idx');
  });
});
