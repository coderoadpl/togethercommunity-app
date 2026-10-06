import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { surveySchema, memberTombstone, DELETED_MEMBER_DISPLAY } from '#core/domain/index.js';
import type { Db } from './client.js';
import { members, tenants, user, surveyEvents, surveyResponses } from './schema.js';
import { createTestDatabase } from './test-database-name.js';
import { createSurveyRepository } from './surveys.js';
import { createMemberErasureRepository } from './repositories.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-01-01T00:00:00.000Z';
const survey = surveySchema.parse({ id: 'survey', tenantId: 'tenant', title: 'Feedback', question: 'How was your experience?', type: 'nps', slug: 'feedback', active: true, commentEnabled: true, commentPrompt: 'Anything else?', endings: [{ min: 0, max: 6, body: 'Low' }, { min: 7, max: 8, body: 'Middle' }, { min: 9, max: 10, body: 'High' }], token: 'token', revision: 1, createdAt: now, updatedAt: now });
const answer = (id: string, memberId: string | null, score = 8) => ({ id, tenantId: 'tenant', surveyId: 'survey', memberId, score, comment: 'Feedback', createdAt: now, updatedAt: now });
describe('survey persistence', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_surveys', baseDatabaseUrl));
    await db.insert(tenants).values([{ id: 'tenant', slug: 'workspace', name: 'Workspace', createdAt: now }, { id: 'other', slug: 'other', name: 'Other workspace', createdAt: now }]);
    await db.insert(user).values([{ id: 'user', email: 'member@example.org', name: 'Member' }, { id: 'erase-user', email: 'erase@example.org', name: 'Erase' }]);
    await db.insert(members).values([{ id: 'member', tenantId: 'tenant', userId: 'user', email: 'member@example.org', displayName: 'Member', createdAt: now }, { id: 'erase-member', tenantId: 'tenant', userId: 'erase-user', email: 'erase@example.org', displayName: 'Erase', createdAt: now }]);
    expect(await createSurveyRepository(db).save('tenant', survey, null)).toMatchObject({ ok: true });
  });
  afterAll(async () => { await close(); });
  it('allows anonymous duplicates while concurrent member submits atomically replace one current response', async () => {
    const repo = createSurveyRepository(db);
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => repo.submit('tenant', survey, answer(`member-answer-${index}`, 'member', index))));
    expect(results.every((result) => result.ok)).toBe(true);
    const anonymous = await Promise.all(['anonymous-1', 'anonymous-2'].map((id) => repo.submit('tenant', survey, answer(id, null))));
    expect(anonymous.every((result) => result.ok)).toBe(true);
    const rows = await repo.responses('tenant', 'survey', 0, 20);
    expect(rows.filter((row) => row.memberId === 'member')).toHaveLength(1);
    expect(rows.filter((row) => row.memberId === null)).toHaveLength(2);
    expect(rows.find((row) => row.memberId === 'member')?.memberName).toBe('Member');
    expect((await repo.distribution('tenant', 'survey')).reduce((sum, row) => sum + row.count, 0)).toBe(3);
  });
  it('exports all responses beyond the results page size with stable identity and member names', async () => {
    const repo = createSurveyRepository(db);
    const exportSurvey = { ...survey, id: 'export-survey', slug: 'export-feedback' };
    expect(await repo.save('tenant', exportSurvey, null)).toMatchObject({ ok: true });
    await db.insert(surveyResponses).values(Array.from({ length: 1001 }, (_, index) => ({ ...answer(`export-${index}`, index === 0 ? 'member' : null), surveyId: exportSurvey.id })));
    const snapshot = await repo.exportResponses('tenant', exportSurvey.id);
    expect(snapshot).toHaveLength(1001);
    expect(new Set(snapshot.map((row) => row.id)).size).toBe(1001);
    expect(snapshot.find((row) => row.memberId === 'member')?.memberName).toBe('Member');
    expect(await repo.exportResponses('other', exportSurvey.id)).toEqual([]);
    expect(await repo.delete('tenant', exportSurvey.id)).toBe(true);
  });
  it('isolates tenant reads, updates, submits, deletes and slug uniqueness', async () => {
    const repo = createSurveyRepository(db);
    expect(await repo.findById('other', 'survey')).toBeNull();
    expect(await repo.findBySlug('other', 'feedback')).toBeNull();
    expect(await repo.responses('other', 'survey', 0, 20)).toEqual([]);
    expect(await repo.exportResponses('other', 'survey')).toEqual([]);
    expect(await repo.delete('other', 'survey')).toBe(false);
    expect(await repo.submit('other', survey, answer('foreign', null))).toMatchObject({ ok: false });
    expect(await repo.save('other', { ...survey, id: 'other-survey', tenantId: 'other' }, null)).toMatchObject({ ok: true });
    expect(await repo.save('tenant', { ...survey, id: 'duplicate' }, null)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
  it('serializes member erasure with submits and never recreates erased responses', async () => {
    const repo = createSurveyRepository(db);
    expect(await repo.submit('tenant', survey, answer('erase-existing', 'erase-member'))).toMatchObject({ ok: true });
    const tombstone = memberTombstone('erase-member');
    await Promise.all([
      repo.submit('tenant', survey, answer('erase-racing', 'erase-member')),
      createMemberErasureRepository(db, { compute: (_, value) => value }).pseudonymize('tenant', { memberId: 'erase-member', deletedAt: now, tombstoneEmail: tombstone.email, severedUserId: tombstone.userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY }),
    ]);
    expect(await db.select().from(surveyResponses).where(and(eq(surveyResponses.tenantId, 'tenant'), eq(surveyResponses.memberId, 'erase-member')))).toEqual([]);
    expect(await repo.submit('tenant', survey, answer('erase-later', 'erase-member'))).toMatchObject({ ok: false });
  });
  it('rejects stale and deactivated submits and atomically records lifecycle snapshots', async () => {
    const repo = createSurveyRepository(db);
    expect(await repo.save('tenant', { ...survey, active: false, revision: 2, token: 'new-token' }, 1)).toMatchObject({ ok: true });
    expect(await repo.submit('tenant', survey, answer('inactive', null))).toMatchObject({ ok: false });
    expect(await repo.save('tenant', { ...survey, revision: 2 }, 1)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await repo.save('tenant', { ...survey, revision: 3, token: 'new-token' }, 2)).toMatchObject({ ok: true });
    expect(await repo.submit('tenant', survey, answer('stale', null))).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await db.select().from(surveyEvents).where(eq(surveyEvents.tenantId, 'tenant'))).toHaveLength(3);
  });
  it('cascades responses and events when a survey or workspace is deleted', async () => {
    const repo = createSurveyRepository(db);
    expect(await repo.delete('tenant', 'survey')).toBe(true);
    expect(await repo.responses('tenant', 'survey', 0, 20)).toEqual([]);
    expect(await db.select().from(surveyEvents).where(eq(surveyEvents.tenantId, 'tenant'))).toEqual([]);
    const other = await repo.findById('other', 'other-survey');
    if (other === null) throw new Error('Missing survey fixture');
    expect(await repo.submit('other', other, { ...answer('other-response', null), tenantId: 'other', surveyId: other.id })).toMatchObject({ ok: true });
    await db.delete(tenants).where(eq(tenants.id, 'other'));
    expect(await repo.findById('other', 'other-survey')).toBeNull();
    expect(await repo.responses('other', 'other-survey', 0, 20)).toEqual([]);
  });
});
