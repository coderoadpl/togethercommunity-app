import type { Theme } from '@mui/material/styles';

import type { TenantBranding } from '@core/domain/index.js';

/**
 * Branding is a thin token overlay on the theme system, never a theme fork:
 * a tenant accent replaces the palette primary of an already-built mode theme
 * and everything else stays untouched. Without an accent the input theme is
 * returned as-is (same reference), so unbranded tenants keep today's look
 * byte-for-byte.
 */

const hexChannel = (hex: string, offset: number): number =>
  Number.parseInt(hex.slice(offset + 1, offset + 3), 16);

const linearChannel = (value: number): number => {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex: string): number =>
  0.2126 * linearChannel(hexChannel(hex, 0)) +
  0.7152 * linearChannel(hexChannel(hex, 2)) +
  0.0722 * linearChannel(hexChannel(hex, 4));

/** WCAG contrast ratio between two #RRGGBB colors, 1..21. */
export const contrastRatio = (a: string, b: string): number => {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
};

const mix = (hex: string, target: string, weight: number): string => {
  const blended = [0, 2, 4].map((offset) => {
    const from = hexChannel(hex, offset);
    const to = hexChannel(target, offset);
    return Math.round(from + (to - from) * weight)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${blended.join('')}`;
};

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#111111';

export interface BrandPalette {
  main: string;
  dark: string;
  light: string;
  contrastText: string;
}

const AA_MIN = 4.5;

/**
 * Text on the accent picks whichever of white/near-black clears the higher
 * WCAG ratio, and mid-tone accents are nudged away from the text color until
 * the pair clears AA (4.5:1) — mirroring how createPlainTheme darkens its
 * hue-derived accent. Hover ("dark") shifts further in the same direction,
 * falling back to lightening if that would drop the hover pair under AA.
 */
export const deriveBrandPalette = (accentColor: string): BrandPalette => {
  const contrastText =
    contrastRatio(accentColor, LIGHT_TEXT) >= contrastRatio(accentColor, DARK_TEXT)
      ? LIGHT_TEXT
      : DARK_TEXT;
  const away = contrastText === LIGHT_TEXT ? '#000000' : '#ffffff';
  let main = accentColor;
  for (let step = 0; step < 24 && contrastRatio(main, contrastText) < AA_MIN; step += 1) {
    main = mix(main, away, 0.08);
  }
  const deepened = mix(main, '#000000', 0.18);
  const dark = contrastRatio(deepened, contrastText) >= AA_MIN ? deepened : mix(main, '#ffffff', 0.18);
  return {
    main,
    dark,
    light: mix(main, '#ffffff', 0.18),
    contrastText,
  };
};

export const applyBranding = (theme: Theme, branding: TenantBranding | null | undefined): Theme => {
  if (branding === null || branding === undefined || branding.accentColor === null) return theme;
  const primary = deriveBrandPalette(branding.accentColor);
  return {
    ...theme,
    focusRing: primary.main,
    palette: {
      ...theme.palette,
      primary: { ...theme.palette.primary, ...primary },
    },
  };
};
