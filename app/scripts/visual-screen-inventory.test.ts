import { describe, expect, it } from 'vitest';

import { includesViewport, VIEWPORTS, type ScreenSpec } from './visual-screen-inventory.js';

const screen = (auth: ScreenSpec['auth'], name = 'screen'): ScreenSpec => ({
  name,
  auth,
  path: '/',
  ready: async () => undefined,
});

describe('capture viewport selection', () => {
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
