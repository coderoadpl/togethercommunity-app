/**
 * Visual regression harness (ux-layout-system §5.4).
 *
 * `npm run visual`        — capture the canonical screen set and pixel-diff it
 *                           against the committed goldens in tasks/visual-goldens;
 *                           diff images land in the gitignored out/visual/.
 * `npm run visual:update` — re-capture the goldens (reviewed artifact in the PR).
 *
 * Determinism: the seed runs with a pinned SEED_BASE_TIME, the browser clock is
 * frozen to the same instant, and all non-local requests are stubbed (images get
 * a flat placeholder), so a golden only changes when the UI changes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { API_PATHS } from '@core/contract/index.js';

import type { ThemeMode } from '../apps/web/src/theme.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const goldenDir = join(rootDir, 'tasks/visual-goldens');
const currentDir = join(rootDir, 'out/visual/current');
const diffDir = join(rootDir, 'out/visual/diff');

const updateMode = process.argv.includes('--update');

const themeStorageKey = 'together-theme-mode';
const languageStorageKey = 'together-language';

const SEED_BASE_TIME = '2026-07-01T12:00:00.000Z';
const PIXELMATCH_THRESHOLD = 0.1;
const MAX_DIFF_RATIO = 0.001;
const minPngBytes = 10 * 1024;

const THEMES: ThemeMode[] = ['shadcn', 'material', 'scoreboard'];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

type AuthKind = 'public' | 'member' | 'member-free' | 'creator';

interface ScreenSpec {
  name: string;
  auth: AuthKind;
  path: string;
  ready: (page: Page) => Promise<void>;
}

const visible = { state: 'visible', timeout: 20000 } as const;

// The unread badge lives on the header bell on sm+ and on the bottom
// tab-bar bell on xs (decision D4) — wait on the instance this viewport
// actually shows, otherwise a shot can land before the async count arrives.
const waitForUnreadBadge = async (page: Page): Promise<void> => {
  const width = page.viewportSize()?.width ?? 0;
  const bellTestId = width < 600 ? 'notification-tab' : 'notification-bell';
  await page
    .locator(`[data-testid="${bellTestId}"] .MuiBadge-badge:not(.MuiBadge-invisible)`)
    .waitFor(visible);
};

const SCREENS: ScreenSpec[] = [
  {
    name: 'login',
    auth: 'public',
    path: '/login',
    ready: (page) => page.getByTestId('login-email').waitFor(visible),
  },
  {
    name: 'checkout',
    auth: 'public',
    path: '/checkout/product-studio-kurs-101',
    ready: (page) => page.getByText('Kurs Together 101').first().waitFor(visible),
  },
  {
    // Waits target the LAST async element of each screen (waterfall queries),
    // otherwise a shot can land mid-load and produce a flaky golden.
    name: 'my-courses',
    auth: 'member',
    path: '/my',
    ready: async (page) => {
      await page.getByTestId('course-card-course-js').waitFor(visible);
      await page.getByTestId('completion-course-js').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'course',
    auth: 'member',
    path: '/my/courses/course-js',
    ready: async (page) => {
      await page.getByTestId('course-tree').waitFor(visible);
      await page.getByText('Przejdź do pierwszej lekcji').waitFor(visible);
    },
  },
  {
    name: 'my-products',
    auth: 'member',
    path: '/my/products',
    ready: (page) => page.getByTestId('my-product-product-js-full').waitFor(visible),
  },
  {
    name: 'product-stub',
    auth: 'member',
    path: '/my/course/product-js-full',
    ready: (page) => page.getByTestId('product-course-links').waitFor(visible),
  },
  {
    name: 'account',
    auth: 'member',
    path: '/account',
    ready: async (page) => {
      await page.getByTestId('account-email').waitFor(visible);
      await page.getByTestId('theme-selector').waitFor(visible);
    },
  },
  {
    name: 'course-not-found',
    auth: 'member',
    path: '/my/courses/course-does-not-exist',
    ready: (page) => page.locator('[data-state="not-found"]').waitFor(visible),
  },
  {
    name: 'lesson-locked',
    auth: 'member-free',
    path: '/my/courses/course-js/lessons/lesson-js-zmienne-2',
    ready: async (page) => {
      await page.getByTestId('locked-lesson-upsell').waitFor(visible);
      await page.getByTestId('locked-product-price').waitFor(visible);
    },
  },
  {
    name: 'lesson',
    auth: 'member',
    path: '/my/courses/course-js/lessons/lesson-js-zmienne-1',
    ready: async (page) => {
      await page.getByLabel('breadcrumb').waitFor(visible);
      await page.getByTestId('discussion-composer').waitFor(visible);
      await page.getByTestId('author-chip-post-js-zmienne-q-r2').waitFor(visible);
    },
  },
  {
    name: 'community',
    auth: 'member',
    path: '/community',
    ready: async (page) => {
      await page.getByTestId('space-card-space-studio-spolecznosc').waitFor(visible);
      await page.getByTestId('space-card-space-studio-klub-js').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'space-feed',
    auth: 'member',
    path: '/community/space-studio-spolecznosc',
    ready: async (page) => {
      await page.getByTestId('post-body-post-spolecznosc-hello').waitFor(visible);
      await page.getByTestId('reaction-post-spolecznosc-hello-👍').waitFor(visible);
      await page.getByTestId('space-follow-toggle').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'panel-spaces',
    auth: 'creator',
    path: '/panel/spaces',
    ready: async (page) => {
      await page.getByTestId('space-manage-space-studio-spolecznosc').waitFor(visible);
      await page.getByTestId('space-manage-space-studio-klub-js').waitFor(visible);
    },
  },
  {
    name: 'panel-dashboard',
    auth: 'creator',
    path: '/panel',
    ready: async (page) => {
      await page.getByTestId('onboarding-checklist').waitFor(visible);
      await page.getByTestId('dashboard-tile-revenue').waitFor(visible);
      await page.getByTestId('dashboard-member-row').first().waitFor(visible);
    },
  },
  {
    name: 'panel-products',
    auth: 'creator',
    path: '/panel/products',
    ready: (page) => page.getByTestId('product-row').first().waitFor(visible),
  },
  {
    name: 'panel-marketing-campaigns',
    auth: 'creator',
    path: '/panel/marketing/campaigns',
    ready: (page) => page.getByRole('heading', { name: 'Kampanie e-mail' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-consents',
    auth: 'creator',
    path: '/panel/marketing/consents',
    ready: (page) => page.getByRole('heading', { name: 'Kreator zgód' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-documents',
    auth: 'creator',
    path: '/panel/marketing/documents',
    ready: (page) => page.getByRole('heading', { name: 'Dokumenty prawne' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-layouts',
    auth: 'creator',
    path: '/panel/marketing/layouts',
    ready: (page) => page.getByRole('heading', { name: 'Układy e-mail' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-settings',
    auth: 'creator',
    path: '/panel/marketing/settings',
    ready: (page) => page.getByTestId('marketing-readiness').waitFor(visible),
  },
  {
    name: 'panel-course',
    auth: 'creator',
    path: '/panel/courses/course-js',
    ready: (page) => page.getByTestId('module-card').first().waitFor(visible),
  },
  {
    name: 'member-detail',
    auth: 'creator',
    path: '/panel/members/member-studio-aktywny',
    ready: (page) => page.getByTestId('grant-row').first().waitFor(visible),
  },
];

class VisualFailure extends Error {}

const fail = (message: string): never => {
  throw new VisualFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new VisualFailure(message);
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

const devDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const prepareDatabase = async (): Promise<void> => {
  const up = await run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d']);
  assert(up.code === 0, `docker compose up failed:\n${up.stdout}${up.stderr}`);
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: devDatabaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], {
    DATABASE_URL: devDatabaseUrl,
    SEED_BASE_TIME,
  });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts']);
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const bootServer = async (
  port: number,
  appBaseUrl: string,
  connectUrl: string,
): Promise<ChildProcess> => {
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
      // not accepting connections yet
    }
    await delay(250);
  }
  throw new VisualFailure(
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

const placeholderPng = (() => {
  const png = new PNG({ width: 960, height: 540 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 228;
    png.data[i + 1] = 228;
    png.data[i + 2] = 228;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
})();

const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');

const stubNonDeterministicRequests = async (context: BrowserContext): Promise<void> => {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    // Last-viewed tracking would mutate the seeded demo progress and change
    // what later captures render; the mutation's failure is silent in the UI.
    if (url.pathname === '/api/student/progress/last-viewed') return route.abort();
    if (isLocalHost(url.hostname)) return route.continue();
    if (route.request().resourceType() === 'image') {
      return route.fulfill({ contentType: 'image/png', body: placeholderPng });
    }
    return route.abort();
  });
};

const applyChrome = async (context: BrowserContext, mode: ThemeMode): Promise<void> => {
  await context.addInitScript(
    ([themeKey, themeValue, langKey]) => {
      try {
        window.localStorage.setItem(themeKey, themeValue);
        window.localStorage.setItem(langKey, 'pl');
      } catch {
        // storage disabled — the choice simply won't persist
      }
    },
    [themeStorageKey, mode, languageStorageKey] as const,
  );
};

const signInCreator = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.getByTestId('login-email').waitFor(visible);
  await page.getByTestId('login-email').fill('creator@together.dev');
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('signin-submit').click();
  await page.getByTestId('tenant-name').waitFor(visible);
};

const signInMember = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.locator('#magic-link-email').waitFor(visible);
  await page.locator('#magic-link-email').fill('kursant.aktywny@together.dev');
  await page.getByRole('button', { name: 'Wyślij mi magiczny link' }).click();
  const magicLink = page.getByRole('link', { name: 'Otwórz magiczny link' });
  await magicLink.waitFor(visible);
  const href = await magicLink.getAttribute('href');
  assert(href !== null && href.length > 0, 'login page did not expose a dev magic link');
  await page.goto(href, { waitUntil: 'load' });
  await page.waitForURL('**/my', { timeout: 20000 });
};

