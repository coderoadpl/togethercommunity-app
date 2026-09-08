import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { createVisualCapture, settlePage, waitForPaint } from './visual-browser-setup.js';
import { pageScreens, pageStoryId, serverHtmlScreenNames } from './storybook-page-screens.js';
import { SCREENS, VIEWPORTS, includesViewport, type ScreenSpec } from './visual-screen-inventory.js';
import { comparePng } from './visual-png-compare.js';

const updateMode = process.argv.includes('--update');
const goldenAuthoringPlatform = 'darwin';
if (updateMode && process.platform !== goldenAuthoringPlatform) throw new Error(`Baseline authoring requires ${goldenAuthoringPlatform}; current platform is ${process.platform}.`);
const args = process.argv.slice(2).filter((argument) => argument !== '--update');
const output = resolve(args[0] ?? 'out/visual');
const shots = join(output, 'current');
const diffs = join(output, 'diff');
mkdirSync(shots, { recursive: true });
mkdirSync(diffs, { recursive: true });
const updates: { baseline: string; current: string }[] = [];
const root = resolve('storybook-static');
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  void (async () => {
    const path = resolve(root, `.${new URL(req.url ?? '/', 'http://localhost').pathname}`);
    if (!path.startsWith(`${root}/`)) { res.writeHead(404).end(); return; }
    try {
      await stat(path);
      res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  })();
});
await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('Missing static server port');
const executablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true, channel: 'chrome' }).catch((error: unknown) => { server.close(); throw error; });
const browserVersion = browser.version();
const measurements: unknown[] = [];
const startedAt = Date.now();
const captureScreens: readonly ScreenSpec[] = [...pageScreens, ...[...serverHtmlScreenNames].map((name) => {
  const screen = SCREENS.find((entry) => entry.name === name);
  if (!screen) throw new Error(`Missing server HTML screen ${name}`);
  return {
    ...screen,
    ready: async (page) => {
      await page.frameLocator('iframe').getByTestId(name).waitFor({ timeout: 20000 });
    },
    settled: async (page) => {
      await page.frameLocator('iframe').locator('body').evaluate(async () => { await document.fonts.ready; });
    },
  } satisfies ScreenSpec;
})];
try {
  const index = z.object({ entries: z.record(z.object({ type: z.string() })) }).parse(JSON.parse(await readFile(join(root, 'index.json'), 'utf8')));
  const goldens = await readdir(resolve('tasks/visual-goldens'));
  const expectedGoldens = new Set<string>();
  for (const spec of captureScreens) {
    for (const viewport of VIEWPORTS.filter((viewport) => includesViewport(spec, viewport))) {
      const id = pageStoryId(spec.name, viewport.name);
      if (index.entries[id]?.type !== 'story') throw new Error(`Missing story ${id} for ${spec.name} at ${viewport.name}`);
      const file = `${spec.name}--shadcn--${viewport.name}.png`;
      if (expectedGoldens.has(file)) throw new Error(`Duplicate golden mapping: ${file}`);
      expectedGoldens.add(file);
      if (!updateMode) await stat(resolve('tasks/visual-goldens', file));
    }
  }
  const skipped = goldens.filter((file) => file.endsWith('.png') && !expectedGoldens.has(file));
  if (skipped.length > 0) throw new Error(`Uncovered goldens: ${skipped.join(', ')}`);
  const selected = args[1]?.split(',') ?? captureScreens.map((entry) => entry.name);
  for (const name of selected) {
    if (!captureScreens.some((entry) => entry.name === name)) throw new Error(`Unknown page screen ${name}`);
  }
  // Match the authoring order and page reuse to preserve rounded-shadow paint caches.
  for (const viewport of VIEWPORTS) {
    for (const auth of ['public', 'member', 'member-free', 'creator'] as const) {
      const specs = captureScreens.filter((entry) => selected.includes(entry.name) && entry.auth === auth && includesViewport(entry, viewport))
        .sort((left, right) => SCREENS.findIndex((entry) => entry.name === left.name) - SCREENS.findIndex((entry) => entry.name === right.name));
      if (specs.length === 0) continue;
      const mode = 'light';
      const createCapture = async () => {
        const { context, page } = await createVisualCapture(browser, viewport);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        return { context, page, errors };
      };
      const sharedCapture = await createCapture();
      for (const spec of specs) {
        const capture = sharedCapture;
        const { page, errors } = capture;
        const screen = spec.name;
        const id = pageStoryId(screen, viewport.name);
        errors.length = 0;
        const captureStartedAt = Date.now();
        let failure: string | undefined;
        const file = `${screen}--shadcn--${viewport.name}`;
        try {
          await page.goto(`http://${spec.tenantSlug ?? 'studio'}.localhost:${address.port}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'load' });
          await spec.ready(page);
          if (!serverHtmlScreenNames.has(screen)) await page.waitForFunction(() => document.documentElement.dataset['fixtureReady'] === 'true');
          await settlePage(page, spec.waitForNetworkIdle ?? true);
          if (spec.settled) {
            await spec.settled(page);
            await waitForPaint(page);
          }
        } catch (error) { failure = String(error); }
        await page.screenshot({ path: join(shots, `${file}.png`), animations: 'disabled', caret: 'hide', scale: 'css', mask: spec.mask?.(page) ?? [] });
        const size = (await stat(join(shots, `${file}.png`))).size;
        const minBytes = spec.minBytes ?? 10 * 1024;
        if (size <= minBytes) failure = [failure, `${file} is only ${size} bytes (expected > ${minBytes})`].filter(Boolean).join('; ');
        const baseline = resolve(`tasks/visual-goldens/${screen}--shadcn--${viewport.name}.png`);
        const diff = join(diffs, `${file}.png`);
        let countedPixels: number | undefined;
        const comparison = comparePng({ onCompared: (pixels) => { countedPixels = pixels; }, file, baselinePath: baseline, currentPath: join(shots, `${file}.png`), diffPath: diff, missingBaselineReason: 'Missing golden' });
        const hasBaseline = await stat(baseline).then(() => true, () => false);
        const diagnostics = await page.evaluate(() => ({ calls: document.documentElement.dataset['fixtureCalls'], missing: document.documentElement.dataset['fixtureErrors'], pending: document.documentElement.dataset['fixturePending'], fetching: document.documentElement.dataset['fixtureFetching'], text: document.body.innerText.slice(0, 2000) }));
        if (failure && diagnostics.fetching !== undefined) failure += `; fetching queries: ${diagnostics.fetching}; held calls: ${diagnostics.pending ?? '[]'}`;
        if ((!updateMode && comparison !== null) || failure || errors.length > 0 || (diagnostics.missing !== undefined && diagnostics.missing !== '[]') || diagnostics.text.includes('Something went wrong!')) process.exitCode = 1;
        const byteIdentical = hasBaseline && (await readFile(baseline)).equals(await readFile(join(shots, `${file}.png`)));
        if (updateMode && !byteIdentical) updates.push({ baseline, current: join(shots, `${file}.png`) });
        const fixturePath = resolve(`apps/web/src/stories/fixtures/${screen}.json`);
        const fixtureSha256 = createHash('sha256').update(await readFile(fixturePath)).digest('hex');
        const result = { fixturePath, fixtureSha256, baseline, file, id, mode, viewport, milliseconds: Date.now() - captureStartedAt, comparison: comparison?.reason ?? `${String(countedPixels)} px differ`, countedPixels, byteIdentical, failure, errors: [...errors], diagnostics };
        measurements.push(result);
        writeFileSync(join(output, 'measurements.json'), JSON.stringify({ browserVersion, milliseconds: Date.now() - startedAt, measurements }, null, 2));
        console.log(`${file}: ${result.comparison}; byte-identical=${byteIdentical}${failure ? `; ${failure}` : ''}${errors.length > 0 ? `; ${errors.join('; ')}` : ''}`);
      }
      await sharedCapture.context.close();
    }
  }
  if (updateMode && process.exitCode !== 1) {
    for (const update of updates) copyFileSync(update.current, update.baseline);
    console.log(`visual:update: ${updates.length} changed baselines written`);
  }
} catch (error) {
  process.exitCode = 1;
  throw error;
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  console.log(`storybook-capture: ${process.exitCode === 1 ? 'FAIL' : 'PASS'} — ${measurements.length} captures compared with committed goldens`);
  writeFileSync(join(output, 'measurements.json'), JSON.stringify({ browserVersion, milliseconds: Date.now() - startedAt, measurements }, null, 2));
}
