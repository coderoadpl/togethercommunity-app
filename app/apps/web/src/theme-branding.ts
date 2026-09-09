import { decomposeColor, hslToRgb, type PaletteMode, type Theme } from '@mui/material/styles';

import { contrastRatio, relativeLuminance, deriveLightAccent, type TenantBranding } from '#core/domain/index.js';

export { contrastRatio };

const CSS_COLOR_4 = /^(rgba?|hsla?)\(\s*([^,]+?)\s*\)$/;

/**
 * MUI's color parser only accepts the comma-separated legacy syntax and answers
 * NaN — never an error — for the space-separated CSS Color 4 form the themes
 * use, so every ratio computed from it would silently pass any floor.
 */
export const toHex = (color: string): string => {
  const [, fn, spaced] = CSS_COLOR_4.exec(color) ?? [];
  const normalized = fn === undefined || spaced === undefined
    ? color
    : `${fn}(${spaced.replaceAll('/', ' ').trim().split(/\s+/).join(', ')})`;
  const decomposed = decomposeColor(
    normalized.startsWith('hsl') ? hslToRgb(normalized) : normalized,
  );
  const channels = decomposed.values.slice(0, 3);
  if (!decomposed.type.startsWith('rgb') || channels.some(Number.isNaN)) {
    throw new Error(`Unsupported color for contrast math: ${color}`);
  }
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
};

const hexChannel = (hex: string, offset: number): number =>
  Number.parseInt(hex.slice(offset + 1, offset + 3), 16);

export const mix = (hex: string, target: string, weight: number): string => {
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
const NON_TEXT_MIN = 3;
const DARK_BACKGROUND = '#101113';
const DARK_SURFACE = '#17181B';

export const nudgeToward = (
  color: string,
  target: string,
  background: string,
  minimum: number,
): string => {
  let result = color;
  for (let step = 0; step < 24 && contrastRatio(result, background) < minimum; step += 1) {
    result = mix(result, target, 0.08);
  }
  return result;
};

const accentFillStates = (main: string, ink: string): { hover: string; active: string } => {
  const away = ink === LIGHT_TEXT ? '#000000' : '#ffffff';
  const toward = ink === LIGHT_TEXT ? '#ffffff' : '#000000';
  const target = contrastRatio(main, mix(main, away, 0.26)) >= 1.1
    || contrastRatio(mix(main, toward, 0.26), ink) < AA_MIN ? away : toward;
  return { hover: mix(main, target, 0.14), active: mix(main, target, 0.26) };
};

export const deriveBrandPalette = (
  accentColor: string,
  scheme: PaletteMode = 'light',
): BrandPalette => {
  if (scheme === 'dark') {
    let main = nudgeToward(accentColor, '#ffffff', DARK_BACKGROUND, NON_TEXT_MIN);
    for (
      let step = 0;
      step < 24
      && Math.max(contrastRatio(main, LIGHT_TEXT), contrastRatio(main, DARK_TEXT)) < AA_MIN;
      step += 1
    ) {
      main = mix(main, '#ffffff', 0.08);
    }
    const dark = nudgeToward(accentColor, '#ffffff', DARK_SURFACE, AA_MIN);
    const contrastText =
      contrastRatio(main, LIGHT_TEXT) >= contrastRatio(main, DARK_TEXT)
        ? LIGHT_TEXT
        : DARK_TEXT;
    return {
      main,
      dark,
      light: accentFillStates(main, contrastText).hover,
      contrastText,
    };
  }
  const contrastText =
    contrastRatio(accentColor, LIGHT_TEXT) >= contrastRatio(accentColor, DARK_TEXT)
      ? LIGHT_TEXT
      : DARK_TEXT;
  const away = contrastText === LIGHT_TEXT ? '#000000' : '#ffffff';
  let main = accentColor;
  for (let step = 0; step < 24 && contrastRatio(main, contrastText) < AA_MIN; step += 1) {
    main = mix(main, away, 0.08);
  }
  const states = accentFillStates(main, contrastText);
  return {
    main,
    dark: states.active,
    light: states.hover,
    contrastText,
  };
};

/** Keeps rings, outlines and accent ink legible whatever accent a tenant picks. */
export const accentOnSurface = (
  accent: string,
  background: string,
  minimum: number = NON_TEXT_MIN,
): string => {
  const hexAccent = /^#[0-9a-f]{6}$/i.test(accent) ? accent : toHex(accent);
  const hexBackground = toHex(background);
  return nudgeToward(hexAccent, relativeLuminance(hexBackground) > 0.5 ? '#000000' : '#ffffff', hexBackground, minimum);
};

const accentTextOn = (accent: string, background: string): string =>
  accentOnSurface(accent, background, AA_MIN);

const hexByte = (value: number): string =>
  Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');

export const hslToHex = (hue: number, saturation: number, lightness: number): string => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const rgb = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][sector] ?? [0, 0, 0];
  return `#${rgb.map((channel) => hexByte((channel + offset) * 255)).join('')}`;
};

