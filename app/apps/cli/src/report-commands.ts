import type { Command } from 'commander';
import { z } from 'zod';
import type { ApiClient } from '#core/client/index.js';
import { activitySummaryQuerySchema, memberActivityQuerySchema } from '#core/contract/index.js';
import { err, internal, ok, validation, type AppError, type MemberActivity, type Result } from '#core/domain/index.js';
import { emit } from './output.js';

type ReportCliContext = { api: Pick<ApiClient, 'activitySummary' | 'memberActivity'>; json: boolean };
const transportSchema = z.object({ apiKeyEnv: z.string().default('TOGETHER_API_KEY'), csv: z.boolean().default(false) });
const memberOptionsSchema = z.object({
  from: z.string(), to: z.string(), pivot: z.string(), exclude: z.array(z.string()).default([]),
}).merge(transportSchema);

export const renderMemberActivityCsv = (members: MemberActivity['members']): string => {
  const fields = ['memberId', 'displayName', 'email', 'signInsBefore', 'signInsAfter', 'firstSignIn', 'lastSignIn', 'progressBefore', 'progressAfter', 'coursesTouched', 'lessonsCompletedTotal', 'lastProgress', 'completionsBefore', 'completionsAfter'] as const;
  const escape = (value: string | number | null): string => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [fields.map(escape).join(','), ...members.map((member) => fields.map((field) => escape(member[field])).join(','))].join('\r\n') + '\r\n';
};

export const registerReportCommands = (program: Command, context: () => Result<ReportCliContext, AppError>): void => {
  const reports = program.command('reports').description('Read tenant activity with a report:read API key');
  const run = (member: boolean) => async (raw: unknown) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
    const options = transportSchema.safeParse(raw);
    if (!options.success) { emit(err(validation('Invalid report options')), ctx.value.json, () => ''); return; }
    const secret = process.env[options.data.apiKeyEnv];
    if (!secret) { emit(err(validation('API key environment variable is empty')), ctx.value.json, () => ''); return; }
    if (ctx.value.json && options.data.csv) { emit(err(validation('Choose --json or --csv')), true, () => ''); return; }
    try {
      if (!member) {
        const input = activitySummaryQuerySchema.safeParse(raw);
        const result = input.success ? await ctx.value.api.activitySummary(input.data, { apiKey: secret }) : err(validation('Invalid report range'));
        emit(result, ctx.value.json, (value) => JSON.stringify(value, null, 2));
        return;
      }
      const parsed = memberOptionsSchema.safeParse(raw);
      if (!parsed.success) { emit(err(validation('Invalid member activity options')), ctx.value.json, () => ''); return; }
      const input = memberActivityQuerySchema.safeParse({ ...parsed.data, excludeEmailPatterns: parsed.data.exclude.join(','), limit: 500 });
      if (!input.success) { emit(err(validation('Invalid member activity query')), ctx.value.json, () => ''); return; }
      const members: MemberActivity['members'] = [];
      let cursor = '';
      do {
        const result = await ctx.value.api.memberActivity({ ...input.data, cursor }, { apiKey: secret });
        if (!result.ok) { emit(result, ctx.value.json, () => ''); return; }
        members.push(...result.value.members);
        cursor = result.value.nextCursor ?? '';
      } while (cursor !== '');
      if (options.data.csv) process.stdout.write(renderMemberActivityCsv(members));
      else emit(ok({ members, nextCursor: null }), ctx.value.json, (value) => JSON.stringify(value, null, 2));
    } catch {
      emit(err(internal('Activity report failed')), ctx.value.json, () => '');
    }
  };
  reports.command('activity-summary').requiredOption('--from <iso>').requiredOption('--to <iso>')
    .option('--api-key-env <name>', 'Environment variable containing the API key', 'TOGETHER_API_KEY').action(run(false));
  reports.command('member-activity').requiredOption('--from <iso>').requiredOption('--to <iso>').requiredOption('--pivot <iso>')
    .option('--exclude <pattern>', 'Exclude an email ILIKE pattern; repeatable', (value: string, previous: string[]) => [...previous, value], [])
    .option('--csv', 'Write CSV to stdout').option('--api-key-env <name>', 'Environment variable containing the API key', 'TOGETHER_API_KEY').action(run(true));
};
