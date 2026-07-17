import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { z } from 'zod';

import { API_PATHS, looseEnvelopeSchema } from '@core/contract/index.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const outputDir = join(rootDir, 'tasks/poc-screenshots');

const devDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

class ShotsFailure extends Error {}

const fail = (message: string): never => {
  throw new ShotsFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ShotsFailure(message);
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> =>
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

const prepareDatabase = async (): Promise<void> => {
  const up = await run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d']);
  assert(up.code === 0, `docker compose up failed:\n${up.stdout}${up.stderr}`);
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: devDatabaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: devDatabaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts']);
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const bootServer = async (port: number, appBaseUrl: string, connectUrl: string): Promise<ChildProcess> => {
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: devDatabaseUrl,
      APP_BASE_URL: appBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      SIMULATED_PAYMENTS: 'true',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
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

  const healthUrl = `${connectUrl}${API_PATHS.health}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (exitInfo !== null) {
      fail(`Server exited before becoming ready (${exitInfo}).\n--- server output ---\n${logs}`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return child;
    } catch {
      await delay(0);
    }
    await delay(250);
  }
  throw new ShotsFailure(`Server did not become ready within 20s on port ${port}.\n--- server output ---\n${logs}`);
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

const shoot = async (page: Page, name: string): Promise<void> => {
  await delay(500);
  await page.screenshot({ path: join(outputDir, name), animations: 'disabled' });
};

const courseCreatedSchema = z.object({ course: z.object({ id: z.string() }) });
const lessonCreatedSchema = z.object({ lesson: z.object({ id: z.string() }) });
const moduleCreatedSchema = z.object({ module: z.object({ id: z.string() }) });
const productCreatedSchema = z.object({ product: z.object({ id: z.string() }) });

interface StudentFixture {
  studentEmail: string;
  courseId: string;
  welcomeLessonId: string;
  lockedLessonId: string;
  courseName: string;
  mediaLessonName: string;
  mixedProductTitle: string;
  grantsMemberEmail: string;
}

const youtube = (id: string): string => JSON.stringify({ type: 'embed', embedUrl: `https://www.youtube.com/embed/${id}` });

const html = (body: string): string => JSON.stringify({ type: 'html', html: body });

const link = (url: string, description: string): string => JSON.stringify({ type: 'link', url, description });

const video = (storageKey: string, streamVideoId: string, streamLibraryId: string): string =>
  JSON.stringify({ type: 'video', storageKey, streamVideoId, streamLibraryId });

const pdf = (pdfUrl: string, name: string): string => JSON.stringify({ type: 'pdf', pdfUrl, name });

const chapterContent = (name: string, lessonId: string): string =>
  JSON.stringify({ id: randomUUID(), name, lessonId });

const buildStudentFixture = async (studioBaseUrl: string, homes: string[]): Promise<StudentFixture> => {
  const url = studioBaseUrl;
  const creatorHome = mkdtempSync(join(tmpdir(), 'parity-creator-'));
  const studentHome = mkdtempSync(join(tmpdir(), 'parity-student-'));
  homes.push(creatorHome, studentHome);

  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', url, ...args], { HOME: home });
  const studio = (args: string[], home: string): Promise<Run> =>
    cli(['--tenant', 'studio', ...args], home);

  const cliData = async (result: Run, label: string): Promise<unknown> => {
    assert(result.code === 0, `${label}: exit ${result.code}\n${result.stdout}${result.stderr}`);
    const parsed = looseEnvelopeSchema.parse(JSON.parse(result.stdout.trim()));
    assert(parsed.ok, `${label}: error envelope ${JSON.stringify(parsed)}`);
    return parsed.data;
  };

  await cliData(
    await cli(['login', '--email', 'creator@together.dev', '--password', 'demo1234'], creatorHome),
    'creator login',
  );

  const course = courseCreatedSchema.parse(
    await cliData(
      await studio(
        [
          'course',
          'create',
          '--name',
          'React Fundamentals',
          '--description',
          'Build modern React apps from components to production patterns.',
        ],
        creatorHome,
      ),
      'create course',
    ),
  );
  const courseId = course.course.id;

  const createLesson = async (name: string, contents: string[]): Promise<string> => {
    const payload = `{"name":${JSON.stringify(name)},"contents":[${contents.join(',')}]}`;
    const lesson = lessonCreatedSchema.parse(
      await cliData(await studio(['lesson', 'create', '--data', payload], creatorHome), `create lesson ${name}`),
    );
    return lesson.lesson.id;
  };

  const welcomeLessonId = await createLesson('Welcome and setup', [
    youtube('aqz-KE-bpKQ'),
    html(
      '<h2>Welcome to React Fundamentals</h2><p>This course takes you from your first component to production-ready patterns. Watch the intro above, then work through each module in order.</p><p>By the end you will be able to:</p><ul><li>Compose interfaces from small, reusable components</li><li>Manage state and side effects with confidence</li><li>Structure a codebase that scales with your team</li></ul>',
    ),
    link('https://github.com/facebook/react', 'Course starter repository'),
  ]);
  const howLessonId = await createLesson('How the course works', [
    html(
      '<h2>How to get the most out of this course</h2><p>Each lesson pairs a short video with a written summary and hands-on links. Mark lessons complete as you go — your progress is saved automatically and the sidebar tracks where you left off.</p>',
    ),
  ]);
  const componentsLessonId = await createLesson('Components in depth', [
    youtube('SqcY0GlETPk'),
    html(
      '<h2>Thinking in components</h2><p>Components are the building blocks of every React application. In this lesson we break a real interface into a tree of focused, reusable pieces.</p>',
    ),
  ]);
  const stateLessonId = await createLesson('State and effects', [
    html(
      '<h2>State and effects</h2><p>Learn how React re-renders in response to state, and how effects let you synchronise with the outside world.</p>',
    ),
  ]);
  const performanceLessonId = await createLesson('Performance tuning', [
    html(
      '<h2>Performance tuning</h2><p>Measure before you optimise. This lesson covers memoisation, list virtualisation and profiling.</p>',
    ),
  ]);
  const architectureLessonId = await createLesson('Architecture patterns', [
    html(
      '<h2>Architecture patterns</h2><p>Fold everything together into a maintainable structure: data flow, boundaries and testing seams.</p>',
    ),
  ]);

  const createModule = async (title: string, chapterName: string, lessons: [string, string][]): Promise<string> => {
    const contents = lessons.map(([name, lessonId]) => chapterContent(name, lessonId)).join(',');
    const chapter = `{"id":"${randomUUID()}","name":${JSON.stringify(chapterName)},"contents":[${contents}]}`;
    const payload = `{"courseIds":["${courseId}"],"title":${JSON.stringify(title)},"chapters":[${chapter}]}`;
    const module = moduleCreatedSchema.parse(
      await cliData(await studio(['module', 'create', '--data', payload], creatorHome), `create module ${title}`),
    );
    return module.module.id;
  };

  const gettingStartedId = await createModule('Getting Started', 'Orientation', [
    ['Welcome and setup', welcomeLessonId],
    ['How the course works', howLessonId],
  ]);
  const coreConceptsId = await createModule('Core Concepts', 'Building Blocks', [
    ['Components in depth', componentsLessonId],
    ['State and effects', stateLessonId],
  ]);
  await createModule('Advanced Patterns', 'Scaling Up', [
    ['Performance tuning', performanceLessonId],
    ['Architecture patterns', architectureLessonId],
  ]);

  const mediaLessonName = 'Streaming media deep dive';
  await createLesson(mediaLessonName, [
    video('courses/react-fundamentals/streaming-media.mp4', 'a1b2c3d4-1122-3344-5566-778899aabbcc', '128312'),
    pdf('https://static.together.dev/react-fundamentals/streaming-media-cheatsheet.pdf', 'Streaming media cheat sheet'),
    html(
      '<h2>Streaming media deep dive</h2><p>The video above streams straight from your Bunny library, and the PDF opens inline or in a new tab. Together only stores the pointers — your media stays where it already lives.</p>',
    ),
  ]);

  const accessItems = JSON.stringify([
    { level: 'modules', courseId, moduleIds: [gettingStartedId] },
    { level: 'lessons', courseId, lessonIds: [componentsLessonId] },
  ]);
  const product = productCreatedSchema.parse(
    await cliData(
      await studio(
        ['product', 'create', '--title', 'React Fundamentals - full course', '--price-cents', '19900', '--access-items', accessItems],
        creatorHome,
      ),
      'create product',
    ),
  );

  const mixedProductTitle = 'React Fundamentals - tiered access';
  const mixedAccessItems = JSON.stringify([
    { level: 'modules', courseId, moduleIds: [gettingStartedId, coreConceptsId] },
    { level: 'lessons', courseId, lessonIds: [componentsLessonId] },
    { level: 'course', courseId },
  ]);
  const mixedProduct = productCreatedSchema.parse(
    await cliData(
      await studio(
        ['product', 'create', '--title', mixedProductTitle, '--price-cents', '29900', '--access-items', mixedAccessItems],
        creatorHome,
      ),
      'create mixed product',
    ),
  );

  const studentEmail = `student.parity+${randomUUID().slice(0, 8)}@together.dev`;
  await cliData(
    await studio(['dev', 'grant', '--email', studentEmail, '--product', product.product.id], creatorHome),
    'grant product',
  );

  const grantsMemberEmail = `member.grants+${randomUUID().slice(0, 8)}@together.dev`;
  await cliData(
    await studio(
      [
        'dev',
        'grant',
        '--email',
        grantsMemberEmail,
        '--product',
        mixedProduct.product.id,
        '--starts-at',
        '2026-06-01T00:00:00.000Z',
        '--expires-at',
        '2027-06-01T00:00:00.000Z',
      ],
      creatorHome,
    ),
    'grant active product',
  );
  await cliData(
    await studio(
      [
        'dev',
        'grant',
        '--email',
        grantsMemberEmail,
        '--product',
        product.product.id,
        '--starts-at',
        '2025-01-01T00:00:00.000Z',
        '--expires-at',
        '2025-04-01T00:00:00.000Z',
      ],
      creatorHome,
    ),
    'grant expired product',
  );

  await cliData(await cli(['login-magic', '--email', studentEmail], studentHome), 'student magic login');
  await cliData(await studio(['student', 'complete', howLessonId], studentHome), 'complete lesson');

  return {
    studentEmail,
    courseId,
    welcomeLessonId,
    lockedLessonId: performanceLessonId,
    courseName: 'React Fundamentals',
    mediaLessonName,
    mixedProductTitle,
    grantsMemberEmail,
  };
};

interface MagicLinkLabels {
  send: string;
  open: string;
}

const ENGLISH_MAGIC_LINK: MagicLinkLabels = { send: 'Send me a magic link', open: 'Open magic link' };
const POLISH_MAGIC_LINK: MagicLinkLabels = { send: 'Wyślij mi magiczny link', open: 'Otwórz magiczny link' };

const signInStudent = async (
  page: Page,
  studioBaseUrl: string,
  email: string,
  labels: MagicLinkLabels = ENGLISH_MAGIC_LINK,
): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.locator('#magic-link-email').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#magic-link-email').fill(email);
  await page.getByRole('button', { name: labels.send }).click();
  const magicLink = page.getByRole('link', { name: labels.open });
  await magicLink.waitFor({ state: 'visible', timeout: 20000 });
  const href = await magicLink.getAttribute('href');
  assert(href !== null && href.length > 0, 'login page did not expose a dev magic link');
  await page.goto(href, { waitUntil: 'load' });
  await page.waitForURL('**/my', { timeout: 20000 });
};

const setLanguage = async (context: BrowserContext, language: 'pl' | 'en'): Promise<void> => {
  await context.addInitScript((value) => {
    window.localStorage.setItem('together-language', value);
  }, language);
};

const capturePolishSurfaces = async (
  browser: Browser,
  studioBaseUrl: string,
  fixture: StudentFixture,
  viewport: { width: number; height: number },
): Promise<void> => {
  const creatorContext = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await setLanguage(creatorContext, 'pl');
  const creatorPage = await creatorContext.newPage();
  await signInCreator(creatorPage, studioBaseUrl);
  await creatorPage.getByTestId('section-products').waitFor({ state: 'visible', timeout: 20000 });
  await creatorPage.getByTestId('section-products').click();
  await creatorPage.getByRole('heading', { name: 'Nowy produkt' }).waitFor({ state: 'visible', timeout: 20000 });
  const productRow = creatorPage.getByTestId('product-row').filter({ hasText: fixture.mixedProductTitle }).first();
  await productRow.waitFor({ state: 'visible', timeout: 20000 });
  await creatorPage.evaluate(() => window.scrollTo(0, 0));
  await shoot(creatorPage, '16-panel-pl.png');
  await creatorContext.close();

  const studentContext = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await setLanguage(studentContext, 'pl');
  const studentPage = await studentContext.newPage();
  await signInStudent(studentPage, studioBaseUrl, fixture.studentEmail, POLISH_MAGIC_LINK);
  await studentPage.goto(`${studioBaseUrl}/my/courses/${fixture.courseId}`, { waitUntil: 'load' });
  await studentPage.getByTestId('course-tree').waitFor({ state: 'visible', timeout: 20000 });
  await studentPage.getByText('Advanced Patterns').first().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(studentPage, '17-student-tree-pl.png');
  await studentContext.close();
};

const captureCommunitySurfaces = async (
  browser: Browser,
  studioBaseUrl: string,
  viewport: { width: number; height: number },
): Promise<void> => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await setLanguage(context, 'pl');
  const page = await context.newPage();
  await signInStudent(page, studioBaseUrl, 'kursant.aktywny@together.dev', POLISH_MAGIC_LINK);

  await page.getByTestId('notification-bell').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('notification-bell').click();
  await page.getByTestId('notification-notif-aktywny-zmienne-r2').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('notification-notif-aktywny-zmienne-r1').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '19-notification-bell.png');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: viewport.width, height: 1400 });
  await page.goto(`${studioBaseUrl}/my/courses/course-js/lessons/lesson-js-zmienne-1`, { waitUntil: 'load' });
  await page.getByTestId('discussion-section').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('author-chip-post-js-zmienne-q-r2').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('deleted-post-post-js-zmienne-tip-r1').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('follow-toggle-post-js-zmienne-q').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('discussion-composer').waitFor({ state: 'visible', timeout: 20000 });
  const section = await page.getByTestId('discussion-section').boundingBox();
  if (section) await page.evaluate((top) => window.scrollTo(0, Math.max(0, top - 24)), section.y);
  await shoot(page, '18-lesson-discussion.png');

  await page.goto(`${studioBaseUrl}/my/courses/course-js`, { waitUntil: 'load' });
  const searchInput = page.getByTestId('course-discussion-search-input');
  await searchInput.waitFor({ state: 'visible', timeout: 20000 });
  await searchInput.fill('lekcji');
  await page.getByTestId('course-search-results').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('search-group-lesson-js-zmienne-1').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('search-group-lesson-js-dom-1').waitFor({ state: 'visible', timeout: 20000 });
  const searchSection = await page.getByTestId('course-discussion-search').boundingBox();
  if (searchSection) await page.evaluate((top) => window.scrollTo(0, Math.max(0, top - 24)), searchSection.y);
  await shoot(page, '20-discussion-search.png');

  await context.close();
};

