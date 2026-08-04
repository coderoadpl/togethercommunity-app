import { describe, expect, it } from 'vitest';

import type { TenantBranding } from '#core/domain/index.js';

import { applyBranding, contrastRatio, deriveBrandPalette } from './theme-branding.js';
import { createThemeForMode, MODES } from './theme.js';

const ACCENT = '#0E7490';

const branding = (accentColor: string | null): TenantBranding => ({
  logoUrl: null,
  accentColor,
  faviconUrl: null,
});

describe('applyBranding', () => {
  it('returns the untouched theme instance for every mode when there is no branding', () => {
    for (const mode of MODES) {
      const theme = createThemeForMode(mode.id);
      expect(applyBranding(theme, null)).toBe(theme);
      expect(applyBranding(theme, undefined)).toBe(theme);
      expect(applyBranding(theme, branding(null))).toBe(theme);
    }
  });

  it('propagates the accent into the palette primary of every mode', () => {
    const derived = deriveBrandPalette(ACCENT);
    for (const mode of MODES) {
      const theme = createThemeForMode(mode.id);
      const branded = applyBranding(theme, branding(ACCENT));
      expect(branded).not.toBe(theme);
      expect(branded.palette.primary.main).toBe(derived.main);
      expect(branded.palette.primary.dark).toBe(derived.dark);
      expect(branded.palette.primary.contrastText).toBe(derived.contrastText);
      if (mode.id === 'shadcn') {
        expect(branded.palette.secondary).toMatchObject(derived);
        expect(branded.primaryActive).toBe(derived.light);
      } else {
        expect(branded.palette.secondary).toBe(theme.palette.secondary);
        expect(branded.primaryActive).toBeUndefined();
      }
    }
  });

  it('leaves non-accent theme tokens untouched', () => {
    for (const mode of MODES) {
      const theme = createThemeForMode(mode.id);
      const branded = applyBranding(theme, branding(ACCENT));
      expect(branded.typography).toBe(theme.typography);
      expect(branded.components).toBe(theme.components);
      expect(branded.shape).toBe(theme.shape);
      expect(branded.palette.background).toBe(theme.palette.background);
    }
  });

  it('keeps a directly usable accent as-is', () => {
    expect(deriveBrandPalette(ACCENT).main).toBe(ACCENT);
  });

  it('tints the focus-ring token with the accent so default-theme focus states show it', () => {
    const theme = createThemeForMode('shadcn');
    const derived = deriveBrandPalette(ACCENT);
    expect(theme.focusRing).toBeDefined();
    expect(applyBranding(theme, branding(ACCENT)).focusRing).toBe(derived.main);
    expect(theme.focusRing).not.toBe(derived.main);
  });
});

describe('deriveBrandPalette', () => {
  it('derives an AA-compliant text and hover pair for any accent', () => {
    const accents = [ACCENT, '#FFC42B', '#FF5A36', '#808080', '#000000', '#ffffff', '#B3261E', '#1C8A5A'];
    for (const accent of accents) {
      const palette = deriveBrandPalette(accent);
      expect(contrastRatio(palette.main, palette.contrastText)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.dark, palette.contrastText)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks white text on dark accents and dark text on light accents', () => {
    expect(deriveBrandPalette('#000000').contrastText).toBe('#ffffff');
    expect(deriveBrandPalette('#ffffff').contrastText).toBe('#111111');
  });

  it('derives visible fills and links against dark Together surfaces', () => {
    const accents = [ACCENT, '#000000', '#172554', '#B3261E', '#1C8A5A'];
    for (const accent of accents) {
      const palette = deriveBrandPalette(accent, 'dark');
      expect(contrastRatio(palette.main, '#141210')).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.dark, '#1E1B18')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.main, palette.contrastText)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses dark derivation when branding a dark theme', () => {
    const theme = createThemeForMode('shadcn', undefined, 'dark');
    const branded = applyBranding(theme, branding('#172554'));
    expect(branded.palette.primary).toMatchObject(deriveBrandPalette('#172554', 'dark'));
  });
});
