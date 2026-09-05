import { spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { z } from 'zod';

import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';
import {
  API_PATHS,
  deepHealthOutputSchema,
  EMAIL_DISPATCH_SECRET_HEADER,
  envelopeSchema,
  EXIT_CODE_BY_ERROR_CODE,
  TENANT_HEADER,
} from '#core/contract/index.js';

import { DEV_EMAIL_DISPATCH_SECRET } from '../apps/server/src/env.js';
import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';
import { ensureWebBundleFresh } from './web-bundle-freshness.js';
import { passwordFixture } from './password-fixture.js';

const SMOKE_DB = uniqueTestDatabaseName('together_smoke');
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';
const smokeUrlObject = new URL(baseDatabaseUrl);
smokeUrlObject.pathname = `/${SMOKE_DB}`;
const smokeDatabaseUrl = smokeUrlObject.toString();
class SmokeFailure extends Error {}
const fail = (message: string): never => {
  throw new SmokeFailure(message);
};
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}
type Run = Awaited<ReturnType<typeof run>>;

const checkLockfileDrift = (): void => {
  const verification = spawnSync(
    'pnpm',
    ['install', '--frozen-lockfile', '--lockfile-only'],
    { cwd: rootDir, encoding: 'utf8' },
  );
  if (verification.error !== undefined) {
    fail(`Could not run pnpm: ${verification.error.message}`);
  }
  if (verification.status !== 0) {
    fail(
      `pnpm-lock.yaml does not match package.json:\n${verification.stdout}${verification.stderr}`,
    );
  }
  const source = readFileSync(join(rootDir, 'pnpm-lock.yaml'), 'utf8');
  let installed: string;
  try {
    installed = readFileSync(join(rootDir, 'node_modules/.pnpm/lock.yaml'), 'utf8');
  } catch {
    throw new SmokeFailure(
      'Dependencies are not installed (node_modules/.pnpm/lock.yaml missing). Run: pnpm install --frozen-lockfile',
    );
  }
  if (installed !== source) {
    fail(
      'Installed dependency tree does not match pnpm-lock.yaml. Run: pnpm install --frozen-lockfile',
    );
  }
};

const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    // Fresh, isolated database each run so smoke never touches the dev-seeded data.
    await client.query(`DROP DATABASE IF EXISTS ${SMOKE_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${SMOKE_DB}`);
  } catch (cause) {
    fail(
      `Could not prepare the smoke database "${SMOKE_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

const dropDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${SMOKE_DB} WITH (FORCE)`);
  } finally {
    await client.end();
  }
};

const migrateAndSeed = async (databaseUrl: string): Promise<void> => {
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: databaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: databaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

const DEMO_TENANT_IDS = ['tenant-studio', 'tenant-acme', 'tenant-akademia'];
const CANONICAL_JS_MODULE_IDS = ['module-js-podstawy', 'module-js-dom', 'module-js-projekty'];
const CANONICAL_AKTYWNY_COMPLETED = ['lesson-js-zmienne-1', 'lesson-js-zmienne-2'];
const CANONICAL_AKTYWNY_LAST_VIEWED = 'lesson-js-funkcje-1';

const idRowsSchema = z.array(z.object({ id: z.string() }));
const moduleOrderRowSchema = z.object({ module_order: z.array(z.string()) });
const progressRowSchema = z.object({
  completed_lesson_ids: z.array(z.string()),
  last_viewed_lesson_id: z.string().nullable(),
});

const polluteDemoTenants = async (client: pg.Client): Promise<void> => {
  const now = new Date().toISOString();
  await client.query(
    `insert into courses (id, tenant_id, name, description, created_at) values ('AUDYT-kurs', 'tenant-studio', 'AUDYT kurs', '', $1)`,
    [now],
  );
  await client.query(
    `insert into course_lessons (id, tenant_id, name, created_at) values ('AUDYT-lekcja', 'tenant-studio', 'AUDYT lekcja', $1)`,
    [now],
  );
  await client.query(
    `insert into course_modules (id, tenant_id, title, created_at) values ('AUDYT-modul', 'tenant-studio', 'AUDYT modul', $1)`,
    [now],
  );
  await client.query(
    `insert into products (id, tenant_id, type, slug, title, description, price_cents, currency, created_at) values ('AUDYT-produkt', 'tenant-studio', 'course', 'audyt-produkt', 'AUDYT produkt', '', 12300, 'PLN', $1)`,
    [now],
  );
  await client.query(
    `insert into product_grants (id, tenant_id, member_id, product_id, source, created_at) values ('AUDYT-grant', 'tenant-studio', 'member-studio-aktywny', 'AUDYT-produkt', 'manual', $1)`,
    [now],
  );
  await client.query(
    `update courses set module_order = '["module-js-projekty","module-js-podstawy","module-js-dom"]'::jsonb where tenant_id = 'tenant-studio' and id = 'course-js'`,
  );
  await client.query(
    `update member_course_progress
     set completed_lesson_ids = '["lesson-js-demo-video","lesson-js-zmienne-1","lesson-js-zmienne-2","lesson-js-funkcje-1","lesson-js-funkcje-2","lesson-js-dom-1","lesson-js-dom-2","lesson-js-projekt-1"]'::jsonb,
         last_viewed_lesson_id = 'lesson-js-projekt-1'
     where tenant_id = 'tenant-studio' and id = 'progress-member-studio-aktywny'`,
  );
};

const verifyReseedRestoresCanonicalState = async (databaseUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await polluteDemoTenants(client);

    const reseed = await run(tsxBin, ['adapters/db/reseed.ts'], { DATABASE_URL: databaseUrl });
    assert(reseed.code === 0, `Reseed failed:\n${reseed.stdout}${reseed.stderr}`);

    const orderResult = await client.query(
      `select module_order from courses where tenant_id = 'tenant-studio' and id = 'course-js'`,
    );
    assert(orderResult.rowCount === 1, 'reseed: course-js should exist after reseed');
    const orderRow = moduleOrderRowSchema.parse(orderResult.rows[0]);
    assert(
      orderRow.module_order.length === 0,
      `reseed: course-js module_order should be the canonical [] (createdAt fallback), got ${JSON.stringify(orderRow.module_order)}`,
    );
    const modulesResult = await client.query(
      `select id from course_modules where tenant_id = 'tenant-studio' and course_ids ? 'course-js' order by created_at, id`,
    );
    const moduleIds = idRowsSchema.parse(modulesResult.rows).map((row) => row.id);
    assert(
      JSON.stringify(moduleIds) === JSON.stringify(CANONICAL_JS_MODULE_IDS),
      `reseed: JS course modules should resolve to the canonical 1-2-3 order ${JSON.stringify(CANONICAL_JS_MODULE_IDS)}, got ${JSON.stringify(moduleIds)}`,
    );

    const progressResult = await client.query(
      `select completed_lesson_ids, last_viewed_lesson_id from member_course_progress
       where tenant_id = 'tenant-studio' and member_id = 'member-studio-aktywny' and course_id = 'course-js'`,
    );
    assert(progressResult.rowCount === 1, 'reseed: kursant.aktywny should have exactly one course-js progress row');
    const progressRow = progressRowSchema.parse(progressResult.rows[0]);
    assert(
      JSON.stringify(progressRow.completed_lesson_ids) === JSON.stringify(CANONICAL_AKTYWNY_COMPLETED),
      `reseed: kursant.aktywny should have exactly the seeded partial progress ${JSON.stringify(CANONICAL_AKTYWNY_COMPLETED)}, got ${JSON.stringify(progressRow.completed_lesson_ids)}`,
    );
    assert(
      progressRow.last_viewed_lesson_id === CANONICAL_AKTYWNY_LAST_VIEWED,
      `reseed: kursant.aktywny last viewed lesson should be ${CANONICAL_AKTYWNY_LAST_VIEWED}, got ${String(progressRow.last_viewed_lesson_id)}`,
    );

    const leftoversResult = await client.query(
      `select id from courses where tenant_id = any($1) and (id like 'AUDYT%' or name like 'AUDYT%')
       union all select id from course_lessons where tenant_id = any($1) and (id like 'AUDYT%' or name like 'AUDYT%')
       union all select id from course_modules where tenant_id = any($1) and (id like 'AUDYT%' or title like 'AUDYT%')
       union all select id from products where tenant_id = any($1) and (id like 'AUDYT%' or title like 'AUDYT%')
       union all select id from product_grants where tenant_id = any($1) and (id like 'AUDYT%' or product_id like 'AUDYT%')
       union all select id from members where tenant_id = any($1) and id like 'AUDYT%'`,
      [DEMO_TENANT_IDS],
    );
    const leftoverIds = idRowsSchema.parse(leftoversResult.rows).map((row) => row.id);
    assert(
      leftoverIds.length === 0,
      `reseed: no AUDYT-* entities should survive a reseed, found ${JSON.stringify(leftoverIds)}`,
    );
  } finally {
    await client.end();
  }
};

const okEnvelope = z.object({ ok: z.literal(true), data: z.unknown() });
const errEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});
const envelope = z.discriminatedUnion('ok', [okEnvelope, errEnvelope]);

const healthSchema = z.object({ status: z.string(), database: z.string(), version: z.string() });
const productItemSchema = z.object({ id: z.string(), title: z.string(), published: z.boolean() });
const productsSchema = z.object({ products: z.array(productItemSchema) });
const createSchema = z.object({ product: productItemSchema });
const publishSchema = z.object({ product: productItemSchema });
const publicOfferSchema = z.object({
  tenant: z.object({ slug: z.string(), name: z.string() }),
  contentVersion: z.number().int().positive(),
  previewLessons: z.array(z.object({ id: z.string(), name: z.string(), courseId: z.string() })),
  products: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      priceCents: z.number().int().nonnegative(),
      currency: z.string(),
    }),
  ),
});
const magicLinkSchema = z.object({ email: z.string(), url: z.string(), token: z.string() });
const simulatePurchaseSchema = z.object({
  memberId: z.string(),
  productId: z.string(),
  alreadyOwned: z.boolean(),
  magicLink: magicLinkSchema.nullable(),
});
const myProductsSchema = z.object({
  products: z.array(z.object({ id: z.string(), title: z.string() })),
});

