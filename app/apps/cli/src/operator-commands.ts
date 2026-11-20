import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import { createOrganizationInputSchema, operatorTenantSlugSchema, organizationLimitsSchema, provisionTenantInputSchema, type OperatorTenantReadiness, type SecretFingerprints } from '#core/contract/index.js';
import { err, internal, validation, type AppError, type Result } from '#core/domain/index.js';
import { secureApiBaseUrl } from '#core/domain/network.js';

import { emit } from './output.js';

type OperatorCliContext = {
  api: Pick<ApiClient, 'provisionOperatorTenant' | 'getOperatorTenantReadiness' | 'getSecretFingerprints' | 'operatorCreateOrganization' | 'operatorSetOrganizationLimits'>;
  apiUrl: string;
  json: boolean;
};

const provisionOptionsSchema = z.object({
  slug: z.string(), name: z.string(), ownerEmail: z.string(), language: z.enum(['en', 'pl']).optional(),
});

const organizationCreateOptionsSchema = z.object({
  slug: z.string(), name: z.string(), ownerEmail: z.string(), maxWorkspaces: z.coerce.number().optional(),
});
const organizationLimitsOptionsSchema = z.object({ maxWorkspaces: z.coerce.number() });

const checklist = (readiness: OperatorTenantReadiness): string => [
  `tenantExists=${readiness.tenantExists}`,
  `ownerGrantPresent=${readiness.ownerGrantPresent}`,
  `storageConfigured=${readiness.storageConfigured}`,
  `lastProbeOk=${readiness.lastProbeOk}`,
  `lastProbeAt=${readiness.lastProbeAt ?? '-'}`,
  `stripeConfigured=${readiness.stripeConfigured}`,
  `mode=${readiness.mode ?? '-'}`,
  `webhookEndpointRegistered=${readiness.webhookEndpointRegistered}`,
  `legalUrlsSet=${readiness.legalUrlsSet}`,
  `publishedProducts=${readiness.publishedProducts}`,
].join('\n');

const fingerprintLines = ({ secrets }: SecretFingerprints): string =>
  secrets.map((entry) => `${entry.name}=${entry.fingerprint ?? 'not-set'}`).join('\n');

