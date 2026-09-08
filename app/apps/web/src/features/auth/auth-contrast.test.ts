import type { CSSObject, PaletteMode, Theme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import type { TenantBranding } from '#core/domain/index.js';

import { applyBranding, contrastRatio } from '../../theme-branding.js';
import { createThemeForMode } from '../../theme.js';
import { authFocusScope } from './auth-chrome.js';

const SCHEMES: PaletteMode[] = ['light', 'dark'];
const NON_TEXT_MIN = 3;
const AA_MIN = 4.5;

const ACCENTS = ['#E2632B', '#F5C842', '#4F46E5', '#0F766E', '#E8682A', '#111111', '#FFFFFF'];

const memberTheme = (scheme: PaletteMode): Theme =>
  createThemeForMode('shadcn', undefined, scheme, 'member');

const brandedTheme = (accentColor: string, scheme: PaletteMode): Theme => {
  const branding: TenantBranding = {
    logoUrl: null,
    logoDarkUrl: null,
    accentColor,
    faviconUrl: null,
  };
  return applyBranding(memberTheme(scheme), branding);
};

/** A tenant without an accent is the common case, so it is the first row of every ring check. */
const brandingCases = (scheme: PaletteMode): [string, Theme][] => [
  ['unbranded', applyBranding(memberTheme(scheme), null)],
  ...ACCENTS.map((accent): [string, Theme] => [accent, brandedTheme(accent, scheme)]),
];

const ringColorsOf = (style: CSSObject): string[] =>
  JSON.stringify(style).match(/#[0-9a-f]{6}/giu) ?? [];

const backgroundOf = (theme: Theme): string => theme.palette.background.default;

describe('auth surface contrast', () => {
  it.each(SCHEMES)('reads every %s surface text colour at AA against the surface', (scheme) => {
    const theme = memberTheme(scheme);
    for (const [name, color] of Object.entries({
      primary: theme.palette.text.primary,
      secondary: theme.palette.text.secondary,
    })) {
      expect([name, contrastRatio(color, backgroundOf(theme)) >= AA_MIN]).toEqual([name, true]);
    }
  });

  it.each(SCHEMES)('keeps the %s input border perceivable against the surface', (scheme) => {
    const theme = memberTheme(scheme);
    expect(contrastRatio(theme.borderInput ?? '', backgroundOf(theme))).toBeGreaterThanOrEqual(
      NON_TEXT_MIN,
    );
  });

  it.each(SCHEMES)('clears the focus ring against the %s surface, branded or not', (scheme) => {
    for (const [label, theme] of brandingCases(scheme)) {
      expect([label, contrastRatio(theme.focusRing ?? '', backgroundOf(theme)) >= NON_TEXT_MIN])
        .toEqual([label, true]);
      expect([label, contrastRatio(theme.focusRing ?? '', theme.palette.background.paper) >= NON_TEXT_MIN])
        .toEqual([label, true]);
    }
  });

  it('rings every focusable descendant, not one component', () => {
    expect(Object.keys(authFocusScope(brandedTheme('#E8682A', 'light')))).toEqual([
      '& .Mui-focusVisible',
      '& .MuiButtonBase-root:focus-visible',
      '& .MuiLink-root:focus-visible',
    ]);
  });

  it.each(SCHEMES)('rings every focused %s control at the non-text minimum', (scheme) => {
    for (const [label, theme] of brandingCases(scheme)) {
      const colors = ringColorsOf(authFocusScope(theme));
      expect([label, colors.length]).toEqual([label, 3]);
      for (const color of colors) {
        expect([label, contrastRatio(color, backgroundOf(theme)) >= NON_TEXT_MIN]).toEqual([
          label,
          true,
        ]);
      }
    }
  });

  it.each(SCHEMES)('reads accent link ink at AA against the %s surface', (scheme) => {
    for (const [label, theme] of brandingCases(scheme)) {
      expect([label, contrastRatio(theme.accentText ?? '', backgroundOf(theme)) >= AA_MIN])
        .toEqual([label, true]);
    }
  });

  it.each(SCHEMES)('labels the %s call to action against its own fill', (scheme) => {
    for (const [label, theme] of brandingCases(scheme)) {
      expect([label, contrastRatio(theme.palette.primary.main, theme.accentInk ?? '') >= AA_MIN])
        .toEqual([label, true]);
    }
  });
});
