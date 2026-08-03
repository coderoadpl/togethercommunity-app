import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright-core';
import { z } from 'zod';

import { comparePng, type PngComparisonFailure } from './visual-png-compare.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const storybookDir = join(rootDir, 'storybook-static');
const baselineDir = join(rootDir, 'tasks/lost-pixel-baselines');
const currentDir = join(rootDir, 'out/visual-stories/current');
const diffDir = join(rootDir, 'out/visual-stories/diff');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];

const updateMode = process.argv.includes('--update');
const baselineAuthoringPlatform = 'darwin';
const viewportHeight = 720;
const settleMs = 500;
const viewports = [390, 1440] as const;

const storyIndexSchema = z.object({
  entries: z.record(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      name: z.string().min(1),
      type: z.string(),
    }),
  ),
});

class StoryVisualFailure extends Error {}

const fail = (message: string): never => {
  throw new StoryVisualFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) fail(message);
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ephemeralPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate an ephemeral port')));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });

const bootStorybook = async (port: number): Promise<ChildProcess> => {
  const child = spawn(
    viteBin,
    [
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
      '--outDir',
      storybookDir,
    ],
    { cwd: rootDir, detached: true },
  );
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

  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (exitInfo !== null) {
      fail(`Storybook server exited before becoming ready (${exitInfo}).\n${logs}`);
    }
    try {
      const response = await fetch(`${baseUrl}/index.json`);
      if (response.ok) return child;
    } catch {}
    await delay(100);
  }
  return fail(`Storybook server did not become ready within 20s.\n${logs}`);
};

const killServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  signalGroup('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL');
};

const slug = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z\d]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

const waitForStory = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => document.body.classList.contains('sb-show-main'), undefined, {
    timeout: 20_000,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await delay(settleMs);
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  if (updateMode && process.platform !== baselineAuthoringPlatform) {
    fail(
      `Story baseline authoring requires ${baselineAuthoringPlatform}; current platform is ${process.platform}.`,
    );
  }

  const parsedIndex = storyIndexSchema.parse(
    JSON.parse(readFileSync(join(storybookDir, 'index.json'), 'utf8')),
  );
  const stories = Object.values(parsedIndex.entries)
    .filter((entry) => entry.type === 'story')
    .sort((left, right) => left.id.localeCompare(right.id));
  assert(stories.length > 0, 'Storybook index contains no stories.');

  mkdirSync(baselineDir, { recursive: true });
  rmSync(currentDir, { recursive: true, force: true });
  rmSync(diffDir, { recursive: true, force: true });
  mkdirSync(currentDir, { recursive: true });
  mkdirSync(diffDir, { recursive: true });

  const baselineFiles = new Set(
    readdirSync(baselineDir).filter((file) => file.endsWith('.png')),
  );
  const shotFiles = new Set<string>();
  const additions: string[] = [];
  const failures: PngComparisonFailure[] = [];

  const port = await ephemeralPort();
  server = await bootStorybook(port);
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  browser = await chromium.launch(
    chromeExecutablePath
      ? { executablePath: chromeExecutablePath, headless: true }
      : { channel: 'chrome', headless: true },
  );

  for (const width of viewports) {
    const context = await browser.newContext({
      viewport: { width, height: viewportHeight },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();

    for (const story of stories) {
      const file = `${slug(story.title)}--${slug(story.name)}__[w${String(width)}px].png`;
      assert(!shotFiles.has(file), `Multiple stories resolve to ${file}.`);
      shotFiles.add(file);
      await page.goto(`${baseUrl}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, {
        waitUntil: 'load',
      });
      await waitForStory(page);
      const shotPath = join(updateMode ? baselineDir : currentDir, file);
      await page.screenshot({
        path: shotPath,
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      });

      if (!updateMode) {
        if (!baselineFiles.has(file)) {
          additions.push(file);
          continue;
        }
        const failure = comparePng({
          file,
          baselinePath: join(baselineDir, file),
          currentPath: shotPath,
          diffPath: join(diffDir, file),
          missingBaselineReason:
            'story baseline missing — run `pnpm run visual:stories:update` and review it',
        });
        if (failure !== null) failures.push(failure);
      }
    }

    await context.close();
    console.log(`visual:stories: captured ${String(stories.length)} stories at ${String(width)} px`);
  }

  if (!updateMode) {
    for (const file of baselineFiles) {
      if (!shotFiles.has(file)) {
        failures.push({ file, reason: 'baseline has no matching Storybook story' });
      }
    }
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (updateMode) {
    console.log(
      `\nvisual:stories:update: PASS (${seconds}s) — ${String(shotFiles.size)} baseline images written to ${baselineDir}`,
    );
    console.log('Review the story baseline diffs and commit only intentional changes.');
  } else if (failures.length > 0) {
    console.error(
      `\nvisual:stories: FAIL — ${String(failures.length)}/${String(baselineFiles.size)} baselines differ:\n`,
    );
    for (const failure of failures) {
      console.error(`  ✗ ${failure.file}\n    ${failure.reason}`);
    }
    console.error(
      '\nIntended change? Run `pnpm run visual:stories:update` and review only the story baselines.',
    );
    process.exitCode = 1;
  } else {
    const additionSummary =
      additions.length === 0 ? '' : `; ${String(additions.length)} unbaselined additions captured`;
    console.log(
      `\nvisual:stories: PASS (${seconds}s) — ${String(baselineFiles.size)} baselines match${additionSummary}`,
    );
  }
} catch (error) {
  const message = error instanceof StoryVisualFailure ? error.message : String(error);
  console.error(`\nvisual:stories: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
