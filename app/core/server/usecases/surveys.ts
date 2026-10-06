import { neutralizeFormula, quoteCsv } from '#core/domain/csv.js';
import { renderPostContent } from '../post-content.js';
import { err, ok, notFound, validation, publicSurveySchema, surveyInputSchema, surveyUpdateSchema, surveySubmissionSchema, surveyResultsInputSchema, surveyEndingPreviewSchema, isMarketingSignupHoneypot, type AppError, type Result, type SurveyResults } from '#core/domain/index.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { SurveyDeps } from '../survey-ports.js';

export const listSurveys = async (ctx: Ctx, deps: SurveyDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'survey:read');
  return tenant.ok ? ok({ surveys: await deps.surveys.list(tenant.value) }) : tenant;
};
export const getSurvey = async (ctx: Ctx, input: { id: string }, deps: SurveyDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'survey:read');
  if (!tenant.ok) return tenant;
  const survey = await deps.surveys.findById(tenant.value, input.id);
  return survey === null ? err(notFound('Survey was not found')) : ok({ survey });
};
export const createSurvey = async (ctx: Ctx, input: unknown, deps: SurveyDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'survey:write');
  if (!tenant.ok) return tenant;
  const parsed = surveyInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid survey', parsed.error.flatten()));
  const now = deps.clock.nowIso();
  const saved = await deps.surveys.save(tenant.value, { ...parsed.data, id: deps.ids.nextId(), tenantId: tenant.value, token: deps.tokens.nextToken(), revision: 1, createdAt: now, updatedAt: now }, null);
  return saved.ok ? ok({ survey: saved.value }) : saved;
};
export const updateSurvey = async (ctx: Ctx, input: unknown, deps: SurveyDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'survey:write');
  if (!tenant.ok) return tenant;
  const parsed = surveyUpdateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid survey', parsed.error.flatten()));
  const existing = await deps.surveys.findById(tenant.value, parsed.data.id);
  if (existing === null) return err(notFound('Survey was not found'));
  const { expectedRevision, ...fields } = parsed.data;
  if (fields.type !== existing.type && (await deps.surveys.distribution(tenant.value, existing.id)).some((row) => row.count > 0)) return err(validation('Survey type cannot change after responses have been collected'));
  const answersChanged = fields.question !== existing.question || fields.type !== existing.type || fields.commentEnabled !== existing.commentEnabled || (fields.commentEnabled && fields.commentPrompt !== existing.commentPrompt);
  const saved = await deps.surveys.save(tenant.value, { ...existing, ...fields, token: answersChanged ? deps.tokens.nextToken() : existing.token, revision: expectedRevision + 1, updatedAt: deps.clock.nowIso() }, expectedRevision);
  return saved.ok ? ok({ survey: saved.value }) : saved;
};
export const deleteSurvey = async (ctx: Ctx, input: { id: string }, deps: SurveyDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'survey:write');
  if (!tenant.ok) return tenant;
  return await deps.surveys.delete(tenant.value, input.id) ? ok({ deleted: true as const }) : err(notFound('Survey was not found'));
};
export const getPublicSurvey = async (tenantId: string, slug: string, deps: SurveyDeps) => {
  const survey = await deps.surveys.findBySlug(tenantId, slug);
  return survey === null || !survey.active ? err(notFound('Survey was not found')) : ok({ survey: publicSurveySchema.parse(survey) });
};
export const submitSurvey = async (tenantId: string, slug: string, input: unknown, memberId: string | null, deps: SurveyDeps) => {
  const survey = await deps.surveys.findBySlug(tenantId, slug);
  if (survey === null || !survey.active) return err(notFound('Survey was not found'));
  if (isMarketingSignupHoneypot(input)) return ok({ ending: survey.endings[1].body, endingHtml: renderPostContent(survey.endings[1].body, 'markdown').html });
  const parsed = surveySubmissionSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid survey response'));
  if (parsed.data.token !== survey.token) return err(validation('The survey changed; reload it before submitting'));
  const ending = survey.endings.find((range) => parsed.data.score >= range.min && parsed.data.score <= range.max);
  if (ending === undefined) return err(validation('Score is outside the survey scale'));
  if (!survey.commentEnabled && parsed.data.comment !== '') return err(validation('Comments are disabled for this survey'));
  const now = deps.clock.nowIso();
  const saved = await deps.surveys.submit(tenantId, survey, { id: deps.ids.nextId(), tenantId, surveyId: survey.id, memberId, score: parsed.data.score, comment: parsed.data.comment, createdAt: now, updatedAt: now });
  return saved.ok ? ok({ ending: ending.body, endingHtml: renderPostContent(ending.body, 'markdown').html }) : saved;
};
export const getSurveyResults = async (ctx: Ctx, input: unknown, deps: SurveyDeps): Promise<Result<{ results: SurveyResults }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'survey:read');
  if (!tenant.ok) return tenant;
  const parsed = surveyResultsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid results page'));
  const { id, page, pageSize } = parsed.data;
  const survey = await deps.surveys.findById(tenant.value, id);
  if (survey === null) return err(notFound('Survey was not found'));
  const counts = await deps.surveys.distribution(tenant.value, id);
  const distribution = Array.from({ length: survey.type === 'nps' ? 11 : 5 }, (_, index) => { const score = index + (survey.type === 'nps' ? 0 : 1); return { score, count: counts.find((row) => row.score === score)?.count ?? 0 }; });
  const count = distribution.reduce((sum, row) => sum + row.count, 0);
  const low = distribution.filter((row) => row.score <= survey.endings[0].max).reduce((sum, row) => sum + row.count, 0);
  const high = distribution.filter((row) => row.score >= survey.endings[2].min).reduce((sum, row) => sum + row.count, 0);
  return ok({ results: {
    count, nps: survey.type === 'nps' && count > 0 ? (high - low) * 100 / count : null,
    average: survey.type === 'stars' && count > 0 ? distribution.reduce((sum, row) => sum + row.score * row.count, 0) / count : null,
    distribution, responses: await deps.surveys.responses(tenant.value, id, (page - 1) * pageSize, pageSize), page, pageSize, totalPages: Math.ceil(count / pageSize),
  } });
};
export const exportSurveyResponses = async (ctx: Ctx, input: { id: string }, deps: SurveyDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'survey:read');
  if (!tenant.ok) return tenant;
  if (await deps.surveys.findById(tenant.value, input.id) === null) return err(notFound('Survey was not found'));
  const lines = ['Member,Score,Comment,Date'];
  const rows = await deps.surveys.exportResponses(tenant.value, input.id);
  for (const row of rows) lines.push([row.memberName ?? 'Anonymous', String(row.score), row.comment, row.updatedAt].map(neutralizeFormula).map(quoteCsv).join(','));
  return ok({ csv: lines.join('\r\n') });
};

export const previewSurveyEnding = async (ctx: Ctx, input: unknown) => {
  const tenant = authorizeRequiredTenant(ctx, 'survey:write');
  if (!tenant.ok) return tenant;
  const parsed = surveyEndingPreviewSchema.safeParse(input);
  return parsed.success ? ok({ html: renderPostContent(parsed.data.body, 'markdown').html }) : err(validation('Invalid ending'));
};