const courseSchema = z.object({ course: z.object({ id: z.string(), name: z.string() }) });
const studentCoursesSchema = z.object({
  courses: z.array(z.object({ id: z.string(), name: z.string() })),
});
const moduleSchema = z.object({ module: z.object({ id: z.string(), name: z.string() }) });
const lessonSchema = z.object({
  lesson: z.object({ id: z.string(), name: z.string(), contents: z.array(z.unknown()) }),
});
const accessStatusSchema = z.enum(['not-accessible', 'partially-accessible', 'fully-accessible']);
const structureLessonSchema = z.object({
  lessonId: z.string(),
  name: z.string(),
  accessStatus: accessStatusSchema,
});
const structureChapterSchema = z.object({ lessons: z.array(structureLessonSchema) });
const structureModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  accessStatus: accessStatusSchema,
  chapters: z.array(structureChapterSchema),
});
const structureSchema = z.object({
  structure: z.object({
    courseId: z.string(),
    accessStatus: accessStatusSchema,
    modules: z.array(structureModuleSchema),
  }),
});
const nextSchema = z.object({ next: z.object({ id: z.string(), name: z.string() }).nullable() });
const progressSchema = z.object({
  progress: z.object({ courseId: z.string(), completedLessonIds: z.array(z.string()) }),
});
const devGrantSchema = z.object({
  memberId: z.string(),
  productId: z.string(),
  granted: z.boolean(),
  expiresAt: z.string().nullable(),
});
const apiKeyCreateSchema = z.object({
  apiKey: z.object({ id: z.string(), name: z.string(), revokedAt: z.string().nullable() }),
  secret: z.string(),
});
const m2mEnrollSchema = z.object({
  memberId: z.string(),
  grantId: z.string(),
  renewed: z.boolean(),
  magicLink: magicLinkSchema.nullable(),
});
const paymentConfigSchema = z.object({
  stripeConfigured: z.boolean(),
  simulatedPaymentsEnabled: z.boolean(),
});
const checkoutSessionSchema = z.object({ url: z.string().url() });
const webhookSchema = z.object({ received: z.literal(true), processed: z.boolean() });
const membersSchema = z.object({
  members: z.array(z.object({ email: z.string().email(), productIds: z.array(z.string()) })),
});
const devEmailResultSchema = z.object({
  email: z.object({ to: z.string().email(), subject: z.string(), text: z.string() }).nullable(),
});
const postCreatedSchema = z.object({
  post: z.object({ id: z.string(), rootPostId: z.string(), contextId: z.string() }),
});
const notificationsListSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      readAt: z.string().nullable(),
      payload: z.object({ rootPostId: z.string(), postId: z.string(), snippet: z.string() }),
    }),
  ),
});
const notificationReadSchema = z.object({
  notification: z.object({ id: z.string(), readAt: z.string().nullable() }),
});
const conversationSchema = z.object({
  conversation: z.object({
    id: z.string(),
    otherParticipant: z.object({ display: z.string(), isStaff: z.boolean() }),
    unread: z.boolean(),
  }),
});
const conversationsListSchema = z.object({
  conversations: z.array(
    z.object({ id: z.string(), lastMessageSnippet: z.string(), unread: z.boolean() }),
  ),
});
const conversationThreadSchema = z.object({
  conversation: z.object({ id: z.string() }),
  messages: z.array(z.object({ id: z.string(), body: z.string(), isOwn: z.boolean() })),
});
const messageSentSchema = z.object({ message: z.object({ id: z.string(), isOwn: z.boolean() }) });
const unreadMessagesSchema = z.object({ unread: z.number() });
const searchHitsSchema = z.object({
  hits: z.array(z.object({ post: z.object({ id: z.string() }), lessonId: z.string(), snippet: z.string() })),
});
const spaceSchema = z.object({
  space: z.object({ id: z.string(), name: z.string(), visibility: z.string(), archivedAt: z.string().nullable() }),
});
const spacesListSchema = z.object({
  spaces: z.array(z.object({ id: z.string(), name: z.string(), isFollowing: z.boolean() })),
});
const staffSpacesSchema = z.object({
  spaces: z.array(
    z.object({
      id: z.string(),
      archivedAt: z.string().nullable(),
      stats: z.object({ posts: z.number(), followers: z.number() }),
    }),
  ),
});
const eventSchema = z.object({
  event: z.object({
    id: z.string(),
    spaceId: z.string(),
    title: z.string(),
    startsAt: z.string(),
    discussionRootPostId: z.string().nullable(),
    goingCount: z.number(),
    notGoingCount: z.number(),
    viewerRsvp: z.string().nullable(),
    liveNow: z.boolean(),
  }),
});
const eventsListSchema = z.object({
  events: z.array(z.object({ id: z.string(), title: z.string(), goingCount: z.number() })),
});
const eventIcsSchema = z.object({ fileName: z.string(), icsContent: z.string() });
const reactionsSchema = z.array(z.object({ emoji: z.string(), count: z.number(), viewerReacted: z.boolean() }));
const spaceFeedSchema = z.object({
  feed: z.object({
    spaceId: z.string(),
    isFollowing: z.boolean(),
    items: z.array(z.object({ id: z.string(), replyCount: z.number(), reactions: reactionsSchema })),
  }),
});
const reactedSchema = z.object({ postId: z.string(), reactions: reactionsSchema });
const publicNavigationSchema = z.object({
  navigation: z.object({
    defaultHomeSpaceId: z.string().nullable(),
    spaces: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() })),
    courses: z.array(z.object({ id: z.string(), name: z.string() })),
    lockedSpaces: z.array(z.object({ id: z.string(), productIds: z.array(z.string()) })),
  }),
});
const publicThreadSchema = z.object({
  discussion: z.object({
    threads: z.array(z.object({ id: z.string(), replyCount: z.number() })),
  }),
});

const PUBLIC_COURSE_ID = 'course-js';
const PRIVATE_COURSE_ID = 'course-react';
const PUBLIC_PREVIEW_LESSON_ID = 'lesson-js-zmienne-1';
const PUBLIC_HOME_SPACE_ID = 'space-studio-spolecznosc';
const PUBLIC_THREAD_POST_ID = 'post-spolecznosc-hello';
const LOCKED_SPACE_ID = 'space-studio-klub-js';

