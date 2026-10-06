import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, surveySchema, type SurveyResponse } from '#core/domain/index.js';
import type { SurveyDeps } from '../survey-ports.js';
import type { Ctx } from '../context.js';
import { createSurvey, deleteSurvey, exportSurveyResponses, getPublicSurvey, getSurvey, getSurveyResults, listSurveys, previewSurveyEnding, submitSurvey, updateSurvey } from './surveys.js';

const survey = surveySchema.parse({ id: 'survey', tenantId: 'tenant', title: 'Audience feedback', question: 'How was your experience?', type: 'nps', slug: 'feedback', commentEnabled: true, commentPrompt: 'Anything else?', active: true, endings: [{ min: 0, max: 6, body: 'Low' }, { min: 7, max: 8, body: 'Middle' }, { min: 9, max: 10, body: '**High**' }], token: 'token', revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const updateInput = { id: survey.id, expectedRevision: survey.revision, title: survey.title, question: survey.question, type: survey.type, slug: survey.slug, commentEnabled: survey.commentEnabled, commentPrompt: survey.commentPrompt, active: survey.active, endings: survey.endings };
const ctx: Ctx = { identity: { userId: 'owner', email: 'owner@example.org', name: 'Owner', emailVerified: true, image: null, tenantAccess: 'staff', tenantId: 'tenant', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false } };
const submit = vi.fn<SurveyDeps['surveys']['submit']>(async () => ok(undefined));
const responses = vi.fn<SurveyDeps['surveys']['responses']>(async () => []);
const exportResponses = vi.fn<SurveyDeps['surveys']['exportResponses']>(async () => []);
const find = vi.fn<SurveyDeps['surveys']['findBySlug']>(async (tenantId, slug) => tenantId === 'tenant' && slug === survey.slug ? survey : null);
const distribution = vi.fn<SurveyDeps['surveys']['distribution']>(async () => [{ score: 4, count: 1 }, { score: 7, count: 1 }, { score: 9, count: 2 }]);
const deps: SurveyDeps = { surveys: { findBySlug: find, findById: async (tenantId, id) => tenantId === 'tenant' && id === survey.id ? survey : null, list: async () => [survey], save: async (_, value) => ok(value), delete: async () => true, submit, responses, exportResponses, distribution }, clock: { nowIso: () => survey.createdAt }, ids: { nextId: () => 'response' }, tokens: { nextToken: () => 'new-token' } };
beforeEach(() => { vi.clearAllMocks(); find.mockImplementation(async (tenantId, slug) => tenantId === 'tenant' && slug === survey.slug ? survey : null); responses.mockResolvedValue([]); exportResponses.mockResolvedValue([]); });
describe('surveys', () => {
  it.each([
    { title: 'Updated internal title' },
    { active: false },
    { endings: [{ min: 0, max: 5, body: 'Updated low ending' }, { min: 6, max: 8, body: 'Middle' }, { min: 9, max: 10, body: 'Updated high ending' }] },
  ])('preserves open form tokens for administrative and ending edits: %j', async (changes) => {
    const result = await updateSurvey(ctx, { ...updateInput, ...changes }, deps);
    expect(result).toMatchObject({ ok: true, value: { survey: { token: survey.token, revision: 2 } } });
    if (!result.ok) throw new Error('Survey update failed');
    find.mockResolvedValue({ ...result.value.survey, active: true });
    expect(await submitSurvey('tenant', 'feedback', { token: survey.token, score: 9 }, null, deps)).toMatchObject({ ok: true });
  });
  it.each([
    { question: 'How would you rate the experience?' },
    { commentEnabled: false },
    { commentPrompt: 'What could improve?' },
    { type: 'stars', endings: [{ min: 1, max: 3, body: 'Low' }, { min: 4, max: 4, body: 'Middle' }, { min: 5, max: 5, body: 'High' }] },
  ])('rotates open form tokens when respondent answers change: %j', async (changes) => {
    const editable: SurveyDeps = { ...deps, surveys: { ...deps.surveys, distribution: async () => [] } };
    const result = await updateSurvey(ctx, { ...updateInput, ...changes }, editable);
    expect(result).toMatchObject({ ok: true, value: { survey: { token: 'new-token', revision: 2 } } });
    if (!result.ok) throw new Error('Survey update failed');
    find.mockResolvedValue(result.value.survey);
    expect(await submitSurvey('tenant', 'feedback', { token: survey.token, score: 5 }, null, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(submit).not.toHaveBeenCalled();
    expect(await submitSurvey('tenant', 'feedback', { token: result.value.survey.token, score: 5 }, null, deps)).toMatchObject({ ok: true });
  });
  it('preserves the token when an unused comment prompt changes', async () => {
    const disabled: SurveyDeps = { ...deps, surveys: { ...deps.surveys, findById: async () => ({ ...survey, commentEnabled: false }) } };
    expect(await updateSurvey(ctx, { ...updateInput, commentEnabled: false, commentPrompt: 'Updated unused prompt' }, disabled)).toMatchObject({ ok: true, value: { survey: { token: survey.token } } });
  });
  it('accepts anonymous and member answers and returns the matching sanitized ending', async () => {
    expect(await submitSurvey('tenant', 'feedback', { token: 'token', score: 9 }, null, deps)).toMatchObject({ ok: true, value: { ending: '**High**', endingHtml: '<p><strong>High</strong></p>\n' } });
    expect(submit).toHaveBeenLastCalledWith('tenant', survey, expect.objectContaining({ memberId: null, score: 9, comment: '' }));
    await submitSurvey('tenant', 'feedback', { token: 'token', score: 3, comment: 'More detail' }, 'member', deps);
    expect(submit).toHaveBeenLastCalledWith('tenant', survey, expect.objectContaining({ memberId: 'member', score: 3, comment: 'More detail' }));
  });
  it('reuses the signup honeypot and requires the current public token', async () => {
    expect(await submitSurvey('tenant', 'feedback', { website: 'spam' }, null, deps)).toMatchObject({ ok: true });
    expect(await submitSurvey('tenant', 'feedback', { score: 9, token: 'wrong' }, null, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(submit).not.toHaveBeenCalled();
  });
  it('hides inactive, unknown and foreign surveys', async () => {
    for (const tenant of ['foreign', 'tenant']) {
      expect(await getPublicSurvey(tenant, 'unknown', deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
      expect(await submitSurvey(tenant, 'unknown', {}, null, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    find.mockResolvedValue({ ...survey, active: false });
    expect(await getPublicSurvey('tenant', 'feedback', deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await submitSurvey('tenant', 'feedback', {}, null, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
  it('rejects scores outside the scale and comments when disabled', async () => {
    find.mockResolvedValue({ ...survey, commentEnabled: false });
    expect(await submitSurvey('tenant', 'feedback', { token: 'token', score: 9, comment: 'Hidden' }, null, deps)).toMatchObject({ ok: false });
    expect(await submitSurvey('tenant', 'feedback', { token: 'token', score: 11 }, null, deps)).toMatchObject({ ok: false });
    expect(submit).not.toHaveBeenCalled();
  });
  it('returns configured-threshold NPS with a complete distribution and paginated responses', async () => {
    const result = await getSurveyResults(ctx, { id: 'survey', page: 2, pageSize: 2 }, deps);
    expect(result).toMatchObject({ ok: true, value: { results: { count: 4, nps: 25, average: null, totalPages: 2, distribution: expect.arrayContaining([{ score: 0, count: 0 }, { score: 9, count: 2 }]) } } });
    expect(responses).toHaveBeenCalledWith('tenant', 'survey', 2, 2);
  });
  it('uses editable NPS thresholds and calculates the stars average', async () => {
    const customized: SurveyDeps = { ...deps, surveys: { ...deps.surveys, findById: async () => ({ ...survey, endings: [{ min: 0, max: 3, body: 'Low' }, { min: 4, max: 8, body: 'Middle' }, { min: 9, max: 10, body: 'High' }] }) } };
    expect(await getSurveyResults(ctx, { id: 'survey' }, customized)).toMatchObject({ ok: true, value: { results: { nps: 50 } } });
    const stars: SurveyDeps = { ...deps, surveys: { ...deps.surveys, findById: async () => ({ ...survey, type: 'stars', endings: [{ min: 1, max: 3, body: 'Low' }, { min: 4, max: 4, body: 'Middle' }, { min: 5, max: 5, body: 'High' }] }), distribution: async () => [{ score: 1, count: 1 }, { score: 5, count: 3 }] } };
    expect(await getSurveyResults(ctx, { id: 'survey' }, stars)).toMatchObject({ ok: true, value: { results: { nps: null, average: 4, count: 4 } } });
  });
  it('protects CSV cells from formulas and preserves commas, quotes and newlines', async () => {
    const row: SurveyResponse = { id: 'r', tenantId: 'tenant', surveyId: 'survey', memberId: null, memberName: null, score: 9, comment: '=SUM(1,2)\n"quoted"', createdAt: survey.createdAt, updatedAt: survey.updatedAt };
    exportResponses.mockResolvedValue([row]);
    const result = await exportSurveyResponses(ctx, { id: 'survey' }, deps);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.csv).toContain('"\'=SUM(1,2)\n""quoted"""');
  });
  it('exports more than one results page using one snapshot read without paging', async () => {
    const snapshot = Array.from({ length: 1001 }, (_, index): SurveyResponse => ({ id: `response-${index}`, tenantId: 'tenant', surveyId: 'survey', memberId: null, memberName: null, score: 9, comment: `Answer ${index}`, createdAt: survey.createdAt, updatedAt: survey.updatedAt }));
    exportResponses.mockResolvedValue(snapshot);
    const result = await exportSurveyResponses(ctx, { id: 'survey' }, deps);
    expect(exportResponses).toHaveBeenCalledExactlyOnceWith('tenant', 'survey');
    expect(responses).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.value.csv.split('\r\n');
      expect(lines).toHaveLength(1002);
      expect(new Set(lines).size).toBe(1002);
      expect(lines.at(-1)).toContain('Answer 1000');
    }
  });
  it('requires staff capabilities on every Studio entry point', async () => {
    const denied = { ...ctx, capabilities: [] };
    const results = await Promise.all([listSurveys(denied, deps), getSurvey(denied, { id: 'survey' }, deps), createSurvey(denied, {}, deps), updateSurvey(denied, {}, deps), deleteSurvey(denied, { id: 'survey' }, deps), getSurveyResults(denied, { id: 'survey' }, deps), exportSurveyResponses(denied, { id: 'survey' }, deps), previewSurveyEnding(denied, { body: 'Text' })]);
    for (const result of results) expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
  it('renders ending previews through the sanitized post renderer', async () => {
    const result = await previewSurveyEnding(ctx, { body: '**Thanks** <script>alert(1)</script> [Unsafe](javascript:alert)' });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) { expect(result.value.html).toContain('<strong>Thanks</strong>'); expect(result.value.html).not.toContain('<script>'); expect(result.value.html).not.toContain('href="javascript:'); }
  });
});
