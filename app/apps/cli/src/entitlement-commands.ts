import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';
import { z } from 'zod';

import { createEntitlementClient, type EntitlementClient, type EntitlementClientOptions } from '#core/client/index.js';
import { err, validation, type AppError, type EntitlementCheckOutput, type Result } from '#core/domain/index.js';

import { emit } from './output.js';
import { readStdin } from './secret-input.js';

export const DEFAULT_ENTITLEMENT_KEY_ENV = 'TOGETHER_ENTITLEMENT_KEY';

type EntitlementCliContext = { apiUrl: string; tenant: string | null; json: boolean };
type EntitlementClientFactory = (options: EntitlementClientOptions) => EntitlementClient;

const checkOptionsSchema = z.object({
  email: z.array(z.string().min(1)).optional(),
  memberId: z.array(z.string().min(1)).optional(),
  product: z.array(z.string().min(1)).optional(),
  subjectsFile: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).default(DEFAULT_ENTITLEMENT_KEY_ENV),
}).passthrough();

type CliSubject = { email: string } | { memberId: string };

const MEMBER_LINE_PREFIX = 'member:';

export const parseSubjectLines = (text: string): CliSubject[] =>
  text.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.startsWith(MEMBER_LINE_PREFIX) ? { memberId: line.slice(MEMBER_LINE_PREFIX.length).trim() } : { email: line });

const readSubjectsFile = async (path: string | undefined): Promise<CliSubject[]> =>
  path === undefined ? [] : parseSubjectLines(path === '-' ? await readStdin() : await readFile(path, 'utf8'));

const subjectLabel = (subject: EntitlementCheckOutput['results'][number]['subject']): string =>
  'email' in subject ? subject.email : `member ${subject.memberId}`;

export const formatEntitlementCheck = (output: EntitlementCheckOutput): string =>
  output.results.map((result) => {
    const products = result.products.length === 0
      ? ['  no access']
      : result.products.map((product) => [
        `  ${product.productId}\t${product.access ? 'access' : 'no access'}`,
        ...(product.source === null ? [] : [`source=${product.source}`]),
        ...(product.subscription === null
          ? []
          : [`subscription=${product.subscription.status}`, `periodEnd=${product.subscription.currentPeriodEnd}`, ...(product.subscription.cancelAtPeriodEnd ? ['cancelAtPeriodEnd'] : [])]),
      ].join('\t'));
    return [`${subjectLabel(result.subject)}${result.member === null ? '' : ` (${result.member.id})`}`, ...products].join('\n');
  }).join('\n');

export const runEntitlementCheck = async (
  rawOptions: unknown,
  context: () => Result<EntitlementCliContext, AppError>,
  fallbackJson: boolean,
  createClient: EntitlementClientFactory = createEntitlementClient,
): Promise<void> => {
  const ctx = context();
  if (!ctx.ok) { emit(ctx, fallbackJson, () => ''); return; }
  const options = checkOptionsSchema.safeParse(rawOptions);
  if (!options.success) { emit(err(validation('Invalid entitlement check options', options.error.flatten())), ctx.value.json, () => ''); return; }
  const apiKey = process.env[options.data.apiKeyEnv]?.trim();
  if (!apiKey) {
    emit(err(validation(`Environment variable ${options.data.apiKeyEnv} must hold the entitlement key`)), ctx.value.json, () => '');
    return;
  }
  const subjects = [
    ...await readSubjectsFile(options.data.subjectsFile),
    ...(options.data.email ?? []).map((email) => ({ email })),
    ...(options.data.memberId ?? []).map((memberId) => ({ memberId })),
  ];
  if (subjects.length === 0) {
    emit(err(validation('Name at least one subject with --subjects-file, --email or --member-id')), ctx.value.json, () => '');
    return;
  }
  const client = createClient({
    baseUrl: ctx.value.apiUrl,
    apiKey,
    ...(ctx.value.tenant === null ? {} : { tenant: ctx.value.tenant }),
  });
  emit(
    await client.check({ subjects, ...(options.data.product === undefined ? {} : { productIds: options.data.product }) }),
    ctx.value.json,
    formatEntitlementCheck,
  );
};

export const registerEntitlementCommands = (
  program: Command,
  context: () => Result<EntitlementCliContext, AppError>,
): void => {
  program.command('entitlement')
    .description(`Check who has access in a workspace with an entitlement key read from an environment variable (default ${DEFAULT_ENTITLEMENT_KEY_ENV})`)
    .command('check')
    .description('Check whether people have access to the workspace\'s products; e-mail addresses match only verified accounts')
    .option('--subjects-file <path>', 'File with one e-mail address or member:<id> per line; - reads stdin (keeps addresses out of shell history and the process list)')
    .option('--email <address...>', 'E-mail addresses to check (they land in shell history; prefer --subjects-file)')
    .option('--member-id <id...>', 'Member ids to check (needs a key with entitlements:members:read)')
    .option('--product <id...>', 'Products to answer for; without it every product the key covers')
    .option('--api-key-env <name>', 'Environment variable holding the entitlement key', DEFAULT_ENTITLEMENT_KEY_ENV)
    .action((rawOptions: unknown) => runEntitlementCheck(rawOptions, context, program.opts()['json'] === true));
};