const readEnvelope = (result: Run, label: string): unknown => {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fail(`${label}: stdout was not a JSON envelope.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
};
const expectOk = (result: Run, label: string): unknown => {
  assert(
    result.code === 0,
    `${label}: expected exit 0, got ${result.code}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  const parsed = envelope.parse(readEnvelope(result, label));
  assert(parsed.ok, `${label}: expected an ok envelope, got an error.`);
  return parsed.data;
};
const expectError = (result: Run, label: string, exitCode: number, errorCode: string): void => {
  assert(
    result.code === exitCode,
    `${label}: expected exit ${exitCode}, got ${result.code}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  const parsed = envelope.parse(readEnvelope(result, label));
  assert(!parsed.ok, `${label}: expected an error envelope, got ok.`);
  assert(
    parsed.error.code === errorCode,
    `${label}: expected error code "${errorCode}", got "${parsed.error.code}".`,
  );
};

const driveCli = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const authedHome = mkdtempSync(join(tmpdir(), 'smoke-cli-'));
  const anonHome = mkdtempSync(join(tmpdir(), 'smoke-anon-'));
  homes.push(authedHome, anonHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });
  const waitForDevEmail = async (to: string): Promise<z.infer<typeof devEmailResultSchema>> => {
    const deadline = Date.now() + 3000;
    while (true) {
      const result = devEmailResultSchema.parse(
        expectOk(
          await cli(
            ['--json', '--api-url', url, '--tenant', 'acme', 'dev', 'email', '--to', to],
            anonHome,
          ),
          'stripe: welcome email in dev sink',
        ),
      );
      if (result.email !== null || Date.now() >= deadline) return result;
      await delay(100);
    }
  };

  const health = healthSchema.parse(expectOk(await cli(['--json', '--api-url', url, 'health'], authedHome), 'health'));
  assert(
    health.status === 'ok' && health.database === 'up',
    `health degraded: status=${health.status} database=${health.database}`,
  );

  // Deep health reads the scheduler's last-run age; the seeded demo history is
  // deliberately aged, so drive one real dispatch before probing it.
  const dispatched = await fetch(`${url}${API_PATHS.emailDispatch}`, {
    method: 'POST',
    headers: { [EMAIL_DISPATCH_SECRET_HEADER]: DEV_EMAIL_DISPATCH_SECRET },
  });
  assert(dispatched.ok, `email dispatch returned HTTP ${dispatched.status}`);

  const deepResponse = await fetch(`${url}${API_PATHS.healthDeep}`);
  const deep = envelopeSchema(deepHealthOutputSchema).parse(await deepResponse.json());
  assert(deep.ok, 'deep health returned an error envelope');
  assert(
    deepResponse.status === 200 && deep.data.ok,
    `deep health failed: ${deep.data.failing.join(', ')}`,
  );

  expectOk(
    await cli(
      ['--json', '--api-url', url, 'login', '--email', 'creator2@together.dev', '--password', 'demo-password-15'],
      authedHome,
    ),
    'login',
  );
  expectError(
    await cli(['--json', '--api-url', url, 'tenant', 'create', 'Reserved', '--slug', 'api'], authedHome),
    'tenant create: reserved slug',
    21,
    'slug_reserved',
  );

  const before = productsSchema.parse(
    expectOk(await cli(['--json', '--api-url', url, '--tenant', 'acme', 'product', 'list'], authedHome), 'product list (before)'),
  );

  const accessCourse = courseSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', url, '--tenant', 'acme', 'course', 'create', '--name', `Smoke access ${randomUUID()}`],
        authedHome,
      ),
      'product access course create',
    ),
  );
  const accessItems = JSON.stringify([{ level: 'course', courseId: accessCourse.course.id }]);
  const title = `smoke product ${randomUUID()}`;
  const created = createSchema.parse(
    expectOk(
      await cli(
        [
          '--json', '--api-url', url, '--tenant', 'acme', 'product', 'create', '--title', title,
          '--price-cents', '1234', '--access-items', accessItems,
        ],
        authedHome,
      ),
      'product create',
    ),
  );
  assert(created.product.title === title, `product create echoed the wrong title: ${created.product.title}`);
  assert(created.product.published === false, 'a newly created product should start as a draft');
  expectOk(
    await cli(
      [
        '--json', '--api-url', url, '--tenant', 'acme', 'price', 'add', '--product', created.product.id,
        '--kind', 'one_time', '--price-cents', '1234', '--currency', 'PLN',
      ],
      authedHome,
    ),
    'product active price create',
  );

  const published = publishSchema.parse(
    expectOk(
      await cli(['--json', '--api-url', url, '--tenant', 'acme', 'product', 'publish', created.product.id], authedHome),
      'product publish',
    ),
  );
  assert(published.product.published === true, 'publish should mark the product as published');

  const after = productsSchema.parse(
    expectOk(await cli(['--json', '--api-url', url, '--tenant', 'acme', 'product', 'list'], authedHome), 'product list (after)'),
  );
  const listed = after.products.find((product) => product.id === created.product.id);
  assert(
    listed !== undefined && listed.published,
    'the published product did not appear as published in the second list',
  );
  assert(
    after.products.length === before.products.length + 1,
    `expected exactly one more product (${before.products.length} -> ${after.products.length})`,
  );

  const publicOffer = publicOfferSchema.parse(
    expectOk(await cli(['--json', '--api-url', url, '--tenant', 'acme', 'public', 'offer'], anonHome), 'public offer'),
  );
  assert(publicOffer.tenant.slug === 'acme', `public offer selected the wrong tenant: ${publicOffer.tenant.slug}`);
  assert(
    publicOffer.products.some((product) => product.id === created.product.id),
    'the anonymously fetched public offer did not include the newly published product',
  );

  const webhookSecret = 'whsec_smoke_known_secret';
  expectOk(
    await cli(
      ['--json', '--api-url', url, '--tenant', 'acme', 'tenant-secret', 'set', 'stripe.restrictedKey', 'rk_test_smoke_restricted'],
      authedHome,
    ),
    'stripe: configure restricted key',
  );
  expectOk(
    await cli(
      ['--json', '--api-url', url, '--tenant', 'acme', 'tenant-secret', 'set', 'stripe.webhookSecret', webhookSecret],
      authedHome,
    ),
    'stripe: configure webhook secret',
  );
  const paymentConfig = paymentConfigSchema.parse(
    expectOk(
      await cli(['--json', '--api-url', url, '--tenant', 'acme', 'public', 'payment-config'], anonHome),
      'stripe: public payment config',
    ),
  );
  assert(paymentConfig.stripeConfigured, 'stripe: configured tenant should expose stripeConfigured=true');
  const checkoutSession = checkoutSessionSchema.parse(
    expectOk(
      await cli(
        [
          '--json', '--api-url', url, '--tenant', 'acme', 'checkout', 'session',
          '--product', created.product.id, '--email', 'stripe-smoke@together.dev', '--language', 'pl',
        ],
        anonHome,
      ),
      'stripe: create fake checkout session',
    ),
  );
  assert(checkoutSession.url.startsWith('https://fake.checkout.local/'), 'stripe: fake checkout URL was not returned');
  const sessionId = checkoutSession.url.slice(checkoutSession.url.lastIndexOf('/') + 1);
  const event = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        customer_details: { email: 'stripe-smoke@together.dev' },
        metadata: {
          tenantId: 'tenant-acme',
          productId: created.product.id,
          memberEmail: 'stripe-smoke@together.dev',
          language: 'pl',
        },
      },
    },
  });
  const webhook = webhookSchema.parse(
    expectOk(
      await cli(
        [
          '--json', '--api-url', url, 'stripe', 'deliver-webhook', '--tenant-id', 'tenant-acme',
          '--webhook-secret', webhookSecret, '--event', event,
        ],
        anonHome,
      ),
      'stripe: deliver signed webhook',
    ),
  );
  assert(webhook.processed, 'stripe: first webhook delivery should fulfill the checkout');
  const repeatedWebhook = webhookSchema.parse(
    expectOk(
      await cli(
        [
          '--json', '--api-url', url, 'stripe', 'deliver-webhook', '--tenant-id', 'tenant-acme',
          '--webhook-secret', webhookSecret, '--event', event,
        ],
        anonHome,
      ),
      'stripe: deliver duplicate webhook',
    ),
  );
  assert(!repeatedWebhook.processed, 'stripe: duplicate webhook should be a successful no-op');
  const stripeMembers = membersSchema.parse(
    expectOk(
      await cli(['--json', '--api-url', url, '--tenant', 'acme', 'member', 'list'], authedHome),
      'stripe: member list after webhook',
    ),
  );
  const stripeMember = stripeMembers.members.find((member) => member.email === 'stripe-smoke@together.dev');
  assert(stripeMember?.productIds.includes(created.product.id) === true, 'stripe: webhook did not create the member grant');
  const stripeEmail = await waitForDevEmail('stripe-smoke@together.dev');
  assert(stripeEmail.email !== null, 'stripe: webhook did not send the welcome email');

  expectError(
    await cli(['--json', '--api-url', url, '--tenant', 'acme', 'product', 'list'], anonHome),
    'unauthorized product list',
    EXIT_CODE_BY_ERROR_CODE.unauthorized,
    'unauthorized',
  );

  const buyerHome = mkdtempSync(join(tmpdir(), 'smoke-buyer-'));
  homes.push(buyerHome);
  const buyerEmail = 'buyer+smoke@together.dev';

  const purchase = simulatePurchaseSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', url, '--tenant', 'acme', 'simulate-purchase', '--email', buyerEmail, '--product', created.product.id],
        buyerHome,
      ),
      'simulate purchase',
    ),
  );
  assert(purchase.alreadyOwned === false, 'first simulated purchase should not report already-owned');
  assert(purchase.magicLink !== null, 'simulated purchase should expose a magic link when enabled');

  const repeat = simulatePurchaseSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', url, '--tenant', 'acme', 'simulate-purchase', '--email', buyerEmail, '--product', created.product.id],
        buyerHome,
      ),
      'simulate purchase (repeat)',
    ),
  );
  assert(repeat.alreadyOwned === true, 'a repeated simulated purchase should be idempotent (already owned)');
  assert(repeat.memberId === purchase.memberId, 'the repeated purchase should resolve the same member');

  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', buyerEmail], buyerHome),
    'login via magic link',
  );

  const mine = myProductsSchema.parse(
    expectOk(await cli(['--json', '--api-url', url, '--tenant', 'acme', 'my', 'products'], buyerHome), 'my products'),
  );
  assert(
    mine.products.some((product) => product.id === created.product.id),
    'the granted product did not appear in the buyer\'s "my products" list',
  );
};

const proveCliPasswordRotation = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const firstHome = mkdtempSync(join(tmpdir(), 'smoke-password-a-'));
  const secondHome = mkdtempSync(join(tmpdir(), 'smoke-password-b-'));
  homes.push(firstHome, secondHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', url, ...args], { HOME: home });
  const email = 'password-rotation-smoke@together.dev';
  const oldPassword = passwordFixture('old-password');
  const newPassword = passwordFixture('new-password');

  expectOk(
    await cli([
      'register',
      '--name',
      'Password Rotation Smoke',
      '--email',
      email,
      '--password',
      oldPassword,
    ], firstHome),
    'password rotation: register session A',
  );
  expectOk(
    await cli(['login', '--email', email, '--password', oldPassword], secondHome),
    'password rotation: login session B',
  );
  expectOk(
    await cli([
      'change-password',
      '--current-password',
      oldPassword,
      '--new-password',
      newPassword,
      '--sign-out-other-sessions',
    ], firstHome),
    'password rotation: change through session A',
  );
  expectOk(
    await cli(['whoami'], firstHome),
    'password rotation: session A replacement token remains usable',
  );
  expectError(
    await cli(['whoami'], secondHome),
    'password rotation: session B is revoked',
    3,
    'unauthorized',
  );
  expectError(
    await cli(['login', '--email', email, '--password', oldPassword], secondHome),
    'password rotation: old password is rejected',
    3,
    'invalid_credentials',
  );
  expectOk(
    await cli(['login', '--email', email, '--password', newPassword], secondHome),
    'password rotation: new password is accepted',
  );
};

const proveEmailVerificationResend = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const home = mkdtempSync(join(tmpdir(), 'smoke-email-verification-'));
  homes.push(home);
  const cli = (args: string[]): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', url, ...args], { HOME: home });
  const email = 'email-verification-smoke@together.dev';

  expectOk(
    await cli([
      'register',
      '--name',
      'Email Verification Smoke',
      '--email',
      email,
      '--password',
      'verification-password',
      '--language',
      'pl',
    ]),
    'email verification: register known address',
  );
  expectOk(
    await cli(['resend-verification-email', '--email', email, '--language', 'en']),
    'email verification: resend known address',
  );

  let delivered: z.infer<typeof devEmailResultSchema>['email'] = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && delivered?.subject !== 'Verify your email address') {
    delivered = devEmailResultSchema.parse(
      expectOk(
        await cli(['dev', 'email', '--to', email]),
        'email verification: inspect known delivery',
      ),
    ).email;
    if (delivered?.subject !== 'Verify your email address') await delay(100);
  }
  assert(delivered !== null, 'email verification: known address did not receive an email');
  assert(
    delivered.subject === 'Verify your email address',
    'email verification: resend did not apply the requested language',
  );

  const actionUrl = delivered.text.match(/https?:\/\/\S+/)?.[0] ?? '';
  assert(actionUrl !== '', 'email verification: delivery did not contain a provider callback URL');
  const callbackUrl = new URL(actionUrl);
  assert(callbackUrl.host === `localhost:${port}`, 'email verification: provider callback used the wrong host');
  const callback = await fetch(actionUrl, { redirect: 'manual' });
  const redirect = callback.headers.get('location');
  assert(callback.status === 302 && redirect !== null, 'email verification: provider callback did not redirect');
  const me = z.object({ emailVerified: z.boolean() }).parse(
    expectOk(await cli(['whoami']), 'email verification: inspect verified account'),
  );
  assert(me.emailVerified, 'email verification: provider callback did not verify the account');
};

const provePasswordReset = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const home = mkdtempSync(join(tmpdir(), 'smoke-password-reset-'));
  homes.push(home);
  const cli = (args: string[]): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', url, ...args], { HOME: home });
  const email = 'password-reset-smoke@together.dev';
  const unknownEmail = 'password-reset-unknown-smoke@together.dev';
  const oldPassword = passwordFixture('old-password');
  const newPassword = passwordFixture('new-password');

  expectOk(
    await cli(['register', '--name', 'Password Reset Smoke', '--email', email, '--password', oldPassword]),
    'password reset: register known address',
  );
  expectOk(
    await cli(['request-password-reset', '--email', email, '--language', 'en']),
    'password reset: request known address',
  );
  expectOk(
    await cli(['request-password-reset', '--email', unknownEmail, '--language', 'en']),
    'password reset: request unknown address',
  );

  let delivered: z.infer<typeof devEmailResultSchema>['email'] = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && delivered === null) {
    delivered = devEmailResultSchema.parse(
      expectOk(
        await cli(['dev', 'email', '--to', email]),
        'password reset: inspect known delivery',
      ),
    ).email;
    if (delivered === null) await delay(100);
  }
  assert(delivered !== null, 'password reset: known address did not receive an email');
  const unknownDelivery = devEmailResultSchema.parse(
    expectOk(
      await cli(['dev', 'email', '--to', unknownEmail]),
      'password reset: inspect unknown delivery',
    ),
  ).email;
  assert(unknownDelivery === null, 'password reset: unknown address received an email');

  const actionUrl = delivered.text.match(/https?:\/\/\S+/)?.[0] ?? '';
  assert(actionUrl !== '', 'password reset: delivery did not contain a provider callback URL');
  const callbackUrl = new URL(actionUrl);
  assert(callbackUrl.host === `localhost:${port}`, 'password reset: provider callback used the wrong host');
  assert(
    /^\/api\/auth\/reset-password\/[^/]+$/.test(callbackUrl.pathname),
    'password reset: delivery bypassed the provider callback',
  );
  const callback = await fetch(actionUrl, { redirect: 'manual' });
  const redirect = callback.headers.get('location');
  assert(callback.status === 302 && redirect !== null, 'password reset: provider callback did not redirect');
  const resetPageUrl = new URL(redirect);
  assert(resetPageUrl.host === callbackUrl.host, 'password reset: completion redirect changed host');
  const token = resetPageUrl.searchParams.get('token');
  assert(token !== null && token.length > 0, 'password reset: completion redirect omitted the token');

  expectOk(
    await cli(['reset-password', '--token', token, '--password', newPassword]),
    'password reset: complete reset',
  );
  expectError(
    await cli(['login', '--email', email, '--password', oldPassword]),
    'password reset: old password is rejected',
    3,
    'invalid_credentials',
  );
  expectOk(
    await cli(['login', '--email', email, '--password', newPassword]),
    'password reset: new password is accepted',
  );
};

const driveStudentFlow = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const creatorHome = mkdtempSync(join(tmpdir(), 'smoke-creator-'));
  const studentHome = mkdtempSync(join(tmpdir(), 'smoke-student-'));
  homes.push(creatorHome, studentHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });
  const acme = (args: string[], home: string): Promise<Run> =>
    cli(['--json', '--api-url', url, '--tenant', 'acme', ...args], home);

  expectOk(
    await cli(['--json', '--api-url', url, 'login', '--email', 'creator2@together.dev', '--password', 'demo-password-15'], creatorHome),
    'student flow: creator login',
  );

  const embed = (n: number): string => JSON.stringify({ type: 'embed', embedUrl: `https://example.com/embed/${n}` });
  const lessonOne = lessonSchema.parse(
    expectOk(
      await acme(['lesson', 'create', '--data', `{"name":"Intro lesson","contents":[${embed(1)}]}`], creatorHome),
      'student flow: create lesson 1',
    ),
  );
  const lessonTwo = lessonSchema.parse(
    expectOk(
      await acme(['lesson', 'create', '--data', `{"name":"Advanced lesson","contents":[${embed(2)}]}`], creatorHome),
      'student flow: create lesson 2',
    ),
  );

  const course = courseSchema.parse(
    expectOk(
      await acme(['course', 'create', '--name', `Smoke course ${randomUUID()}`], creatorHome),
      'student flow: create course',
    ),
  );

  const chapter = (name: string, lessonId: string): string =>
    JSON.stringify({
      id: randomUUID(),
      name,
      contents: [{ id: randomUUID(), name, lessonId }],
    });
  const moduleOne = moduleSchema.parse(
    expectOk(
      await acme(
        ['module', 'create', '--data', `{"courseIds":["${course.course.id}"],"title":"Module One","chapters":[${chapter('Chapter One', lessonOne.lesson.id)}]}`],
        creatorHome,
      ),
      'student flow: create module 1',
    ),
  );
  const moduleTwo = moduleSchema.parse(
    expectOk(
      await acme(
        ['module', 'create', '--data', `{"courseIds":["${course.course.id}"],"title":"Module Two","chapters":[${chapter('Chapter Two', lessonTwo.lesson.id)}]}`],
        creatorHome,
      ),
      'student flow: create module 2',
    ),
  );

  const accessItems = (moduleId: string): string =>
    JSON.stringify([{ level: 'modules', courseId: course.course.id, moduleIds: [moduleId] }]);
  const productOne = createSchema.parse(
    expectOk(
      await acme(['product', 'create', '--title', `Access M1 ${randomUUID()}`, '--price-cents', '1000', '--access-items', accessItems(moduleOne.module.id)], creatorHome),
      'student flow: create product 1',
    ),
  );
  const productTwo = createSchema.parse(
    expectOk(
      await acme(['product', 'create', '--title', `Access M2 ${randomUUID()}`, '--price-cents', '1000', '--access-items', accessItems(moduleTwo.module.id)], creatorHome),
      'student flow: create product 2',
    ),
  );
  expectOk(
    await acme(
      ['price', 'add', '--product', productOne.product.id, '--kind', 'one_time', '--price-cents', '1000'],
      creatorHome,
    ),
    'student flow: create active price 1',
  );
  expectOk(
    await acme(
      ['price', 'add', '--product', productTwo.product.id, '--kind', 'one_time', '--price-cents', '1000'],
      creatorHome,
    ),
    'student flow: create active price 2',
  );
  expectOk(await acme(['product', 'publish', productOne.product.id], creatorHome), 'student flow: publish product 1');
  expectOk(await acme(['product', 'publish', productTwo.product.id], creatorHome), 'student flow: publish product 2');

  const studentEmail = 'student+smoke@together.dev';
  expectOk(
    await acme(['simulate-purchase', '--email', studentEmail, '--product', productOne.product.id], studentHome),
    'student flow: purchase product 1',
  );

  const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const expiredGrant = devGrantSchema.parse(
    expectOk(
      await acme(['dev', 'grant', '--email', studentEmail, '--product', productTwo.product.id, '--expires-at', pastIso], creatorHome),
      'student flow: expired grant for product 2',
    ),
  );
  assert(expiredGrant.granted, 'the expired grant should have been created');
  assert(expiredGrant.expiresAt === pastIso, 'the expired grant should carry the past expiry');

  expectOk(await cli(['--json', '--api-url', url, 'login-magic', '--email', studentEmail], studentHome), 'student flow: student login');

  const courses = studentCoursesSchema.parse(
    expectOk(await acme(['student', 'courses'], studentHome), 'student flow: my courses'),
  );
  assert(
    courses.courses.some((item) => item.id === course.course.id),
    'the partially-accessible course should appear in the student course list',
  );

  const structure = structureSchema.parse(
    expectOk(await acme(['student', 'structure', course.course.id], studentHome), 'student flow: course structure'),
  );
  assert(
    structure.structure.accessStatus === 'partially-accessible',
    `expected a partially-accessible course, got ${structure.structure.accessStatus}`,
  );
  const structModuleOne = structure.structure.modules.find((item) => item.id === moduleOne.module.id);
  const structModuleTwo = structure.structure.modules.find((item) => item.id === moduleTwo.module.id);
  assert(
    structModuleOne?.accessStatus === 'fully-accessible',
    'the purchased module should be fully accessible',
  );
  assert(
    structModuleTwo?.accessStatus === 'not-accessible',
    'the module behind an expired grant should be not accessible',
  );

  const openLesson = lessonSchema.parse(
    expectOk(await acme(['student', 'lesson', lessonOne.lesson.id], studentHome), 'student flow: fetch accessible lesson'),
  );
  assert(openLesson.lesson.contents.length === 1, 'the accessible lesson should expose its contents');

  const completed = progressSchema.parse(
    expectOk(await acme(['student', 'complete', lessonOne.lesson.id], studentHome), 'student flow: complete lesson'),
  );
  assert(
    completed.progress.completedLessonIds.includes(lessonOne.lesson.id),
    'completing the lesson should record it in progress',
  );

  const next = nextSchema.parse(
    expectOk(await acme(['student', 'next', lessonOne.lesson.id], studentHome), 'student flow: next lesson'),
  );
  assert(next.next?.id === lessonTwo.lesson.id, 'the next lesson after lesson one should be lesson two');

  expectError(
    await acme(['student', 'lesson', lessonTwo.lesson.id], studentHome),
    'student flow: locked lesson after expired grant',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );

  const progress = progressSchema.parse(
    expectOk(await acme(['student', 'progress', course.course.id], studentHome), 'student flow: read progress'),
  );
  assert(
    progress.progress.completedLessonIds.length === 1,
    'the course progress should report exactly one completed lesson',
  );

  const uncompleted = progressSchema.parse(
    expectOk(
      await acme(['student', 'uncomplete', lessonOne.lesson.id], studentHome),
      'student flow: un-mark completed lesson',
    ),
  );
  assert(
    uncompleted.progress.completedLessonIds.length === 0,
    'un-marking the lesson should remove it from progress',
  );

  const anonHome = mkdtempSync(join(tmpdir(), 'smoke-anon-student-'));
  homes.push(anonHome);
  expectError(
    await acme(['lesson', 'update', '--data', `{"id":"${lessonTwo.lesson.id}","isPreview":true}`], creatorHome),
    'student flow: free preview before the course is publicly visible',
    EXIT_CODE_BY_ERROR_CODE.validation,
    'validation',
  );
  expectOk(
    await acme(['course', 'update', course.course.id, '--publicly-visible', 'true'], creatorHome),
    'student flow: make the course publicly visible',
  );
  expectOk(
    await acme(['lesson', 'update', '--data', `{"id":"${lessonTwo.lesson.id}","isPreview":true}`], creatorHome),
    'student flow: flag lesson two as a free preview',
  );
  const preview = lessonSchema.parse(
    expectOk(await acme(['student', 'lesson', lessonTwo.lesson.id], anonHome), 'student flow: anonymous preview lesson'),
  );
  assert(
    preview.lesson.contents.length === 1,
    'the free preview lesson should serve its contents without a session',
  );
  expectError(
    await acme(['student', 'lesson', lessonOne.lesson.id], anonHome),
    'student flow: anonymous non-preview lesson',
    EXIT_CODE_BY_ERROR_CODE.unauthorized,
    'unauthorized',
  );
  const offerWithPreview = publicOfferSchema.parse(
    expectOk(await acme(['public', 'offer'], anonHome), 'student flow: public offer with preview lessons'),
  );
  assert(
    offerWithPreview.previewLessons.some(
      (item) => item.id === lessonTwo.lesson.id && item.courseId === course.course.id,
    ),
    'the public offer should link the free preview lesson to its course',
  );
};

const driveM2mFlow = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const creatorHome = mkdtempSync(join(tmpdir(), 'smoke-m2m-creator-'));
  const studentHome = mkdtempSync(join(tmpdir(), 'smoke-m2m-student-'));
  homes.push(creatorHome, studentHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });
  const acme = (args: string[], home: string): Promise<Run> =>
    cli(['--json', '--api-url', url, '--tenant', 'acme', ...args], home);

  expectOk(
    await cli(['--json', '--api-url', url, 'login', '--email', 'creator2@together.dev', '--password', 'demo-password-15'], creatorHome),
    'm2m flow: creator login',
  );

  const embed = JSON.stringify({ type: 'embed', embedUrl: 'https://example.com/embed/m2m' });
  const lesson = lessonSchema.parse(
    expectOk(
      await acme(['lesson', 'create', '--data', `{"name":"M2M lesson","contents":[${embed}]}`], creatorHome),
      'm2m flow: create lesson',
    ),
  );
  const course = courseSchema.parse(
    expectOk(await acme(['course', 'create', '--name', `M2M course ${randomUUID()}`], creatorHome), 'm2m flow: create course'),
  );
  const chapter = JSON.stringify({
    id: randomUUID(),
    name: 'M2M chapter',
    contents: [{ id: randomUUID(), name: 'M2M chapter', lessonId: lesson.lesson.id }],
  });
  expectOk(
    await acme(
      ['module', 'create', '--data', `{"courseIds":["${course.course.id}"],"title":"M2M module","chapters":[${chapter}]}`],
      creatorHome,
    ),
    'm2m flow: create module',
  );
  const accessItems = JSON.stringify([{ level: 'course', courseId: course.course.id }]);
  const product = createSchema.parse(
    expectOk(
      await acme(['product', 'create', '--title', `M2M access ${randomUUID()}`, '--price-cents', '1000', '--access-items', accessItems], creatorHome),
      'm2m flow: create product',
    ),
  );
  expectOk(
    await acme(
      ['price', 'add', '--product', product.product.id, '--kind', 'one_time', '--price-cents', '1000'],
      creatorHome,
    ),
    'm2m flow: create active price',
  );
  expectOk(await acme(['product', 'publish', product.product.id], creatorHome), 'm2m flow: publish product');

  const key = apiKeyCreateSchema.parse(
    expectOk(await acme(['api-key', 'create', 'CI enrollment key'], creatorHome), 'm2m flow: create api key'),
  );
  assert(key.secret.length > 0, 'the created API key should expose a one-time secret');

  const m2mEmail = 'm2m-student@together.dev';
  const enrolled = m2mEnrollSchema.parse(
    expectOk(
      await acme(['m2m', 'enroll', '--api-key', key.secret, '--email', m2mEmail, '--product', product.product.id], studentHome),
      'm2m flow: enroll member',
    ),
  );
  assert(enrolled.renewed === false, 'the first enrollment should create a grant, not renew');

  const renewed = m2mEnrollSchema.parse(
    expectOk(
      await acme(['m2m', 'enroll', '--api-key', key.secret, '--email', m2mEmail, '--product', product.product.id], studentHome),
      'm2m flow: renew member',
    ),
  );
  assert(renewed.renewed === true, 'a repeated enrollment of an active grant should renew');
  assert(renewed.grantId === enrolled.grantId, 'the renewal should target the same grant');

  expectError(
    await acme(['m2m', 'enroll', '--api-key', 'wrong-secret', '--email', m2mEmail, '--product', product.product.id], studentHome),
    'm2m flow: wrong api key rejected',
    EXIT_CODE_BY_ERROR_CODE.unauthorized,
    'unauthorized',
  );

  expectOk(await cli(['--json', '--api-url', url, 'login-magic', '--email', m2mEmail], studentHome), 'm2m flow: member login');

  const courses = studentCoursesSchema.parse(
    expectOk(await acme(['student', 'courses'], studentHome), 'm2m flow: student courses'),
  );
  assert(
    courses.courses.some((item) => item.id === course.course.id),
    'the enrolled member should see the granted course in their course list',
  );
};