export const registerOperatorCommands = (
  program: Command,
  context: () => Result<OperatorCliContext, AppError>,
): void => {
  const operator = program.command('operator').description('Instance operator commands');
  const tenant = operator.command('tenant').description('Operator workspace provisioning and readiness');
  const withSecretFrom = (envName: 'OPERATOR_SECRET' | 'SECRET_FINGERPRINT_READ_SECRET') => (
    action: (ctx: OperatorCliContext, secret: string, raw: unknown) => Promise<void>,
  ) => async (raw: unknown) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
    if (secureApiBaseUrl(ctx.value.apiUrl) === null) {
      emit(err(validation('Operator commands need an https API URL, or http on a local host')), ctx.value.json, () => '');
      return;
    }
    const secret = process.env[envName];
    if (!secret) {
      emit(err(validation(`${envName} is required`)), ctx.value.json, () => '');
      return;
    }
    try {
      await action(ctx.value, secret, raw);
    } catch {
      emit(err(internal('Operator request failed')), ctx.value.json, () => '');
    }
  };
  const withOperatorSecret = withSecretFrom('OPERATOR_SECRET');
  const provision = withOperatorSecret(async (ctx, secret, raw) => {
    const options = provisionOptionsSchema.safeParse(raw);
    const parsed = options.success ? provisionTenantInputSchema.safeParse({
      slug: options.data.slug, name: options.data.name, ownerEmail: options.data.ownerEmail,
      ...(options.data.language === undefined ? {} : { defaultLanguage: options.data.language }),
    }) : options;
    if (!parsed.success) {
      emit(err(validation('Invalid tenant provisioning payload')), ctx.json, () => '');
      return;
    }
    emit(await ctx.api.provisionOperatorTenant(parsed.data, secret), ctx.json, (value) =>
      `${value.tenant.slug}: created=${value.created}\n${checklist(value.readiness)}`);
  });
  const readiness = withOperatorSecret(async (ctx, secret, raw) => {
    const parsed = z.object({ slug: operatorTenantSlugSchema }).safeParse(raw);
    if (!parsed.success) {
      emit(err(validation('Invalid tenant slug')), ctx.json, () => '');
      return;
    }
    emit(await ctx.api.getOperatorTenantReadiness(parsed.data.slug, secret), ctx.json, checklist);
  });
  const fingerprints = withSecretFrom('SECRET_FINGERPRINT_READ_SECRET')(async (ctx, secret) => {
    emit(await ctx.api.getSecretFingerprints(secret), ctx.json, fingerprintLines);
  });
  tenant.command('provision').description('Create a workspace for an existing verified owner')
    .requiredOption('--slug <slug>', 'Workspace slug')
    .requiredOption('--name <name>', 'Workspace name')
    .requiredOption('--owner-email <email>', 'Verified owner email')
    .option('--language <language>', 'Default workspace language (en or pl)')
    .action(provision);
  tenant.command('readiness').description('Read the workspace readiness checklist')
    .requiredOption('--slug <slug>', 'Workspace slug').action(readiness);
  operator.command('secrets').description('Checks of deployment secrets')
    .command('fingerprints')
    .description('Print the HMAC fingerprint of every server secret, never a value; reads SECRET_FINGERPRINT_READ_SECRET, not OPERATOR_SECRET')
    .action(fingerprints);

  const operatorSecret = (json: boolean): string | null => {
    const secret = process.env['OPERATOR_SECRET'];
    if (secret) return secret;
    emit(err(validation('OPERATOR_SECRET is required')), json, () => '');
    return null;
  };
  const org = operator.command('org').description('Operator organization creation and limits');
  org.command('create').description('Create an organization owned by an existing verified account')
    .requiredOption('--slug <slug>', 'Organization slug')
    .requiredOption('--name <name>', 'Organization name')
    .requiredOption('--owner-email <email>', 'Verified owner email')
    .option('--max-workspaces <n>', 'Maximum number of workspaces (default 0)')
    .action(async (raw: unknown) => {
      const ctx = context();
      if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
      const secret = operatorSecret(ctx.value.json);
      if (secret === null) return;
      const options = organizationCreateOptionsSchema.safeParse(raw);
      const parsed = options.success ? createOrganizationInputSchema.safeParse({
        slug: options.data.slug, name: options.data.name, ownerEmail: options.data.ownerEmail,
        ...(options.data.maxWorkspaces === undefined ? {} : { maxWorkspaces: options.data.maxWorkspaces }),
      }) : options;
      if (!parsed.success) {
        emit(err(validation('Invalid organization payload')), ctx.value.json, () => '');
        return;
      }
      try {
        emit(await ctx.value.api.operatorCreateOrganization(parsed.data, secret), ctx.value.json, (value) =>
          `${value.organization.slug}: created=${value.created}\nid=${value.organization.id}\nmaxWorkspaces=${value.organization.maxWorkspaces}`);
      } catch {
        emit(err(internal('Operator request failed')), ctx.value.json, () => '');
      }
    });
  org.command('limits <organizationId>').description('Set the workspace limit of an organization')
    .requiredOption('--max-workspaces <n>', 'Maximum number of workspaces')
    .action(async (organizationId: unknown, raw: unknown) => {
      const ctx = context();
      if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
      const secret = operatorSecret(ctx.value.json);
      if (secret === null) return;
      const id = z.string().trim().min(1).safeParse(organizationId);
      const options = organizationLimitsOptionsSchema.safeParse(raw);
      const limits = options.success ? organizationLimitsSchema.safeParse(options.data) : options;
      if (!id.success || !limits.success) {
        emit(err(validation('Invalid organization limits')), ctx.value.json, () => '');
        return;
      }
      try {
        emit(await ctx.value.api.operatorSetOrganizationLimits({ organizationId: id.data, ...limits.data }, secret), ctx.value.json,
          (value) => `${value.organization.slug}: maxWorkspaces=${value.organization.maxWorkspaces}`);
      } catch {
        emit(err(internal('Operator request failed')), ctx.value.json, () => '');
      }
    });
};