/** Same name, same colour, forever — a tenant without an accent still gets a stable cover. */
export const deterministicAccent = (seed: string): string => {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 360;
  return hslToHex(hash, 0.55, 0.45);
};

export interface AccentGradient {
  from: string;
  to: string;
  ink: string;
}

/**
 * Two stops out of one accent, plus the label ink. The title sitting on the
 * gradient is normal-size text, so both stops are pushed away from the ink
 * until the darker of the two clears AA — the same loop `deriveBrandPalette`
 * runs on the accent fill.
 */
export const accentGradient = (accent: string): AccentGradient => {
  const worstOf = (text: string, first: string, second: string): number =>
    Math.min(contrastRatio(text, first), contrastRatio(text, second));
  let from = mix(accent, '#ffffff', 0.18);
  let to = mix(accent, '#000000', 0.3);
  const ink = worstOf(LIGHT_TEXT, from, to) >= worstOf(DARK_TEXT, from, to) ? LIGHT_TEXT : DARK_TEXT;
  const away = ink === LIGHT_TEXT ? '#000000' : '#ffffff';
  for (let step = 0; step < 24 && worstOf(ink, from, to) < AA_MIN; step += 1) {
    from = mix(from, away, 0.08);
    to = mix(to, away, 0.08);
  }
  return { from, to, ink };
};

/** Focus lands on the page and inside cards, so the ring has to clear both. */
const focusRingFor = (accent: string, theme: Theme): string =>
  accentOnSurface(
    accentOnSurface(accent, theme.palette.background.default),
    theme.palette.background.paper,
  );

const withAccentTokens = (theme: Theme): Theme => ({
  ...theme,
  accentInk: theme.palette.primary.contrastText,
  accentText: accentTextOn(
    accentTextOn(theme.palette.primary.main, theme.palette.background.default),
    theme.palette.background.paper,
  ),
});

export const applyBranding = (theme: Theme, branding: TenantBranding | null | undefined): Theme => {
  const configuredAccent = theme.palette.mode === 'light'
    ? branding?.accentLight ?? branding?.accentColor
    : branding?.accentColor;
  if (configuredAccent === null || configuredAccent === undefined) return withAccentTokens(theme);
  const accent = theme.palette.mode === 'light' && branding?.accentLight == null
    ? deriveLightAccent(configuredAccent, [
      toHex(theme.palette.background.default), toHex(theme.palette.background.paper),
      ...(/^#[0-9a-f]{6}$/i.test(theme.palette.action.hover) ? [theme.palette.action.hover] : []),
    ])
    : configuredAccent;
  const primary = deriveBrandPalette(accent, theme.palette.mode);
  const states = accentFillStates(primary.main, primary.contrastText);
  return withAccentTokens({
    ...theme,
    focusRing: focusRingFor(primary.main, theme),
    brandAccent: primary.main,
    emberCta: { main: primary.main, hover: states.hover, active: states.active, contrastText: primary.contrastText },
    ...(theme.primaryActive === undefined ? {} : { primaryActive: states.active }),
    palette: {
      ...theme.palette,
      primary: { ...theme.palette.primary, ...primary },
    },
  });
};