const driveCommunityFlow = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const authorHome = mkdtempSync(join(tmpdir(), 'smoke-community-author-'));
  const replierHome = mkdtempSync(join(tmpdir(), 'smoke-community-replier-'));
  const expiredHome = mkdtempSync(join(tmpdir(), 'smoke-community-expired-'));
  homes.push(authorHome, replierHome, expiredHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });
  const studio = (args: string[], home: string): Promise<Run> =>
    cli(['--json', '--api-url', url, '--tenant', 'studio', ...args], home);

  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.aktywny@together.dev'], authorHome),
    'community: author login',
  );
  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.modul@together.dev'], replierHome),
    'community: replier login',
  );
  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.wygasly@together.dev'], expiredHome),
    'community: expired member login',
  );

  const marker = `smoke${randomUUID().slice(0, 8)}`;
  const posted = postCreatedSchema.parse(
    expectOk(
      await studio(
        ['discussion', 'post', '--lesson', 'lesson-js-dom-1', '--body', `Pytanie ${marker}: czy querySelectorAll przyjmuje kazdy selektor CSS?`],
        authorHome,
      ),
      'community: member posts a question',
    ),
  );
  assert(posted.post.rootPostId === posted.post.id, 'a top-level post should be its own thread root');

  const reply = postCreatedSchema.parse(
    expectOk(
      await studio(
        ['discussion', 'reply', '--lesson', 'lesson-js-dom-1', '--parent', posted.post.id, '--body', `Tak ${marker}, dziala z kazdym selektorem.`],
        replierHome,
      ),
      'community: second member replies',
    ),
  );
  assert(reply.post.rootPostId === posted.post.id, 'the reply should join the original thread');

  const inbox = notificationsListSchema.parse(
    expectOk(await studio(['notifications', 'list'], authorHome), 'community: author notifications'),
  );
  const notification = inbox.notifications.find((item) => item.payload.postId === reply.post.id);
  assert(notification !== undefined, 'the reply should notify the thread author');
  assert(notification.kind === 'thread-reply', `expected a thread-reply notification, got ${notification.kind}`);
  assert(notification.readAt === null, 'the fresh thread-reply notification should be unread');
  assert(
    notification.payload.rootPostId === posted.post.id,
    'the notification should point at the original thread',
  );

  const read = notificationReadSchema.parse(
    expectOk(await studio(['notifications', 'read', notification.id], authorHome), 'community: mark notification read'),
  );
  assert(read.notification.readAt !== null, 'marking the notification read should set readAt');

  const search = searchHitsSchema.parse(
    expectOk(await studio(['discussion', 'search', '--query', marker], authorHome), 'community: search posts'),
  );
  assert(
    search.hits.some((hit) => hit.post.id === posted.post.id && hit.lessonId === 'lesson-js-dom-1'),
    'search should find the freshly posted question',
  );

  expectError(
    await studio(
      ['discussion', 'post', '--lesson', 'lesson-js-dom-1', '--body', 'Czy moge jeszcze pisac po wygasnieciu dostepu?'],
      expiredHome,
    ),
    'community: expired member cannot post',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );
};

