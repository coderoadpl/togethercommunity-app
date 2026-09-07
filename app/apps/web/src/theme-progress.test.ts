import { describe, expect, it } from 'vitest';

import { contrastRatio, deriveBrandPalette, toHex } from './theme-branding.js';
import { progressTokens } from './theme-progress.js';
import { createThemeForMode, MODES } from './theme.js';

const NON_TEXT_MIN = 3;

const schemes = ['light', 'dark'] as const;

describe('progress tokens', () => {
  it('keeps the track outline and the fill above the non-text contrast floor in every theme', () => {
    for (const mode of MODES) {
      for (const scheme of schemes) {
        const where = `${mode.id}/${scheme}`;
        const theme = createThemeForMode(mode.id, undefined, scheme);
        const surface = toHex(theme.palette.background.paper);
        const tokens = progressTokens(surface, theme.palette.primary.main);

        expect([where, contrastRatio(tokens.border, surface) >= NON_TEXT_MIN]).toEqual([where, true]);
        expect([where, contrastRatio(tokens.fill, tokens.track) >= NON_TEXT_MIN]).toEqual([where, true]);
        expect([where, tokens.track === surface]).toEqual([where, false]);
      }
    }
  });

  it('keeps a tenant accent legible against the track it fills', () => {
    const accents = ['#E8682A', '#1B1A18', '#FFFFFF', '#7B61FF', '#FFC42B'];

    for (const scheme of schemes) {
      const theme = createThemeForMode('shadcn', undefined, scheme);
      const surface = theme.palette.background.paper;
      for (const accent of accents) {
        const brand = deriveBrandPalette(accent, scheme);
        const tokens = progressTokens(surface, brand.main);
        expect([accent, contrastRatio(tokens.fill, tokens.track) >= NON_TEXT_MIN]).toEqual([
          accent,
          true,
        ]);
      }
    }
  });

  it('reads an accent written in the space-separated CSS Color 4 syntax', () => {
    const tokens = progressTokens('#faf9f7', 'hsl(24 62% 42%)');

    expect(tokens.fill).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(tokens.fill, tokens.track)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });

  it('rejects a color it cannot parse instead of scoring it as passing', () => {
    expect(() => progressTokens('rgb(a, b, c)', '#E8682A')).toThrow(/Unsupported color/);
  });
});
