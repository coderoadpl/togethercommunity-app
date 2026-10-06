import { z } from 'zod';
import { surveySchema, surveyInputSchema, surveyUpdateSchema, publicSurveySchema, surveySubmissionSchema, surveyResultsInputSchema, surveyResultsSchema, surveyEndingPreviewSchema } from '#core/domain/index.js';

const idInput = z.object({ id: z.string().min(1) }).strict();
export const surveyContracts = {
  listSurveys: { input: z.object({}).strict(), output: z.object({ surveys: z.array(surveySchema) }) },
  getSurvey: { input: idInput, output: z.object({ survey: surveySchema }) },
  createSurvey: { input: surveyInputSchema, output: z.object({ survey: surveySchema }) },
  updateSurvey: { input: surveyUpdateSchema, output: z.object({ survey: surveySchema }) },
  deleteSurvey: { input: idInput, output: z.object({ deleted: z.literal(true) }) },
  getSurveyResults: { input: surveyResultsInputSchema, output: z.object({ results: surveyResultsSchema }) },
  exportSurveyResponses: { input: idInput, output: z.object({ csv: z.string() }) },
  getPublicSurvey: { input: z.object({ slug: z.string().min(1) }).strict(), output: z.object({ survey: publicSurveySchema }) },
  previewSurveyEnding: { input: surveyEndingPreviewSchema, output: z.object({ html: z.string() }) },
  submitSurvey: { input: surveySubmissionSchema.extend({ slug: z.string().min(1) }), output: z.object({ ending: z.string(), endingHtml: z.string() }) },
} as const;
export const SURVEY_ROUTES = {
  previewSurveyEnding: { method: 'POST', path: '/api/surveys/preview' },
  listSurveys: { method: 'GET', path: '/api/surveys' },
  createSurvey: { method: 'POST', path: '/api/surveys' },
  getSurvey: { method: 'GET', path: '/api/surveys/:id' },
  updateSurvey: { method: 'POST', path: '/api/surveys/:id' },
  deleteSurvey: { method: 'DELETE', path: '/api/surveys/:id' },
  getSurveyResults: { method: 'GET', path: '/api/surveys/:id/results' },
  exportSurveyResponses: { method: 'GET', path: '/api/surveys/:id/export' },
  getPublicSurvey: { method: 'GET', path: '/api/public/surveys/:slug' },
  submitSurvey: { method: 'POST', path: '/api/public/surveys/:slug/submit' },
} as const;
