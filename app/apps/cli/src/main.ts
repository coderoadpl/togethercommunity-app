import { readFile, writeFile } from 'node:fs/promises';

import { Command, CommanderError } from 'commander';
import { z, type ZodTypeAny } from 'zod';

import { createCliAuthAdapter, type CliAuthAdapter } from '#adapters/auth/client-adapter.js';
import { createApiClient, type ApiClient } from '#core/client/index.js';
import { API_KEY_HEADER, TENANT_HEADER } from '#core/contract/index.js';
import {
  accessItemSchema,
  currencySchema,
  devGrantInputSchema,
  err,
  internal,
  m2mEnrollInputSchema,
  memberExportFormatSchema,
  newCourseLessonSchema,
  newCourseModuleSchema,
  notFound,
  ok,
  priceMajorSchema,
  reactionEmojiSchema,
  spaceVisibilitySchema,
  tenantSecretKeySchema,
  transactionalLanguageSchema,
  updateCourseLessonInputSchema,
  updateCourseModuleInputSchema,
  updateLastViewedInputSchema,
  updateProductAccessItemsInputSchema,
  validation,
  type AccessStatus,
  type AppError,
  type LessonReferences,
  type Result,
} from '#core/domain/index.js';

import {
  apiOrigin,
  loadConfig,
  resolveCliConfig,
  saveConfig,
  updateOriginProfile,
  type CliConfig,
  type CliOriginSource,
  type CliProfile,
} from './config.js';
import { emit } from './output.js';
import { formatSchedulerRun, formatSchedulerRuns } from './scheduler-runs-output.js';

const program = new Command('together')
  .description('Reference client for the together API - the agent feedback loop')
  .option('--json', 'machine-readable JSON output', false)
  .option('--api-url <url>', 'API base URL (overrides config)')
  .option('--tenant <slug>', 'tenant slug for this invocation (overrides config)');

program.exitOverride().configureOutput({ writeErr: () => {} });

interface CliCtx {
  config: CliConfig;
  api: ApiClient;
  auth: CliAuthAdapter;
  apiUrl: string;
  origin: string;
  originSource: CliOriginSource;
  profile: CliProfile;
  tenant: string | null;
  json: boolean;
}

const globalOptionsSchema = z.object({
  json: z.boolean().default(false),
  apiUrl: z.string().url().optional(),
  tenant: z.string().min(1).optional(),
});
const cliEnvSchema = z.object({
  TOGETHER_CLI_API_URL: z.string().url().optional(),
  TOGETHER_CLI_TENANT: z.string().min(1).optional(),
});
const originUseSchema = z.tuple([z.string().url(), z.object({}).passthrough()]);

const centsSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, 'Price must be a non-negative integer number of cents')
  .transform((value) => Number.parseInt(value, 10));

const emailOptionSchema = z.object({ email: z.string().email() });
const authPasswordOptionsSchema = emailOptionSchema.extend({ password: z.string().min(1) });
const registerOptionsSchema = authPasswordOptionsSchema.extend({ name: z.string().min(1) });
const passwordResetRequestOptionsSchema = emailOptionSchema.extend({ language: z.string().min(1).optional() });
const resetPasswordOptionsSchema = z.object({ token: z.string().min(1), password: z.string().min(1) });
const tenantCreateOptionsSchema = z.object({ slug: z.string().min(1).optional() });
const tenantSettingsOptionsSchema = z.object({
  billingPortalUrl: z.string().url().optional(),
  clearBillingPortalUrl: z.boolean().optional(),
});
const productCreateOptionsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  priceCents: centsSchema.optional(),
  price: priceMajorSchema.optional(),
  currency: currencySchema.optional(),
  description: z.string().optional(),
  accessItems: z.string().optional(),
});
const simulatePurchaseOptionsSchema = z.object({
  email: z.string().email(),
  product: z.string().min(1),
  priceId: z.string().min(1).optional(),
});
const priceAddOptionsSchema = z.object({
  product: z.string().min(1),
  kind: z.enum(['one_time', 'recurring']),
  interval: z.enum(['month', 'year']).optional(),
  priceCents: centsSchema.optional(),
  price: priceMajorSchema.optional(),
  currency: currencySchema.optional(),
});
const ordersListOptionsSchema = z.object({
  status: z.enum(['paid', 'pending', 'failed', 'refunded']).optional(),
  product: z.string().min(1).optional(),
  kind: z.enum(['one_time', 'recurring']).optional(),
  coupon: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  page: z
    .string()
    .regex(/^[1-9]\d*$/, 'page must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
  pageSize: z
    .string()
    .regex(/^[1-9]\d*$/, 'page-size must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
});
const ordersExportOptionsSchema = z.object({
  format: z.enum(['csv', 'json']),
  status: z.enum(['paid', 'pending', 'failed', 'refunded']).optional(),
  product: z.string().min(1).optional(),
  kind: z.enum(['one_time', 'recurring']).optional(),
  coupon: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  out: z.string().min(1).optional(),
});
const ordersReconciliationOptionsSchema = z.object({
  minAgeMinutes: z
    .string()
    .regex(/^\d+$/, 'min-age-minutes must be a non-negative integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
});
const supportMessageOptionsSchema = z.object({
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
});
const couponCreateOptionsSchema = z.object({
  code: z.string().trim().min(1),
  kind: z.enum(['percent', 'amount']),
  value: z.string().regex(/^\d+$/).transform((entry) => Number.parseInt(entry, 10)),
  products: z.array(z.string().min(1)).optional(),
  appliesTo: z.enum(['one_time', 'recurring', 'both']).optional(),
  recurringDuration: z.enum(['first_invoice', 'forever']).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  maxRedemptions: z.string().regex(/^[1-9]\d*$/).transform((entry) => Number.parseInt(entry, 10)).optional(),
  maxPerMember: z.string().regex(/^[1-9]\d*$/).transform((entry) => Number.parseInt(entry, 10)).optional(),
  partner: z.string().trim().min(1).optional(),
});
const couponExportOptionsSchema = z.object({
  format: z.enum(['csv', 'json']),
  partner: z.string().trim().min(1).optional(),
  out: z.string().min(1).optional(),
});
const checkoutSessionOptionsSchema = z.object({
  product: z.string().min(1),
  email: z.string().email().optional(),
  language: transactionalLanguageSchema.optional(),
});
const memberExportOptionsSchema = z.object({
  format: memberExportFormatSchema,
  out: z.string().min(1).optional(),
});
const noOptionsSchema = z.object({});
const emailDispatchOptionsSchema = z.object({ secret: z.string().min(1) });
const schedulerRunsListOptionsSchema = z.object({
  secret: z.string().min(1),
  kind: z.enum(['marketing_tick', 'outbox_dispatch']).optional(),
  status: z.enum(['running', 'completed', 'failed']).optional(),
  since: z.string().datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).transform((value) => Number.parseInt(value, 10)).optional(),
});
const schedulerRunShowOptionsSchema = z.object({ secret: z.string().min(1) });
const consentDefinitionCreateOptionsSchema = z.object({
  key: z.string().min(1), label: z.string().min(1), documentUrl: z.string().url(), singleOptIn: z.boolean().optional(),
});
const campaignCreateOptionsSchema = z.object({
  name: z.string().min(1), subject: z.string().min(1), bodyHtml: z.string().min(1), consentDefinition: z.string().min(1),
});
const campaignScheduleOptionsSchema = z.object({ campaign: z.string().min(1), sendAt: z.string().datetime() });
const suppressionAddOptionsSchema = z.object({ email: z.string().email(), sourceRef: z.string().min(1).optional() });

const jsonSourceOptionsSchema = z.object({
  data: z.string().optional(),
  jsonFile: z.string().min(1).optional(),
});

const courseCreateOptionsSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  legacyId: z.string().min(1).optional(),
});
const courseUpdateOptionsSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  moduleOrder: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .optional(),
});
const moduleAttachOptionsSchema = z.object({
  course: z.string().min(1),
  module: z.string().min(1),
});
const moduleDetachOptionsSchema = z.object({
  course: z.string().min(1),
  module: z.string().min(1),
});
const historyOptionsSchema = z.object({
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
});
const productAccessItemsInlineSchema = z.array(accessItemSchema);
const lastViewedOptionsSchema = z.object({
  course: z.string().min(1),
  lesson: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  chapter: z.string().min(1).optional(),
});
const devGrantOptionsSchema = z.object({
  email: z.string().email(),
  product: z.string().min(1),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});
const m2mEnrollOptionsSchema = z.object({
  apiKey: z.string().min(1),
  email: z.string().email(),
  product: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
  language: transactionalLanguageSchema.optional(),
  skipEmail: z.boolean().optional(),
});
const stripeWebhookOptionsSchema = z.object({
  tenantId: z.string().min(1),
  webhookSecret: z.string().min(1),
  event: z.string().min(1),
});
const discussionPostOptionsSchema = z.object({
  lesson: z.string().min(1),
  body: z.string().min(1),
});
const discussionReplyOptionsSchema = discussionPostOptionsSchema.extend({
  parent: z.string().min(1),
});
const discussionListOptionsSchema = z.object({
  lesson: z.string().min(1),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
});
const discussionSearchOptionsSchema = z.object({
  query: z.string().min(1),
  lesson: z.string().min(1).optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
});
const reactionOptionsSchema = z.object({
  post: z.string().min(1),
  emoji: reactionEmojiSchema,
});
const postReportOptionsSchema = z.object({
  post: z.string().min(1),
  reason: z.enum(['spam', 'harassment', 'off-topic', 'illegal', 'other']),
  note: z.string().max(1000).optional(),
});
const reportListOptionsSchema = z.object({
  status: z.enum(['open', 'dismissed', 'resolved']).optional(),
});
const reportResolveOptionsSchema = z.object({
  report: z.string().min(1),
  action: z.enum(['dismiss', 'delete-post']),
});
const spaceCreateOptionsSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  visibility: spaceVisibilitySchema,
  products: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .optional(),
});
const spaceUpdateOptionsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  visibility: spaceVisibilitySchema.optional(),
  products: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .optional(),
  position: z
    .string()
    .regex(/^\d+$/, 'position must be a non-negative integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
});
const spaceFeedOptionsSchema = z.object({
  space: z.string().min(1),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
  cursor: z.string().min(1).optional(),
});
const spacePostOptionsSchema = z.object({
  space: z.string().min(1),
  body: z.string().min(1),
});
const spaceReplyOptionsSchema = spacePostOptionsSchema.extend({
  parent: z.string().min(1),
});
const spaceIdOptionsSchema = z.object({
  space: z.string().min(1),
});
const notificationsListOptionsSchema = z.object({
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
    .transform((value) => Number.parseInt(value, 10))
    .optional(),
});
const notificationReadOptionsSchema = z.object({
  all: z.boolean().optional(),
});

