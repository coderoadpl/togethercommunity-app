import type { Hono } from 'hono';

import { API_PATHS, surveyContracts } from '#core/contract/index.js';
import { err, internal, validation } from '#core/domain/index.js';
import { createSurvey, deleteSurvey, exportSurveyResponses, getSurvey, getSurveyResults, listSurveys, updateSurvey, previewSurveyEnding } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';
import { ctxOf } from './ctx-of.js';
import { readJson } from './read-json.js';
import { respond } from './respond.js';

export const registerSurveyRoutes = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.post(API_PATHS.previewSurveyEnding, async (c) => {
    const input = surveyContracts.previewSurveyEnding.input.safeParse(await readJson(c.req.raw));
    return input.success ? respond(await previewSurveyEnding(ctxOf(c), input.data)) : respond(err(validation('Invalid survey ending')));
  });
  app.get(API_PATHS.listSurveys, async (c) => deps.surveys === undefined ? respond(err(internal('Surveys are unavailable'))) : respond(await listSurveys(ctxOf(c), deps.surveys)));
  app.get(API_PATHS.getSurvey, async (c) => deps.surveys === undefined ? respond(err(internal('Surveys are unavailable'))) : respond(await getSurvey(ctxOf(c), { id: c.req.param('id') ?? '' }, deps.surveys)));
  app.post(API_PATHS.createSurvey, async (c) => {
    if (deps.surveys === undefined) return respond(err(internal('Surveys are unavailable')));
    const input = surveyContracts.createSurvey.input.safeParse(await readJson(c.req.raw));
    return input.success ? respond(await createSurvey(ctxOf(c), input.data, deps.surveys), { successStatus: 201 }) : respond(err(validation('Invalid survey')));
  });
  app.post(API_PATHS.updateSurvey, async (c) => {
    if (deps.surveys === undefined) return respond(err(internal('Surveys are unavailable')));
    const input = surveyContracts.updateSurvey.input.safeParse(await readJson(c.req.raw));
    if (!input.success || input.data.id !== c.req.param('id')) return respond(err(validation('Invalid survey update')));
    return respond(await updateSurvey(ctxOf(c), input.data, deps.surveys));
  });
  app.delete(API_PATHS.deleteSurvey, async (c) => deps.surveys === undefined ? respond(err(internal('Surveys are unavailable'))) : respond(await deleteSurvey(ctxOf(c), { id: c.req.param('id') ?? '' }, deps.surveys)));
  app.get(API_PATHS.getSurveyResults, async (c) => {
    if (deps.surveys === undefined) return respond(err(internal('Surveys are unavailable')));
    const input = surveyContracts.getSurveyResults.input.safeParse({ id: c.req.param('id'), ...(c.req.query('page') === undefined ? {} : { page: Number(c.req.query('page')) }), ...(c.req.query('pageSize') === undefined ? {} : { pageSize: Number(c.req.query('pageSize')) }) });
    return input.success ? respond(await getSurveyResults(ctxOf(c), input.data, deps.surveys)) : respond(err(validation('Invalid survey results query')));
  });
  app.get(API_PATHS.exportSurveyResponses, async (c) => deps.surveys === undefined ? respond(err(internal('Surveys are unavailable'))) : respond(await exportSurveyResponses(ctxOf(c), { id: c.req.param('id') ?? '' }, deps.surveys)));

};
