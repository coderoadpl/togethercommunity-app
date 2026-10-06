import type { Command } from 'commander';
import { z } from 'zod';

import { surveyContracts, type ApiClient } from '#core/client/index.js';
import { err, validation, type AppError, type Result } from '#core/domain/index.js';

import { emit } from './output.js';

type SurveyCliContext = { api: ApiClient; json: boolean };
const jsonInput = z.string().transform((value, ctx): unknown => {
  try { return JSON.parse(value); }
  catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON input' }); return z.NEVER; }
});

export const registerSurveyCommands = (program: Command, context: () => Result<SurveyCliContext, AppError>): void => {
  const surveys = program.command('survey').description('Manage surveys and responses');
  const run = <S extends z.ZodTypeAny>(schema: S, action: (ctx: SurveyCliContext, input: z.output<S>) => Promise<Result<unknown, AppError>>) => async (...args: unknown[]) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, process.argv.includes('--json'), () => ''); return; }
    const input = schema.safeParse(args.slice(0, -1));
    if (!input.success) { emit(err(validation('Invalid survey command options', input.error.flatten())), ctx.value.json, () => ''); return; }
    emit(await action(ctx.value, input.data), ctx.value.json, (value) => JSON.stringify(value, null, 2));
  };
  surveys.command('list').action(run(z.tuple([z.object({})]), (ctx) => ctx.api.listSurveys({})));
  surveys.command('show <id>').action(run(z.tuple([z.string(), z.object({})]), (ctx, [id]) => ctx.api.getSurvey({ id })));
  surveys.command('create').requiredOption('--input <json>', 'Survey fields as JSON').action(run(z.tuple([z.object({ input: jsonInput.pipe(surveyContracts.createSurvey.input) })]), (ctx, [options]) => ctx.api.createSurvey(options.input)));
  surveys.command('update <id>').requiredOption('--input <json>', 'All fields, id and expectedRevision as JSON').action(run(z.tuple([z.string(), z.object({ input: jsonInput.pipe(surveyContracts.updateSurvey.input) })]), async (ctx, [id, options]) => options.input.id === id ? ctx.api.updateSurvey(options.input) : err(validation('Survey id does not match the input'))));
  surveys.command('delete <id>').requiredOption('--confirm', 'Delete the survey and its responses').action(run(z.tuple([z.string(), z.object({ confirm: z.literal(true) })]), (ctx, [id]) => ctx.api.deleteSurvey({ id })));
  surveys.command('results <id>').option('--page <number>', 'Page number', '1').option('--page-size <number>', 'Responses per page', '50').action(run(z.tuple([z.string(), z.object({ page: z.coerce.number().int().positive(), pageSize: z.coerce.number().int().min(1).max(100) })]), (ctx, [id, options]) => ctx.api.getSurveyResults({ id, ...options })));
  surveys.command('export <id>').action(run(z.tuple([z.string(), z.object({})]), (ctx, [id]) => ctx.api.exportSurveyResponses({ id })));
};