const hmacSha256 = async (secret: string, value: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readJsonPayload = async (
  inline: string | undefined,
  file: string | undefined,
): Promise<Result<unknown, AppError>> => {
  const provided = [inline, file].filter((value) => value !== undefined).length;
  if (provided === 0) return err(validation('Provide the payload with --json <inline> or --json-file <path>'));
  if (provided > 1) return err(validation('Provide only one of --json or --json-file'));
  let raw: string;
  if (file !== undefined) {
    try {
      raw = await readFile(file, 'utf8');
    } catch (cause) {
      return err(validation(`Could not read JSON file "${file}": ${String(cause)}`));
    }
  } else {
    raw = inline ?? '';
  }
  try {
    return ok(JSON.parse(raw));
  } catch (cause) {
    return err(validation(`Invalid JSON payload: ${String(cause)}`));
  }
};

const accessGlyph = (status: AccessStatus): string =>
  status === 'fully-accessible' ? 'open' : status === 'partially-accessible' ? 'partial' : 'locked';

const slugFromName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const rawGlobalOptions = (): unknown => program.opts();

const currentJsonFlag = (): boolean => {
  const parsed = z.object({ json: z.boolean().default(false) }).passthrough().safeParse(rawGlobalOptions());
  return parsed.success ? parsed.data.json : false;
};

const parsedInput = <S extends ZodTypeAny>(
  schema: S,
  input: unknown,
  message: string,
): Result<z.output<S>, AppError> => {
  const parsed = schema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err(validation(message, parsed.error.flatten()));
};

const cliCtx = (): Result<CliCtx, AppError> => {
  const config = loadConfig();
  const globals = parsedInput(globalOptionsSchema, rawGlobalOptions(), 'Invalid global CLI options');
  if (!globals.ok) return globals;
  const env = parsedInput(cliEnvSchema, process.env, 'Invalid CLI environment');
  if (!env.ok) return env;
  const resolved = resolveCliConfig({
    config,
    cwd: process.cwd(),
    env: env.value,
    ...(globals.value.apiUrl === undefined ? {} : { apiUrl: globals.value.apiUrl }),
    ...(globals.value.tenant === undefined ? {} : { tenant: globals.value.tenant }),
  });
  const { apiUrl, origin, originSource, profile, tenant } = resolved;
  const api = createApiClient({
    baseUrl: apiUrl,
    headers: () => ({
      ...(profile.token ? { authorization: `Bearer ${profile.token}` } : {}),
      ...(tenant ? { [TENANT_HEADER]: tenant } : {}),
    }),
  });
  const auth = createCliAuthAdapter(apiUrl, (token) => {
    saveConfig(updateOriginProfile(config, origin, { token }, originSource !== 'repo'));
  }, () => profile.token);
  return ok({
    config,
    api,
    auth,
    apiUrl,
    origin,
    originSource,
    profile,
    tenant,
    json: globals.value.json,
  });
};

const saveActiveProfile = (ctx: CliCtx, patch: Partial<CliProfile>): void => {
  saveConfig(
    updateOriginProfile(ctx.config, ctx.origin, patch, ctx.originSource !== 'repo'),
  );
};

const withCtx =
  (handler: (ctx: CliCtx) => Promise<void> | void) =>
  async (): Promise<void> => {
    const ctx = cliCtx();
    if (!ctx.ok) {
      emit(ctx, currentJsonFlag(), () => '');
      return;
    }
    await handler(ctx.value);
  };

const withInput =
  <S extends ZodTypeAny>(
    schema: S,
    handler: (ctx: CliCtx, input: z.output<S>) => Promise<void> | void,
  ) =>
  async (...raw: unknown[]): Promise<void> => {
    const ctx = cliCtx();
    if (!ctx.ok) {
      emit(ctx, currentJsonFlag(), () => '');
      return;
    }
    const commandInput = raw.at(-1) instanceof Command ? raw.slice(0, -1) : raw;
    const input = parsedInput(schema, commandInput, 'Invalid command arguments');
    if (!input.ok) {
      emit(input, ctx.value.json, () => '');
      return;
    }
    await handler(ctx.value, input.value);
  };

program.command('health').description('API and database status').action(
  withCtx(async (ctx) => {
    emit(
      await ctx.api.health(),
      ctx.json,
      (h) => `status=${h.status} db=${h.database} v${h.version} sha=${h.sha}`,
    );
  }),
);

program
  .command('register')
  .description('Create an account (and sign in)')
  .requiredOption('--name <name>')
  .requiredOption('--email <email>')
  .requiredOption('--password <password>')
  .action(
    withInput(z.tuple([registerOptionsSchema]), async (ctx, [options]) => {
      const result = await ctx.auth.signUp(options);
      if (result.ok && result.value.token) {
        saveActiveProfile(ctx, { token: result.value.token });
      }
      emit(result, ctx.json, () => `registered and signed in as ${options.email}`);
    }),
  );

program
  .command('login')
  .description('Sign in and store the session token')
  .requiredOption('--email <email>')
  .requiredOption('--password <password>')
  .action(
    withInput(z.tuple([authPasswordOptionsSchema]), async (ctx, [options]) => {
      const result = await ctx.auth.signIn(options);
      if (result.ok) {
        if (!result.value.token) {
          emit(err(internal('Server did not return a session token')), ctx.json, () => '');
          return;
        }
        saveActiveProfile(ctx, { token: result.value.token });
      }
      emit(result, ctx.json, () => `signed in as ${options.email}`);
    }),
  );

program.command('logout').description('Revoke and drop the stored session token').action(
  withCtx(async (ctx) => {
    const result = await ctx.auth.signOut();
    saveActiveProfile(ctx, { token: null });
    emit(result.ok ? ok({ loggedOut: true }) : result, ctx.json, () => 'signed out');
  }),
);

program.command('whoami').description('Current user and active tenant').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.me(), ctx.json, (me) =>
      me.tenant
        ? `${me.email} @ ${me.tenant.name} (${me.tenant.slug}, staff: ${me.tenant.staffRole ?? 'none'})`
        : `${me.email} (no tenant selected)`,
    );
  }),
);

const originCommand = program.command('origin').description('API-origin profiles');

originCommand.command('list').description('List configured API origins').action(
  withCtx((ctx) => {
    const origins = Object.entries(ctx.config.profiles)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([profileOrigin, profile]) => ({
        origin: profileOrigin,
        current: profileOrigin === ctx.config.currentOrigin,
        hasToken: profile.token !== null,
        tenant: profile.tenant,
      }));
    emit(ok({ origins }), ctx.json, (data) =>
      data.origins.length === 0
        ? 'no configured origins'
        : data.origins
            .map((entry) =>
              `${entry.current ? '*' : ' '} ${entry.origin}\ttoken=${entry.hasToken ? 'present' : 'absent'}\ttenant=${entry.tenant ?? '-'}`,
            )
            .join('\n'),
    );
  }),
);

originCommand
  .command('use <url>')
  .description('Select an API origin without making a network call')
  .action(
    withInput(originUseSchema, (ctx, [url]) => {
      const selectedOrigin = apiOrigin(url);
      saveConfig(updateOriginProfile(ctx.config, selectedOrigin, {}, true));
      emit(ok({ origin: selectedOrigin }), ctx.json, (data) => `active origin: ${data.origin}`);
    }),
  );

const publicCommand = program.command('public').description('Public read-only API');

publicCommand.command('offer').description('Show the public offer').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.publicOffer(), ctx.json, (data) =>
      data.products.length === 0
        ? `${data.tenant.name} (${data.tenant.slug}) has no published products`
        : data.products
            .map((product) => `- ${product.title}  ${product.priceCents} ${product.currency}  (${product.id})`)
            .join('\n'),
    );
  }),
);

publicCommand.command('auth-config').description('Show public auth configuration').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.authConfig(), ctx.json, (data) =>
      `google=${data.googleEnabled ? 'enabled' : 'disabled'} passkeys=${data.passkeysEnabled ? 'enabled' : 'disabled'}`,
    );
  }),
);

publicCommand.command('payment-config').description('Show public payment configuration').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.publicPaymentConfig(), ctx.json, (data) =>
      `stripe=${data.stripeConfigured ? 'configured' : 'not-configured'} simulated=${data.simulatedPaymentsEnabled ? 'enabled' : 'disabled'}`,
    );
  }),
);

const checkout = program.command('checkout').description('Public checkout');

checkout
  .command('session')
  .description('Create a Stripe-hosted checkout session')
  .requiredOption('--product <id>')
  .option('--email <email>')
  .option('--language <language>', 'checkout language (pl or en)')
  .action(
    withInput(z.tuple([checkoutSessionOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.createCheckoutSession({
          productId: options.product,
          ...(options.email === undefined ? {} : { email: options.email }),
          ...(options.language === undefined ? {} : { language: options.language }),
        }),
        ctx.json,
        (data) => data.url,
      );
    }),
  );

const tenant = program.command('tenant').description('Tenant staff access');

tenant.command('list').description('Tenants you administer').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.listTenants(), ctx.json, (data) =>
      data.tenants.length === 0
        ? 'no staff tenants'
        : data.tenants.map((m) => `${m.tenant.slug}\t${m.tenant.name}\t(${m.staffRole})`).join('\n'),
    );
  }),
);

tenant
  .command('create <name...>')
  .description('Create a tenant and become its owner')
  .option('--slug <slug>', 'tenant slug')
  .action(
    withInput(
      z.tuple([z.array(z.string().min(1)).min(1), tenantCreateOptionsSchema]),
      async (ctx, [nameWords, options]) => {
        const name = nameWords.join(' ');
        const slug = options.slug ?? slugFromName(name);
        emit(await ctx.api.createTenant({ slug, name }), ctx.json, (data) =>
          `created tenant: ${data.tenant.name} (${data.tenant.slug})`,
        );
      },
    ),
  );

tenant
  .command('switch <slug>')
  .description('Set the active tenant for subsequent commands')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [slug]) => {
      const tenants = await ctx.api.listTenants();
      if (!tenants.ok) {
        emit(tenants, ctx.json, () => '');
        return;
      }
      const membership = tenants.value.tenants.find((m) => m.tenant.slug === slug);
      if (!membership) {
        emit(err(notFound(`You do not administer any tenant with slug "${slug}"`)), ctx.json, () => '');
        return;
      }
      saveActiveProfile(ctx, { tenant: slug });
      emit(ok(membership), ctx.json, (m) => `active tenant: ${m.tenant.name} (${m.tenant.slug})`);
    }),
  );

