import type { Command } from 'commander';
import { z } from 'zod';
import { salesLinkContracts, type ApiClient } from '#core/client/index.js';
import { err, validation, type AppError, type Result } from '#core/domain/index.js';
import { emit } from './output.js';

type SalesLinkCliContext = { api: ApiClient; json: boolean };
const jsonInput = z.string().transform((value, ctx): unknown => {
  try { return JSON.parse(value); }
  catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON input' }); return z.NEVER; }
});
export const registerSalesLinkCommands = (program: Command, context: () => Result<SalesLinkCliContext, AppError>): void => {
  const links = program.command('sales-link').description('Manage multi-product sales links');
  const run = <S extends z.ZodTypeAny>(schema: S, action: (ctx: SalesLinkCliContext, input: z.output<S>) => Promise<Result<unknown, AppError>>) => async (...args: unknown[]) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, process.argv.includes('--json'), () => ''); return; }
    const input = schema.safeParse(args.slice(0, -1));
    if (!input.success) { emit(err(validation('Invalid sales-link command options', input.error.flatten())), ctx.value.json, () => ''); return; }
    emit(await action(ctx.value, input.data), ctx.value.json, (value) => JSON.stringify(value, null, 2));
  };
  links.command('list').action(run(z.tuple([z.object({})]), (ctx) => ctx.api.listSalesLinks({})));
  links.command('show <id>').action(run(z.tuple([z.string(), z.object({})]), (ctx, [id]) => ctx.api.getSalesLink({ id })));
  links.command('create').requiredOption('--input <json>', 'Sales-link fields as JSON').action(run(z.tuple([z.object({ input: jsonInput.pipe(salesLinkContracts.createSalesLink.input) })]), (ctx, [options]) => ctx.api.createSalesLink(options.input)));
  links.command('update <id>').requiredOption('--input <json>', 'All fields, id and expectedRevision as JSON').action(run(z.tuple([z.string(), z.object({ input: jsonInput.pipe(salesLinkContracts.updateSalesLink.input) })]), async (ctx, [id, options]) => options.input.id === id ? ctx.api.updateSalesLink(options.input) : err(validation('Sales-link id does not match the input'))));
  links.command('delete <id>').requiredOption('--confirm', 'Delete a sales link without paid orders').action(run(z.tuple([z.string(), z.object({ confirm: z.literal(true) })]), (ctx, [id]) => ctx.api.deleteSalesLink({ id })));
  links.command('offer <slug>').action(run(z.tuple([z.string(), z.object({})]), (ctx, [slug]) => ctx.api.getPublicSalesLink({ slug })));
  for (const active of [true, false]) links.command(active ? 'activate <id>' : 'deactivate <id>').action(run(z.tuple([z.string(), z.object({})]), async (ctx, [id]) => {
    const result = await ctx.api.getSalesLink({ id });
    if (!result.ok) return result;
    const link = result.value.salesLink;
    return ctx.api.updateSalesLink({ id, expectedRevision: link.revision, slug: link.slug, title: link.title, heading: link.heading, description: link.description, productIds: link.productIds, listed: link.listed, validFrom: link.validFrom, validTo: link.validTo, active });
  }));
};