const driveDirectMessagesFlow = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const authorHome = mkdtempSync(join(tmpdir(), 'smoke-dm-author-'));
  const senderHome = mkdtempSync(join(tmpdir(), 'smoke-dm-sender-'));
  const strangerHome = mkdtempSync(join(tmpdir(), 'smoke-dm-stranger-'));
  homes.push(authorHome, senderHome, strangerHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });
  const studio = (args: string[], home: string): Promise<Run> =>
    cli(['--json', '--api-url', url, '--tenant', 'studio', ...args], home);

  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.aktywny@together.dev'], authorHome),
    'dm: author login',
  );
  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.modul@together.dev'], senderHome),
    'dm: sender login',
  );
  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.wygasly@together.dev'], strangerHome),
    'dm: stranger login',
  );

  const marker = `dm${randomUUID().slice(0, 8)}`;
  const posted = postCreatedSchema.parse(
    expectOk(
      await studio(
        ['discussion', 'post', '--lesson', 'lesson-js-dom-1', '--body', `Pytanie ${marker}: jak debugowac selektory?`],
        authorHome,
      ),
      'dm: author posts a question',
    ),
  );

  const started = conversationSchema.parse(
    expectOk(await studio(['dm', 'start', '--to-post', posted.post.id], senderHome), 'dm: start from the post author'),
  );
  const reopened = conversationSchema.parse(
    expectOk(await studio(['dm', 'start', '--to-post', posted.post.id], senderHome), 'dm: start is idempotent'),
  );
  assert(
    reopened.conversation.id === started.conversation.id,
    'starting the same conversation twice should return the same row',
  );

  const sent = messageSentSchema.parse(
    expectOk(
      await studio(['dm', 'send', '--conversation', started.conversation.id, '--body', `Czesc ${marker}`], senderHome),
      'dm: send a message',
    ),
  );
  assert(sent.message.isOwn, 'the sender should own the message they just sent');

  const inbox = conversationsListSchema.parse(
    expectOk(await studio(['dm', 'list'], authorHome), 'dm: recipient lists conversations'),
  );
  const conversation = inbox.conversations.find((item) => item.id === started.conversation.id);
  assert(conversation !== undefined, 'the recipient should see the conversation');
  assert(conversation.unread, 'the recipient should see the conversation as unread');
  assert(
    conversation.lastMessageSnippet.includes(marker),
    'the conversation projection should carry the last message snippet',
  );

  const unread = unreadMessagesSchema.parse(
    expectOk(await studio(['dm', 'unread'], authorHome), 'dm: recipient unread badge'),
  );
  assert(unread.unread >= 1, 'the recipient badge should count the unread conversation');

  const thread = conversationThreadSchema.parse(
    expectOk(await studio(['dm', 'thread', started.conversation.id], authorHome), 'dm: recipient reads the thread'),
  );
  assert(
    thread.messages.some((item) => item.id === sent.message.id && !item.isOwn),
    'the recipient should read the message as not their own',
  );

  expectOk(await studio(['dm', 'read', started.conversation.id], authorHome), 'dm: recipient marks the thread read');
  const afterRead = unreadMessagesSchema.parse(
    expectOk(await studio(['dm', 'unread'], authorHome), 'dm: badge after reading'),
  );
  assert(afterRead.unread === 0, 'reading the conversation should clear the recipient badge');

  expectError(
    await studio(['dm', 'thread', started.conversation.id], strangerHome),
    'dm: a non-participant cannot read the conversation',
    EXIT_CODE_BY_ERROR_CODE.not_found,
    'not_found',
  );
};

