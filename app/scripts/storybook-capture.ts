import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { applyChrome, settlePage, stubNonDeterministicRequests } from './visual-browser-setup.js';
import { visualSeedTime } from './visual-request-policy.js';
import { pageScreens, pageStoryId } from './storybook-page-screens.js';
import { SCREENS, VIEWPORTS, includesViewport, type ScreenSpec } from './visual-screen-inventory.js';
import { comparePng } from './visual-png-compare.js';

const output = z.string().min(1).parse(process.argv[2]);
const shots = join(output, 'shots');
mkdirSync(shots, { recursive: true });
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
const browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true, channel: 'chrome' });
const browserVersion = browser.version();
const measurements: unknown[] = [];
const startedAt = Date.now();
const hostedLegalDocument = SCREENS.find((screen) => screen.name === 'hosted-legal-document');
if (!hostedLegalDocument) throw new Error('Missing hosted legal document screen');
const captureScreens: readonly ScreenSpec[] = [...pageScreens, {
  ...hostedLegalDocument,
  ready: async (page) => {
    await page.frameLocator('iframe[title="Hosted legal document"]').getByTestId('hosted-legal-document').waitFor({ timeout: 20000 });
  },
  settled: async (page) => {
    await page.frameLocator('iframe[title="Hosted legal document"]').locator('body').evaluate(async () => { await document.fonts.ready; });
  },
}];
try {
  const index = z.object({ entries: z.record(z.object({ type: z.string() })) }).parse(JSON.parse(await readFile(join(root, 'index.json'), 'utf8')));
  const goldens = await readdir(resolve('tasks/visual-goldens'));
  for (const spec of captureScreens) {
    const expectedGoldens = new Set<string>();
    for (const viewport of VIEWPORTS.filter((viewport) => includesViewport(spec, viewport))) {
      const id = pageStoryId(spec.name, viewport.name);
      if (index.entries[id]?.type !== 'story') throw new Error(`Missing story ${id} for ${spec.name} at ${viewport.name}`);
      await stat(resolve(`tasks/visual-goldens/${spec.name}--shadcn--${viewport.name}.png`));
      expectedGoldens.add(`${spec.name}--shadcn--${viewport.name}.png`);
    }
    const skipped = goldens.filter((file) => file.startsWith(`${spec.name}--shadcn--`) && file.endsWith('.png') && !expectedGoldens.has(file));
    if (skipped.length > 0) throw new Error(`Uncovered page goldens: ${skipped.join(', ')}`);
  }
  const selected = process.argv[3]?.split(',') ?? captureScreens.map((entry) => entry.name);
  for (const name of selected) {
    if (!captureScreens.some((entry) => entry.name === name)) throw new Error(`Unknown page screen ${name}`);
  }
  for (const spec of captureScreens.filter((entry) => selected.includes(entry.name))) {
    const screen = spec.name;
    for (const viewport of VIEWPORTS) {
      if (!includesViewport(spec, viewport)) continue;
      for (const mode of ['light']) {
        const id = pageStoryId(screen, viewport.name);
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, colorScheme: mode === 'dark' ? 'dark' : 'light', locale: 'pl-PL', timezoneId: 'UTC', reducedMotion: 'reduce' });
        await applyChrome(context);
        await stubNonDeterministicRequests(context);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date(visualSeedTime));
        const captureStartedAt = Date.now();
        let failure: string | undefined;
        const file = `${screen}--${mode}--${viewport.name}`;
        try {
          await page.goto(`http://${spec.tenantSlug ?? 'studio'}.localhost:${address.port}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'load' });
          await spec.ready(page);
          if (screen !== 'hosted-legal-document') await page.waitForFunction(() => document.documentElement.dataset['fixtureReady'] === 'true');
          await settlePage(page, spec.waitForNetworkIdle ?? true);
          if (spec.settled) {
            await spec.settled(page);
            await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          }
        } catch (error) { failure = String(error); }
        await page.screenshot({ path: join(shots, `${file}.png`), animations: 'disabled', caret: 'hide', scale: 'css' });
        const size = (await stat(join(shots, `${file}.png`))).size;
        const minBytes = spec.minBytes ?? 10 * 1024;
        if (size <= minBytes) failure = [failure, `${file} is only ${size} bytes (expected > ${minBytes})`].filter(Boolean).join('; ');
        const baseline = resolve(`tasks/visual-goldens/${screen}--shadcn--${viewport.name}.png`);
        const diff = join(shots, `${file}-diff.png`);
        let countedPixels: number | undefined;
        const comparison = comparePng({ onCompared: (pixels) => { countedPixels = pixels; }, file, baselinePath: baseline, currentPath: join(shots, `${file}.png`), diffPath: diff, missingBaselineReason: 'Missing golden' });
        const hasBaseline = await stat(baseline).then(() => true, () => false);
        const composition = hasBaseline ? spawnSync('python3', ['-c', 'from PIL import Image\nimport sys\nimages=[Image.open(p).convert("RGB") for p in sys.argv[1:4]]\nout=Image.new("RGB",(sum(i.width for i in images),max(i.height for i in images)),"white")\nx=0\nfor i in images:\n out.paste(i,(x,0)); x+=i.width\nout.save(sys.argv[4])', baseline, join(shots, `${file}.png`), diff, join(shots, `${file}-comparison.png`)], { encoding: 'utf8' }) : undefined;
        if (composition && composition.status !== 0) throw new Error(composition.stderr);
        const diagnostics = await page.evaluate(() => ({ calls: document.documentElement.dataset['fixtureCalls'], missing: document.documentElement.dataset['fixtureErrors'], pending: document.documentElement.dataset['fixturePending'], fetching: document.documentElement.dataset['fixtureFetching'], text: document.body.innerText.slice(0, 2000) }));
        if (failure && diagnostics.fetching !== undefined) failure += `; fetching queries: ${diagnostics.fetching}; held calls: ${diagnostics.pending ?? '[]'}`;
        if (comparison !== null || countedPixels !== 0 || failure || errors.length > 0 || (diagnostics.missing !== undefined && diagnostics.missing !== '[]') || diagnostics.text.includes('Something went wrong!')) process.exitCode = 1;
        const fixturePath = resolve(`apps/web/src/stories/fixtures/${screen}.json`);
        const fixtureSha256 = createHash('sha256').update(await readFile(fixturePath)).digest('hex');
        const result = { fixturePath, fixtureSha256, baseline, file, id, mode, viewport, milliseconds: Date.now() - captureStartedAt, comparison: comparison?.reason ?? `${String(countedPixels)} px differ`, countedPixels, byteIdentical: hasBaseline && (await readFile(baseline)).equals(await readFile(join(shots, `${file}.png`))), failure, errors, diagnostics };
        measurements.push(result);
        writeFileSync(join(output, 'measurements.json'), JSON.stringify({ browserVersion, milliseconds: Date.now() - startedAt, measurements }, null, 2));
        console.log(JSON.stringify(result));
        await context.close();
      }
    }
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
