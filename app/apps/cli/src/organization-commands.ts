import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import { err, notFound, ok, validation, type AppError, type Result } from '#core/domain/index.js';

import { emit } from './output.js';

type OrganizationCliContext = {
  api: Pick<ApiClient, 'listOrganizations' | 'getOrganization' | 'listOrganizationMembers' | 'listOrganizationAuditEvents'>;
  json: boolean;
};

const selectorSchema = z.string().trim().min(1);
const orgOptionSchema = z.object({ org: selectorSchema.optional() });
const auditOptionsSchema = orgOptionSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const resolveOrganizationId = async (
  api: Pick<ApiClient, 'listOrganizations'>,
  selector: string | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<Result<string, AppError>> => {
  const chosen = selectorSchema.safeParse(selector ?? env['TOGETHER_CLI_ORG']);
  if (!chosen.success) return err(validation('Select an organization with --org or TOGETHER_CLI_ORG'));
  const listed = await api.listOrganizations();
  if (!listed.ok) return listed;
  const match = listed.value.organizations.find((organization) =>
    organization.id === chosen.data || organization.slug === chosen.data.toLowerCase());
  return match === undefined ? err(notFound('Organization not found')) : ok(match.id);
};

export const registerOrganizationCommands = (
  program: Command,
  context: () => Result<OrganizationCliContext, AppError>,
): void => {
  const org = program.command('org').description('Organizations above workspaces (members only)');
  const run = <S extends z.ZodTypeAny, T>(
    schema: S,
    action: (ctx: OrganizationCliContext, options: z.output<S>) => Promise<Result<T, AppError>>,
    human: (value: T) => string = (value) => JSON.stringify(value, null, 2),
  ) => async (raw: unknown) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
    const options = schema.safeParse(raw);
    if (!options.success) {
      emit(err(validation('Invalid organization command options', options.error.flatten())), ctx.value.json, () => '');
      return;
    }
    emit(await action(ctx.value, options.data), ctx.value.json, human);
  };
  const scoped = <T>(
    call: (ctx: OrganizationCliContext, organizationId: string, options: z.output<typeof auditOptionsSchema>) => Promise<Result<T, AppError>>,
  ) => async (ctx: OrganizationCliContext, options: z.output<typeof auditOptionsSchema>): Promise<Result<T, AppError>> => {
    const organizationId = await resolveOrganizationId(ctx.api, options.org);
    return organizationId.ok ? call(ctx, organizationId.value, options) : organizationId;
  };
  const orgOption = ['--org <id-or-slug>', 'Organization id or slug (default: TOGETHER_CLI_ORG)'] as const;

  org.command('list').description('List the organizations you belong to').action(run(
    z.object({}),
    (ctx) => ctx.api.listOrganizations(),
    (value) => value.organizations.map((entry) => `${entry.slug}\t${entry.role}\t${entry.status}\t${entry.name}\t${entry.id}`).join('\n'),
  ));
  org.command('show').description('Show one organization').option(...orgOption).action(run(
    orgOptionSchema,
    scoped((ctx, organizationId) => ctx.api.getOrganization({ organizationId })),
  ));
  org.command('member').description('Organization members')
    .command('list').description('List organization members').option(...orgOption).action(run(
      orgOptionSchema,
      scoped((ctx, organizationId) => ctx.api.listOrganizationMembers({ organizationId })),
      (value) => value.members.map((member) => `${member.email}\t${member.role}\t${member.userId}`).join('\n'),
    ));
  org.command('audit').description('List recent organization audit events').option(...orgOption)
    .option('--limit <n>', 'Number of events (1-100, default 25)').action(run(
      auditOptionsSchema,
      scoped((ctx, organizationId, options) => ctx.api.listOrganizationAuditEvents({
        organizationId, ...(options.limit === undefined ? {} : { limit: options.limit }),
      })),
    ));
};
