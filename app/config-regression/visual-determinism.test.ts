import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const harness = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'visual-screenshots.ts'),
  'utf8',
);
const browserSetup = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'visual-browser-setup.ts'),
  'utf8',
);
const storybookCapture = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'storybook-capture.ts'),
  'utf8',
);
const requestPolicy = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'visual-request-policy.ts'),
  'utf8',
);
const comparator = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'visual-png-compare.ts'),
  'utf8',
);

describe('visual regression determinism', () => {
  it('pins browser rendering inputs', () => {
    expect(browserSetup).toContain("colorScheme: 'light'");
    expect(browserSetup).toContain("locale: 'pl-PL'");
    expect(browserSetup).toContain("timezoneId: 'UTC'");
    expect(browserSetup).toContain("reducedMotion: 'reduce'");
    expect(browserSetup).toContain('deviceScaleFactor: 1');
    expect(browserSetup).toContain('page.clock.setFixedTime(new Date(visualSeedTime))');
    for (const capture of [harness, storybookCapture]) {
      expect(capture).toContain('await createVisualCapture(browser, viewport');
      expect(capture).not.toContain('page.clock.setFixedTime');
      expect(capture).not.toContain('timezoneId:');
    }
    expect(harness).toContain("{ APP_COMMIT_SHA: '' }");
  });

  it('pins the native macOS date controls independently of JavaScript emulation', () => {
    const workflow = readFileSync(join(import.meta.dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    const nativeLocale = 'defaults write NSGlobalDomain AppleLocale -string en_PL';
    expect(workflow).toContain(nativeLocale);
    expect(workflow).toContain('defaults write NSGlobalDomain AppleLanguages -array en-PL');
    expect(workflow).toContain('defaults write NSGlobalDomain AppleICUForce24HourTime -bool true');
    expect(workflow.indexOf(nativeLocale)).toBeLessThan(workflow.indexOf('- run: pnpm run visual\n'));
  });

  it('settles the page before every capture', () => {
    for (const capture of [harness, storybookCapture]) {
      expect(capture).toContain("from './visual-browser-setup.js'");
      expect(capture).toContain('await settlePage(page');
    }
    expect(browserSetup).toContain('await applyChrome(context)');
    expect(browserSetup).toContain("Object.defineProperty(window, 'EventSource'");
    expect(browserSetup).toContain("page.waitForLoadState('networkidle')");
    expect(browserSetup).toContain('document.fonts.ready');
    expect(browserSetup).toContain('animation: none !important');
    expect(browserSetup).toContain('transition: none !important');
    expect(browserSetup).toContain('const nativeFrame = window.requestAnimationFrame.bind(window)');
    expect(browserSetup).toContain("window.addEventListener('visual:paint-request'");
    for (const capture of [harness, storybookCapture]) expect(capture).toContain('await waitForPaint(page)');
  });

  it('shares the request policy across capture paths', () => {
    for (const capture of [harness, storybookCapture]) {
      expect(capture).not.toContain('context.route(');
    }
    expect(browserSetup).toContain("from './visual-request-policy.js'");
    expect(browserSetup).toContain('await stubNonDeterministicRequests(context)');
    expect(browserSetup).toContain('const policy = visualRequestPolicy(');
    expect(requestPolicy).toContain('API_PATHS.studentLastViewed');
    expect(requestPolicy).toContain('API_PATHS.spaceSeen');
  });

  it('uses the shared screen inventory and viewport policy', () => {
    for (const capture of [harness, storybookCapture]) {
      expect(capture).toContain("from './visual-screen-inventory.js'");
      expect(capture).toContain('includesViewport(');
    }
    const storybookScreens = readFileSync(join(import.meta.dirname, '..', 'scripts', 'storybook-page-screens.ts'), 'utf8');
    expect(storybookScreens).toContain("from './visual-screen-inventory.js'");
    expect(storybookScreens).not.toContain('ready:');
    expect(storybookScreens).not.toContain('settled:');
    expect(storybookCapture).not.toContain('pageScreens.push(');
  });

  it('captures stable pixels with a bounded antialias tolerance', () => {
    expect(harness).toContain("animations: 'disabled'");
    expect(harness).toContain("caret: 'hide'");
    expect(harness).toContain("scale: 'css'");
    expect(harness).toContain('mask: stableMasks(page, screen)');
    expect(harness).not.toContain("page.getByTestId('build-stamp')");
    expect(storybookCapture).toContain("from './visual-png-compare.js'");
    expect(comparator).toContain('{ threshold: 0, includeAA: false }');
    expect(comparator).toContain('const maxDiffPixels = 10;');
    expect(comparator).toContain('if (mismatched <= maxDiffPixels) return null;');
  });

  it('restricts golden authoring to the declared platform', () => {
    expect(storybookCapture).toContain("const goldenAuthoringPlatform = 'darwin';");
    expect(storybookCapture).toContain('process.platform !== goldenAuthoringPlatform');
  });
});