const captureStudentJourney = async (
  context: BrowserContext,
  studioBaseUrl: string,
  fixture: StudentFixture,
): Promise<void> => {
  const page = await context.newPage();

  await signInStudent(page, studioBaseUrl, fixture.studentEmail);
  await page.getByRole('heading', { name: 'My courses' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('React Fundamentals').first().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '08-my-courses.png');

  await page.goto(`${studioBaseUrl}/my/courses/${fixture.courseId}`, { waitUntil: 'load' });
  await page.getByTestId('course-tree').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('Advanced Patterns').first().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '09-course-tree-locks.png');

  await page.goto(`${studioBaseUrl}/my/courses/${fixture.courseId}/lessons/${fixture.welcomeLessonId}`, {
    waitUntil: 'load',
  });
  await page.getByRole('heading', { name: 'Welcome and setup' }).waitFor({ state: 'visible', timeout: 20000 });
  const embed = page.getByTestId('lesson-embed').first();
  await embed.waitFor({ state: 'visible', timeout: 20000 });
  await embed.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(4500);
  await shoot(page, '10-lesson-player.png');

  await page.goto(`${studioBaseUrl}/my/courses/${fixture.courseId}/lessons/${fixture.lockedLessonId}`, {
    waitUntil: 'load',
  });
  await page.getByText('Content locked').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '11-lesson-locked.png');

  await page.close();
};

