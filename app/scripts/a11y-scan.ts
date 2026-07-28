/**
 * Accessibility runtime scan (ux-decisions §4).
 *
 * `npm run a11y` — builds the web SPA, seeds an isolated dev database, boots the
 * real server on an ephemeral port and runs axe-core (WCAG 2.0/2.1 A+AA plus
 * best-practice) against every key screen, across all 7 themes at desktop 1440;
 * the member-facing screens are additionally scanned at mobile 390.
 *
 * It aggregates violations by rule x theme x screen, writes a JSON + Markdown
 * summary to out/a11y/, and fails the process when any serious/critical
 * violation survives so the gate stays honest.
 *
 * The harness (database prep, web build, server boot, theme injection, member
 * and creator sign-in) mirrors scripts/visual-screenshots.ts so the two scans
 * observe the same deterministic fixture state.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AxeResults, ImpactValue, Result as AxeViolation } from 'axe-core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { API_PATHS } from '#core/contract/index.js';

import { MODES, type ThemeMode } from '../apps/web/src/theme.js';

declare global {
  interface Window {
    axe: { run: (context: Document, options: object) => Promise<AxeResults> };
  }
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const axeSourcePath = join(rootDir, 'node_modules/axe-core/axe.min.js');
const outDir = join(rootDir, 'out/a11y');

const themeStorageKey = 'together-theme-mode';
const languageStorageKey = 'together-language';

const SEED_BASE_TIME = '2026-07-01T12:00:00.000Z';

const THEMES: ThemeMode[] = MODES.map((mode) => mode.id);

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const FAILING_IMPACTS: ImpactValue[] = ['serious', 'critical'];
const IMPACT_ORDER: ImpactValue[] = ['critical', 'serious', 'moderate', 'minor'];

type AuthKind = 'public' | 'member' | 'member-free' | 'creator';
type ViewportName = 'desktop' | 'mobile';

const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

interface ScreenSpec {
  name: string;
  auth: AuthKind;
  path: string;
  viewports: ViewportName[];
  ready: (page: Page) => Promise<void>;
}

const visible = { state: 'visible', timeout: 20000 } as const;
const memberViewports: ViewportName[] = ['desktop', 'mobile'];
const desktopOnly: ViewportName[] = ['desktop'];

const SCREENS: ScreenSpec[] = [
  {
    name: 'login',
    auth: 'public',
    path: '/login',
    viewports: memberViewports,
    ready: (page) => page.getByTestId('login-email').waitFor(visible),
  },
  {
    name: 'checkout-multiprice',
    auth: 'public',
    path: '/checkout/product-club',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByText('Klub Studio — subskrypcja').first().waitFor(visible);
      await page.locator('#checkout-price-choice').waitFor(visible);
    },
  },
  {
    name: 'my-courses',
    auth: 'member',
    path: '/my',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByTestId('course-card-course-js').waitFor(visible);
      await page.getByTestId('completion-course-js').waitFor(visible);
    },
  },
  {
    name: 'course',
    auth: 'member',
    path: '/my/courses/course-js',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByTestId('course-tree').waitFor(visible);
      await page.getByText('Przejdź do pierwszej lekcji').waitFor(visible);
    },
  },
  {
    name: 'lesson',
    auth: 'member',
    path: '/my/courses/course-js/lessons/lesson-js-zmienne-1',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByLabel('breadcrumb').waitFor(visible);
      await page.getByTestId('discussion-composer').waitFor(visible);
    },
  },
  {
    name: 'my-products',
    auth: 'member',
    path: '/my/products',
    viewports: memberViewports,
    ready: (page) => page.getByTestId('my-product-product-js-full').waitFor(visible),
  },
  {
    name: 'account',
    auth: 'member',
    path: '/account',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByTestId('account-email').waitFor(visible);
      await page.getByTestId('theme-selector').waitFor(visible);
    },
  },
  {
    name: 'panel-dashboard',
    auth: 'creator',
    path: '/panel',
    viewports: desktopOnly,
    ready: async (page) => {
      await page.getByTestId('dashboard-tiles').waitFor(visible);
      await page.getByTestId('dashboard-member-row').first().waitFor(visible);
    },
  },
  {
    name: 'panel-products',
    auth: 'creator',
    path: '/panel/products',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('product-row').first().waitFor(visible),
  },
  {
    name: 'panel-product-editor',
    auth: 'creator',
    path: '/panel/products/product-studio-kurs-101',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('prices-section').waitFor(visible),
  },
  {
    name: 'panel-course-detail',
    auth: 'creator',
    path: '/panel/courses/course-js',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('module-card').first().waitFor(visible),
  },
  {
    name: 'panel-members',
    auth: 'creator',
    path: '/panel/members',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('member-row').first().waitFor(visible),
  },
  {
    name: 'panel-member-detail',
    auth: 'creator',
    path: '/panel/members/member-studio-aktywny',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('grant-row').first().waitFor(visible),
  },
  {
    name: 'panel-sales',
    auth: 'creator',
    path: '/panel/sales',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('sales-list').waitFor(visible),
  },
  {
    name: 'panel-integrations',
    auth: 'creator',
    path: '/panel/integrations',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('bunny-test-connection').waitFor(visible),
  },
  {
    name: 'panel-settings',
    auth: 'creator',
    path: '/panel/settings',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('add-passkey').waitFor(visible),
  },
];

class ScanFailure extends Error {}

const fail = (message: string): never => {
  throw new ScanFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ScanFailure(message);
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
  throw new ScanFailure(
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

const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');

const stubNonDeterministicRequests = async (context: BrowserContext): Promise<void> => {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/student/progress/last-viewed') return route.abort();
    if (isLocalHost(url.hostname)) return route.continue();
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

const signInMagicLink = (email: string) => async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.locator('#magic-link-email').waitFor(visible);
  await page.locator('#magic-link-email').fill(email);
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
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  await applyChrome(context, 'shadcn');
  const page = await context.newPage();
  await signIn(page, studioBaseUrl);
  const state = await context.storageState();
  await context.close();
  return state;
};

interface ContrastDatum {
  fg: string;
  bg: string;
  ratio: number;
  expected: string;
  fontSize: string;
  fontWeight: string;
  html: string;
}

interface ViolationRecord {
  rule: string;
  impact: ImpactValue;
  help: string;
  helpUrl: string;
  theme: ThemeMode;
  screen: string;
  viewport: ViewportName;
  nodes: number;
  targets: string[];
  contrast: ContrastDatum[];
}

const readContrast = (node: AxeViolation['nodes'][number]): ContrastDatum[] => {
  const out: ContrastDatum[] = [];
  for (const check of node.any) {
    const data = check.data;
    if (
      typeof data === 'object' &&
      data !== null &&
      'fgColor' in data &&
      'bgColor' in data &&
      'contrastRatio' in data
    ) {
      out.push({
        fg: String(data.fgColor),
        bg: String(data.bgColor),
        ratio: Number(data.contrastRatio),
        expected: 'expectedContrastRatio' in data ? String(data.expectedContrastRatio) : '',
        fontSize: 'fontSize' in data ? String(data.fontSize) : '',
        fontWeight: 'fontWeight' in data ? String(data.fontWeight) : '',
        html: node.html.slice(0, 160),
      });
    }
  }
  return out;
};

const impactRank = (impact: ImpactValue): number => {
  const index = IMPACT_ORDER.indexOf(impact);
  return index === -1 ? IMPACT_ORDER.length : index;
};

const runAxe = async (page: Page): Promise<AxeResults> => {
  const axeSource = readFileSync(axeSourcePath, 'utf8');
  await page.evaluate(axeSource);
  return page.evaluate(
    ([tags]) =>
      window.axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      }),
    [AXE_TAGS] as const,
  );
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  mkdirSync(outDir, { recursive: true });

  console.log(`a11y: preparing the dev database (SEED_BASE_TIME=${SEED_BASE_TIME})...`);
  await prepareDatabase();
  console.log('a11y: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`a11y: booting server on port ${port}...`);
  server = await bootServer(port, studioBaseUrl, connectUrl);

  browser = await chromium.launch({ channel: 'chrome', headless: true });

  console.log('a11y: signing in the member and creator fixtures...');
  const memberState = await bootstrapAuthState(
    browser,
    studioBaseUrl,
    signInMagicLink('kursant.aktywny@together.dev'),
  );
  const freeMemberState = await bootstrapAuthState(
    browser,
    studioBaseUrl,
    signInMagicLink('free@together.dev'),
  );
  const creatorState = await bootstrapAuthState(browser, studioBaseUrl, signInCreator);
  const stateFor = (auth: AuthKind): StorageState | undefined => {
    if (auth === 'member') return memberState;
    if (auth === 'member-free') return freeMemberState;
    if (auth === 'creator') return creatorState;
    return undefined;
  };

  const records: ViolationRecord[] = [];
  let scanned = 0;

  for (const theme of THEMES) {
    for (const viewportName of ['desktop', 'mobile'] satisfies ViewportName[]) {
      for (const auth of ['public', 'member', 'member-free', 'creator'] satisfies AuthKind[]) {
        const screens = SCREENS.filter(
          (screen) => screen.auth === auth && screen.viewports.includes(viewportName),
        );
        if (screens.length === 0) continue;
        const storageState = stateFor(auth);
        const context = await browser.newContext({
          viewport: VIEWPORTS[viewportName],
          deviceScaleFactor: 1,
          ...(storageState === undefined ? {} : { storageState }),
        });
        await applyChrome(context, theme);
        await stubNonDeterministicRequests(context);
        const page = await context.newPage();

        for (const screen of screens) {
          await page.goto(`${studioBaseUrl}${screen.path}`, { waitUntil: 'load' });
          await screen.ready(page);
          await delay(600);
          const results = await runAxe(page);
          scanned += 1;
          for (const violation of results.violations) {
            const impact: ImpactValue = violation.impact ?? 'minor';
            records.push({
              rule: violation.id,
              impact,
              help: violation.help,
              helpUrl: violation.helpUrl,
              theme,
              screen: screen.name,
              viewport: viewportName,
              nodes: violation.nodes.length,
              targets: violation.nodes
                .flatMap((node: AxeViolation['nodes'][number]) => node.target.map(String))
                .slice(0, 5),
              contrast: violation.nodes.flatMap((node: AxeViolation['nodes'][number]) =>
                readContrast(node),
              ),
            });
          }
        }

        await context.close();
      }
    }
    console.log(`a11y: scanned theme ${theme}`);
  }

  const byRule = new Map<
    string,
    {
      rule: string;
      impact: ImpactValue;
      help: string;
      helpUrl: string;
      themes: Set<string>;
      screens: Set<string>;
      viewports: Set<string>;
      occurrences: number;
    }
  >();
  for (const record of records) {
    const existing = byRule.get(record.rule);
    if (existing === undefined) {
      byRule.set(record.rule, {
        rule: record.rule,
        impact: record.impact,
        help: record.help,
        helpUrl: record.helpUrl,
        themes: new Set([record.theme]),
        screens: new Set([record.screen]),
        viewports: new Set([record.viewport]),
        occurrences: 1,
      });
      continue;
    }
    if (impactRank(record.impact) < impactRank(existing.impact)) existing.impact = record.impact;
    existing.themes.add(record.theme);
    existing.screens.add(record.screen);
    existing.viewports.add(record.viewport);
    existing.occurrences += 1;
  }

  const ruleSummary = [...byRule.values()].sort(
    (a, b) => impactRank(a.impact) - impactRank(b.impact) || b.occurrences - a.occurrences,
  );

  const failing = records.filter((record) => FAILING_IMPACTS.includes(record.impact));

  const jsonReport = {
    generatedAt: new Date().toISOString(),
    seedBaseTime: SEED_BASE_TIME,
    themes: THEMES,
    axeTags: AXE_TAGS,
    screensScanned: scanned,
    totalViolations: records.length,
    failingViolations: failing.length,
    rules: ruleSummary.map((rule) => ({
      rule: rule.rule,
      impact: rule.impact,
      help: rule.help,
      helpUrl: rule.helpUrl,
      occurrences: rule.occurrences,
      themes: [...rule.themes].sort(),
      screens: [...rule.screens].sort(),
      viewports: [...rule.viewports].sort(),
    })),
    records,
  };
  writeFileSync(join(outDir, 'a11y-report.json'), `${JSON.stringify(jsonReport, null, 2)}\n`);

  const mdLines: string[] = [];
  mdLines.push('# axe-core scan — raw aggregate');
  mdLines.push('');
  mdLines.push(`Generated: ${jsonReport.generatedAt}`);
  mdLines.push('');
  mdLines.push(
    `Scanned ${String(scanned)} screen renders (${String(THEMES.length)} themes; member screens at desktop 1440 + mobile 390, panel screens at desktop 1440).`,
  );
  mdLines.push('');
  mdLines.push(`Tags: ${AXE_TAGS.join(', ')}`);
  mdLines.push('');
  if (ruleSummary.length === 0) {
    mdLines.push('No violations found. Clean pass.');
  } else {
    mdLines.push('| Rule | Impact | Occurrences | Themes | Screens | Viewports |');
    mdLines.push('| --- | --- | --- | --- | --- | --- |');
    for (const rule of ruleSummary) {
      const themes =
        rule.themes.size === THEMES.length ? 'all' : [...rule.themes].sort().join(', ');
      mdLines.push(
        `| ${rule.rule} | ${rule.impact} | ${String(rule.occurrences)} | ${themes} | ${[...rule.screens].sort().join(', ')} | ${[...rule.viewports].sort().join(', ')} |`,
      );
    }
  }
  mdLines.push('');
  writeFileSync(join(outDir, 'a11y-report.md'), `${mdLines.join('\n')}\n`);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  if (ruleSummary.length === 0) {
    console.log(`a11y: PASS (${seconds}s) — ${String(scanned)} renders, 0 violations`);
  } else {
    console.log(`a11y: ${String(scanned)} renders scanned in ${seconds}s`);
    console.log(`a11y: ${String(records.length)} total violations across ${String(ruleSummary.length)} rules:\n`);
    for (const rule of ruleSummary) {
      const scope =
        rule.themes.size === THEMES.length ? 'all themes' : `${String(rule.themes.size)} themes`;
      console.log(
        `  [${rule.impact}] ${rule.rule} — ${String(rule.occurrences)}x (${scope}; screens: ${[...rule.screens].sort().join(', ')})`,
      );
    }
    console.log('');
    if (failing.length > 0) {
      console.error(
        `a11y: FAIL — ${String(failing.length)} serious/critical violation instance(s) remain. See ${join(outDir, 'a11y-report.json')}`,
      );
      process.exitCode = 1;
    } else {
      console.log(`a11y: PASS — no serious/critical violations (moderate/minor only). Report: ${join(outDir, 'a11y-report.md')}`);
    }
  }
} catch (error) {
  const message = error instanceof ScanFailure ? error.message : String(error);
  console.error(`\na11y: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
