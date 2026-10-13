import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import { err, notFound, validation, type AppError, type Result } from '#core/domain/index.js';

import { emit } from './output.js';

type TeamCliContext = {
  api: Pick<ApiClient, 'listTenantTeam' | 'addTenantAdmin' | 'removeTenantAdmin'>;
  json: boolean;
};
const emailSchema = z.string().trim().toLowerCase().email();

export const registerTeamCommands = (program: Command, context: () => Result<TeamCliContext, AppError>): void => {
  const team = program.command('team').description('Manage tenant administrators (owner only)');
  const run = <S extends z.ZodTypeAny>(schema: S, action: (ctx: TeamCliContext, input: z.output<S>) => Promise<Result<unknown, AppError>>) => async (...args: unknown[]) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
    const input = schema.safeParse(args.slice(0, -1));
    if (!input.success) { emit(err(validation('Invalid team command options', input.error.flatten())), ctx.value.json, () => ''); return; }
    emit(await action(ctx.value, input.data), ctx.value.json, (value) => JSON.stringify(value, null, 2));
  };
  team.command('list').description('List the owner and administrators').action(
    run(z.tuple([z.object({})]), (ctx) => ctx.api.listTenantTeam()),
  );
  team.command('add <email>').description('Add an administrator and send a sign-in link').action(
    run(z.tuple([emailSchema, z.object({})]), (ctx, [email]) => ctx.api.addTenantAdmin({ email })),
  );
  team.command('remove <email>').description('Remove an administrator').action(
    run(z.tuple([emailSchema, z.object({})]), async (ctx, [email]) => {
      const result = await ctx.api.listTenantTeam();
      if (!result.ok) return result;
      const member = result.value.members.find((entry) => entry.email.toLowerCase() === email);
      if (!member) return err(notFound('Team member not found'));
      return ctx.api.removeTenantAdmin({ userId: member.userId });
    }),
  );
};
