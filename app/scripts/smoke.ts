import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { z } from 'zod';

import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');

const SMOKE_DB = 'together_smoke';
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
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: rootDir, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) => resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

interface LockPackage {
  version?: string;
  optional?: boolean;
  os?: unknown;
  cpu?: unknown;
}
interface LockFile {
  packages: Record<string, LockPackage>;
}
const readLock = (raw: string): LockFile => JSON.parse(raw);

const checkLockfileDrift = (): void => {
  const src = readLock(readFileSync(join(rootDir, 'package-lock.json'), 'utf8'));
  let installedRaw: string;
  try {
    installedRaw = readFileSync(join(rootDir, 'node_modules/.package-lock.json'), 'utf8');
  } catch {
    throw new SmokeFailure(
      'Dependencies are not installed (node_modules/.package-lock.json missing). Run: npm install',
    );
  }
  const installed = readLock(installedRaw);
  const problems: string[] = [];
  for (const [name, entry] of Object.entries(src.packages)) {
    if (name === '') continue;
    const present = installed.packages[name];
    // Platform-conditional packages are legitimately absent on this host.
    const platformConditional =
      entry.optional === true || entry.os !== undefined || entry.cpu !== undefined;
    if (!present) {
      if (!platformConditional) problems.push(`missing: ${name}`);
      continue;
    }
    if (entry.version !== undefined && present.version !== undefined && entry.version !== present.version) {
      problems.push(`version: ${name} lock=${entry.version} installed=${present.version}`);
    }
  }
  for (const name of Object.keys(installed.packages)) {
    if (name === '') continue;
    if (!(name in src.packages)) problems.push(`extraneous: ${name}`);
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 10).join('\n  ');
    const rest = problems.length > 10 ? `\n  ...and ${problems.length - 10} more` : '';
    fail(`Installed dependency tree does not match package-lock.json. Run: npm install\n  ${shown}${rest}`);
  }
};

const ephemeralPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate an ephemeral port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });

const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    // Fresh, isolated database each run so smoke never touches the dev-seeded data.
    await client.query(`DROP DATABASE IF EXISTS ${SMOKE_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${SMOKE_DB}`);
  } catch (cause) {
    fail(
      `Could not prepare the smoke database "${SMOKE_DB}". Is the dev Postgres up (npm run db:up)?\n${String(cause)}`,
    );
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

const bootServer = async (
  port: number,
  databaseUrl: string,
  webDistDir: string,
): Promise<ChildProcess> => {
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      APP_BASE_URL: `http://localhost:${port}`,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      SIMULATED_PAYMENTS: 'true',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      PAYMENT_PROVIDER: 'fake',
      EMAIL_PROVIDER: 'dev',
    },
  });
  let logs = '';
  child.stdout?.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });
  let exitInfo: string | null = null;
  child.on('exit', (code, signal) => {
    exitInfo = `code=${String(code)} signal=${String(signal)}`;
  });

  const healthUrl = `http://localhost:${port}/api/health`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (exitInfo !== null) {
      fail(`Server exited before becoming ready (${exitInfo}).\n--- server output ---\n${logs}`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return child;
    } catch {
      // not accepting connections yet
    }
    await delay(300);
  }
  throw new SmokeFailure(
    `Server did not become ready within 20s on port ${port}.\n--- server output ---\n${logs}`,
  );
};

const killServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const { pid } = child;
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (pid !== undefined) process.kill(-pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  signalGroup('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL');
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

  const health = healthSchema.parse(expectOk(await cli(['--json', '--api-url', url, 'health'], authedHome), 'health'));
  assert(
    health.status === 'ok' && health.database === 'up',
    `health degraded: status=${health.status} database=${health.database}`,
  );

  expectOk(
    await cli(
      ['--json', '--api-url', url, 'login', '--email', 'creator2@together.dev', '--password', 'demo1234'],
      authedHome,
    ),
    'login',
  );

  const before = productsSchema.parse(
    expectOk(await cli(['--json', '--api-url', url, '--tenant', 'acme', 'product', 'list'], authedHome), 'product list (before)'),
  );

  const title = `smoke product ${randomUUID()}`;
  const created = createSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', url, '--tenant', 'acme', 'product', 'create', '--title', title, '--price-cents', '1234'],
        authedHome,
      ),
      'product create',
    ),
  );
  assert(created.product.title === title, `product create echoed the wrong title: ${created.product.title}`);
  assert(created.product.published === false, 'a newly created product should start as a draft');

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
  const stripeEmail = devEmailResultSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', url, '--tenant', 'acme', 'dev', 'email', '--to', 'stripe-smoke@together.dev'],
        anonHome,
      ),
      'stripe: welcome email in dev sink',
    ),
  );
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
    await cli(['--json', '--api-url', url, 'login', '--email', 'creator2@together.dev', '--password', 'demo1234'], creatorHome),
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
    await cli(['--json', '--api-url', url, 'login', '--email', 'creator2@together.dev', '--password', 'demo1234'], creatorHome),
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

const startedAt = Date.now();
const homes: string[] = [];
let server: ChildProcess | null = null;
try {
  console.log('smoke: checking lockfile drift...');
  checkLockfileDrift();
  console.log('smoke: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(smokeDatabaseUrl);
  const port = await ephemeralPort();
  console.log(`smoke: booting server on port ${port}...`);
  const webDistDir = mkdtempSync(join(tmpdir(), 'smoke-web-'));
  homes.push(webDistDir);
  server = await bootServer(port, smokeDatabaseUrl, webDistDir);
  console.log('smoke: driving the CLI...');
  await driveCli(port, homes);
  console.log('smoke: driving the student surface...');
  await driveStudentFlow(port, homes);
  console.log('smoke: driving the M2M enrollment surface...');
  await driveM2mFlow(port, homes);
  console.log(`\nsmoke: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\nsmoke: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
}
