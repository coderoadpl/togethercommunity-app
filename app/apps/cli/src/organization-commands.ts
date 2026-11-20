import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import {
  err,
  notFound,
  ok,
  organizationRoleSchema,
  organizationSecretKeySchema,
  setOrganizationSecretInputSchema,
  updateOrganizationInputSchema,
  validation,
  type AppError,
  type Result,
} from '#core/domain/index.js';

import { emit } from './output.js';

type OrganizationCliContext = {
  api: Pick<
    ApiClient,
    | 'listOrganizations'
    | 'getOrganization'
    | 'updateOrganization'
    | 'listOrganizationSecrets'
    | 'setOrganizationSecret'
    | 'deleteOrganizationSecret'
    | 'getWorkspaceConfigSources'
    | 'listOrganizationMembers'
    | 'addOrganizationMember'
    | 'setOrganizationMemberRole'
    | 'removeOrganizationMember'
    | 'listOrganizationAuditEvents'
    | 'listOrganizationWorkspaces'
    | 'linkOrganizationWorkspace'
    | 'unlinkOrganizationWorkspace'
    | 'listTenants'
  >;
  json: boolean;
};

type MemberChange = { member: { email: string; role: string; userId: string }; changed: boolean };

const selectorSchema = z.string().trim().min(1);
const orgOptionSchema = z.object({ org: selectorSchema.optional() });
const memberEmailSchema = z.string().trim().toLowerCase().email();
const memberRoleOptionsSchema = orgOptionSchema.extend({ role: organizationRoleSchema });
const auditOptionsSchema = orgOptionSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export interface SecretValueSource {
  env: Record<string, string | undefined>;
  stdin: AsyncIterable<string | Uint8Array> & { isTTY?: boolean };
}

const environmentNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Name an environment variable');

export const readSecretValue = async (valueEnv: string | undefined, source: SecretValueSource): Promise<Result<string, AppError>> => {
  if (valueEnv !== undefined) {
    const value = source.env[valueEnv]?.trim() ?? '';
    return value === '' ? err(validation(`Environment variable ${valueEnv} is empty or not set`)) : ok(value);
  }
  if (source.stdin.isTTY === true) {
    return err(validation('Pipe the secret value on stdin or name an environment variable with --value-env'));
  }
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of source.stdin) text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  const value = (text + decoder.decode()).trim();
  return value === '' ? err(validation('The secret value on stdin is empty')) : ok(value);
};

const clearableTextSchema = z.string().trim().transform((value) => value === '' ? null : value);
const updateOptionsSchema = orgOptionSchema.extend({
  name: z.string().optional(),
  legalName: clearableTextSchema.optional(),
  legalAddress: clearableTextSchema.optional(),
  invoicingProvider: z.enum(['ifirma', 'ksef', 'none']).transform((value) => value === 'none' ? null : value).optional(),
  ksefSubmissionMode: z.string().optional(),
  shipxEnvironment: z.string().optional(),
  shipxSender: z.string().optional(),
});
const secretSetOptionsSchema = orgOptionSchema.extend({ valueEnv: environmentNameSchema.optional() });

const parseSender = (raw: string | undefined): Result<unknown, AppError> => {
  if (raw === undefined) return ok(undefined);
  if (raw.trim() === 'none') return ok(null);
  try {
    const sender: unknown = JSON.parse(raw);
    return ok(sender);
  } catch {
    return err(validation('--shipx-sender takes a JSON object or none'));
  }
};

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

export const resolveWorkspaceId = async (
  api: Pick<ApiClient, 'listTenants'>,
  selector: unknown,
): Promise<Result<string, AppError>> => {
  const chosen = selectorSchema.safeParse(selector);
  if (!chosen.success) return err(validation('Name the workspace by its slug'));
  const listed = await api.listTenants();
  if (!listed.ok) return listed;
  const match = listed.value.tenants.find(({ tenant }) => tenant.id === chosen.data || tenant.slug === chosen.data.toLowerCase());
  return match === undefined ? err(notFound('Workspace not found among your staff workspaces')) : ok(match.tenant.id);
};

