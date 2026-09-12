import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { pageScreens } from './storybook-page-screens.js';
import { includesViewport, repaintForStableAntialiasing, VIEWPORTS, type AntialiasRepaint, type ScreenSpec } from './visual-screen-inventory.js';

const screen = (auth: ScreenSpec['auth'], name = 'screen'): ScreenSpec => ({
  name,
  auth,
  path: '/',
  ready: async () => undefined,
});

const repaintProbe = (matched: boolean): { steps: AntialiasRepaint; trace: string[] } => {
  const trace: string[] = [];
  const steps: AntialiasRepaint = {
    waitForTarget: async () => {
      trace.push('waitForTarget');
      if (!matched) throw new Error('locator.waitFor: Timeout 20000ms exceeded');
    },
    setHidden: async (hidden) => {
      trace.push(hidden ? 'hide' : 'show');
    },
    repaint: async () => {
      trace.push('paint');
    },
  };
  return { steps, trace };
};

describe('capture viewport selection', () => {
  it('registers each marketing directory page for desktop and mobile capture', () => {
    for (const name of ['panel-marketing-contacts', 'panel-marketing-lists', 'panel-marketing-contact-import']) {
      const spec = pageScreens.find((entry) => entry.name === name);
      expect(spec).toBeDefined();
      if (spec) expect(VIEWPORTS.filter((viewport) => includesViewport(spec, viewport)).map((viewport) => viewport.name)).toEqual(['desktop', 'mobile']);
    }
  });
  it.each([
    ['public', 'screen', ['desktop', 'mobile']],
    ['creator', 'screen', ['desktop', 'mobile']],
    ['member', 'screen', ['desktop', 'mobile', 'mobile-375']],
    ['member-free', 'screen', ['desktop', 'mobile', 'mobile-375']],
    ['public', 'checkout', ['desktop', 'mobile', 'mobile-375']],
  ] satisfies [ScreenSpec['auth'], string, string[]][])('captures %s %s at its supported widths', (auth, name, expected) => {
    expect(VIEWPORTS.filter((viewport) => includesViewport(screen(auth, name), viewport)).map((viewport) => viewport.name)).toEqual(expected);
  });

  it('restricts a mobile-only interaction even for members', () => {
    const spec: ScreenSpec = { ...screen('member'), viewports: ['mobile'] };
    expect(VIEWPORTS.filter((viewport) => includesViewport(spec, viewport)).map((viewport) => viewport.name)).toEqual(['mobile']);
  });
});

describe('antialias repaint', () => {
  it('fails the capture when the repainted target never appears', async () => {
    const probe = repaintProbe(false);
    await expect(repaintForStableAntialiasing(probe.steps)).rejects.toThrow('Timeout');
    expect(probe.trace).toEqual(['waitForTarget']);
  });

  it('re-rasters the target only after it is visible', async () => {
    const probe = repaintProbe(true);
    await repaintForStableAntialiasing(probe.steps);
    expect(probe.trace).toEqual(['waitForTarget', 'hide', 'paint', 'show', 'paint']);
  });

  it('keeps the repainted testids in sync with the components that render them', async () => {
    const [imageField, courseDetail, anonSidebar] = await Promise.all([
      readFile('apps/web/src/components/ui/ImageAssetField.tsx', 'utf8'),
      readFile('apps/web/src/features/home/courses/CourseDetail.tsx', 'utf8'),
      readFile('apps/web/src/features/member/shell/AnonSidebar.tsx', 'utf8'),
    ]);
    expect(imageField).toContain('data-testid={`${testId}-upload`}');
    expect(courseDetail).toContain('testId="course-image"');
    expect(anonSidebar).toContain('data-testid="anon-sidebar"');
  });
});
