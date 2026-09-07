import { describe, expect, it } from 'vitest';

import type { TenantBranding } from '#core/domain/index.js';

import {
  accentGradient,
  accentOnSurface,
  applyBranding,
  contrastRatio,
  deriveBrandPalette,
  deterministicAccent,
} from './theme-branding.js';
import { createThemeForMode, MODES } from './theme.js';

const ACCENT = '#0E7490';
const ACCENTS = [ACCENT, '#F5C842', '#4F46E5', '#E8682A', '#000000', '#ffffff'];
const SCHEMES = ['light', 'dark'] as const;
const SURFACES = ['member', 'studio'] as const;
const AA_MIN = 4.5;
const NON_TEXT_MIN = 3;

const branding = (accentColor: string | null): TenantBranding => ({
  logoUrl: null,
  logoDarkUrl: null,
  accentColor,
  faviconUrl: null,
});

describe('applyBranding', () => {
  it('leaves the palette alone for every mode when there is no branding', () => {
    for (const mode of MODES) {
      const theme = createThemeForMode(mode.id);
      for (const unbranded of [null, undefined, branding(null)]) {
        const result = applyBranding(theme, unbranded);
        expect(result.palette).toBe(theme.palette);
        expect(result.focusRing).toBe(theme.focusRing);
        expect(result.accentInk).toBe(theme.palette.primary.contrastText);
      }
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
      expect(branded.palette.secondary).toBe(theme.palette.secondary);
      expect(branded.primaryActive).toBe(mode.id === 'shadcn' ? derived.light : undefined);
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

  it('flags the tenant accent only when one was supplied', () => {
    const theme = createThemeForMode('shadcn');
    expect(theme.brandAccent).toBeUndefined();
    expect(applyBranding(theme, branding(null)).brandAccent).toBeUndefined();
    expect(applyBranding(theme, branding(ACCENT)).brandAccent).toBe(deriveBrandPalette(ACCENT).main);
  });

  it('tints the focus-ring token with the accent so default-theme focus states show it', () => {
    const theme = createThemeForMode('shadcn');
    const derived = deriveBrandPalette(ACCENT);
    expect(theme.focusRing).toBeDefined();
    expect(applyBranding(theme, branding(ACCENT)).focusRing).toBe(
      accentOnSurface(derived.main, theme.palette.background.default),
    );
    expect(theme.focusRing).not.toBe(derived.main);
  });

  it('keeps the focus ring perceivable on the page and inside cards for any accent', () => {
    for (const scheme of SCHEMES) {
      for (const surface of SURFACES) {
        const theme = createThemeForMode('shadcn', undefined, scheme, surface);
        for (const accent of ACCENTS) {
          const ring = applyBranding(theme, branding(accent)).focusRing ?? '';
          const where = `${scheme}/${surface}/${accent}`;
          expect([where, contrastRatio(ring, theme.palette.background.default) >= NON_TEXT_MIN])
            .toEqual([where, true]);
          expect([where, contrastRatio(ring, theme.palette.background.paper) >= NON_TEXT_MIN])
            .toEqual([where, true]);
        }
      }
    }
  });

  it('moves the accent onto primary on the member and the creator surface alike', () => {
    for (const scheme of SCHEMES) {
      const derived = deriveBrandPalette(ACCENT, scheme);
      for (const surface of SURFACES) {
        const theme = createThemeForMode('shadcn', undefined, scheme, surface);
        const branded = applyBranding(theme, branding(ACCENT));
        expect([surface, branded.palette.primary.main]).toEqual([surface, derived.main]);
        expect([surface, branded.brandAccent]).toEqual([surface, derived.main]);
      }
    }
  });

  it('pairs every accent with a label ink and a page ink that clear AA', () => {
    for (const scheme of SCHEMES) {
      const member = createThemeForMode('shadcn', undefined, scheme, 'member');
      for (const accent of ACCENTS) {
        const branded = applyBranding(member, branding(accent));
        expect([accent, contrastRatio(branded.palette.primary.main, branded.accentInk ?? '') >= AA_MIN])
          .toEqual([accent, true]);
        expect([accent, contrastRatio(branded.accentText ?? '', branded.palette.background.default) >= AA_MIN])
          .toEqual([accent, true]);
      }
    }
  });
});

describe('accentGradient', () => {
  it('reads the cover title at AA on both stops, for any accent a tenant can pick', () => {
    for (const accent of ACCENTS) {
      const { from, to, ink } = accentGradient(accent);
      expect([accent, contrastRatio(ink, from) >= AA_MIN]).toEqual([accent, true]);
      expect([accent, contrastRatio(ink, to) >= AA_MIN]).toEqual([accent, true]);
    }
  });

  it('reads the cover title at AA on every hue the title hash can produce', () => {
    for (let hue = 0; hue < 360; hue += 1) {
      const accent = deterministicAccent(String.fromCodePoint(hue));
      const { from, to, ink } = accentGradient(accent);
      const worst = Math.min(contrastRatio(ink, from), contrastRatio(ink, to));
      expect([hue, worst >= AA_MIN]).toEqual([hue, true]);
    }
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
      expect(contrastRatio(palette.main, '#101113')).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.dark, '#17181B')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.main, palette.contrastText)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses dark derivation when branding a dark theme', () => {
    const theme = createThemeForMode('shadcn', undefined, 'dark');
    const branded = applyBranding(theme, branding('#172554'));
    expect(branded.palette.primary).toMatchObject(deriveBrandPalette('#172554', 'dark'));
  });
});