tenant.command('settings').description('Show tenant settings').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.getTenantSettings(), ctx.json, (data) =>
      `billing portal url: ${data.settings.billingPortalUrl ?? '(not set)'}`,
    );
  }),
);

tenant
  .command('settings-set')
  .description('Update tenant settings (owner only)')
  .option('--billing-portal-url <url>', 'billing portal URL shown to members')
  .option('--clear-billing-portal-url', 'remove the billing portal URL')
  .action(
    withInput(z.tuple([tenantSettingsOptionsSchema]), async (ctx, [options]) => {
      const billingPortalUrl = options.clearBillingPortalUrl === true ? null : options.billingPortalUrl;
      if (billingPortalUrl === undefined) {
        emit(
          err(validation('Pass --billing-portal-url <url> or --clear-billing-portal-url')),
          ctx.json,
          () => '',
        );
        return;
      }
      emit(await ctx.api.updateTenantSettings({ billingPortalUrl }), ctx.json, (data) =>
        `billing portal url: ${data.settings.billingPortalUrl ?? '(not set)'}`,
      );
    }),
  );

const onboarding = program.command('onboarding').description('Creator onboarding checklist');

const onboardingLines = (data: { onboarding: { steps: { id: string; done: boolean; target: string }[]; dismissed: boolean } }): string => {
  const done = data.onboarding.steps.filter((step) => step.done).length;
  return [
    `onboarding: ${done}/${data.onboarding.steps.length} done${data.onboarding.dismissed ? ' (dismissed)' : ''}`,
    ...data.onboarding.steps.map((step) => `[${step.done ? 'x' : ' '}] ${step.id}\t${step.target}`),
  ].join('\n');
};

onboarding.command('show').description('Show the checklist for the active tenant').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.getOnboarding(), ctx.json, onboardingLines);
  }),
);

onboarding.command('dismiss').description('Hide the checklist for the active tenant').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.dismissOnboarding(), ctx.json, onboardingLines);
  }),
);

const product = program.command('product').description('Products in the active tenant');

product.command('list').description('List products').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.listProducts(), ctx.json, (data) =>
      data.products.length === 0
        ? 'no products'
        : data.products
            .map(
              (p) =>
                `- ${p.title}  ${p.priceCents} ${p.currency}  [${p.published ? 'published' : 'draft'}]  (${p.id.slice(0, 8)})`,
            )
            .join('\n'),
    );
  }),
);

product
  .command('create')
  .description('Create a product in the active tenant')
  .requiredOption('--title <title>')
  .option('--price-cents <cents>', 'price in integer cents')
  .option('--price <amount>', 'price in currency units, e.g. 199 or 199.99')
  .option('--currency <currency>', '3-letter uppercase currency code')
  .option('--description <description>')
  .option('--access-items <json>', 'inline JSON access items, e.g. [{"level":"course","courseId":"c1"},{"level":"modules","courseId":"c1","moduleIds":["m1"]}]')
  .action(
    withInput(z.tuple([productCreateOptionsSchema]), async (ctx, [options]) => {
      if (options.price !== undefined && options.priceCents !== undefined) {
        emit(err(validation('Provide only one of --price and --price-cents')), ctx.json, () => '');
        return;
      }
      const priceCents = options.price ?? options.priceCents;
      if (priceCents === undefined) {
        emit(
          err(validation('Provide a price with --price (currency units) or --price-cents (integer cents)')),
          ctx.json,
          () => '',
        );
        return;
      }
      let accessItems: z.output<typeof productAccessItemsInlineSchema> | undefined;
      if (options.accessItems !== undefined) {
        const payload = await readJsonPayload(options.accessItems, undefined);
        if (!payload.ok) {
          emit(payload, ctx.json, () => '');
          return;
        }
        const parsed = parsedInput(productAccessItemsInlineSchema, payload.value, 'Invalid access items');
        if (!parsed.ok) {
          emit(parsed, ctx.json, () => '');
          return;
        }
        accessItems = parsed.value;
      }
      emit(
        await ctx.api.createProduct({
          title: options.title,
          priceCents,
          ...(options.currency === undefined ? {} : { currency: options.currency }),
          ...(options.description === undefined ? {} : { description: options.description }),
          ...(accessItems === undefined ? {} : { accessItems }),
        }),
        ctx.json,
        (data) => `created: ${data.product.title} (${data.product.id.slice(0, 8)})`,
      );
    }),
  );

product
  .command('publish <id>')
  .description('Publish a product')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [id]) => {
      emit(await ctx.api.publishProduct({ id }), ctx.json, (data) =>
        `published: ${data.product.title} (${data.product.id.slice(0, 8)})`,
      );
    }),
  );

product
  .command('access-items <id>')
  .description('Replace a product access items (course/module/lesson grants)')
  .option('--data <json>', 'inline JSON access items union array (level: course|modules|lessons)')
  .option('--json-file <path>', 'path to a JSON file with the access items array')
  .action(
    withInput(z.tuple([z.string().min(1), jsonSourceOptionsSchema]), async (ctx, [id, options]) => {
      const payload = await readJsonPayload(options.data, options.jsonFile);
      if (!payload.ok) {
        emit(payload, ctx.json, () => '');
        return;
      }
      const input = parsedInput(
        updateProductAccessItemsInputSchema,
        { id, accessItems: payload.value },
        'Invalid access items payload',
      );
      if (!input.ok) {
        emit(input, ctx.json, () => '');
        return;
      }
      emit(await ctx.api.updateProductAccessItems(input.value), ctx.json, (data) =>
        `updated access items: ${data.product.title} (${data.product.accessItems.length} item(s))`,
      );
    }),
  );

product
  .command('access-issues')
  .description('List products whose access items point at missing courses, modules or lessons')
  .action(
    withCtx(async (ctx) => {
      emit(await ctx.api.listProductAccessIssues(), ctx.json, (data) =>
        data.issues.length === 0
          ? 'no access issues'
          : data.issues
              .map((issue) => {
                const parts: string[] = [];
                if (issue.missingCourseIds.length > 0) {
                  parts.push(`courses: ${issue.missingCourseIds.join(', ')}`);
                }
                if (issue.missingModuleIds.length > 0) {
                  parts.push(`modules: ${issue.missingModuleIds.join(', ')}`);
                }
                if (issue.missingLessonIds.length > 0) {
                  parts.push(`lessons: ${issue.missingLessonIds.join(', ')}`);
                }
                return `- ${issue.productTitle} (${issue.productId.slice(0, 8)})  missing ${parts.join('; ')}`;
              })
              .join('\n'),
      );
    }),
  );

const priceCommand = program.command('price').description('Product prices in the active tenant (staff only)');

const formatPrice = (price: {
  id: string;
  kind: string;
  interval: string | null;
  amountCents: number;
  currency: string;
  active: boolean;
}): string => {
  const cadence = price.kind === 'recurring' ? `recurring/${price.interval ?? '?'}` : 'one-time';
  return `- ${price.amountCents} ${price.currency}  ${cadence}  [${price.active ? 'active' : 'inactive'}]  (${price.id})`;
};

priceCommand
  .command('add')
  .description('Add a price to a product')
  .requiredOption('--product <id>')
  .requiredOption('--kind <kind>', 'one_time or recurring')
  .option('--interval <interval>', 'month or year (required for recurring)')
  .option('--price-cents <cents>', 'amount in integer cents')
  .option('--price <amount>', 'amount in currency units, e.g. 199 or 199.99')
  .option('--currency <currency>', '3-letter uppercase currency code')
  .action(
    withInput(z.tuple([priceAddOptionsSchema]), async (ctx, [options]) => {
      if (options.price !== undefined && options.priceCents !== undefined) {
        emit(err(validation('Provide only one of --price and --price-cents')), ctx.json, () => '');
        return;
      }
      const amountCents = options.price ?? options.priceCents;
      if (amountCents === undefined) {
        emit(
          err(validation('Provide an amount with --price (currency units) or --price-cents (integer cents)')),
          ctx.json,
          () => '',
        );
        return;
      }
      emit(
        await ctx.api.createProductPrice({
          productId: options.product,
          kind: options.kind,
          amountCents,
          ...(options.interval === undefined ? {} : { interval: options.interval }),
          ...(options.currency === undefined ? {} : { currency: options.currency }),
        }),
        ctx.json,
        (data) => `created price: ${formatPrice(data.price)}`,
      );
    }),
  );

priceCommand
  .command('list')
  .description('List the prices of a product')
  .requiredOption('--product <id>')
  .action(
    withInput(z.tuple([z.object({ product: z.string().min(1) })]), async (ctx, [options]) => {
      emit(await ctx.api.listProductPrices(options.product), ctx.json, (data) =>
        data.prices.length === 0 ? 'no prices' : data.prices.map(formatPrice).join('\n'),
      );
    }),
  );

priceCommand
  .command('deactivate <id>')
  .description('Deactivate a price (existing subscriptions keep renewing)')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [id]) => {
      emit(await ctx.api.deactivateProductPrice({ id }), ctx.json, (data) =>
        `deactivated price: ${formatPrice(data.price)}`,
      );
    }),
  );

const ordersCommand = program.command('orders').description('Sales ledger of the active tenant (staff only)');

ordersCommand
  .command('list')
  .description('List orders with filters, search and paging')
  .option('--status <status>', 'paid, pending, failed or refunded')
  .option('--product <id>')
  .option('--kind <kind>', 'one_time or recurring')
  .option('--coupon <id>')
  .option('--search <text>', 'search by member e-mail or name')
  .option('--page <n>')
  .option('--page-size <n>')
  .action(
    withInput(z.tuple([ordersListOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.listOrders({
          ...(options.status === undefined ? {} : { status: options.status }),
          ...(options.product === undefined ? {} : { productId: options.product }),
          ...(options.kind === undefined ? {} : { kind: options.kind }),
          ...(options.coupon === undefined ? {} : { couponId: options.coupon }),
          ...(options.search === undefined ? {} : { search: options.search }),
          ...(options.page === undefined ? {} : { page: options.page }),
          ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
        }),
        ctx.json,
        (data) =>
          data.orders.length === 0
            ? `no orders (total ${data.total})`
            : [
                ...data.orders.map(
                  (order) =>
                    `${order.createdAt}\t${order.status}\t${order.amountCents} ${order.currency}\t${order.kind}\t${order.productTitle}\t${order.memberEmail}\t(${order.id.slice(0, 8)})`,
                ),
                `page ${data.page}/${Math.max(1, Math.ceil(data.total / data.pageSize))} — ${data.total} order(s)`,
              ].join('\n'),
      );
    }),
  );

