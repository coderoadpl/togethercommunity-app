import { describe, expect, it } from 'vitest';

import type { Theme } from '@mui/material/styles';

import { contrastRatio } from '#core/domain/index.js';
import {
  BORDER_INPUT,
  createThemeForMode,
  MEMBER_BACKGROUND,
  type ResolvedColorScheme,
} from './theme.js';

const expectRatio = (foreground: string, background: string, expected: number): void => {
  expect(contrastRatio(foreground, background)).toBeCloseTo(expected, 2);
};

const themes = {
  light: createThemeForMode('shadcn', undefined, 'light'),
  dark: createThemeForMode('shadcn', undefined, 'dark'),
};

const memberThemes = {
  light: createThemeForMode('shadcn', undefined, 'light', 'member'),
  dark: createThemeForMode('shadcn', undefined, 'dark', 'member'),
};

const SCHEMES: ResolvedColorScheme[] = ['light', 'dark'];
const MEMBER_CONTROL_MIN_HEIGHT = 48;
const STUDIO_CONTROL_MIN_HEIGHT = 44;
const TOUCH_TARGET_MIN = 44;

const themeFor = (scheme: ResolvedColorScheme) => themes[scheme];

const rootStyleOf = (theme: Theme, component: 'MuiButton' | 'MuiOutlinedInput' | 'MuiIconButton') => {
  const root = theme.components?.[component]?.styleOverrides?.root;
  return typeof root === 'function' ? root({ theme, ownerState: {} }) : root;
};

const inputStyleOf = (theme: Theme) => theme.components?.MuiOutlinedInput?.styleOverrides?.input;

const buttonVariantStyleOf = (theme: Theme, variant: 'contained' | 'outlined' | 'text') => {
  const override = theme.components?.MuiButton?.styleOverrides?.[variant];
  return typeof override === 'function' ? override({ theme, ownerState: {} }) : override;
};

describe('Together theme contrast', () => {
  it('uses neutral primary actions and reserves ember for the checkout CTA and focus ring', () => {
    const light = themeFor('light');
    const dark = themeFor('dark');

    expect(light.palette.primary).toMatchObject({
      main: '#1B1A18',
      light: '#2F2D2A',
      dark: '#1B1A18',
      contrastText: '#FFFFFF',
    });
    expect(dark.palette.primary).toMatchObject({
      main: '#EDEEF0',
      light: '#D9DBDE',
      dark: '#EDEEF0',
      contrastText: '#101113',
    });
    expect(light.primaryActive).toBe('#3B3936');
    expect(dark.primaryActive).toBe('#C9CCD0');
    expect(light.focusRing).toBe('#E8682A');
    expect(dark.focusRing).toBe('#E8682A');
    expect(light.emberCta).toEqual({
      main: '#E8682A',
      hover: '#DA5D22',
      active: '#D8571F',
      contrastText: '#1C120B',
    });
    expect(dark.emberCta).toEqual({
      main: '#E8682A',
      hover: '#EE7B40',
      active: '#EE7B40',
      contrastText: '#1C120B',
    });
  });

  it('uses flat readable disabled-state tokens in both schemes', () => {
    const light = themeFor('light');
    const dark = themeFor('dark');

    expect(light.palette.action.disabled).toBe('#8A8781');
    expect(light.palette.action.disabledBackground).toBe('#ECEBE9');
    expect(dark.palette.action.disabled).toBe('#686C72');
    expect(dark.palette.action.disabledBackground).toBe('#26282D');
    expectRatio('#8A8781', '#ECEBE9', 3.01);
    expectRatio('#686C72', '#26282D', 2.79);
  });

  it('reproduces the quiet-paper contrast pairs', () => {
    const backgrounds = ['#FAFAF9', '#FFFFFF', '#F4F4F2', '#ECEBE9'] as const;
    const cases = [
      ['#1B1A18', [16.65, 17.39, 15.79, 14.60]],
      ['#63615C', [5.92, 6.19, 5.62, 5.19]],
    ] as const;

    for (const [foreground, expected] of cases) {
      backgrounds.forEach((background, index) => {
        expectRatio(foreground, background, expected[index] ?? 0);
      });
    }
    expectRatio('#C21E1E', '#FAFAF9', 5.75);
    expectRatio('#147036', '#FAFAF9', 5.91);
    expectRatio('#A34D08', '#FAFAF9', 5.55);
    expectRatio("#0E7490", '#FAFAF9', 5.13);
    expectRatio('#FFFFFF', '#1B1A18', 17.39);
    expectRatio('#FFFFFF', '#2F2D2A', 13.73);
    expectRatio('#FFFFFF', '#3B3936', 11.51);
    expectRatio('#1C120B', '#E8682A', 5.65);
    expectRatio('#1C120B', '#DA5D22', 4.88);
    expectRatio('#1C120B', '#D8571F', 4.65);
    expectRatio('#E8682A', '#FAFAF9', 3.12);
    expectRatio('#E8682A', '#FFFFFF', 3.26);
  });

  it('reproduces the deep-ink contrast pairs', () => {
    const backgrounds = ['#101113', '#17181B', '#1D1F22', '#26282D'] as const;
    const cases = [
      ['#EDEEF0', [16.27, 15.29, 14.23, 12.70]],
      ['#A0A3A8', [7.47, 7.02, 6.53, 5.83]],
    ] as const;

    for (const [foreground, expected] of cases) {
      backgrounds.forEach((background, index) => {
        expectRatio(foreground, background, expected[index] ?? 0);
      });
    }
    expectRatio('#F0857A', '#101113', 7.50);
    expectRatio('#F0857A', '#17181B', 7.05);
    expectRatio('#55C382', '#101113', 8.56);
    expectRatio('#55C382', '#17181B', 8.04);
    expectRatio('#E5A84B', '#101113', 9.03);
    expectRatio('#E5A84B', '#17181B', 8.48);
    expectRatio('#85B8DC', '#101113', 8.89);
    expectRatio('#85B8DC', '#17181B', 8.36);
    expectRatio('#101113', '#EDEEF0', 16.27);
    expectRatio('#101113', '#D9DBDE', 13.62);
    expectRatio('#101113', '#C9CCD0', 11.72);
    expectRatio('#E8682A', '#101113', 5.80);
    expectRatio('#E8682A', '#17181B', 5.45);
    expectRatio('#16171A', '#EDEEF0', 15.44);
  });
});

