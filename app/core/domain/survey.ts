import { z } from 'zod';

const surveyTypeSchema = z.enum(['nps', 'stars']);
export const surveyEndingSchema = z.object({ min: z.number().int(), max: z.number().int(), body: z.string().trim().min(1).max(20000) }).strict();
const surveyFields = {
  title: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(1000),
  type: surveyTypeSchema,
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  commentEnabled: z.boolean(),
  commentPrompt: z.string().trim().max(500),
  active: z.boolean(),
  endings: z.tuple([surveyEndingSchema, surveyEndingSchema, surveyEndingSchema]),
};
const validateRanges = (survey: { type: 'nps' | 'stars'; endings: z.output<typeof surveyEndingSchema>[] }, ctx: z.RefinementCtx) => {
  let next = survey.type === 'nps' ? 0 : 1;
  for (const range of survey.endings) {
    if (range.min !== next || range.max < range.min) ctx.addIssue({ code: 'custom', path: ['endings'], message: 'Ending ranges must cover the scale without gaps or overlaps' });
    next = range.max + 1;
  }
  if (next !== (survey.type === 'nps' ? 11 : 6)) ctx.addIssue({ code: 'custom', path: ['endings'], message: 'Ending ranges must cover the entire scale' });
};
export const surveyInputSchema = z.object(surveyFields).strict().superRefine(validateRanges);
export const surveyUpdateSchema = z.object({ ...surveyFields, id: z.string().min(1), expectedRevision: z.number().int().positive() }).strict().superRefine(validateRanges);
export const surveySchema = z.object({
  ...surveyFields, id: z.string().min(1), tenantId: z.string().min(1), token: z.string().min(1), revision: z.number().int().positive(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).superRefine(validateRanges);
export const publicSurveySchema = z.object({ slug: surveyFields.slug, question: surveyFields.question, type: surveyTypeSchema, commentEnabled: z.boolean(), commentPrompt: surveyFields.commentPrompt, token: z.string().min(1) });
export const surveySubmissionSchema = z.object({ score: z.number().int().min(0).max(10), comment: z.string().trim().max(2000).default(''), token: z.string().min(1).max(200), website: z.string().max(500).default('') });
export const surveyResponseSchema = z.object({
  id: z.string(), tenantId: z.string(), surveyId: z.string(), memberId: z.string().nullable(), memberName: z.string().nullable(), score: z.number().int().min(0).max(10), comment: z.string().max(2000), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const surveyResultsInputSchema = z.object({ id: z.string().min(1), page: z.number().int().positive().default(1), pageSize: z.number().int().min(1).max(100).default(25) }).strict();
export const surveyResultsSchema = z.object({
  count: z.number().int().nonnegative(), nps: z.number().nullable(), average: z.number().nullable(), distribution: z.array(z.object({ score: z.number().int(), count: z.number().int().nonnegative() })), responses: z.array(surveyResponseSchema), page: z.number().int().positive(), pageSize: z.number().int().positive(), totalPages: z.number().int().nonnegative(),
});
export type Survey = z.output<typeof surveySchema>;
export type SurveyInput = z.output<typeof surveyInputSchema>;
export type PublicSurvey = z.output<typeof publicSurveySchema>;
export type SurveyResponse = z.output<typeof surveyResponseSchema>;
export type SurveyResults = z.output<typeof surveyResultsSchema>;
export const surveyEndingPreviewSchema = z.object({ body: z.string().max(20000) }).strict();