ordersCommand
  .command('export')
  .description('Export orders as CSV or JSON, mirroring the web sales export')
  .requiredOption('--format <format>', 'csv or json')
  .option('--status <status>', 'paid, pending, failed or refunded')
  .option('--product <id>')
  .option('--kind <kind>', 'one_time or recurring')
  .option('--coupon <id>')
  .option('--search <text>', 'search by member e-mail or name')
  .option('--out <file>', 'write the export to a file instead of stdout')
  .action(
    withInput(z.tuple([ordersExportOptionsSchema]), async (ctx, [options]) => {
      const result = await ctx.api.exportOrders({
        format: options.format,
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.product === undefined ? {} : { productId: options.product }),
        ...(options.kind === undefined ? {} : { kind: options.kind }),
        ...(options.coupon === undefined ? {} : { couponId: options.coupon }),
        ...(options.search === undefined ? {} : { search: options.search }),
      });
      if (result.ok && options.out !== undefined) {
        await writeFile(options.out, result.value.content);
      }
      emit(result, ctx.json, (file) =>
        options.out !== undefined ? `wrote ${file.filename} to ${options.out}` : file.content,
      );
    }),
  );

ordersCommand
  .command('reconciliation')
  .description('List paid orders that have no matching product grant')
  .option('--min-age-minutes <n>')
  .option('--limit <n>')
  .action(
    withInput(z.tuple([ordersReconciliationOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.listOrderReconciliation({
          ...(options.minAgeMinutes === undefined
            ? {}
            : { minAgeMinutes: options.minAgeMinutes }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        }),
        ctx.json,
        (data) =>
          data.rows.length === 0
            ? 'no paid orders without a grant'
            : data.rows
                .map(
                  (row) =>
                    `${row.createdAt}\t${row.memberEmail}\t${row.productTitle}\t${row.amountCents} ${row.currency}\t(${row.orderId.slice(0, 8)})`,
                )
                .join('\n'),
      );
    }),
  );

ordersCommand.command('summary').description('Dashboard sales summary (last 30 days)').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.salesSummary(), ctx.json, (data) => {
      const revenue =
        data.summary.revenueLast30Days.length === 0
          ? '0'
          : data.summary.revenueLast30Days
              .map((entry) => `${entry.amountCents} ${entry.currency}`)
              .join(', ');
      return `revenue 30d: ${revenue}\norders 30d: ${data.summary.ordersLast30Days}\nactive subscriptions: ${data.summary.activeSubscriptions}`;
    });
  }),
);

program
  .command('support')
  .description('Contact the active tenant creator')
  .command('send')
  .requiredOption('--subject <subject>')
  .requiredOption('--body <body>')
  .action(
    withInput(z.tuple([supportMessageOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.sendSupportMessage(options),
        ctx.json,
        () => 'support message queued',
      );
    }),
  );

const couponsCommand = program.command('coupons').description('Coupons and attributed sales');

couponsCommand
  .command('list')
  .option('--partner <label>')
  .action(
    withInput(z.tuple([z.object({ partner: z.string().trim().min(1).optional() })]), async (ctx, [options]) => {
      emit(
        await ctx.api.listCouponStats(
          options.partner === undefined ? {} : { partnerLabel: options.partner },
        ),
        ctx.json,
        (data) =>
          data.items.length === 0
            ? 'no coupons'
            : data.items.map((item) =>
                `${item.coupon.code}\t${item.coupon.status}\t${item.redemptions} redemption(s)\t${item.coupon.partnerLabel ?? 'no partner'}\t(${item.coupon.id})`,
              ).join('\n'),
      );
    }),
  );

couponsCommand
  .command('create')
  .requiredOption('--code <code>')
  .requiredOption('--kind <kind>', 'percent or amount')
  .requiredOption('--value <integer>')
  .option('--products <ids...>')
  .option('--applies-to <kind>', 'one_time, recurring or both')
  .option('--recurring-duration <duration>', 'first_invoice or forever')
  .option('--starts-at <iso>')
  .option('--ends-at <iso>')
  .option('--max-redemptions <n>')
  .option('--max-per-member <n>')
  .option('--partner <label>')
  .action(
    withInput(z.tuple([couponCreateOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.createCoupon({
          code: options.code,
          kind: options.kind,
          value: options.value,
          scope: options.products === undefined
            ? { kind: 'all' }
            : { kind: 'products', productIds: options.products },
          appliesTo: options.appliesTo ?? 'both',
          recurringDuration: options.recurringDuration ?? 'first_invoice',
          startsAt: options.startsAt ?? null,
          endsAt: options.endsAt ?? null,
          maxRedemptions: options.maxRedemptions ?? null,
          maxRedemptionsPerMember: options.maxPerMember ?? null,
          partnerLabel: options.partner ?? null,
        }),
        ctx.json,
        (data) => `created coupon ${data.coupon.code} (${data.coupon.id})`,
      );
    }),
  );

couponsCommand
  .command('archive <id>')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [id]) => {
      emit(
        await ctx.api.archiveCoupon({ id }),
        ctx.json,
        (data) => `archived coupon ${data.coupon.code} (${data.coupon.id})`,
      );
    }),
  );

couponsCommand
  .command('export')
  .requiredOption('--format <format>', 'csv or json')
  .option('--partner <label>')
  .option('--out <file>')
  .action(
    withInput(z.tuple([couponExportOptionsSchema]), async (ctx, [options]) => {
      const result = await ctx.api.exportCouponStats({
        format: options.format,
        ...(options.partner === undefined ? {} : { partnerLabel: options.partner }),
      });
      if (result.ok && options.out !== undefined) await writeFile(options.out, result.value.content);
      emit(
        result,
        ctx.json,
        (file) => options.out === undefined ? file.content : `wrote ${file.filename} to ${options.out}`,
      );
    }),
  );

const subscriptionCommand = program
  .command('subscription')
  .description('Dev-only subscription lifecycle simulation');

const formatSubscription = (subscription: {
  id: string;
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}): string =>
  `subscription ${subscription.id.slice(0, 8)}: ${subscription.status}, period ends ${subscription.currentPeriodEnd}${subscription.cancelAtPeriodEnd ? ', cancels at period end' : ''}`;

subscriptionCommand
  .command('simulate-cycle <subscriptionId>')
  .description('Simulate the next paid invoice cycle (dev endpoint)')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [subscriptionId]) => {
      emit(await ctx.api.simulateSubscriptionCycle({ subscriptionId }), ctx.json, (data) =>
        formatSubscription(data.subscription),
      );
    }),
  );

subscriptionCommand
  .command('simulate-failure <subscriptionId>')
  .description('Simulate a failed invoice payment (dev endpoint)')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [subscriptionId]) => {
      emit(await ctx.api.simulateSubscriptionFailure({ subscriptionId }), ctx.json, (data) =>
        formatSubscription(data.subscription),
      );
    }),
  );

const course = program.command('course').description('Courses in the active tenant (staff only)');

course.command('list').description('List courses').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.listCourses(), ctx.json, (data) =>
      data.courses.length === 0
        ? 'no courses'
        : data.courses.map((item) => `- ${item.name}  (${item.id.slice(0, 8)})`).join('\n'),
    );
  }),
);

course
  .command('create')
  .description('Create a course')
  .requiredOption('--name <name>')
  .option('--description <description>')
  .option('--image-url <url>')
  .option('--legacy-id <id>')
  .action(
    withInput(z.tuple([courseCreateOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.createCourse({
          name: options.name,
          ...(options.description === undefined ? {} : { description: options.description }),
          ...(options.imageUrl === undefined ? {} : { imageUrl: options.imageUrl }),
          ...(options.legacyId === undefined ? {} : { legacyId: options.legacyId }),
        }),
        ctx.json,
        (data) => `created course: ${data.course.name} (${data.course.id.slice(0, 8)})`,
      );
    }),
  );

course
  .command('update <id>')
  .description('Update a course')
  .option('--name <name>')
  .option('--description <description>')
  .option('--image-url <url>')
  .option('--module-order <ids>', 'comma-separated module ids in display order')
  .action(
    withInput(z.tuple([z.string().min(1), courseUpdateOptionsSchema]), async (ctx, [id, options]) => {
      emit(
        await ctx.api.updateCourse({
          id,
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.description === undefined ? {} : { description: options.description }),
          ...(options.imageUrl === undefined ? {} : { imageUrl: options.imageUrl }),
          ...(options.moduleOrder === undefined ? {} : { moduleOrder: options.moduleOrder }),
        }),
        ctx.json,
        (data) => `updated course: ${data.course.name} (${data.course.id.slice(0, 8)})`,
      );
    }),
  );

course
  .command('history <courseId>')
  .description('List course and module snapshot versions (staff only)')
  .option('--limit <n>', 'max versions to return (newest first)')
  .action(
    withInput(z.tuple([z.string().min(1), historyOptionsSchema]), async (ctx, [courseId, options]) => {
      emit(
        await ctx.api.listContentHistory({
          courseId,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        }),
        ctx.json,
        (data) =>
          data.versions.length === 0
            ? 'no versions'
            : data.versions
                .map(
                  (v) =>
                    `- v${v.schemaVersion}  ${v.createdAt}  ${v.createdByDisplayName ?? 'unknown'}  ${v.subjectKind}:${v.subjectName}  (${v.id.slice(0, 8)})`,
                )
                .join('\n'),
      );
    }),
  );

course
  .command('version <versionId>')
  .description('Show a single snapshot upcast to the current schema (staff only)')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [versionId]) => {
      emit(
        await ctx.api.getContentVersion(versionId),
        ctx.json,
        ({ version }) =>
          `${version.entityKind} ${version.entityId.slice(0, 8)}  stored v${version.schemaVersion} -> current v${version.currentSchemaVersion}\n${JSON.stringify(version.payload, null, 2)}`,
      );
    }),
  );

const moduleCommand = program.command('module').description('Course modules (staff only)');

moduleCommand.command('list').description('List modules').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.listModules(), ctx.json, (data) =>
      data.modules.length === 0
        ? 'no modules'
        : data.modules.map((item) => `- ${item.name}  (${item.id.slice(0, 8)})`).join('\n'),
    );
  }),
);

moduleCommand
  .command('create')
  .description('Create a module (chapters via --data inline JSON or --json-file)')
  .option('--data <json>', 'inline JSON module payload')
  .option('--json-file <path>', 'path to a JSON file with the module payload')
  .action(
    withInput(z.tuple([jsonSourceOptionsSchema]), async (ctx, [options]) => {
      const payload = await readJsonPayload(options.data, options.jsonFile);
      if (!payload.ok) {
        emit(payload, ctx.json, () => '');
        return;
      }
      const input = parsedInput(newCourseModuleSchema, payload.value, 'Invalid module payload');
      if (!input.ok) {
        emit(input, ctx.json, () => '');
        return;
      }
      emit(await ctx.api.createModule(input.value), ctx.json, (data) =>
        `created module: ${data.module.name} (${data.module.id.slice(0, 8)})`,
      );
    }),
  );

