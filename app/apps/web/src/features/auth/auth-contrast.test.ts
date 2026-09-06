import type { CSSObject, PaletteMode } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import type { TenantBranding } from '#core/domain/index.js';

import { applyBranding, contrastRatio, deriveBrandPalette } from '../../theme-branding.js';
import { createThemeForMode } from '../../theme.js';
import { AUTH_BACKGROUND, AUTH_BORDER, authFocusScope, authLinkInk, authRing } from './auth-chrome.js';

const SCHEMES: PaletteMode[] = ['light', 'dark'];
const NON_TEXT_MIN = 3;
const AA_MIN = 4.5;

const ACCENTS = ['#E2632B', '#F5C842', '#4F46E5', '#0F766E', '#E8682A', '#111111', '#FFFFFF'];

const brandedTheme = (accentColor: string, scheme: PaletteMode) => {
  const branding: TenantBranding = {
    logoUrl: null,
    logoDarkUrl: null,
    accentColor,
    faviconUrl: null,
  };
  return applyBranding(createThemeForMode('shadcn', undefined, scheme), branding);
};

const ringColorsOf = (style: CSSObject): string[] =>
  JSON.stringify(style).match(/#[0-9a-f]{6}/giu) ?? [];

const surfaceTextColors = (scheme: PaletteMode): Record<string, string> => {
  const { text } = createThemeForMode('shadcn', undefined, scheme).palette;
  return { primary: text.primary, secondary: text.secondary };
};

describe('auth surface contrast', () => {
  it.each(SCHEMES)('reads every %s surface text colour at AA against the surface', (scheme) => {
    for (const [name, color] of Object.entries(surfaceTextColors(scheme))) {
      expect([name, contrastRatio(color, AUTH_BACKGROUND[scheme]) >= AA_MIN]).toEqual([name, true]);
    }
  });

  it.each(SCHEMES)('keeps the %s input border perceivable against the surface', (scheme) => {
    expect(contrastRatio(AUTH_BORDER[scheme], AUTH_BACKGROUND[scheme])).toBeGreaterThanOrEqual(
      NON_TEXT_MIN,
    );
  });

  it.each(SCHEMES)('clears the focus ring against the %s surface for any accent', (scheme) => {
    for (const accent of ACCENTS) {
      const ring = authRing(deriveBrandPalette(accent, scheme).main, scheme);
      expect([accent, contrastRatio(ring, AUTH_BACKGROUND[scheme]) >= NON_TEXT_MIN]).toEqual([
        accent,
        true,
      ]);
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
    for (const accent of ACCENTS) {
      const colors = ringColorsOf(authFocusScope(brandedTheme(accent, scheme)));
      expect([accent, colors.length]).toEqual([accent, 3]);
      for (const color of colors) {
        expect([accent, contrastRatio(color, AUTH_BACKGROUND[scheme]) >= NON_TEXT_MIN]).toEqual([
          accent,
          true,
        ]);
      }
    }
  });

  it.each(SCHEMES)('reads accent link ink at AA against the %s surface', (scheme) => {
    for (const accent of ACCENTS) {
      const ink = authLinkInk(deriveBrandPalette(accent, scheme).main, scheme);
      expect([accent, contrastRatio(ink, AUTH_BACKGROUND[scheme]) >= AA_MIN]).toEqual([
        accent,
        true,
      ]);
    }
  });

  it.each(SCHEMES)('labels the %s call to action against its own fill', (scheme) => {
    for (const accent of ACCENTS) {
      const { main, contrastText } = deriveBrandPalette(accent, scheme);
      expect([accent, contrastRatio(main, contrastText) >= AA_MIN]).toEqual([accent, true]);
    }
  });
});
