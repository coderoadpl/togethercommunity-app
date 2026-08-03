import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const harness = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'visual-screenshots.ts'),
  'utf8',
);
const comparator = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'visual-png-compare.ts'),
  'utf8',
);

describe('visual regression determinism', () => {
  it('pins browser rendering inputs', () => {
    expect(harness).toContain("colorScheme: 'light'");
    expect(harness).toContain("locale: 'pl-PL'");
    expect(harness).toContain("timezoneId: 'UTC'");
    expect(harness).toContain("reducedMotion: 'reduce'");
    expect(harness).toContain('deviceScaleFactor: 1');
    expect(harness).toContain('page.clock.setFixedTime');
    expect(harness).toContain("{ APP_COMMIT_SHA: '' }");
  });

  it('settles the page before every capture', () => {
    expect(harness).toContain("Object.defineProperty(window, 'EventSource'");
    expect(harness).toContain("page.waitForLoadState('networkidle')");
    expect(harness).toContain('document.fonts.ready');
    expect(harness).toContain('animation: none !important');
    expect(harness).toContain('transition: none !important');
  });

  it('captures exact stable pixels', () => {
    expect(harness).toContain("animations: 'disabled'");
    expect(harness).toContain("caret: 'hide'");
    expect(harness).toContain("scale: 'css'");
    expect(harness).toContain('mask: stableMasks(page, screen)');
    expect(harness).toContain("page.getByTestId('build-stamp')");
    expect(harness).toContain("from './visual-png-compare.js'");
    expect(comparator).toContain('{ threshold: 0, includeAA: false }');
    expect(comparator).toContain('if (mismatched === 0) return null;');
  });

  it('restricts golden authoring to the declared platform', () => {
    expect(harness).toContain("const goldenAuthoringPlatform = 'darwin';");
    expect(harness).toContain('process.platform !== goldenAuthoringPlatform');
  });
});
