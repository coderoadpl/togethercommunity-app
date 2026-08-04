import { describe, expect, it } from 'vitest';

import { contrastRatio } from './theme-branding.js';
import { createThemeForMode, type ResolvedColorScheme } from './theme.js';

const expectRatio = (foreground: string, background: string, expected: number): void => {
  expect(contrastRatio(foreground, background)).toBeCloseTo(expected, 2);
};

const themes = {
  light: createThemeForMode('shadcn', undefined, 'light'),
  dark: createThemeForMode('shadcn', undefined, 'dark'),
};

const themeFor = (scheme: ResolvedColorScheme) => themes[scheme];

describe('Together theme contrast', () => {
  it('uses the two-hex ember rule in both schemes', () => {
    const light = themeFor('light');
    const dark = themeFor('dark');

    expect(light.palette.primary.main).toBe('#E8682A');
    expect(light.palette.primary.dark).toBe('#AD440A');
    expect(light.palette.primary.contrastText).toBe('#1C120B');
    expect(dark.palette.primary.main).toBe('#E8682A');
    expect(dark.palette.primary.dark).toBe('#F49A5E');
    expect(dark.palette.primary.contrastText).toBe('#1C120B');
    expectRatio('#1C120B', '#E8682A', 5.65);
  });

  it('uses the flat light disabled-state tokens and the dark opacity mechanism', () => {
    const light = themeFor('light');
    const dark = themeFor('dark');

    expect(light.palette.action.disabled).toBe('#8A8177');
    expect(light.palette.action.disabledBackground).toBe('#EDE8E1');
    expectRatio('#8A8177', '#EDE8E1', 3.14);
    expectRatio('#8A8177', '#FFFFFF', 3.83);
    expect(dark.palette.action.disabled).toBe('#756E66');
    expectRatio('#756E66', '#141210', 3.72);
    expectRatio('#756E66', '#1E1B18', 3.41);
  });

  it('reproduces every light text-token contrast pair', () => {
    const backgrounds = ['#FAF8F5', '#FFFFFF', '#F2EEE8'] as const;
    const cases = [
      ['#1B1613', [16.92, 17.94, 15.52]],
      ['#6A6156', [5.73, 6.07, 5.26]],
      ['#AD440A', [5.49, 5.82, 5.04]],
      ['#147036', [5.83, 6.18, 5.34]],
      ['#C21E1E', [5.66, 6, 5.19]],
      ['#A34D08', [5.47, 5.8, 5.02]],
      ['#0E7490', [5.05, 5.36, 4.64]],
    ] as const;

    for (const [foreground, expected] of cases) {
      backgrounds.forEach((background, index) => {
        expectRatio(foreground, background, expected[index] ?? 0);
      });
    }
    expectRatio('#FFFFFF', '#147036', 6.18);
    expectRatio('#FFFFFF', '#C21E1E', 6);
    expectRatio('#231303', '#D97706', 5.65);
    expectRatio('#FFFFFF', '#0E7490', 5.36);
    expectRatio('#1C120B', '#DA5D22', 4.88);
    expectRatio('#1C120B', '#D8571F', 4.65);
    expectRatio('#E8682A', '#FAF8F5', 3.07);
    expectRatio('#E8682A', '#FFFFFF', 3.26);
    expectRatio('#E8682A', '#F2EEE8', 2.82);
    expectRatio('#AD440A', '#E7E2DA', 4.51);
  });

  it('reproduces every dark text-token contrast pair', () => {
    const backgrounds = ['#141210', '#1E1B18', '#262220'] as const;
    const cases = [
      ['#F4EFE9', [16.35, 14.99, 13.79]],
      ['#A9A29A', [7.41, 6.79, 6.25]],
      ['#F49A5E', [8.57, 7.86, 7.23]],
    ] as const;

    for (const [foreground, expected] of cases) {
      backgrounds.forEach((background, index) => {
        expectRatio(foreground, background, expected[index] ?? 0);
      });
    }
    expectRatio('#55C382', '#141210', 8.47);
    expectRatio('#55C382', '#1E1B18', 7.77);
    expectRatio('#F0857A', '#141210', 7.42);
    expectRatio('#F0857A', '#1E1B18', 6.81);
    expectRatio('#E5A84B', '#141210', 8.93);
    expectRatio('#E5A84B', '#1E1B18', 8.19);
    expectRatio('#85B8DC', '#141210', 8.8);
    expectRatio('#85B8DC', '#1E1B18', 8.07);
    expectRatio('#E8682A', '#141210', 5.74);
    expectRatio('#E8682A', '#1E1B18', 5.26);
    expectRatio('#1C120B', '#EE7B40', 6.61);
    expectRatio('#1B1815', '#F4EFE9', 15.46);
  });
});
