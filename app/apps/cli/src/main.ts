import { readFile, writeFile } from 'node:fs/promises';

import { Command } from 'commander';
import { z, type ZodTypeAny } from 'zod';

import { createCliAuthAdapter, type CliAuthAdapter } from '@adapters/auth/client-adapter.js';
import { createApiClient, type ApiClient } from '@core/client/index.js';
import { TENANT_HEADER } from '@core/contract/index.js';
import {
  accessItemSchema,
  currencySchema,
  devGrantInputSchema,
  err,
  internal,
  memberExportFormatSchema,
  newCourseLessonSchema,
  newCourseModuleSchema,
  notFound,
  ok,
  updateCourseLessonInputSchema,
  updateCourseModuleInputSchema,
  updateLastViewedInputSchema,
  updateProductAccessItemsInputSchema,
  validation,
  type AccessStatus,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import { loadConfig, saveConfig, type CliConfig } from './config.js';
import { emit } from './output.js';

const program = new Command('together')
  .description('Reference client for the together API - the agent feedback loop')
  .option('--json', 'machine-readable JSON output', false)
  .option('--api-url <url>', 'API base URL (overrides config)')
  .option('--tenant <slug>', 'tenant slug for this invocation (overrides config)');

interface CliCtx {
  config: CliConfig;
  api: ApiClient;
  auth: CliAuthAdapter;
  apiUrl: string;
  tenant: string | null;
  json: boolean;
}

const globalOptionsSchema = z.object({
  json: z.boolean().default(false),
  apiUrl: z.string().url().optional(),
  tenant: z.string().min(1).optional(),
});

const centsSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, 'Price must be a non-negative integer number of cents')
  .transform((value) => Number.parseInt(value, 10));

const emailOptionSchema = z.object({ email: z.string().email() });
const authPasswordOptionsSchema = emailOptionSchema.extend({ password: z.string().min(1) });
const registerOptionsSchema = authPasswordOptionsSchema.extend({ name: z.string().min(1) });
const tenantCreateOptionsSchema = z.object({ slug: z.string().min(1).optional() });
const productCreateOptionsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  priceCents: centsSchema,
  currency: currencySchema.optional(),
  description: z.string().optional(),
  accessItems: z.string().optional(),
});
const simulatePurchaseOptionsSchema = z.object({
  email: z.string().email(),
  product: z.string().min(1),
});
const memberExportOptionsSchema = z.object({
  format: memberExportFormatSchema,
  out: z.string().min(1).optional(),
});
const noOptionsSchema = z.object({});

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
});
const moduleAttachOptionsSchema = z.object({
  course: z.string().min(1),
  module: z.string().min(1),
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
  const apiUrl = globals.value.apiUrl ?? config.apiUrl;
  const tenant = globals.value.tenant ?? config.tenant;
  const api = createApiClient({
    baseUrl: apiUrl,
    headers: () => ({
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      ...(tenant ? { [TENANT_HEADER]: tenant } : {}),
    }),
  });
  const auth = createCliAuthAdapter(apiUrl, (token) => {
    saveConfig({ ...config, apiUrl, token });
  });
  return ok({ config, api, auth, apiUrl, tenant, json: globals.value.json });
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
    emit(await ctx.api.health(), ctx.json, (h) => `status=${h.status} db=${h.database} v${h.version}`);
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
        saveConfig({ ...ctx.config, apiUrl: ctx.apiUrl, token: result.value.token });
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
        saveConfig({ ...ctx.config, apiUrl: ctx.apiUrl, token: result.value.token });
      }
      emit(result, ctx.json, () => `signed in as ${options.email}`);
    }),
  );

program.command('logout').description('Drop the stored session token').action(
  withCtx((ctx) => {
    saveConfig({ ...ctx.config, token: null });
    emit(ok({ loggedOut: true }), ctx.json, () => 'signed out');
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
      saveConfig({ ...ctx.config, tenant: slug });
      emit(ok(membership), ctx.json, (m) => `active tenant: ${m.tenant.name} (${m.tenant.slug})`);
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
  .requiredOption('--price-cents <cents>', 'price in integer cents')
  .option('--currency <currency>', '3-letter uppercase currency code')
  .option('--description <description>')
  .option('--access-items <json>', 'inline JSON array of access items')
  .action(
    withInput(z.tuple([productCreateOptionsSchema]), async (ctx, [options]) => {
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
          priceCents: options.priceCents,
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
  .option('--data <json>', 'inline JSON array of access items')
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
  .action(
    withInput(z.tuple([z.string().min(1), courseUpdateOptionsSchema]), async (ctx, [id, options]) => {
      emit(
        await ctx.api.updateCourse({
          id,
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.description === undefined ? {} : { description: options.description }),
          ...(options.imageUrl === undefined ? {} : { imageUrl: options.imageUrl }),
        }),
        ctx.json,
        (data) => `updated course: ${data.course.name} (${data.course.id.slice(0, 8)})`,
      );
    }),
  );

const moduleCommand = program.command('module').description('Course modules (staff only)');

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

const lesson = program.command('lesson').description('Course lessons (staff only)');

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

program
  .command('simulate-purchase')
  .description('Simulate a purchase (dev endpoint): grant a product to a buyer email')
  .requiredOption('--email <email>')
  .requiredOption('--product <id>')
  .action(
    withInput(z.tuple([simulatePurchaseOptionsSchema]), async (ctx, [options]) => {
      if (!ctx.tenant) {
        emit(err(validation('Select a tenant with --tenant to simulate a purchase')), ctx.json, () => '');
        return;
      }
      emit(
        await ctx.api.simulatePurchase({ email: options.email, productId: options.product }),
        ctx.json,
        (data) => {
          const status = data.alreadyOwned ? 'already owned' : 'granted';
          const link = data.magicLink ? `\nmagic link: ${data.magicLink.url}` : '';
          return `${status}: product ${data.productId} for member ${data.memberId}${link}`;
        },
      );
    }),
  );

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
        saveConfig({ ...ctx.config, apiUrl: ctx.apiUrl, token: verified.value.token });
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
  .command('remove <memberId>')
  .description('Remove a member and tenant-scoped grants without deleting the account')
  .action(
    withInput(z.tuple([z.string().min(1), noOptionsSchema]), async (ctx, [memberId]) => {
      emit(await ctx.api.removeMember({ memberId }), ctx.json, (data) => `removed member: ${data.memberId}`);
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

await program.parseAsync(process.argv);