moduleCommand
  .command('update')
  .description('Update a module (chapters via --data inline JSON or --json-file)')
  .option('--data <json>', 'inline JSON module payload (must include id)')
  .option('--json-file <path>', 'path to a JSON file with the module payload')
  .action(
    withInput(z.tuple([jsonSourceOptionsSchema]), async (ctx, [options]) => {
      const payload = await readJsonPayload(options.data, options.jsonFile);
      if (!payload.ok) {
        emit(payload, ctx.json, () => '');
        return;
      }
      const input = parsedInput(updateCourseModuleInputSchema, payload.value, 'Invalid module update payload');
      if (!input.ok) {
        emit(input, ctx.json, () => '');
        return;
      }
      emit(await ctx.api.updateModule(input.value), ctx.json, (data) =>
        `updated module: ${data.module.name} (${data.module.id.slice(0, 8)})`,
      );
    }),
  );

moduleCommand
  .command('attach')
  .description('Attach a module to a course')
  .requiredOption('--course <courseId>')
  .requiredOption('--module <moduleId>')
  .action(
    withInput(z.tuple([moduleAttachOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.attachModuleToCourse({ courseId: options.course, moduleId: options.module }),
        ctx.json,
        (data) => `attached module ${data.module.id.slice(0, 8)} to course ${options.course.slice(0, 8)}`,
      );
    }),
  );

moduleCommand
  .command('detach')
  .description('Detach a module from a course (keeps the module in the pool)')
  .requiredOption('--course <courseId>')
  .requiredOption('--module <moduleId>')
  .action(
    withInput(z.tuple([moduleDetachOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.detachModuleFromCourse({ courseId: options.course, moduleId: options.module }),
        ctx.json,
        (data) => `detached module ${data.module.id.slice(0, 8)} from course ${options.course.slice(0, 8)}`,
      );
    }),
  );

const lesson = program.command('lesson').description('Course lessons (staff only)');

lesson.command('list').description('List lessons').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.listLessons(), ctx.json, (data) =>
      data.lessons.length === 0
        ? 'no lessons'
        : data.lessons.map((item) => `- ${item.name}  (${item.id.slice(0, 8)})`).join('\n'),
    );
  }),
);

lesson
  .command('create')
  .description('Create a lesson (contents via --data inline JSON or --json-file)')
  .option('--data <json>', 'inline JSON lesson payload')
  .option('--json-file <path>', 'path to a JSON file with the lesson payload')
  .action(
    withInput(z.tuple([jsonSourceOptionsSchema]), async (ctx, [options]) => {
      const payload = await readJsonPayload(options.data, options.jsonFile);
      if (!payload.ok) {
        emit(payload, ctx.json, () => '');
        return;
      }
      const input = parsedInput(newCourseLessonSchema, payload.value, 'Invalid lesson payload');
      if (!input.ok) {
        emit(input, ctx.json, () => '');
        return;
      }
      emit(await ctx.api.createLesson(input.value), ctx.json, (data) =>
        `created lesson: ${data.lesson.name} (${data.lesson.id.slice(0, 8)})`,
      );
    }),
  );

lesson
  .command('update')
  .description('Update a lesson (contents via --data inline JSON or --json-file)')
  .option('--data <json>', 'inline JSON lesson payload (must include id)')
  .option('--json-file <path>', 'path to a JSON file with the lesson payload')
  .action(
    withInput(z.tuple([jsonSourceOptionsSchema]), async (ctx, [options]) => {
      const payload = await readJsonPayload(options.data, options.jsonFile);
      if (!payload.ok) {
        emit(payload, ctx.json, () => '');
        return;
      }
      const input = parsedInput(updateCourseLessonInputSchema, payload.value, 'Invalid lesson update payload');
      if (!input.ok) {
        emit(input, ctx.json, () => '');
        return;
      }
      emit(await ctx.api.updateLesson(input.value), ctx.json, (data) =>
        `updated lesson: ${data.lesson.name} (${data.lesson.id.slice(0, 8)})`,
      );
    }),
  );

const describeLessonReferences = (references: LessonReferences): string => {
  const lines = [`lesson ${references.lessonName} (${references.lessonId.slice(0, 8)})`];
  lines.push(
    references.chapters.length === 0
      ? 'chapters: none'
      : `chapters: ${references.chapters.map((chapter) => `${chapter.moduleName} / ${chapter.chapterName}`).join(', ')}`,
  );
  lines.push(
    references.products.length === 0
      ? 'products: none'
      : `products: ${references.products.map((product) => product.productTitle).join(', ')}`,
  );
  lines.push(`progress records: ${references.progressCount}`);
  return lines.join('\n');
};

lesson
  .command('references <id>')
  .description('Show what references a lesson (chapters, products, progress)')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [id]) => {
      emit(await ctx.api.lessonReferences(id), ctx.json, (data) => describeLessonReferences(data.references));
    }),
  );

lesson
  .command('delete <id>')
  .description('Delete a lesson and clean up its references (chapters, product access items)')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [id]) => {
      emit(
        await ctx.api.deleteLesson(id),
        ctx.json,
        (data) =>
          `deleted lesson ${data.references.lessonName} (${data.references.lessonId.slice(0, 8)})\n${describeLessonReferences(data.references)}`,
      );
    }),
  );

const student = program.command('student').description('Your student view of the active tenant');

student.command('courses').description('Courses you can access').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.studentCourses(), ctx.json, (data) =>
      data.courses.length === 0
        ? 'no accessible courses'
        : data.courses.map((item) => `- ${item.name}  (${item.id.slice(0, 8)})`).join('\n'),
    );
  }),
);

student
  .command('structure <courseId>')
  .description('Course structure with 3-state access and completion')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [courseId]) => {
      emit(await ctx.api.studentCourseStructure(courseId), ctx.json, (data) => {
        const lines = [`${data.structure.name} [${accessGlyph(data.structure.accessStatus)}]`];
        for (const structModule of data.structure.modules) {
          lines.push(`  ${structModule.name} [${accessGlyph(structModule.accessStatus)}]`);
          for (const chapter of structModule.chapters) {
            for (const structLesson of chapter.lessons) {
              lines.push(`    - ${structLesson.name} [${accessGlyph(structLesson.accessStatus)}]`);
            }
          }
        }
        return lines.join('\n');
      });
    }),
  );

student
  .command('lesson <lessonId>')
  .description('Fetch a lesson with its contents (forbidden when locked)')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [lessonId]) => {
      emit(await ctx.api.studentLesson(lessonId), ctx.json, (data) =>
        `${data.lesson.name} (${data.lesson.contents.length} block(s))`,
      );
    }),
  );

student
  .command('complete <lessonId>')
  .description('Mark a lesson completed')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [lessonId]) => {
      emit(await ctx.api.completeLesson({ lessonId }), ctx.json, (data) =>
        `completed ${data.progress.completedLessonIds.length} lesson(s) in course ${data.progress.courseId.slice(0, 8)}`,
      );
    }),
  );

student
  .command('uncomplete <lessonId>')
  .description('Un-mark a completed lesson (no-op when not completed)')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [lessonId]) => {
      emit(await ctx.api.uncompleteLesson({ lessonId }), ctx.json, (data) =>
        `completed ${data.progress.completedLessonIds.length} lesson(s) in course ${data.progress.courseId.slice(0, 8)}`,
      );
    }),
  );

student
  .command('next <lessonId>')
  .description('Next lesson after the given lesson')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [lessonId]) => {
      emit(await ctx.api.nextLesson(lessonId), ctx.json, (data) =>
        data.next ? `next: ${data.next.name} (${data.next.id.slice(0, 8)})` : 'no next lesson',
      );
    }),
  );

student
  .command('progress <courseId>')
  .description('Your progress in a course')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [courseId]) => {
      emit(await ctx.api.studentProgress(courseId), ctx.json, (data) =>
        `${data.progress.completedLessonIds.length} completed; last lesson ${data.progress.lastViewedLessonId ?? 'none'}`,
      );
    }),
  );

student
  .command('last-viewed')
  .description('Record the last-viewed position in a course')
  .requiredOption('--course <courseId>')
  .option('--lesson <lessonId>')
  .option('--module <moduleId>')
  .option('--chapter <chapterId>')
  .action(
    withInput(z.tuple([lastViewedOptionsSchema]), async (ctx, [options]) => {
      const input = parsedInput(
        updateLastViewedInputSchema,
        {
          courseId: options.course,
          ...(options.lesson === undefined ? {} : { lessonId: options.lesson }),
          ...(options.module === undefined ? {} : { moduleId: options.module }),
          ...(options.chapter === undefined ? {} : { chapterId: options.chapter }),
        },
        'Invalid last-viewed payload',
      );
      if (!input.ok) {
        emit(input, ctx.json, () => '');
        return;
      }
      emit(await ctx.api.updateLastViewed(input.value), ctx.json, (data) =>
        `last viewed lesson ${data.progress.lastViewedLessonId ?? 'none'} in course ${data.progress.courseId.slice(0, 8)}`,
      );
    }),
  );

const discussion = program.command('discussion').description('Lesson discussions');

const post = program.command('post').description('Community posts');

post
  .command('report')
  .description('Report a post')
  .requiredOption('--post <postId>')
  .requiredOption('--reason <reason>')
  .option('--note <text>')
  .action(
    withInput(z.tuple([postReportOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.reportPost({
          postId: options.post,
          reason: options.reason,
          ...(options.note === undefined ? {} : { note: options.note }),
        }),
        ctx.json,
        (data) => `reported post ${data.report.postId.slice(0, 8)} (${data.report.id.slice(0, 8)})`,
      );
    }),
  );

const report = program.command('report').description('Post reports (staff only)');

report
  .command('list')
  .description('List reports')
  .option('--status <status>', 'open, dismissed, or resolved')
  .action(
    withInput(z.tuple([reportListOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.listReports(options.status === undefined ? {} : { status: options.status }),
        ctx.json,
        (data) => data.items.length === 0
          ? 'no reports'
          : data.items.map(({ report: item, post: reportedPost }) =>
              `- ${item.reason}\t${reportedPost.body.slice(0, 80)}\t(${item.id})`
            ).join('\n'),
      );
    }),
  );

report
  .command('resolve')
  .description('Resolve a report')
  .requiredOption('--report <id>')
  .requiredOption('--action <action>', 'dismiss or delete-post')
  .action(
    withInput(z.tuple([reportResolveOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.resolveReport({ reportId: options.report, action: options.action }),
        ctx.json,
        (data) => `resolved report ${data.report.id.slice(0, 8)} as ${data.report.status}`,
      );
    }),
  );