describe('member surface foundation', () => {
  it.each(SCHEMES)('gives the %s member page the sign-in surface', (scheme) => {
    expect(memberThemes[scheme].palette.background.default).toBe(MEMBER_BACKGROUND[scheme]);
    expect(memberThemes[scheme].borderInput).toBe(BORDER_INPUT[scheme]);
  });

  it.each(SCHEMES)('perceives the %s input outline against surface and page', (scheme) => {
    const theme = memberThemes[scheme];
    const border = theme.borderInput ?? '';
    expect(contrastRatio(border, theme.palette.background.paper)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(border, theme.palette.background.default)).toBeGreaterThanOrEqual(3);
  });

  it.each(SCHEMES)('perceives the unbranded %s focus ring on the page and on a card', (scheme) => {
    const theme = memberThemes[scheme];
    const ring = theme.focusRing ?? '';
    expect(contrastRatio(ring, theme.palette.background.default)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ring, theme.palette.background.paper)).toBeGreaterThanOrEqual(3);
  });

  it.each(SCHEMES)('sizes every %s member button, input and icon target for touch', (scheme) => {
    const theme = memberThemes[scheme];
    expect(rootStyleOf(theme, 'MuiButton')).toMatchObject({ minHeight: MEMBER_CONTROL_MIN_HEIGHT });
    expect(rootStyleOf(theme, 'MuiOutlinedInput')).toMatchObject({ minHeight: MEMBER_CONTROL_MIN_HEIGHT });
    expect(rootStyleOf(theme, 'MuiIconButton')).toMatchObject({
      minWidth: TOUCH_TARGET_MIN,
      minHeight: TOUCH_TARGET_MIN,
    });
    expect(inputStyleOf(theme)).toMatchObject({ fontSize: '1rem' });
  });
});

describe('studio surface foundation', () => {
  it.each(SCHEMES)('keeps the %s creator page off the member palette', (scheme) => {
    const theme = themeFor(scheme);
    expect(theme.palette.background.default).not.toBe(MEMBER_BACKGROUND[scheme]);
    expect(rootStyleOf(theme, 'MuiButton')).toMatchObject({ padding: '0.5rem 1rem' });
  });

  it.each(SCHEMES)('perceives the %s studio input outline against surface and page', (scheme) => {
    const theme = themeFor(scheme);
    const border = theme.borderInput ?? '';
    expect(border).toBe(BORDER_INPUT[scheme]);
    expect(contrastRatio(border, theme.palette.background.paper)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(border, theme.palette.background.default)).toBeGreaterThanOrEqual(3);
  });

  it.each(SCHEMES)('sizes every %s studio button, input and icon target for touch', (scheme) => {
    const theme = themeFor(scheme);
    expect(rootStyleOf(theme, 'MuiButton')).toMatchObject({ minHeight: STUDIO_CONTROL_MIN_HEIGHT });
    expect(rootStyleOf(theme, 'MuiOutlinedInput')).toMatchObject({ minHeight: STUDIO_CONTROL_MIN_HEIGHT });
    expect(rootStyleOf(theme, 'MuiIconButton')).toMatchObject({
      minWidth: TOUCH_TARGET_MIN,
      minHeight: TOUCH_TARGET_MIN,
    });
    expect(inputStyleOf(theme)).toMatchObject({ fontSize: '1rem' });
  });

  it.each(SCHEMES)('paints %s destructive buttons in the error colour in every variant', (scheme) => {
    const theme = themeFor(scheme);
    const destructive = theme.palette.error.main;

    expect(buttonVariantStyleOf(theme, 'text')).toMatchObject({
      '&.MuiButton-colorError': { color: destructive },
    });
    expect(buttonVariantStyleOf(theme, 'outlined')).toMatchObject({
      '&.MuiButton-colorError': { color: destructive },
    });
    expect(buttonVariantStyleOf(theme, 'contained')).toMatchObject({
      '&.MuiButton-colorError': { backgroundColor: destructive },
    });
    expect(contrastRatio(destructive, theme.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
  });
});