const driveEventsFlow = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const staffHome = mkdtempSync(join(tmpdir(), 'smoke-events-staff-'));
  const followerHome = mkdtempSync(join(tmpdir(), 'smoke-events-follower-'));
  homes.push(staffHome, followerHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });
  const studio = (args: string[], home: string): Promise<Run> =>
    cli(['--json', '--api-url', url, '--tenant', 'studio', ...args], home);

  expectOk(
    await cli(['--json', '--api-url', url, 'login', '--email', 'creator@together.dev', '--password', 'demo-password-15'], staffHome),
    'events: staff login',
  );
  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.aktywny@together.dev'], followerHome),
    'events: member login',
  );

  const marker = `wyd${randomUUID().slice(0, 8)}`;
  const space = spaceSchema.parse(
    expectOk(
      await studio(['space', 'create', '--slug', `${marker}-events`, '--name', `Wydarzenia ${marker}`, '--visibility', 'members'], staffHome),
      'events: staff creates the host space',
    ),
  ).space;
  expectOk(await studio(['space', 'follow', '--space', space.id], followerHome), 'events: member follows the space');

  const created = eventSchema.parse(
    expectOk(
      await studio(
        [
          'event', 'create',
          '--space', space.id,
          '--title', `Warsztat ${marker}`,
          '--starts-at', '2099-07-12T18:00:00.000Z',
          '--ends-at', '2099-07-12T20:00:00.000Z',
          '--location', 'Online',
        ],
        staffHome,
      ),
      'events: staff schedules an event',
    ),
  ).event;
  assert(created.discussionRootPostId !== null, 'creating an event should open its discussion thread');
  expectError(
    await studio(
      ['event', 'create', '--space', space.id, '--title', 'Odwrotnie', '--starts-at', '2099-07-12T20:00:00.000Z', '--ends-at', '2099-07-12T18:00:00.000Z'],
      staffHome,
    ),
    'events: an event cannot end before it starts',
    EXIT_CODE_BY_ERROR_CODE.validation,
    'validation',
  );
  expectError(
    await studio(
      ['event', 'create', '--space', space.id, '--title', 'Nie wolno', '--starts-at', '2099-07-12T18:00:00.000Z', '--ends-at', '2099-07-12T20:00:00.000Z'],
      followerHome,
    ),
    'events: a member cannot schedule events',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );

  const followerInbox = notificationsListSchema.parse(
    expectOk(await studio(['notifications', 'list'], followerHome), 'events: follower notifications'),
  );
  const eventNotifications = followerInbox.notifications.filter(
    (item) => item.payload.rootPostId === created.discussionRootPostId,
  );
  assert(eventNotifications.length === 1, `a new event should notify followers exactly once, got ${String(eventNotifications.length)}`);
  assert(
    eventNotifications[0]?.kind === 'space-event',
    `expected a space-event notification, got ${String(eventNotifications[0]?.kind)}`,
  );

  const listed = eventsListSchema.parse(
    expectOk(await studio(['event', 'list', '--space', space.id], followerHome), 'events: member lists space events'),
  );
  assert(listed.events.some((item) => item.id === created.id), 'the member should see the scheduled event');
  const upcoming = eventsListSchema.parse(
    expectOk(await studio(['event', 'upcoming'], followerHome), 'events: member lists upcoming events'),
  );
  assert(upcoming.events.some((item) => item.id === created.id), 'the upcoming strip should carry the event');

  const answered = eventSchema.parse(
    expectOk(await studio(['event', 'rsvp', created.id, '--status', 'going'], followerHome), 'events: member answers going'),
  ).event;
  assert(answered.viewerRsvp === 'going', 'the rsvp should be echoed back to its author');
  assert(answered.goingCount === 1, `the going count should be one, got ${String(answered.goingCount)}`);
  const changed = eventSchema.parse(
    expectOk(await studio(['event', 'rsvp', created.id, '--status', 'not-going'], followerHome), 'events: member changes the answer'),
  ).event;
  assert(changed.goingCount === 0 && changed.notGoingCount === 1, 'changing the answer should move the counts');

  const ics = eventIcsSchema.parse(
    expectOk(await studio(['event', 'ics', created.id], followerHome), 'events: member downloads the calendar entry'),
  );
  assert(ics.fileName.endsWith('.ics'), 'the calendar file should carry an .ics name');
  assert(
    ics.icsContent.includes(`SUMMARY:Warsztat ${marker}`) && ics.icsContent.startsWith('BEGIN:VCALENDAR'),
    'the calendar entry should be a VCALENDAR carrying the event title',
  );
};