discussion
  .command('post')
  .description('Create a top-level discussion post under a lesson')
  .requiredOption('--lesson <lessonId>')
  .requiredOption('--body <text>')
  .action(
    withInput(z.tuple([discussionPostOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.createPost({ contextKind: 'lesson', contextId: options.lesson, body: options.body }),
        ctx.json,
        (data) => `posted ${data.post.id.slice(0, 8)} in lesson ${data.post.contextId.slice(0, 8)}`,
      );
    }),
  );

discussion
  .command('reply')
  .description('Reply to a discussion post')
  .requiredOption('--lesson <lessonId>')
  .requiredOption('--parent <postId>')
  .requiredOption('--body <text>')
  .action(
    withInput(z.tuple([discussionReplyOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.createPost({
          contextKind: 'lesson',
          contextId: options.lesson,
          parentPostId: options.parent,
          body: options.body,
        }),
        ctx.json,
        (data) => `replied ${data.post.id.slice(0, 8)} to thread ${data.post.rootPostId.slice(0, 8)}`,
      );
    }),
  );

discussion
  .command('list')
  .description('List a lesson discussion')
  .requiredOption('--lesson <lessonId>')
  .option('--limit <n>')
  .action(
    withInput(z.tuple([discussionListOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.discussion({
          contextKind: 'lesson',
          contextId: options.lesson,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        }),
        ctx.json,
        (data) =>
          data.discussion.threads.length === 0
            ? 'no posts'
            : data.discussion.threads
                .map((post) => `- ${post.authorDisplay}: ${post.body} (${post.id.slice(0, 8)}, ${post.replyCount} replies)`)
                .join('\n'),
      );
    }),
  );

discussion
  .command('search')
  .description('Search accessible discussion posts')
  .requiredOption('--query <text>')
  .option('--lesson <lessonId>')
  .option('--limit <n>')
  .action(
    withInput(z.tuple([discussionSearchOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.searchPosts({
          query: options.query,
          ...(options.lesson === undefined ? {} : { lessonIds: [options.lesson] }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        }),
        ctx.json,
        (data) =>
          data.hits.length === 0
            ? 'no matches'
            : data.hits
                .map((hit) => `- ${hit.post.contextKind} ${hit.lessonId.slice(0, 8)} ${hit.post.id.slice(0, 8)}: ${hit.snippet}`)
                .join('\n'),
      );
    }),
  );

discussion
  .command('react')
  .description('React to a post with an emoji (👍 ❤️ 🎉 💡 😂); idempotent')
  .requiredOption('--post <postId>')
  .requiredOption('--emoji <emoji>')
  .action(
    withInput(z.tuple([reactionOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.reactToPost({ postId: options.post, emoji: options.emoji }),
        ctx.json,
        (data) =>
          `reactions on ${data.postId.slice(0, 8)}: ${
            data.reactions.map((reaction) => `${reaction.emoji} ${reaction.count}`).join(' ') || 'none'
          }`,
      );
    }),
  );

discussion
  .command('unreact')
  .description('Remove your emoji reaction from a post; idempotent')
  .requiredOption('--post <postId>')
  .requiredOption('--emoji <emoji>')
  .action(
    withInput(z.tuple([reactionOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.unreactToPost({ postId: options.post, emoji: options.emoji }),
        ctx.json,
        (data) =>
          `reactions on ${data.postId.slice(0, 8)}: ${
            data.reactions.map((reaction) => `${reaction.emoji} ${reaction.count}`).join(' ') || 'none'
          }`,
      );
    }),
  );

const space = program.command('space').description('Community spaces');

space
  .command('list')
  .description('List spaces you can see')
  .action(
    withCtx(async (ctx) => {
      emit(await ctx.api.listSpaces(), ctx.json, (data) =>
        data.spaces.length === 0
          ? 'no spaces'
          : data.spaces
              .map(
                (item) =>
                  `- ${item.name} [${item.slug}] ${item.visibility}${item.isFollowing ? ' (following)' : ''} (${item.id.slice(0, 8)})`,
              )
              .join('\n'),
      );
    }),
  );

space
  .command('create')
  .description('Create a space (staff)')
  .requiredOption('--slug <slug>')
  .requiredOption('--name <name>')
  .requiredOption('--visibility <visibility>', "'members' or 'product'")
  .option('--description <text>')
  .option('--products <ids>', 'comma-separated product ids for product-gated spaces')
  .action(
    withInput(z.tuple([spaceCreateOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.createSpace({
          slug: options.slug,
          name: options.name,
          visibility: options.visibility,
          ...(options.description === undefined ? {} : { description: options.description }),
          ...(options.products === undefined ? {} : { productIds: options.products }),
        }),
        ctx.json,
        (data) => `created space ${data.space.name} (${data.space.id.slice(0, 8)})`,
      );
    }),
  );

space
  .command('update')
  .description('Update a space (staff)')
  .requiredOption('--id <spaceId>')
  .option('--name <name>')
  .option('--description <text>')
  .option('--visibility <visibility>', "'members' or 'product'")
  .option('--products <ids>', 'comma-separated product ids')
  .option('--position <n>')
  .action(
    withInput(z.tuple([spaceUpdateOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.updateSpace({
          id: options.id,
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.description === undefined ? {} : { description: options.description }),
          ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
          ...(options.products === undefined ? {} : { productIds: options.products }),
          ...(options.position === undefined ? {} : { position: options.position }),
        }),
        ctx.json,
        (data) => `updated space ${data.space.name} (${data.space.id.slice(0, 8)})`,
      );
    }),
  );

space
  .command('delete')
  .description('Delete a space (staff)')
  .requiredOption('--space <spaceId>')
  .action(
    withInput(z.tuple([spaceIdOptionsSchema]), async (ctx, [options]) => {
      emit(await ctx.api.deleteSpace({ id: options.space }), ctx.json, (data) =>
        `deleted space ${data.spaceId.slice(0, 8)}`,
      );
    }),
  );

space
  .command('archive')
  .description('Archive a space — hidden from members, content kept (staff)')
  .requiredOption('--space <spaceId>')
  .action(
    withInput(z.tuple([spaceIdOptionsSchema]), async (ctx, [options]) => {
      emit(await ctx.api.archiveSpace({ id: options.space, archived: true }), ctx.json, (data) =>
        `archived space ${data.space.name} (${data.space.id.slice(0, 8)})`,
      );
    }),
  );

space
  .command('restore')
  .description('Restore an archived space (staff)')
  .requiredOption('--space <spaceId>')
  .action(
    withInput(z.tuple([spaceIdOptionsSchema]), async (ctx, [options]) => {
      emit(await ctx.api.archiveSpace({ id: options.space, archived: false }), ctx.json, (data) =>
        `restored space ${data.space.name} (${data.space.id.slice(0, 8)})`,
      );
    }),
  );

space
  .command('stats')
  .description('List spaces with post and follower counts (staff)')
  .action(
    withCtx(async (ctx) => {
      emit(await ctx.api.listStaffSpaces(), ctx.json, (data) =>
        data.spaces.length === 0
          ? 'no spaces'
          : data.spaces
              .map(
                (item) =>
                  `${item.id.slice(0, 8)} ${item.name}${item.archivedAt === null ? '' : ' (archived)'} — ${item.stats.posts} posts, ${item.stats.followers} followers`,
              )
              .join('\n'),
      );
    }),
  );

space
  .command('feed')
  .description('Show a space feed (newest first)')
  .requiredOption('--space <spaceId>')
  .option('--limit <n>')
  .option('--cursor <cursor>')
  .action(
    withInput(z.tuple([spaceFeedOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.spaceFeed({
          spaceId: options.space,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
          ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        }),
        ctx.json,
        (data) =>
          data.feed.items.length === 0
            ? 'no posts'
            : data.feed.items
                .map((item) => {
                  const reactions = item.reactions
                    .map((reaction) => `${reaction.emoji} ${reaction.count}`)
                    .join(' ');
                  return `- ${item.authorDisplay}: ${item.body} (${item.id.slice(0, 8)}, ${item.replyCount} replies${reactions.length > 0 ? `, ${reactions}` : ''})`;
                })
                .join('\n'),
      );
    }),
  );

space
  .command('post')
  .description('Post to a space feed')
  .requiredOption('--space <spaceId>')
  .requiredOption('--body <text>')
  .action(
    withInput(z.tuple([spacePostOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.createPost({ contextKind: 'space', contextId: options.space, body: options.body }),
        ctx.json,
        (data) => `posted ${data.post.id.slice(0, 8)} in space ${data.post.contextId.slice(0, 8)}`,
      );
    }),
  );

space
  .command('reply')
  .description('Reply to a post in a space feed')
  .requiredOption('--space <spaceId>')
  .requiredOption('--parent <postId>')
  .requiredOption('--body <text>')
  .action(
    withInput(z.tuple([spaceReplyOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.createPost({
          contextKind: 'space',
          contextId: options.space,
          parentPostId: options.parent,
          body: options.body,
        }),
        ctx.json,
        (data) => `replied ${data.post.id.slice(0, 8)} to thread ${data.post.rootPostId.slice(0, 8)}`,
      );
    }),
  );

space
  .command('follow')
  .description('Follow a space to get notified about new posts')
  .requiredOption('--space <spaceId>')
  .action(
    withInput(z.tuple([spaceIdOptionsSchema]), async (ctx, [options]) => {
      emit(await ctx.api.followSpace({ spaceId: options.space }), ctx.json, (data) =>
        `following space ${data.spaceId.slice(0, 8)}`,
      );
    }),
  );

space
  .command('unfollow')
  .description('Stop following a space')
  .requiredOption('--space <spaceId>')
  .action(
    withInput(z.tuple([spaceIdOptionsSchema]), async (ctx, [options]) => {
      emit(await ctx.api.unfollowSpace({ spaceId: options.space }), ctx.json, (data) =>
        `unfollowed space ${data.spaceId.slice(0, 8)}`,
      );
    }),
  );

const notifications = program.command('notifications').description('Your notifications');

notifications
  .command('list')
  .description('List notifications')
  .option('--limit <n>')
  .action(
    withInput(z.tuple([notificationsListOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.listNotifications(options.limit === undefined ? {} : { limit: options.limit }),
        ctx.json,
        (data) =>
          data.notifications.length === 0
            ? 'no notifications'
            : data.notifications
                .map((item) => {
                  const status = item.readAt === null ? 'unread' : 'read';
                  return `- ${status} ${item.kind} ${item.payload.snippet} (${item.id.slice(0, 8)})`;
                })
                .join('\n'),
      );
    }),
  );

