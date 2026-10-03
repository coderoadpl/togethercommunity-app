import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import { operatorTenantSlugSchema, provisionTenantInputSchema, type OperatorTenantReadiness } from '#core/contract/index.js';
import { err, internal, validation, type AppError, type Result } from '#core/domain/index.js';

import { emit } from './output.js';

type OperatorCliContext = {
  api: Pick<ApiClient, 'provisionOperatorTenant' | 'getOperatorTenantReadiness'>;
  json: boolean;
};

const provisionOptionsSchema = z.object({
  slug: z.string(), name: z.string(), ownerEmail: z.string(), language: z.enum(['en', 'pl']).optional(),
});

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

export const registerOperatorCommands = (
  program: Command,
  context: () => Result<OperatorCliContext, AppError>,
): void => {
  const tenant = program.command('operator').description('Instance operator commands')
    .command('tenant').description('Operator workspace provisioning and readiness');
  const run = (provision: boolean) => async (raw: unknown) => {
    const ctx = context();
    if (!ctx.ok) { emit(ctx, program.opts()['json'] === true, () => ''); return; }
    const secret = process.env['OPERATOR_SECRET'];
    if (!secret) {
      emit(err(validation('OPERATOR_SECRET is required')), ctx.value.json, () => '');
      return;
    }
    try {
      if (provision) {
        const options = provisionOptionsSchema.safeParse(raw);
        const parsed = options.success ? provisionTenantInputSchema.safeParse({
          slug: options.data.slug, name: options.data.name, ownerEmail: options.data.ownerEmail,
          ...(options.data.language === undefined ? {} : { defaultLanguage: options.data.language }),
        }) : options;
        if (!parsed.success) {
          emit(err(validation('Invalid tenant provisioning payload')), ctx.value.json, () => '');
          return;
        }
        const result = await ctx.value.api.provisionOperatorTenant(parsed.data, secret);
        emit(result, ctx.value.json, (value) =>
          `${value.tenant.slug}: created=${value.created}\n${checklist(value.readiness)}`);
      } else {
        const parsed = z.object({ slug: operatorTenantSlugSchema }).safeParse(raw);
        if (!parsed.success) {
          emit(err(validation('Invalid tenant slug')), ctx.value.json, () => '');
          return;
        }
        emit(await ctx.value.api.getOperatorTenantReadiness(parsed.data.slug, secret), ctx.value.json, checklist);
      }
    } catch {
      emit(err(internal('Operator request failed')), ctx.value.json, () => '');
    }
  };
  tenant.command('provision').description('Create a workspace for an existing verified owner')
    .requiredOption('--slug <slug>', 'Workspace slug')
    .requiredOption('--name <name>', 'Workspace name')
    .requiredOption('--owner-email <email>', 'Verified owner email')
    .option('--language <language>', 'Default workspace language (en or pl)')
    .action(run(true));
  tenant.command('readiness').description('Read the workspace readiness checklist')
    .requiredOption('--slug <slug>', 'Workspace slug').action(run(false));
};