const signInCreator = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('login-email').fill('creator@together.dev');
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('signin-submit').click();
  await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
};

const captureCreatorPanel = async (
  context: BrowserContext,
  studioBaseUrl: string,
  fixture: StudentFixture,
): Promise<void> => {
  const page = await context.newPage();

  await signInCreator(page, studioBaseUrl);

  await page.getByTestId('section-courses').click();
  const courseRow = page.getByTestId('course-row').filter({ hasText: fixture.courseName }).first();
  await courseRow.waitFor({ state: 'visible', timeout: 20000 });
  await courseRow.getByRole('button', { name: 'manage' }).click();
  await page.getByRole('heading', { name: 'Modules' }).waitFor({ state: 'visible', timeout: 20000 });
  const firstModule = page.getByTestId('module-card').first();
  await firstModule.waitFor({ state: 'visible', timeout: 20000 });
  await firstModule.getByText('Welcome and setup').first().waitFor({ state: 'visible', timeout: 20000 });
  await firstModule.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -24));
  await shoot(page, '12-panel-course-editor.png');

  await page.getByRole('link', { name: '← all courses' }).click();
  await page.getByTestId('section-lessons').click();
  const lessonRow = page.getByTestId('lesson-row').filter({ hasText: fixture.mediaLessonName }).first();
  await lessonRow.waitFor({ state: 'visible', timeout: 20000 });
  await lessonRow.getByRole('button', { name: 'edit' }).click();
  await page.waitForURL('**/panel/lessons/*', { timeout: 20000 });
  await page.getByRole('heading', { name: 'Edit lesson' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('block-type').filter({ hasText: 'video' }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('block-type').filter({ hasText: 'pdf' }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const videoBlockBox = await page.getByTestId('lesson-block').first().boundingBox();
  if (videoBlockBox) await page.evaluate((top) => window.scrollBy(0, top - 20), videoBlockBox.y);
  await shoot(page, '13-panel-lesson-editor.png');

  await page.getByTestId('section-products').click();
  const productRow = page.getByTestId('product-row').filter({ hasText: fixture.mixedProductTitle }).first();
  await productRow.waitFor({ state: 'visible', timeout: 20000 });
  await productRow.getByRole('button', { name: 'edit access' }).click();
  const accessItems = productRow.getByTestId('access-item');
  await accessItems.first().waitFor({ state: 'visible', timeout: 20000 });
  assert((await accessItems.count()) === 3, 'mixed product should expose three access items');
  await productRow.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -24));
  await shoot(page, '14-panel-product-access.png');

  await page.getByTestId('section-members').click();
  const memberRow = page.getByTestId('member-row').filter({ hasText: fixture.grantsMemberEmail }).first();
  await memberRow.waitFor({ state: 'visible', timeout: 20000 });
  await memberRow.getByRole('button', { name: 'Manage' }).click();
  await page.getByRole('heading', { name: 'Granted products' }).waitFor({ state: 'visible', timeout: 20000 });
  const grantRows = page.getByTestId('grant-row');
  await grantRows.first().waitFor({ state: 'visible', timeout: 20000 });
  assert((await grantRows.count()) === 2, 'grants member should show two grants');
  await page.getByText('active').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('expired').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('heading', { name: 'Granted products' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -24));
  await shoot(page, '15-panel-member-grants.png');

  await page.close();
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;
const homes: string[] = [];

try {
  mkdirSync(outputDir, { recursive: true });
  console.log('shots:parity: preparing the dev database...');
  await prepareDatabase();
  console.log('shots:parity: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`shots:parity: booting server on port ${port}...`);
  server = await bootServer(port, studioBaseUrl, connectUrl);

  console.log('shots:parity: building the student fixture...');
  const fixture = await buildStudentFixture(studioBaseUrl, homes);

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const viewport = { width: 1440, height: 900 };
  const studentContext = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await setLanguage(studentContext, 'en');
  await captureStudentJourney(studentContext, studioBaseUrl, fixture);
  await studentContext.close();

  const creatorContext = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await setLanguage(creatorContext, 'en');
  await captureCreatorPanel(creatorContext, studioBaseUrl, fixture);
  await creatorContext.close();

  await capturePolishSurfaces(browser, studioBaseUrl, fixture, viewport);

  await captureCommunitySurfaces(browser, studioBaseUrl, viewport);

  console.log(`\nshots:parity: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s) -> ${outputDir}`);
} catch (error) {
  const message = error instanceof ShotsFailure ? error.message : String(error);
  console.error(`\nshots:parity: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