notifications
  .command('read [id]')
  .description('Mark one notification, or all notifications with --all, as read')
  .option('--all')
  .action(
    withInput(z.tuple([z.string().min(1).optional(), notificationReadOptionsSchema]), async (ctx, [id, options]) => {
      if (options.all === true) {
        emit(await ctx.api.markAllNotificationsRead(), ctx.json, (data) => `marked ${data.read} notification(s) read`);
        return;
      }
      if (id === undefined) {
        emit(err(validation('Pass a notification id or --all')), ctx.json, () => '');
        return;
      }
      emit(await ctx.api.markNotificationRead({ id }), ctx.json, (data) =>
        `marked ${data.notification.id.slice(0, 8)} read`,
      );
    }),
  );

program
  .command('simulate-purchase')
  .description('Simulate a purchase (dev endpoint): grant a product to a buyer email')
  .requiredOption('--email <email>')
  .requiredOption('--product <id>')
  .option('--price-id <id>', 'buy a specific price; a recurring price starts a simulated subscription')
  .action(
    withInput(z.tuple([simulatePurchaseOptionsSchema]), async (ctx, [options]) => {
      if (!ctx.tenant) {
        emit(err(validation('Select a tenant with --tenant to simulate a purchase')), ctx.json, () => '');
        return;
      }
      emit(
        await ctx.api.simulatePurchase({
          email: options.email,
          productId: options.product,
          ...(options.priceId === undefined ? {} : { priceId: options.priceId }),
        }),
        ctx.json,
        (data) => {
          const status = data.alreadyOwned ? 'already owned' : 'granted';
          const subscription = data.subscriptionId ? `\nsubscription: ${data.subscriptionId}` : '';
          const link = data.magicLink ? `\nmagic link: ${data.magicLink.url}` : '';
          return `${status}: product ${data.productId} for member ${data.memberId}${subscription}${link}`;
        },
      );
    }),
  );

const emailCommand = program.command('email').description('Transactional email operations');

emailCommand
  .command('dispatch')
  .description('Dispatch one queued email batch')
  .requiredOption('--secret <secret>', 'shared internal dispatch secret')
  .action(
    withInput(z.tuple([emailDispatchOptionsSchema]), async (ctx, [options]) => {
      emit(await ctx.api.dispatchEmail(options.secret), ctx.json, (data) =>
        `attempted ${String(data.attemptsMade)}, sent ${String(data.sentCount)}, failed ${String(data.failedCount)}`,
      );
    }),
  );

const schedulerRuns = program.command('scheduler-runs').description('Global scheduler run activity');

schedulerRuns
  .command('list')
  .requiredOption('--secret <secret>', 'scheduler operator secret')
  .option('--kind <kind>', 'marketing_tick or outbox_dispatch')
  .option('--status <status>', 'running, completed, or failed')
  .option('--since <iso>', 'only runs started at or after this ISO datetime')
  .option('--cursor <cursor>', 'keyset pagination cursor')
  .option('--limit <n>', 'page size')
  .action(withInput(z.tuple([schedulerRunsListOptionsSchema]), async (ctx, [options]) => {
    emit(await ctx.api.listGlobalSchedulerRuns({
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.since === undefined ? {} : { since: options.since }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }, options.secret), ctx.json, (data) => formatSchedulerRuns(data.runs));
  }));

schedulerRuns
  .command('show <id>')
  .requiredOption('--secret <secret>', 'scheduler operator secret')
  .action(withInput(z.tuple([z.string().min(1), schedulerRunShowOptionsSchema]), async (ctx, [id, options]) => {
    emit(await ctx.api.getGlobalSchedulerRun(id, options.secret), ctx.json, formatSchedulerRun);
  }));

const dev = program.command('dev').description('Dev-only endpoints');

dev
  .command('magic-link')
  .description('Show the latest dev magic link for an email')
  .requiredOption('--email <email>')
  .action(
    withInput(z.tuple([emailOptionSchema]), async (ctx, [options]) => {
      emit(await ctx.api.devMagicLink(options.email), ctx.json, (data) =>
        data.magicLink ? data.magicLink.url : 'no magic link stored for this email',
      );
    }),
  );

dev
  .command('email')
  .description('Show the latest dev-stored email for a recipient')
  .requiredOption('--to <email>')
  .action(
    withInput(z.tuple([z.object({ to: z.string().email() })]), async (ctx, [options]) => {
      emit(await ctx.api.devEmail(options.to), ctx.json, (data) =>
        data.email ? data.email.text : 'no email stored for this recipient',
      );
    }),
  );

dev
  .command('grant')
  .description('Grant a product to a member with an optional time box (dev endpoint)')
  .requiredOption('--email <email>')
  .requiredOption('--product <id>')
  .option('--starts-at <iso>', 'ISO datetime when the grant becomes active')
  .option('--expires-at <iso>', 'ISO datetime when the grant expires')
  .action(
    withInput(z.tuple([devGrantOptionsSchema]), async (ctx, [options]) => {
      if (!ctx.tenant) {
        emit(err(validation('Select a tenant with --tenant to grant a product')), ctx.json, () => '');
        return;
      }
      const input = parsedInput(
        devGrantInputSchema,
        {
          email: options.email,
          productId: options.product,
          ...(options.startsAt === undefined ? {} : { startsAt: options.startsAt }),
          ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
        },
        'Invalid grant payload',
      );
      if (!input.ok) {
        emit(input, ctx.json, () => '');
        return;
      }
      emit(await ctx.api.devGrant(input.value), ctx.json, (data) => {
        const status = data.granted ? 'granted' : 'already granted';
        const box = data.expiresAt ? ` (expires ${data.expiresAt})` : '';
        return `${status}: product ${data.productId} for member ${data.memberId}${box}`;
      });
    }),
  );

program
  .command('request-password-reset')
  .description('Send a password-reset email (to the requesting tenant host)')
  .requiredOption('--email <email>')
  .option('--language <language>', 'email language (pl or en)')
  .action(
    withInput(z.tuple([passwordResetRequestOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.auth.requestPasswordReset({
          email: options.email,
          ...(options.language === undefined ? {} : { language: options.language }),
        }),
        ctx.json,
        () => `password-reset email requested for ${options.email}`,
      );
    }),
  );

program
  .command('reset-password')
  .description('Consume a reset token and set a new password')
  .requiredOption('--token <token>')
  .requiredOption('--password <password>')
  .action(
    withInput(z.tuple([resetPasswordOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.auth.resetPassword({ token: options.token, newPassword: options.password }),
        ctx.json,
        () => 'password reset',
      );
    }),
  );

program
  .command('login-magic')
  .description('Sign in via magic link through the dev endpoints')
  .requiredOption('--email <email>')
  .action(
    withInput(z.tuple([emailOptionSchema]), async (ctx, [options]) => {
      const requested = await ctx.auth.requestMagicLink({ email: options.email, callbackURL: ctx.apiUrl });
      if (!requested.ok) {
        emit(requested, ctx.json, () => '');
        return;
      }
      const link = await ctx.api.devMagicLink(options.email);
      if (!link.ok || !link.value.magicLink) {
        emit(
          err(
            validation(
              'Dev magic-link endpoint returned no link; enable SIMULATED_PAYMENTS and AUTH_DEV_EXPOSE_MAGIC_LINKS',
            ),
          ),
          ctx.json,
          () => '',
        );
        return;
      }
      const verified = await ctx.auth.verifyMagicLinkToken(link.value.magicLink.token);
      if (verified.ok && !verified.value.token) {
        emit(err(internal('Magic-link verification returned no session token')), ctx.json, () => '');
        return;
      }
      if (verified.ok && verified.value.token) {
        saveActiveProfile(ctx, { token: verified.value.token });
      }
      emit(verified, ctx.json, () => `signed in as ${options.email} via magic link`);
    }),
  );

const member = program.command('member').description('Members of the active tenant (staff only)');

member.command('list').description('List members and their granted product ids').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.listMembers(), ctx.json, (data) =>
      data.members.length === 0
        ? 'no members'
        : data.members
            .map((m) => `${m.email}\t${m.displayName ?? ''}\t${m.productIds.length} product(s)\t(${m.id})`)
            .join('\n'),
    );
  }),
);

member
  .command('export')
  .description('Export members as CSV or JSON')
  .requiredOption('--format <format>', 'csv or json')
  .option('--out <file>', 'write the export to a file instead of stdout')
  .action(
    withInput(z.tuple([memberExportOptionsSchema]), async (ctx, [options]) => {
      const result = await ctx.api.exportMembers(options.format);
      if (result.ok && options.out !== undefined) {
        await writeFile(options.out, result.value.content);
      }
      emit(result, ctx.json, (file) =>
        options.out !== undefined ? `wrote ${file.filename} to ${options.out}` : file.content,
      );
    }),
  );

member
  .command('learning <memberId>')
  .description('Learning summary: last activity plus per-course progress and latest completed lesson')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [memberId]) => {
      emit(await ctx.api.memberLearningSummary(memberId), ctx.json, (data) => {
        const header = `last activity: ${data.summary.lastActivityAt ?? 'none'}`;
        const rows = data.summary.courses.map(
          (c) =>
            `${c.courseName}\t${c.completedLessonCount}/${c.accessibleLessonCount} lessons\tlatest: ${c.latestCompletedLesson?.name ?? 'none'}\tactive: ${c.lastActivityAt ?? 'never'}`,
        );
        return [header, ...rows].join('\n');
      });
    }),
  );

member
  .command('reset-progress <memberId>')
  .description('Clear a member completed lessons and resume position in one course (staff only)')
  .requiredOption('--course <courseId>')
  .action(
    withInput(
      z.tuple([z.string().min(1), z.object({ course: z.string().min(1) })]),
      async (ctx, [memberId, options]) => {
        emit(
          await ctx.api.resetMemberProgress({ memberId, courseId: options.course }),
          ctx.json,
          (data) =>
            `reset progress for member ${data.reset.memberId.slice(0, 8)} in course ${data.reset.courseId.slice(0, 8)}: cleared ${data.reset.clearedLessonCount} lesson(s)`,
        );
      },
    ),
  );

member
  .command('remove <memberId>')
  .description('Remove a member and tenant-scoped grants without deleting the account')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [memberId]) => {
      emit(await ctx.api.removeMember({ memberId }), ctx.json, (data) => `removed member: ${data.memberId}`);
    }),
  );

const grant = program.command('grant').description('Product grants for members (staff only)');