const driveSpacesFlow = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const staffHome = mkdtempSync(join(tmpdir(), 'smoke-spaces-staff-'));
  const entitledHome = mkdtempSync(join(tmpdir(), 'smoke-spaces-entitled-'));
  const moduleOnlyHome = mkdtempSync(join(tmpdir(), 'smoke-spaces-module-'));
  homes.push(staffHome, entitledHome, moduleOnlyHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });
  const studio = (args: string[], home: string): Promise<Run> =>
    cli(['--json', '--api-url', url, '--tenant', 'studio', ...args], home);

  expectOk(
    await cli(['--json', '--api-url', url, 'login', '--email', 'creator@together.dev', '--password', 'demo-password-15'], staffHome),
    'spaces: staff login',
  );
  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.aktywny@together.dev'], entitledHome),
    'spaces: entitled member login',
  );
  expectOk(
    await cli(['--json', '--api-url', url, 'login-magic', '--email', 'kursant.modul@together.dev'], moduleOnlyHome),
    'spaces: module-only member login',
  );

  const marker = `strefa${randomUUID().slice(0, 8)}`;
  const open = spaceSchema.parse(
    expectOk(
      await studio(['space', 'create', '--slug', `${marker}-open`, '--name', `Strefa ${marker}`, '--visibility', 'members'], staffHome),
      'spaces: staff creates a members space',
    ),
  ).space;
  const gated = spaceSchema.parse(
    expectOk(
      await studio(
        ['space', 'create', '--slug', `${marker}-vip`, '--name', `VIP ${marker}`, '--visibility', 'product', '--products', 'product-js-full'],
        staffHome,
      ),
      'spaces: staff creates a product-gated space',
    ),
  ).space;
  expectError(
    await studio(['space', 'create', '--slug', `${marker}-open`, '--name', 'Duplikat', '--visibility', 'members'], staffHome),
    'spaces: duplicate slug rejected',
    EXIT_CODE_BY_ERROR_CODE.conflict,
    'conflict',
  );
  expectError(
    await studio(['space', 'create', '--slug', `${marker}-x`, '--name', 'X', '--visibility', 'members'], entitledHome),
    'spaces: member cannot create spaces',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );

  const entitledSpaces = spacesListSchema.parse(
    expectOk(await studio(['space', 'list'], entitledHome), 'spaces: entitled member lists spaces'),
  );
  assert(
    entitledSpaces.spaces.some((item) => item.id === open.id),
    'entitled member should see the members space',
  );
  assert(
    entitledSpaces.spaces.some((item) => item.id === gated.id),
    'entitled member should see the product-gated space',
  );
  const moduleOnlySpaces = spacesListSchema.parse(
    expectOk(await studio(['space', 'list'], moduleOnlyHome), 'spaces: module-only member lists spaces'),
  );
  assert(
    moduleOnlySpaces.spaces.some((item) => item.id === open.id),
    'module-only member should see the members space',
  );
  assert(
    !moduleOnlySpaces.spaces.some((item) => item.id === gated.id),
    'module-only member must NOT see the product-gated space',
  );
  expectError(
    await studio(['space', 'feed', '--space', gated.id], moduleOnlyHome),
    'spaces: module-only member cannot read the gated feed',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );

  expectOk(await studio(['space', 'follow', '--space', open.id], moduleOnlyHome), 'spaces: follower follows');

  const rooted = postCreatedSchema.parse(
    expectOk(
      await studio(['space', 'post', '--space', open.id, '--body', `Ogloszenie ${marker} dla wszystkich`], entitledHome),
      'spaces: entitled member posts to the feed',
    ),
  );
  assert(rooted.post.rootPostId === rooted.post.id, 'a space feed post should be its own thread root');

  const followerInbox = notificationsListSchema.parse(
    expectOk(await studio(['notifications', 'list'], moduleOnlyHome), 'spaces: follower notifications'),
  );
  const spacePostNotification = followerInbox.notifications.find(
    (item) => item.payload.postId === rooted.post.id,
  );
  assert(spacePostNotification !== undefined, 'a new space post should notify followers');
  assert(
    spacePostNotification.kind === 'space-post',
    `expected a space-post notification, got ${spacePostNotification.kind}`,
  );
  assert(spacePostNotification.readAt === null, 'the fresh space-post notification should be unread');

  const reply = postCreatedSchema.parse(
    expectOk(
      await studio(
        ['space', 'reply', '--space', open.id, '--parent', rooted.post.id, '--body', `Odpowiedz ${marker}`],
        moduleOnlyHome,
      ),
      'spaces: follower replies in the thread',
    ),
  );
  assert(reply.post.rootPostId === rooted.post.id, 'the space reply should join the original thread');
  const authorInbox = notificationsListSchema.parse(
    expectOk(await studio(['notifications', 'list'], entitledHome), 'spaces: author notifications'),
  );
  const replyNotification = authorInbox.notifications.find((item) => item.payload.postId === reply.post.id);
  assert(replyNotification !== undefined, 'the space reply should notify the thread author');
  assert(
    replyNotification.kind === 'thread-reply',
    `expected a thread-reply notification, got ${replyNotification.kind}`,
  );

  const reacted = reactedSchema.parse(
    expectOk(
      await studio(['discussion', 'react', '--post', rooted.post.id, '--emoji', '👍'], moduleOnlyHome),
      'spaces: follower reacts',
    ),
  );
  assert(
    reacted.reactions.some((item) => item.emoji === '👍' && item.count === 1 && item.viewerReacted),
    'the reaction should register with viewerReacted=true',
  );
  const feed = spaceFeedSchema.parse(
    expectOk(await studio(['space', 'feed', '--space', open.id], entitledHome), 'spaces: author reads the feed'),
  );
  const feedItem = feed.feed.items.find((item) => item.id === rooted.post.id);
  assert(feedItem !== undefined, 'the feed should contain the fresh post');
  assert(feedItem.replyCount === 1, `the post should show one reply, got ${feedItem.replyCount}`);
  assert(
    feedItem.reactions.some((item) => item.emoji === '👍' && item.count === 1 && !item.viewerReacted),
    'the feed should show the follower reaction without viewerReacted for the author',
  );
  const unreacted = reactedSchema.parse(
    expectOk(
      await studio(['discussion', 'unreact', '--post', rooted.post.id, '--emoji', '👍'], moduleOnlyHome),
      'spaces: follower removes the reaction',
    ),
  );
  assert(
    !unreacted.reactions.some((item) => item.emoji === '👍'),
    'removing the reaction should clear it from the summary',
  );

  const archived = spaceSchema.parse(
    expectOk(await studio(['space', 'archive', '--space', open.id], staffHome), 'spaces: staff archives'),
  ).space;
  assert(archived.archivedAt !== null, 'archiving should set archivedAt');
  const afterArchive = spacesListSchema.parse(
    expectOk(await studio(['space', 'list'], moduleOnlyHome), 'spaces: member lists after archive'),
  );
  assert(
    !afterArchive.spaces.some((item) => item.id === open.id),
    'an archived space must disappear from member listings',
  );
  expectError(
    await studio(['space', 'feed', '--space', open.id], entitledHome),
    'spaces: archived feed hidden from members',
    EXIT_CODE_BY_ERROR_CODE.not_found,
    'not_found',
  );
  const staffView = staffSpacesSchema.parse(
    expectOk(await studio(['space', 'stats'], staffHome), 'spaces: staff stats include archived'),
  );
  const archivedRow = staffView.spaces.find((item) => item.id === open.id);
  assert(archivedRow !== undefined, 'staff stats should still list the archived space');
  assert(archivedRow.archivedAt !== null, 'staff stats should mark the space archived');
  assert(archivedRow.stats.posts === 2, `the archived space should keep its posts, got ${archivedRow.stats.posts}`);
  assert(archivedRow.stats.followers === 1, `exactly one follower should be counted, got ${archivedRow.stats.followers}`);
};

