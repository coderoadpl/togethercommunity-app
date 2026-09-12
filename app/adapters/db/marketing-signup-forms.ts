import { and, eq, sql } from 'drizzle-orm';

import { appError, err, ok, marketingSignupFormSchema, marketingSignupFormCountersSchema, type AppError } from '#core/domain/index.js';
import type { MarketingSignupFormRepository, MarketingSignupTransaction } from '#core/server/index.js';

import type { Db } from './client.js';
import { marketingSignupForms as forms, marketingSignupSubmissions as submissions } from './schema.js';
import { createMarketingDirectoryEventRepository, type DirectoryRepositoryDeps } from './marketing-contact-repositories.js';
import { createMarketingImportTransactionRepos } from './marketing-contact-transactions.js';
import { createConsentConfirmationTokenRepository } from './marketing-repositories.js';
import { createEmailOutboxRepository } from './email-outbox.js';

export const createMarketingSignupFormRepository = (db: Db, deps: DirectoryRepositoryDeps): MarketingSignupFormRepository => ({
  findBySlug: async (tenantId, slug) => {
    const [row] = await db.select().from(forms).where(and(eq(forms.tenantId, tenantId), eq(forms.slug, slug)));
    return row === undefined ? null : marketingSignupFormSchema.parse(row);
  },
  findBySlugForUpdate: async (tenantId, slug) => {
    const [row] = await db.select().from(forms).where(and(eq(forms.tenantId, tenantId), eq(forms.slug, slug))).for('update');
    return row === undefined ? null : marketingSignupFormSchema.parse(row);
  },
  list: async (tenantId) => (await db.select().from(forms).where(eq(forms.tenantId, tenantId)).orderBy(forms.slug)).map((row) => marketingSignupFormSchema.parse(row)),
  save: async (tenantId, input, expectedRevision) => {
    const form = marketingSignupFormSchema.parse({ ...input, tenantId });
    const rows = expectedRevision === null
      ? await db.insert(forms).values(form).onConflictDoNothing().returning()
      : await db.update(forms).set(form).where(and(eq(forms.tenantId, tenantId), eq(forms.id, form.id), eq(forms.revision, expectedRevision))).returning();
    const row = rows[0];
    if (row === undefined) return err(appError('conflict', 'Signup form slug or revision conflicts with an existing form'));
    await createMarketingDirectoryEventRepository(db).append(tenantId, {
      id: deps.ids.nextId(), tenantId, subjectKind: 'signup_form', subjectId: form.id,
      type: expectedRevision === null ? 'signup_form_created' : form.status === 'archived' ? 'signup_form_archived' : 'signup_form_updated',
      actor: 'studio', importId: null, payload: { revision: form.revision, form }, occurredAt: form.updatedAt, createdAt: form.updatedAt,
    });
    return ok(marketingSignupFormSchema.parse(row));
  },
  counters: async (tenantId, formId, now) => {
    const confirmed = sql`${submissions.confirmedAt} IS NOT NULL`;
    const [row] = await db.select({
      submissionsTotal: sql<number>`count(*)::integer`,
      submissions24h: sql<number>`count(*) FILTER (WHERE ${submissions.occurredAt}::timestamptz >= ${now}::timestamptz - interval '24 hours')::integer`,
      submissions7d: sql<number>`count(*) FILTER (WHERE ${submissions.occurredAt}::timestamptz >= ${now}::timestamptz - interval '7 days')::integer`,
      confirmed: sql<number>`count(*) FILTER (WHERE ${confirmed})::integer`,
      pending: sql<number>`count(*) FILTER (WHERE NOT (${confirmed}))::integer`,
    }).from(submissions).where(and(eq(submissions.tenantId, tenantId), eq(submissions.formId, formId)));
    return marketingSignupFormCountersSchema.parse({ ...row, computedAt: now });
  },
  recordSubmission: async (tenantId, input) => { await db.insert(submissions).values({ ...input, tenantId, confirmedAt: input.doubleOptIn ? null : input.occurredAt }); },
});
class SignupRollback extends Error {
  constructor(readonly failure: AppError) { super(failure.message); }
}
export const createMarketingSignupTransaction = (db: Db, deps: DirectoryRepositoryDeps): MarketingSignupTransaction => ({
  run: async (tenantId, operation) => {
    if (tenantId.length === 0) throw new Error('Tenant context is required');
    try {
      return await db.transaction(async (tx) => {
        const result = await operation({ ...createMarketingImportTransactionRepos(tx, deps), forms: createMarketingSignupFormRepository(tx, deps), confirmations: createConsentConfirmationTokenRepository(tx), outbox: createEmailOutboxRepository(tx) });
        if (!result.ok) throw new SignupRollback(result.error);
        return result;
      });
    } catch (error) {
      if (error instanceof SignupRollback) return err(error.failure);
      throw error;
    }
  },
});