const grantCreateOptionsSchema = z.object({
  member: z.string().min(1),
  product: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

grant
  .command('list <memberId>')
  .description('List a member grants with product name, window, source and active flag')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [memberId]) => {
      emit(await ctx.api.listMemberGrants(memberId), ctx.json, (data) =>
        data.grants.length === 0
          ? 'no grants'
          : data.grants
              .map(
                (g) =>
                  `${g.active ? 'active ' : 'expired'}\t${g.productName}\t${g.startsAt} → ${g.expiresAt ?? 'perpetual'}\t${g.source}\t(${g.id})`,
              )
              .join('\n'),
      );
    }),
  );

grant
  .command('create')
  .description('Grant a product to a member (create-or-renew) with an optional expiry')
  .requiredOption('--member <memberId>')
  .requiredOption('--product <productId>')
  .option('--expires-at <iso>', 'ISO datetime when the grant expires')
  .action(
    withInput(z.tuple([grantCreateOptionsSchema]), async (ctx, [options]) => {
      emit(
        await ctx.api.grantProductToMember({
          memberId: options.member,
          productId: options.product,
          ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
        }),
        ctx.json,
        (data) =>
          `${data.renewed ? 'renewed' : 'granted'}: grant ${data.grantId} for member ${data.memberId}`,
      );
    }),
  );

grant
  .command('revoke <grantId>')
  .description('Revoke a grant by setting its expiry to now')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [grantId]) => {
      emit(await ctx.api.revokeGrant({ grantId }), ctx.json, (data) =>
        `revoked grant ${data.grantId} (expires ${data.expiresAt})`,
      );
    }),
  );

const apiKey = program.command('api-key').description('Tenant API keys for M2M enrollment (owner only)');

apiKey.command('list').description('List API keys (no secrets)').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.listApiKeys(), ctx.json, (data) =>
      data.apiKeys.length === 0
        ? 'no API keys'
        : data.apiKeys
            .map((k) => `${k.name}\t${k.revokedAt ? 'revoked' : 'active'}\t(${k.id})`)
            .join('\n'),
    );
  }),
);

apiKey
  .command('create <name...>')
  .description('Create an API key; the secret is shown once')
  .action(
    withInput(z.tuple([z.array(z.string().min(1)).min(1), noOptionsSchema]), async (ctx, [nameWords]) => {
      emit(await ctx.api.createApiKey({ name: nameWords.join(' ') }), ctx.json, (data) =>
        `created API key ${data.apiKey.name} (${data.apiKey.id})\nsecret (shown once): ${data.secret}`,
      );
    }),
  );

apiKey
  .command('revoke <id>')
  .description('Revoke an API key')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [id]) => {
      emit(await ctx.api.revokeApiKey({ id }), ctx.json, (data) =>
        `revoked API key ${data.apiKey.name} (${data.apiKey.id})`,
      );
    }),
  );

const tenantSecret = program
  .command('tenant-secret')
  .description('Encrypted BYO integration secrets (owner only)');

tenantSecret.command('list').description('List configured secrets (masked)').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.listTenantSecrets(), ctx.json, (data) =>
      data.secrets.length === 0
        ? 'no secrets'
        : data.secrets.map((s) => `${s.key}\t${s.maskedPreview}\t(updated ${s.updatedAt})`).join('\n'),
    );
  }),
);

tenantSecret
  .command('set <key> <value>')
  .description('Store or replace a secret; encrypted at rest, returned masked')
  .action(
    withInput(
      z.tuple([tenantSecretKeySchema, z.string().min(1), noOptionsSchema]),
      async (ctx, [key, value]) => {
        emit(await ctx.api.setTenantSecret({ key, value }), ctx.json, (data) =>
          `saved ${data.secret.key} (${data.secret.maskedPreview})`,
        );
      },
    ),
  );

tenantSecret
  .command('delete <key>')
  .description('Delete a secret')
  .action(
    withInput(z.tuple([tenantSecretKeySchema, noOptionsSchema]), async (ctx, [key]) => {
      emit(await ctx.api.deleteTenantSecret({ key }), ctx.json, (data) => `deleted ${data.key}`);
    }),
  );

const stripe = program.command('stripe').description('Stripe payment integration (owner only)');

stripe
  .command('test-connection')
  .description('Create and immediately expire a test checkout session via the port')
  .action(
    withCtx(async (ctx) => {
      emit(await ctx.api.testStripeConnection(), ctx.json, (data) => data.diagnostic);
    }),
  );

stripe
  .command('deliver-webhook')
  .description('Sign and deliver a Stripe event payload')
  .requiredOption('--tenant-id <id>')
  .requiredOption('--webhook-secret <secret>')
  .requiredOption('--event <json>')
  .action(
    withInput(z.tuple([stripeWebhookOptionsSchema]), async (ctx, [options]) => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = await hmacSha256(options.webhookSecret, `${timestamp}.${options.event}`);
      emit(
        await ctx.api.deliverStripeWebhook(options.tenantId, options.event, `t=${timestamp},v1=${signature}`),
        ctx.json,
        (data) => `received=${data.received} processed=${data.processed}`,
      );
    }),
  );

const consentDefinition = program.command('consent-definition').description('Marketing consent definitions');

consentDefinition.command('list').action(withCtx(async (ctx) => {
  emit(await ctx.api.listMarketingConsentDefinitions(), ctx.json, (data) => data.definitions.length === 0
    ? 'no consent definitions'
    : data.definitions.map((item) => `${item.key}\t${item.status}\t${item.doubleOptIn ? 'double opt-in' : 'single opt-in'}\t(${item.id})`).join('\n'));
}));

consentDefinition.command('create')
  .requiredOption('--key <key>')
  .requiredOption('--label <label>')
  .requiredOption('--document-url <url>')
  .option('--single-opt-in')
  .action(withInput(z.tuple([consentDefinitionCreateOptionsSchema]), async (ctx, [options]) => {
    emit(await ctx.api.createMarketingConsentDefinition({
      key: options.key, label: options.label, documentRef: { mode: 'url', url: options.documentUrl },
      doubleOptIn: options.singleOptIn !== true,
    }), ctx.json, (data) => `created consent definition ${data.definition?.key ?? options.key} (${data.definition?.id ?? 'unknown'})`);
  }));

const campaign = program.command('campaign').description('Marketing campaigns');

campaign.command('create')
  .requiredOption('--name <name>')
  .requiredOption('--subject <subject>')
  .requiredOption('--body-html <html>')
  .requiredOption('--consent-definition <id>')
  .action(withInput(z.tuple([campaignCreateOptionsSchema]), async (ctx, [options]) => {
    emit(await ctx.api.createMarketingCampaign({
      name: options.name, subject: options.subject, bodyHtml: options.bodyHtml,
      consentDefinitionId: options.consentDefinition,
    }), ctx.json, (data) => `created campaign ${data.campaign.name} (${data.campaign.id})`);
  }));

campaign.command('schedule')
  .requiredOption('--campaign <id>')
  .requiredOption('--send-at <iso>')
  .action(withInput(z.tuple([campaignScheduleOptionsSchema]), async (ctx, [options]) => {
    emit(await ctx.api.scheduleMarketingCampaign({ campaignId: options.campaign, sendAt: options.sendAt }), ctx.json,
      (data) => `scheduled campaign ${data.campaign.id} for ${data.campaign.sendAt ?? options.sendAt}`);
  }));

campaign.command('status <id>').action(withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [id]) => {
  emit(await ctx.api.getMarketingCampaign(id), ctx.json,
    (data) => `${data.campaign.status}\t${data.campaign.sent}/${data.campaign.toSend} sent\t${data.campaign.failed} failed`);
}));

const suppression = program.command('suppression').description('Marketing suppressions');

suppression.command('list').action(withCtx(async (ctx) => {
  emit(await ctx.api.listMarketingSuppressions(), ctx.json, (data) => data.suppressions.length === 0
    ? 'no suppressions'
    : data.suppressions.map((item) => `${item.email ?? item.emailHmac}\t${item.reason}\t${item.createdAt}`).join('\n'));
}));

suppression.command('add')
  .requiredOption('--email <email>')
  .option('--source-ref <reference>')
  .action(withInput(z.tuple([suppressionAddOptionsSchema]), async (ctx, [options]) => {
    emit(await ctx.api.addMarketingSuppression({ email: options.email, sourceRef: options.sourceRef ?? null }), ctx.json,
      (data) => `suppressed ${data.suppression.email ?? options.email} (${data.suppression.id})`);
  }));

const m2m = program.command('m2m').description('Machine-to-machine enrollment (API-key auth)');

m2m
  .command('enroll')
  .description('Enroll a member into a product via a tenant API key')
  .requiredOption('--api-key <secret>')
  .requiredOption('--email <email>')
  .requiredOption('--product <id>')
  .option('--expires-at <iso>', 'ISO datetime when the grant expires')
  .option('--language <language>', 'email language (pl or en)')
  .option('--skip-email', 'do not send the enrollment email')
  .action(
    withInput(z.tuple([m2mEnrollOptionsSchema]), async (ctx, [options]) => {
      if (!ctx.tenant) {
        emit(err(validation('Select a tenant with --tenant to enroll a member')), ctx.json, () => '');
        return;
      }
      const input = parsedInput(
        m2mEnrollInputSchema,
        {
          email: options.email,
          productId: options.product,
          ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
          ...(options.language === undefined ? {} : { language: options.language }),
          ...(options.skipEmail === true ? { doNotSendEmail: true } : {}),
        },
        'Invalid enrollment payload',
      );
      if (!input.ok) {
        emit(input, ctx.json, () => '');
        return;
      }
      const tenant = ctx.tenant;
      const api = createApiClient({
        baseUrl: ctx.apiUrl,
        headers: () => ({ [TENANT_HEADER]: tenant, [API_KEY_HEADER]: options.apiKey }),
      });
      emit(await api.m2mEnroll(input.value), ctx.json, (data) => {
        const status = data.renewed ? 'renewed' : 'enrolled';
        const link = data.magicLink ? `\nmagic link: ${data.magicLink.url}` : '';
        return `${status}: grant ${data.grantId} for member ${data.memberId}${link}`;
      });
    }),
  );

const my = program.command('my').description('Your member view of the active tenant');

my.command('products').description('Products you have been granted').action(
  withCtx(async (ctx) => {
    emit(await ctx.api.myProducts(), ctx.json, (data) =>
      data.products.length === 0
        ? 'no products'
        : data.products
            .map((p) => `- ${p.title}  ${p.priceCents} ${p.currency}  (${p.id.slice(0, 8)})`)
            .join('\n'),
    );
  }),
);

const wantsJson = process.argv.includes('--json');
try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.exitCode !== 0) {
      emit(err(validation(error.message.replace(/^error:\s*/i, ''))), wantsJson, () => '');
    }
  } else if (error instanceof Error && error.message.startsWith('together:')) {
    emit(err(internal(error.message)), wantsJson, () => '');
  } else {
    throw error;
  }
}