export const registerOrganizationCommands = (
  program: Command,
  context: () => Result<OrganizationCliContext, AppError>,
  secretSource: SecretValueSource = { env: process.env, stdin: process.stdin },
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
  const scoped = <O extends { org?: string | undefined }, T>(
    call: (ctx: OrganizationCliContext, organizationId: string, options: O) => Promise<Result<T, AppError>>,
  ) => async (ctx: OrganizationCliContext, options: O): Promise<Result<T, AppError>> => {
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
  org.command('update').description('Update organization name, legal identity, invoicing and ShipX settings (organization owners only)')
    .option(...orgOption)
    .option('--name <name>', 'Organization name')
    .option('--legal-name <text>', 'Legal name used as seller and footer name (empty clears)')
    .option('--legal-address <text>', 'Legal address used as seller and footer address (empty clears)')
    .option('--invoicing-provider <provider>', 'ifirma, ksef or none')
    .option('--ksef-submission-mode <mode>', 'automatic or manual')
    .option('--shipx-environment <environment>', 'sandbox or production')
    .option('--shipx-sender <json>', 'ShipX sender as a JSON object, or none')
    .action(run(updateOptionsSchema, scoped(async (ctx, organizationId, options: z.output<typeof updateOptionsSchema>) => {
      const sender = parseSender(options.shipxSender);
      if (!sender.ok) return sender;
      const update = updateOrganizationInputSchema.safeParse({
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.legalName === undefined ? {} : { legalName: options.legalName }),
        ...(options.legalAddress === undefined ? {} : { legalAddress: options.legalAddress }),
        ...(options.invoicingProvider === undefined ? {} : { invoicingProvider: options.invoicingProvider }),
        ...(options.ksefSubmissionMode === undefined ? {} : { ksefSubmissionMode: options.ksefSubmissionMode }),
        ...(options.shipxEnvironment === undefined ? {} : { shipxEnvironment: options.shipxEnvironment }),
        ...(sender.value === undefined ? {} : { shipxSender: sender.value }),
      });
      if (!update.success) return err(validation('Invalid organization settings', update.error.flatten()));
      return ctx.api.updateOrganization({ organizationId, update: update.data });
    })));
  const secret = org.command('secret').description('Organization secrets (values are never printed)');
  secret.command('list').description('List organization secrets with masked previews').option(...orgOption).action(run(
    orgOptionSchema,
    scoped((ctx, organizationId) => ctx.api.listOrganizationSecrets({ organizationId })),
    (value) => value.secrets.map((entry) => `${entry.key}\t${entry.maskedPreview}\t${entry.updatedAt}`).join('\n'),
  ));
  secret.command('set <key>')
    .description('Store an organization secret read from --value-env or stdin, never from arguments (organization owners only)')
    .option(...orgOption)
    .option('--value-env <name>', 'Environment variable holding the secret value (default: read stdin)')
    .action((key: unknown, raw: unknown) => run(secretSetOptionsSchema, scoped(async (ctx, organizationId, options: z.output<typeof secretSetOptionsSchema>) => {
      const parsedKey = setOrganizationSecretInputSchema.shape.key.safeParse(key);
      if (!parsedKey.success) return err(validation('Invalid organization secret key', parsedKey.error.flatten()));
      const value = await readSecretValue(options.valueEnv, secretSource);
      if (!value.ok) return value;
      return ctx.api.setOrganizationSecret({ organizationId, key: parsedKey.data, value: value.value });
    }), (value) => `${value.secret.key}\t${value.secret.maskedPreview}\t${value.secret.updatedAt}`)(raw));
  secret.command('delete <key>')
    .description('Delete an organization secret no workspace inherits (organization owners only)')
    .option(...orgOption)
    .action((key: unknown, raw: unknown) => run(orgOptionSchema, scoped(async (ctx, organizationId) => {
      const parsedKey = organizationSecretKeySchema.safeParse(key);
      if (!parsedKey.success) return err(validation('Invalid organization secret key', parsedKey.error.flatten()));
      return ctx.api.deleteOrganizationSecret({ organizationId, key: parsedKey.data });
    }))(raw));
  const member = org.command('member').description('Organization members');
  member.command('list').description('List organization members').option(...orgOption).action(run(
    orgOptionSchema,
    scoped((ctx, organizationId) => ctx.api.listOrganizationMembers({ organizationId })),
    (value) => value.members.map((entry) => `${entry.email}\t${entry.role}\t${entry.userId}`).join('\n'),
  ));
  const memberLine = (value: MemberChange) =>
    `${value.member.email}\t${value.member.role}\t${value.member.userId}\t${value.changed ? 'changed' : 'unchanged'}`;
  const memberChange = <S extends typeof orgOptionSchema | typeof memberRoleOptionsSchema>(
    schema: S,
    call: (ctx: OrganizationCliContext, input: { organizationId: string; email: string }, options: z.output<S>) => Promise<Result<MemberChange, AppError>>,
  ) => (email: unknown, raw: unknown) => run(schema, scoped(async (ctx, organizationId, options: z.output<S>) => {
    const address = memberEmailSchema.safeParse(email);
    if (!address.success) return err(validation('Name the member by e-mail address'));
    return call(ctx, { organizationId, email: address.data }, options);
  }), memberLine)(raw);
  const roleOption = ['--role <role>', 'Organization role: owner or admin'] as const;
  member.command('add <email>')
    .description('Add an existing account with a verified e-mail address (organization owners only)')
    .option(...orgOption).option(...roleOption)
    .action(memberChange(memberRoleOptionsSchema, (ctx, input, options) => ctx.api.addOrganizationMember({ ...input, role: options.role })));
  member.command('role <email>')
    .description('Change the role of an organization member (organization owners only)')
    .option(...orgOption).option(...roleOption)
    .action(memberChange(memberRoleOptionsSchema, (ctx, input, options) => ctx.api.setOrganizationMemberRole({ ...input, role: options.role })));
  member.command('remove <email>')
    .description('Remove an organization member (organization owners only)')
    .option(...orgOption)
    .action(memberChange(orgOptionSchema, (ctx, input) => ctx.api.removeOrganizationMember(input)));
  org.command('audit').description('List recent organization audit events').option(...orgOption)
    .option('--limit <n>', 'Number of events (1-100, default 25)').action(run(
      auditOptionsSchema,
      scoped((ctx, organizationId, options) => ctx.api.listOrganizationAuditEvents({
        organizationId, ...(options.limit === undefined ? {} : { limit: options.limit }),
      })),
    ));
  const workspace = org.command('workspace').description('Workspaces linked to an organization');
  workspace.command('list').description('List the workspaces linked to the organization').option(...orgOption).action(run(
    orgOptionSchema,
    scoped((ctx, organizationId) => ctx.api.listOrganizationWorkspaces({ organizationId })),
    (value) => value.workspaces.map((entry) => `${entry.slug}\t${entry.status}\t${entry.name}\t${entry.id}`).join('\n'),
  ));
  const change = <T>(call: (ctx: OrganizationCliContext, input: { organizationId: string; tenantId: string }) => Promise<Result<T, AppError>>) =>
    (slug: unknown, raw: unknown) => run(orgOptionSchema, scoped(async (ctx, organizationId) => {
      const tenantId = await resolveWorkspaceId(ctx.api, slug);
      return tenantId.ok ? call(ctx, { organizationId, tenantId: tenantId.value }) : tenantId;
    }))(raw);
  workspace.command('link <slug>')
    .description('Link a workspace you own directly to the organization (organization owners only)')
    .option(...orgOption).action(change((ctx, input) => ctx.api.linkOrganizationWorkspace(input)));
  workspace.command('unlink <slug>')
    .description('Unlink a linked workspace from the organization (organization owners only)')
    .option(...orgOption).action(change((ctx, input) => ctx.api.unlinkOrganizationWorkspace(input)));
  workspace.command('sources <slug>')
    .description('Show whether each configuration group of a linked workspace comes from the workspace or the organization')
    .option(...orgOption)
    .action((slug: unknown, raw: unknown) => run(orgOptionSchema, scoped(async (ctx, organizationId) => {
      const chosen = selectorSchema.safeParse(slug);
      if (!chosen.success) return err(validation('Name the workspace by its slug'));
      const listed = await ctx.api.listOrganizationWorkspaces({ organizationId });
      if (!listed.ok) return listed;
      const match = listed.value.workspaces.find((entry) => entry.id === chosen.data || entry.slug === chosen.data.toLowerCase());
      if (match === undefined) return err(notFound('Workspace not found in this organization'));
      return ctx.api.getWorkspaceConfigSources({ organizationId, tenantId: match.id });
    }), (value) => value.sources.map((entry) => `${entry.group}\t${entry.source}`).join('\n'))(raw));
};