const driveAnonymousPublicFlow = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const creatorHome = mkdtempSync(join(tmpdir(), 'smoke-public-creator-'));
  const anonHome = mkdtempSync(join(tmpdir(), 'smoke-public-anon-'));
  homes.push(creatorHome, anonHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });
  const studio = (args: string[], home: string): Promise<Run> =>
    cli(['--json', '--api-url', url, '--tenant', 'studio', ...args], home);
  const publicGet = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${url}${path}`, { headers: { [TENANT_HEADER]: 'studio', ...headers } });
  const publicData = async (response: Response, label: string): Promise<unknown> => {
    assert(response.status === 200, `${label}: expected 200, got ${response.status}`);
    assert(
      response.headers.get('vary') === `Host, ${TENANT_HEADER}`,
      `${label}: the anonymous response must vary on the tenant`,
    );
    const parsed = envelope.parse(await response.json());
    assert(parsed.ok, `${label}: expected an ok envelope, got an error.`);
    return parsed.data;
  };
  const expectPublicNotFound = async (path: string, label: string): Promise<void> => {
    const response = await publicGet(path);
    assert(response.status === 404, `${label}: expected 404, got ${response.status}`);
    const parsed = envelope.parse(await response.json());
    assert(!parsed.ok && parsed.error.code === 'not_found', `${label}: expected a not_found envelope.`);
  };

  expectOk(
    await cli(['--json', '--api-url', url, 'login', '--email', 'creator@together.dev', '--password', 'demo-password-15'], creatorHome),
    'public: staff login',
  );
  expectOk(
    await studio(['lesson', 'update', '--data', `{"id":"${PUBLIC_PREVIEW_LESSON_ID}","isPreview":true}`], creatorHome),
    'public: flag a seeded lesson as a free preview',
  );

  const navigationResponse = await publicGet(API_PATHS.publicNavigation);
  const navigation = publicNavigationSchema.parse(
    await publicData(navigationResponse, 'public: anonymous navigation'),
  ).navigation;
  assert(
    navigation.defaultHomeSpaceId === PUBLIC_HOME_SPACE_ID,
    `public: expected the seeded home space, got ${String(navigation.defaultHomeSpaceId)}`,
  );
  assert(
    navigation.spaces.some((space) => space.id === PUBLIC_HOME_SPACE_ID),
    'public: the publicly readable space should be listed anonymously',
  );
  assert(
    navigation.courses.some((course) => course.id === PUBLIC_COURSE_ID),
    'public: the publicly visible course should be listed anonymously',
  );
  assert(
    !navigation.courses.some((course) => course.id === PRIVATE_COURSE_ID),
    'public: a course that is not publicly visible must stay out of the anonymous navigation',
  );
  const lockedSpace = navigation.lockedSpaces.find((space) => space.id === LOCKED_SPACE_ID);
  assert(lockedSpace !== undefined, 'public: the product-gated space should surface as a locked entry');
  assert(
    lockedSpace.productIds.includes('product-js-full'),
    'public: the locked entry should carry its checkout product',
  );

  const navigationEtag = navigationResponse.headers.get('etag');
  assert(navigationEtag !== null, 'public: the navigation response should carry a content-version ETag');
  const revalidated = await publicGet(API_PATHS.publicNavigation, { 'if-none-match': navigationEtag });
  assert(revalidated.status === 304, `public: expected a 304 revalidation, got ${revalidated.status}`);

  const structure = structureSchema.parse(
    await publicData(
      await publicGet(API_PATHS.publicCourseStructure.replace(':courseId', PUBLIC_COURSE_ID)),
      'public: anonymous course structure',
    ),
  ).structure;
  const structureLessons = structure.modules.flatMap((item) => item.chapters.flatMap((chapter) => chapter.lessons));
  const previewRow = structureLessons.find((lesson) => lesson.lessonId === PUBLIC_PREVIEW_LESSON_ID);
  assert(previewRow !== undefined, 'public: the preview lesson should appear in the anonymous program');
  assert(
    previewRow.accessStatus === 'fully-accessible',
    `public: the preview lesson should read as accessible, got ${previewRow.accessStatus}`,
  );
  assert(
    structureLessons.some((lesson) => lesson.accessStatus === 'not-accessible'),
    'public: paid lessons must stay locked in the anonymous program',
  );
  await expectPublicNotFound(
    API_PATHS.publicCourseStructure.replace(':courseId', PRIVATE_COURSE_ID),
    'public: structure of a course that is not publicly visible',
  );

  const feed = spaceFeedSchema.parse(
    await publicData(
      await publicGet(API_PATHS.publicSpaceFeed.replace(':spaceId', PUBLIC_HOME_SPACE_ID)),
      'public: anonymous space feed',
    ),
  ).feed;
  assert(feed.items.length > 0, 'public: the seeded publicly readable space should expose its posts');
  assert(!feed.isFollowing, 'public: an anonymous reader can never follow a space');
  assert(
    feed.items.every((item) => item.reactions.every((reaction) => !reaction.viewerReacted)),
    'public: an anonymous reader must never own a reaction',
  );
  const thread = publicThreadSchema.parse(
    await publicData(
      await publicGet(
        API_PATHS.publicSpaceThread
          .replace(':spaceId', PUBLIC_HOME_SPACE_ID)
          .replace(':postId', PUBLIC_THREAD_POST_ID),
      ),
      'public: anonymous space thread',
    ),
  ).discussion;
  assert(
    thread.threads.some((item) => item.id === PUBLIC_THREAD_POST_ID && item.replyCount > 0),
    'public: the anonymous thread should carry the seeded replies',
  );
  await expectPublicNotFound(
    API_PATHS.publicSpaceFeed.replace(':spaceId', LOCKED_SPACE_ID),
    'public: feed of a product-gated space',
  );

  const preview = lessonSchema.parse(
    expectOk(await studio(['student', 'lesson', PUBLIC_PREVIEW_LESSON_ID], anonHome), 'public: anonymous preview lesson'),
  );
  assert(preview.lesson.contents.length > 0, 'public: the preview lesson should serve its contents without a session');
  expectError(
    await studio(['student', 'courses'], anonHome),
    'public: member course list without a session',
    EXIT_CODE_BY_ERROR_CODE.unauthorized,
    'unauthorized',
  );

  expectOk(
    await studio(['tenant-secret', 'set', 'stripe.restrictedKey', 'rk_test_smoke_public'], creatorHome),
    'public: configure the studio restricted key',
  );
  expectOk(
    await studio(['tenant-secret', 'set', 'stripe.webhookSecret', 'whsec_smoke_public'], creatorHome),
    'public: configure the studio webhook secret',
  );
  const checkoutSession = checkoutSessionSchema.parse(
    expectOk(
      await studio(
        ['checkout', 'session', '--product', 'product-js-full', '--email', 'anon-public@together.dev', '--language', 'pl'],
        anonHome,
      ),
      'public: anonymous checkout session from the public surface',
    ),
  );
  assert(
    checkoutSession.url.startsWith('https://fake.checkout.local/'),
    `public: the anonymous checkout should hand back a provider session, got ${checkoutSession.url}`,
  );
};

const driveLegacyUrlRedirects = async (port: number, homes: string[]): Promise<void> => {
  const url = `http://localhost:${port}`;
  const creatorHome = mkdtempSync(join(tmpdir(), 'smoke-legacy-creator-'));
  homes.push(creatorHome);
  const cli = (args: string[]): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: creatorHome });
  const acme = (args: string[]): Promise<Run> =>
    cli(['--json', '--api-url', url, '--tenant', 'acme', ...args]);
  const sourceId = (suffix: string): string => randomUUID().replaceAll('-', '').slice(0, 20) + suffix;
  const legacyCourseId = sourceId('c');
  const legacyModuleId = sourceId('m');
  const legacyLessonId = sourceId('l');

  expectOk(
    await cli(['--json', '--api-url', url, 'login', '--email', 'creator2@together.dev', '--password', 'demo-password-15']),
    'legacy links: creator login',
  );
  const lesson = lessonSchema.parse(
    expectOk(
      await acme(['lesson', 'create', '--data', `{"name":"Legacy lesson","legacyId":"${legacyLessonId}"}`]),
      'legacy links: create the imported lesson',
    ),
  );
  const course = courseSchema.parse(
    expectOk(
      await acme(['course', 'create', '--name', `Legacy course ${randomUUID()}`, '--legacy-id', legacyCourseId]),
      'legacy links: create the imported course',
    ),
  );
  const chapterId = randomUUID();
  const modulePayload = JSON.stringify({
    courseIds: [course.course.id],
    title: 'Legacy module',
    legacyId: legacyModuleId,
    chapters: [{ id: chapterId, name: 'Legacy chapter', contents: [{ id: randomUUID(), name: 'Legacy lesson', lessonId: lesson.lesson.id }] }],
  });
  expectOk(
    await acme(['module', 'create', '--data', modulePayload]),
    'legacy links: create the imported module',
  );

  const coursePage = `/my/courses/${course.course.id}`;
  const lessonPage = `${coursePage}/lessons/${lesson.lesson.id}`;
  const legacyPath = `/courses/${legacyCourseId}`;
  const hop = async (path: string, tenant: string): Promise<Response> =>
    fetch(`${url}${path}`, { headers: { [TENANT_HEADER]: tenant }, redirect: 'manual' });
  const expectHop = async (
    path: string,
    expected: { status: number; location: string },
    label: string,
    tenant = 'acme',
  ): Promise<void> => {
    const response = await hop(path, tenant);
    assert(
      response.status === expected.status,
      `${label}: expected ${expected.status}, got ${response.status}`,
    );
    const location = response.headers.get('location');
    assert(
      location === expected.location,
      `${label}: expected a hop to ${expected.location}, got ${String(location)}`,
    );
  };

  await expectHop(legacyPath, { status: 301, location: coursePage }, 'legacy links: course link');
  await expectHop(
    `${legacyPath}/modules/${legacyModuleId}`,
    { status: 302, location: lessonPage },
    'legacy links: module link',
  );
  await expectHop(
    `${legacyPath}/modules/${legacyModuleId}/chapters/${chapterId}`,
    { status: 302, location: lessonPage },
    'legacy links: chapter link',
  );
  await expectHop(
    `${legacyPath}/modules/${legacyModuleId}/chapters/${chapterId}/lessons/${legacyLessonId}?utm_source=newsletter`,
    { status: 301, location: `${lessonPage}?utm_source=newsletter` },
    'legacy links: lesson link',
  );
  await expectHop(legacyPath, { status: 302, location: '/my' }, 'legacy links: another workspace', 'studio');
  await expectHop(
    `/courses/${sourceId('x')}`,
    { status: 302, location: '/my' },
    'legacy links: unknown course',
  );
};

const startedAt = Date.now();
const homes: string[] = [];
let server: ChildProcess | null = null;
try {
  console.log('smoke: checking lockfile drift...');
  checkLockfileDrift();
  console.log('smoke: assuring the server-served web bundle is fresh...');
  await ensureWebBundleFresh(rootDir);
  console.log('smoke: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(smokeDatabaseUrl);
  console.log('smoke: verifying db:reseed restores the canonical demo state...');
  await verifyReseedRestoresCanonicalState(smokeDatabaseUrl);
  const port = await ephemeralPort();
  console.log(`smoke: booting server on port ${port}...`);
  const webDistDir = mkdtempSync(join(tmpdir(), 'smoke-web-'));
  homes.push(webDistDir);
  server = await bootServer({
    port,
    healthUrl: `http://localhost:${String(port)}/api/health`,
    env: {
      DATABASE_URL: smokeDatabaseUrl,
      APP_BASE_URL: `http://localhost:${String(port)}`,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      SIMULATED_PAYMENTS: 'true',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      PAYMENT_PROVIDER: 'fake',
      EMAIL_PROVIDER: 'dev',
    },
  });
  console.log('smoke: driving the CLI...');
  await driveCli(port, homes);
  console.log('smoke: driving the student surface...');
  await driveStudentFlow(port, homes);
  console.log('smoke: driving the M2M enrollment surface...');
  await driveM2mFlow(port, homes);
  console.log('smoke: driving the community surface...');
  await driveCommunityFlow(port, homes);
  console.log('smoke: driving the direct-message surface...');
  await driveDirectMessagesFlow(port, homes);
  console.log('smoke: driving the spaces surface...');
  await driveSpacesFlow(port, homes);
  console.log('smoke: driving the events surface...');
  await driveEventsFlow(port, homes);
  console.log('smoke: driving the anonymous public surface...');
  await driveAnonymousPublicFlow(port, homes);
  console.log('smoke: following legacy course links...');
  await driveLegacyUrlRedirects(port, homes);
  console.log('smoke: proving password rotation with two isolated CLI homes...');
  await proveCliPasswordRotation(port, homes);
  console.log('smoke: proving provider-validated email verification resend...');
  await proveEmailVerificationResend(port, homes);
  console.log('smoke: proving provider-validated password reset...');
  await provePasswordReset(port, homes);
  console.log(`\nsmoke: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\nsmoke: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
