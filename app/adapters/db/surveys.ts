import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { appError, err, ok, notFound, validation, surveySchema, surveyResponseSchema } from '#core/domain/index.js';
import type { SurveyRepository } from '#core/server/index.js';
import type { Db } from './client.js';
import { members } from './schema.js';
import { surveys, surveyResponses, surveyEvents } from './survey-schema.js';

export const createSurveyRepository = (db: Db): SurveyRepository => ({
  list: async (tenantId) => (await db.select().from(surveys).where(eq(surveys.tenantId, tenantId)).orderBy(desc(surveys.createdAt), surveys.id)).map((row) => surveySchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() })),
  findById: async (tenantId, id) => {
    const [row] = await db.select().from(surveys).where(and(eq(surveys.tenantId, tenantId), eq(surveys.id, id)));
    return row === undefined ? null : surveySchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() });
  },
  findBySlug: async (tenantId, slug) => {
    const [row] = await db.select().from(surveys).where(and(eq(surveys.tenantId, tenantId), eq(surveys.slug, slug)));
    return row === undefined ? null : surveySchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() });
  },
  save: async (tenantId, input, expectedRevision) => db.transaction(async (tx) => {
    const survey = surveySchema.parse({ ...input, tenantId });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`survey-slug:${tenantId}`}, 0))`);
    if (expectedRevision !== null) {
      const [existing] = await tx.select().from(surveys).where(and(eq(surveys.tenantId, tenantId), eq(surveys.id, survey.id))).for('update');
      if (existing === undefined || existing.revision !== expectedRevision) return err(appError('conflict', 'Survey revision conflicts with an existing survey'));
      if (existing.type !== survey.type) {
        const [response] = await tx.select({ id: surveyResponses.id }).from(surveyResponses).where(and(eq(surveyResponses.tenantId, tenantId), eq(surveyResponses.surveyId, survey.id))).limit(1);
        if (response !== undefined) return err(validation('Survey type cannot change after responses have been collected'));
      }
    }
    const [sameSlug] = await tx.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.tenantId, tenantId), eq(surveys.slug, survey.slug)));
    if (sameSlug !== undefined && sameSlug.id !== survey.id) return err(appError('conflict', 'Survey slug already exists'));
    const rows = expectedRevision === null
      ? await tx.insert(surveys).values(survey).onConflictDoNothing().returning()
      : await tx.update(surveys).set(survey).where(and(eq(surveys.tenantId, tenantId), eq(surveys.id, survey.id), eq(surveys.revision, expectedRevision))).returning();
    const row = rows[0];
    if (row === undefined) return err(appError('conflict', 'Survey slug or revision conflicts with an existing survey'));
    await tx.insert(surveyEvents).values({ tenantId, surveyId: survey.id, revision: survey.revision, type: expectedRevision === null ? 'created' : 'updated', snapshot: survey, occurredAt: survey.updatedAt });
    return ok(surveySchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() }));
  }),
  delete: async (tenantId, id) => (await db.delete(surveys).where(and(eq(surveys.tenantId, tenantId), eq(surveys.id, id))).returning({ id: surveys.id })).length > 0,
  submit: async (tenantId, survey, input) => db.transaction(async (tx) => {
    if (input.memberId !== null) {
      const [member] = await tx.select({ deletedAt: members.deletedAt, bannedAt: members.bannedAt }).from(members).where(and(eq(members.tenantId, tenantId), eq(members.id, input.memberId))).for('update');
      if (member === undefined || member.deletedAt !== null || member.bannedAt !== null) return err(notFound('Member was not found'));
    }
    const [current] = await tx.select().from(surveys).where(and(eq(surveys.tenantId, tenantId), eq(surveys.id, survey.id))).for('share');
    if (current === undefined || !current.active) return err(notFound('Survey was not found'));
    if (current.revision !== survey.revision || current.token !== survey.token) return err(appError('conflict', 'The survey changed; reload it before submitting'));
    await tx.insert(surveyResponses).values({ ...input, tenantId, surveyId: survey.id }).onConflictDoUpdate({ target: [surveyResponses.tenantId, surveyResponses.surveyId, surveyResponses.memberId], set: { score: input.score, comment: input.comment, updatedAt: input.updatedAt } });
    return ok(undefined);
  }),
  responses: async (tenantId, surveyId, offset, limit) => (await db.select({ ...getTableColumns(surveyResponses), memberName: sql<string | null>`CASE WHEN ${surveyResponses.memberId} IS NULL THEN NULL ELSE coalesce(${members.displayName}, ${members.email}) END` }).from(surveyResponses).leftJoin(members, and(eq(members.tenantId, surveyResponses.tenantId), eq(members.id, surveyResponses.memberId))).where(and(eq(surveyResponses.tenantId, tenantId), eq(surveyResponses.surveyId, surveyId))).orderBy(desc(surveyResponses.updatedAt), desc(surveyResponses.id)).offset(offset).limit(limit)).map((row) => surveyResponseSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() })),
  exportResponses: async (tenantId, surveyId) => (await db.select({ ...getTableColumns(surveyResponses), memberName: sql<string | null>`CASE WHEN ${surveyResponses.memberId} IS NULL THEN NULL ELSE coalesce(${members.displayName}, ${members.email}) END` }).from(surveyResponses).leftJoin(members, and(eq(members.tenantId, surveyResponses.tenantId), eq(members.id, surveyResponses.memberId))).where(and(eq(surveyResponses.tenantId, tenantId), eq(surveyResponses.surveyId, surveyId))).orderBy(desc(surveyResponses.updatedAt), desc(surveyResponses.id))).map((row) => surveyResponseSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() })),
  distribution: async (tenantId, surveyId) => db.select({ score: surveyResponses.score, count: sql<number>`count(*)::integer` }).from(surveyResponses).where(and(eq(surveyResponses.tenantId, tenantId), eq(surveyResponses.surveyId, surveyId))).groupBy(surveyResponses.score).orderBy(surveyResponses.score),
});
