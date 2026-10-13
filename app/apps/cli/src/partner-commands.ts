import type { Command } from 'commander';
import { z } from 'zod';
import { partnerContracts, type ApiClient } from '#core/client/index.js';
import { err, validation, type AppError, type Result } from '#core/domain/index.js';
import { emit } from './output.js';

type PartnerCliContext = { api: ApiClient; json: boolean };
const jsonInput = z.string().transform((value, ctx): unknown => {
  try { return JSON.parse(value); }
  catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON input' }); return z.NEVER; }
});
export const registerPartnerCommands = (program: Command, context: () => Result<PartnerCliContext, AppError>): void => {
  const partners = program.command('partner-program').description('Manage partner programs, partners, and codes');
  const run = <S extends z.ZodTypeAny>(schema: S, action: (ctx: PartnerCliContext, input: z.output<S>) => Promise<Result<unknown, AppError>>) => async (...args: unknown[]) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, process.argv.includes('--json'), () => ''); return; }
    const input = schema.safeParse(args.slice(0, -1));
    if (!input.success) { emit(err(validation('Invalid partner command options', input.error.flatten())), ctx.value.json, () => ''); return; }
    emit(await action(ctx.value, input.data), ctx.value.json, (value) => JSON.stringify(value, null, 2));
  };
  partners.command('list').action(run(z.tuple([z.object({})]), (ctx) => ctx.api.listPartnerPrograms({})));
  partners.command('show <id>').action(run(z.tuple([z.string(), z.object({})]), (ctx, [id]) => ctx.api.getPartnerProgram({ id })));
  partners.command('create').requiredOption('--input <json>', 'Program fields as JSON').action(run(z.tuple([z.object({ input: jsonInput.pipe(partnerContracts.createPartnerProgram.input) })]), (ctx, [options]) => ctx.api.createPartnerProgram(options.input)));
  partners.command('update').requiredOption('--input <json>', 'Program fields, id and expectedRevision as JSON').action(run(z.tuple([z.object({ input: jsonInput.pipe(partnerContracts.updatePartnerProgram.input) })]), (ctx, [options]) => ctx.api.updatePartnerProgram(options.input)));
  partners.command('assign').requiredOption('--input <json>', 'Program id and member email as JSON').action(run(z.tuple([z.object({ input: jsonInput.pipe(partnerContracts.assignPartner.input) })]), (ctx, [options]) => ctx.api.assignPartner(options.input)));
  partners.command('update-partner').requiredOption('--input <json>', 'Partner id and status as JSON').action(run(z.tuple([z.object({ input: jsonInput.pipe(partnerContracts.updatePartner.input) })]), (ctx, [options]) => ctx.api.updatePartner(options.input)));
  partners.command('create-code').requiredOption('--input <json>', 'Code fields as JSON').action(run(z.tuple([z.object({ input: jsonInput.pipe(partnerContracts.createPartnerCode.input) })]), (ctx, [options]) => ctx.api.createPartnerCode(options.input)));
  partners.command('update-code').requiredOption('--input <json>', 'Code fields, id and expectedRevision as JSON').action(run(z.tuple([z.object({ input: jsonInput.pipe(partnerContracts.updatePartnerCode.input) })]), (ctx, [options]) => ctx.api.updatePartnerCode(options.input)));
};
