import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { z } from 'zod';
import { createApiClient } from '#core/client/index.js';
import { TENANT_HEADER } from '#core/contract/index.js';
import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import { emit } from '../output.js';
import { planManifest } from './plan.js';
import { applyManifest } from './apply.js';

export type ManifestCliContext = { apiUrl: string; profile: { token: string | null }; json: boolean };
const optionsSchema = z.object({ manifest: z.string().min(1), shop: z.string().min(1).optional(), integrations: z.boolean().optional() }).strict();

export const manifestApiUrl = (baseUrl: string, workspace: string): string => {
  const url = new URL(baseUrl);
  if (url.hostname === 'togethercommunity.app' || url.hostname.endsWith('.togethercommunity.app')) {
    url.hostname = `${workspace}.togethercommunity.app`;
  } else if (url.hostname.endsWith('.localhost')) {
    url.hostname = `${workspace}.localhost`;
  }
  return url.origin;
};

export const readManifestFile = async (path: string): Promise<Result<unknown, AppError>> => {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch { return err(validation('Could not read the manifest file')); }
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch { return err(validation('Manifest must be valid JSON')); }
};

export const registerShopManifestCommands = (program: Command, context: () => Result<ManifestCliContext, AppError>): void => {
  const shop = program.command('shop').description('Plan and apply a declarative shop manifest');
  for (const command of ['plan', 'apply'] as const) {
    const subcommand = shop.command(command)
      .description(command === 'plan' ? 'Preview settings and catalogue changes without writing' : 'Apply settings and catalogue changes, stopping at the first error')
      .requiredOption('--manifest <file>', 'JSON manifest file').option('--shop <slug>', 'Select one manifest workspace');
    if (command === 'apply') subcommand.option('--integrations', 'Configure integration credentials and register workspace Stripe webhooks');
    subcommand.action(async (raw: unknown) => {
      const ctx = context();
      if (!ctx.ok) {
        const globals = z.object({ json: z.boolean().default(false) }).safeParse(program.optsWithGlobals());
        emit(ctx, globals.success && globals.data.json, () => '');
        return;
      }
      const options = optionsSchema.safeParse(raw);
      if (!options.success) { emit(err(validation('Invalid shop command options')), ctx.value.json, () => ''); return; }
      const input = await readManifestFile(options.data.manifest);
      if (!input.ok) { emit(input, ctx.value.json, () => ''); return; }
      const clientFor = (workspace: string) => createApiClient({
        baseUrl: manifestApiUrl(ctx.value.apiUrl, workspace),
        headers: () => ({
          ...(ctx.value.profile.token ? { authorization: `Bearer ${ctx.value.profile.token}` } : {}),
          [TENANT_HEADER]: workspace,
        }),
      });
      const result = command === 'plan'
        ? await planManifest(input.value, clientFor, options.data.shop)
        : await applyManifest(input.value, clientFor, options.data.shop, {
          integrations: options.data.integrations, environment: process.env, operator: createApiClient({ baseUrl: ctx.value.apiUrl }),
        });
      emit(result, ctx.value.json, (value) => JSON.stringify(value, null, 2));
    });
  }
};