const signInFreeMember = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.locator('#magic-link-email').waitFor(visible);
  await page.locator('#magic-link-email').fill('free@together.dev');
  await page.getByRole('button', { name: 'Wyślij mi magiczny link' }).click();
  const magicLink = page.getByRole('link', { name: 'Otwórz magiczny link' });
  await magicLink.waitFor(visible);
  const href = await magicLink.getAttribute('href');
  assert(href !== null && href.length > 0, 'login page did not expose a dev magic link');
  await page.goto(href, { waitUntil: 'load' });
  await page.waitForURL('**/my', { timeout: 20000 });
};

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

const bootstrapAuthState = async (
  browser: Browser,
  studioBaseUrl: string,
  signIn: (page: Page, baseUrl: string) => Promise<void>,
): Promise<StorageState> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await applyChrome(context, 'shadcn');
  const page = await context.newPage();
  await signIn(page, studioBaseUrl);
  const state = await context.storageState();
  await context.close();
  return state;
};

interface ShotFailure {
  file: string;
  reason: string;
}

const comparePng = (name: string, currentPath: string): ShotFailure | null => {
  const goldenPath = join(goldenDir, name);
  if (!existsSync(goldenPath)) {
    return { file: name, reason: 'golden missing — run `npm run visual:update` and review it' };
  }
  const golden = PNG.sync.read(readFileSync(goldenPath));
  const current = PNG.sync.read(readFileSync(currentPath));
  if (golden.width !== current.width || golden.height !== current.height) {
    return {
      file: name,
      reason: `size mismatch: golden ${golden.width}x${golden.height} vs current ${current.width}x${current.height}`,
    };
  }
  const diff = new PNG({ width: golden.width, height: golden.height });
  const mismatched = pixelmatch(golden.data, current.data, diff.data, golden.width, golden.height, {
    threshold: PIXELMATCH_THRESHOLD,
  });
  const ratio = mismatched / (golden.width * golden.height);
  if (ratio <= MAX_DIFF_RATIO) return null;
  const diffPath = join(diffDir, name);
  writeFileSync(diffPath, PNG.sync.write(diff));
  return {
    file: name,
    reason: `${mismatched} px differ (${(ratio * 100).toFixed(3)}%, limit ${(MAX_DIFF_RATIO * 100).toFixed(3)}%) — diff: ${diffPath}`,
  };
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  mkdirSync(goldenDir, { recursive: true });
  mkdirSync(currentDir, { recursive: true });
  mkdirSync(diffDir, { recursive: true });

  console.log(`visual: preparing the dev database (SEED_BASE_TIME=${SEED_BASE_TIME})...`);
  await prepareDatabase();
  console.log('visual: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`visual: booting server on port ${port}...`);
  server = await bootServer(port, studioBaseUrl, connectUrl);

  browser = await chromium.launch({ channel: 'chrome', headless: true });

  console.log('visual: signing in the member and creator fixtures...');
  const memberState = await bootstrapAuthState(browser, studioBaseUrl, signInMember);
  const freeMemberState = await bootstrapAuthState(browser, studioBaseUrl, signInFreeMember);
  const creatorState = await bootstrapAuthState(browser, studioBaseUrl, signInCreator);
  const stateFor = (auth: AuthKind): StorageState | undefined => {
    if (auth === 'member') return memberState;
    if (auth === 'member-free') return freeMemberState;
    if (auth === 'creator') return creatorState;
    return undefined;
  };

  const failures: ShotFailure[] = [];
  let captured = 0;

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const auth of ['public', 'member', 'member-free', 'creator'] satisfies AuthKind[]) {
        const screens = SCREENS.filter((screen) => screen.auth === auth);
        const storageState = stateFor(auth);
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          ...(storageState === undefined ? {} : { storageState }),
        });
        await applyChrome(context, theme);
        await stubNonDeterministicRequests(context);
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date(SEED_BASE_TIME));

        for (const screen of screens) {
          const file = `${screen.name}--${theme}--${viewport.name}.png`;
          await page.goto(`${studioBaseUrl}${screen.path}`, { waitUntil: 'load' });
          await screen.ready(page);
          await delay(600);
          const shotPath = updateMode ? join(goldenDir, file) : join(currentDir, file);
          await page.screenshot({ path: shotPath, animations: 'disabled' });
          const { size } = statSync(shotPath);
          assert(size > minPngBytes, `${file} is only ${size} bytes (expected > ${minPngBytes})`);
          captured += 1;
          if (!updateMode) {
            const failure = comparePng(file, shotPath);
            if (failure !== null) failures.push(failure);
          }
        }

        await context.close();
      }
    }
    console.log(`visual: captured ${theme} (${SCREENS.length} screens x ${VIEWPORTS.length} viewports)`);
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (updateMode) {
    console.log(`\nvisual:update: PASS (${seconds}s) — ${captured} goldens written to ${goldenDir}`);
    console.log('Review the golden diffs and commit them with the change that caused them.');
  } else if (failures.length > 0) {
    console.error(`\nvisual: FAIL — ${failures.length}/${captured} screenshots differ from the goldens:\n`);
    for (const failure of failures) {
      console.error(`  ✗ ${failure.file}\n    ${failure.reason}`);
    }
    console.error(
      '\nIntended change? Run `npm run visual:update`, review the golden diffs and commit them.\nUnintended? That is a visual regression — fix it.',
    );
    process.exitCode = 1;
  } else {
    console.log(`\nvisual: PASS (${seconds}s) — ${captured} screenshots match the goldens`);
  }
} catch (error) {
  const message = error instanceof VisualFailure ? error.message : String(error);
  console.error(`\nvisual: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
