import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const harness = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'visual-screenshots.ts'),
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
  });

  it('settles the page before every capture', () => {
    expect(harness).toContain("page.waitForLoadState('networkidle')");
    expect(harness).toContain('document.fonts.ready');
    expect(harness).toContain('animation: none !important');
    expect(harness).toContain('transition: none !important');
  });

  it('captures exact stable pixels', () => {
    expect(harness).toContain("animations: 'disabled'");
    expect(harness).toContain("caret: 'hide'");
    expect(harness).toContain("scale: 'css'");
    expect(harness).toContain('const PIXELMATCH_THRESHOLD = 0;');
    expect(harness).toContain('const MAX_DIFF_RATIO = 0;');
  });

  it('restricts golden authoring to the declared platform', () => {
    expect(harness).toContain("const goldenAuthoringPlatform = 'darwin';");
    expect(harness).toContain('process.platform !== goldenAuthoringPlatform');
  });
});
