import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { z } from 'zod';
import { createApiClient } from '#core/client/index.js';
import { EXIT_CODE_BY_ERROR_CODE, TENANT_HEADER } from '#core/contract/index.js';
import { err, ok, validation, type AppError, type Result } from '#core/domain/index.js';
import { emit } from '../output.js';
import { planManifest, preflightManifest } from './plan.js';
import { applyManifest } from './apply.js';
import { driftManifest } from './drift.js';
import { baseDomainSchema, manifestWorkspaceOrigins, workspaceHostGuard } from './instance.js';
import { confirmingOperator, readConfirmedWorkspaces } from './workspaces.js';

export type ManifestCliContext = { apiUrl: string; profile: { token: string | null }; json: boolean };
const optionsSchema = z.object({
  manifest: z.string().min(1), shop: z.string().min(1).optional(), integrations: z.boolean().optional(),
  reconfigurePayments: z.boolean().optional(), baseDomain: baseDomainSchema.optional(),
}).strict();

type HostCheck = () => Promise<Result<true, AppError>>;

const checkedFetch = (check: HostCheck): typeof fetch => async (input, init) => {
  const checked = await check();
  if (!checked.ok) return Response.json({ ok: false, error: checked.error }, { status: 400 });
  return fetch(input, init);
};

const sessionClient = (baseUrl: string, token: string | null, workspace: string | null, check?: HostCheck) => createApiClient({
  baseUrl,
  refuseRedirects: true,
  ...(check === undefined ? {} : { fetchImpl: checkedFetch(check) }),
  headers: () => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), ...(workspace === null ? {} : { [TENANT_HEADER]: workspace }) }),
});

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
  const shop = program.command('shop').description('Plan, apply and detect drift from a declarative shop manifest');
  const descriptions = {
    plan: 'Preview settings and catalogue changes without writing',
    apply: 'Apply settings and catalogue changes, stopping at the first error',
    drift: 'Read the plan and exit nonzero when managed workspace state differs',
  };
  for (const command of ['plan', 'apply', 'drift'] as const) {
    const subcommand = shop.command(command)
      .description(descriptions[command])
      .requiredOption('--manifest <file>', 'JSON manifest file').option('--shop <slug>', 'Select one manifest workspace')
      .option('--base-domain <domain>', 'Instance base domain, needed when the API origin does not report it (the platform host)');
    if (command === 'apply') {
      subcommand.option('--integrations', 'Configure integration credentials and register workspace Stripe webhooks')
        .option('--reconfigure-payments', 'With --integrations, configure Stripe again even when the workspace reports that mode as configured; registers a new webhook endpoint and signing secret');
    }
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
      const preflight = preflightManifest(input.value, options.data.shop);
      if (!preflight.ok) { emit(preflight, ctx.value.json, () => ''); return; }
      const { apiUrl, profile } = ctx.value;
      const confirmed = await readConfirmedWorkspaces(sessionClient(apiUrl, profile.token, null));
      if (!confirmed.ok) { emit(confirmed, ctx.value.json, () => ''); return; }
      const workspaceOrigin = await manifestWorkspaceOrigins(apiUrl, (workspace) => sessionClient(apiUrl, profile.token, workspace),
        preflight.value.map((shop) => shop.slug).filter((slug) => confirmed.value.has(slug)), options.data.baseDomain);
      if (!workspaceOrigin.ok) { emit(workspaceOrigin, ctx.value.json, () => ''); return; }
      const hostServedByInstance = workspaceHostGuard(new URL(apiUrl).origin, (origin) => createApiClient({ baseUrl: origin, refuseRedirects: true }));
      const clientFor = (workspace: string) => {
        if (!confirmed.value.has(workspace)) return null;
        const origin = workspaceOrigin.value(workspace);
        return sessionClient(origin, profile.token, workspace, () => hostServedByInstance(origin));
      };
      if (command === 'drift') {
        const result = await driftManifest(input.value, clientFor, options.data.shop);
        emit(result, ctx.value.json, (value) => JSON.stringify(value, null, 2));
        if (result.ok && result.value.drifted) process.exitCode = 1;
        return;
      }
      const result = command === 'plan'
        ? await planManifest(input.value, clientFor, options.data.shop)
        : await applyManifest(input.value, clientFor, options.data.shop, {
          integrations: options.data.integrations, reconfigurePayments: options.data.reconfigurePayments, environment: process.env,
          operator: confirmingOperator(createApiClient({ baseUrl: apiUrl, refuseRedirects: true }), confirmed.value),
        });
      emit(result, ctx.value.json, (value) => JSON.stringify(value, null, 2));
      if (command === 'plan' && result.ok && result.value.shops.some((entry) => entry.provisioning === 'missing')) {
        process.exitCode = EXIT_CODE_BY_ERROR_CODE.validation;
      }
    });
  }
};
