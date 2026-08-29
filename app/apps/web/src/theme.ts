import type { ElementType } from 'react';
import { Box, Breadcrumbs, Button, ButtonBase, LinearProgress, ListItem, ListItemButton, ListItemText, MenuItem, Paper, Stack, SvgIcon, Typography } from '@mui/material';
import { alpha, createTheme, styled, type Theme } from '@mui/material/styles';

/**
 * The entire "engineer's logbook" visual language lives in this theme:
 * colors, fonts and component overrides. Pages only use MUI components
 * with their stock props/variants, plus `sx` for layout and spacing.
 * The accent hue is derived from the tenant slug, so each tenant gets
 * its own theme instance via a nested ThemeProvider.
 *
 * Values mirror the original hand-written stylesheet 1:1 (pixel-diffed
 * against it); do not "round" them to Material defaults.
 */

const FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace";
const FONT_DISPLAY =
  "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";

declare module '@mui/material/styles' {
  interface Theme {
    headerRule?: string;
    numericFontFamily?: string;
    statusAccent?: string;
    moneyColor?: string;
    primaryActive?: string;
    emberCta?: {
      main: string;
      hover: string;
      active: string;
      contrastText: string;
    };
    /** Focus-ring base color; themes that set it let applyBranding tint focus with the tenant accent. */
    focusRing?: string;
    /** Link ink; themes that leave it unset follow the branding-tinted primary. */
    linkColor?: string;
  }
  interface ThemeOptions {
    headerRule?: string;
    numericFontFamily?: string;
    statusAccent?: string;
    moneyColor?: string;
    primaryActive?: string;
    emberCta?: {
      main: string;
      hover: string;
      active: string;
      contrastText: string;
    };
    focusRing?: string;
    linkColor?: string;
  }
}

const linkInk = (theme: Theme): string => theme.linkColor ?? theme.palette.primary.dark;

const PAPER = '#f6f2ea';
const PAPER_RAISED = '#fdfbf6';
const INK = '#191512';
const INK_SOFT = '#5c5348';
const LINE = 'rgba(25, 21, 18, 0.14)';
const LINE_STRONG = 'rgba(25, 21, 18, 0.55)';

/**
 * MUI picks `contrastText` against a 3:1 floor, which is WCAG AA for large text
 * only; filled chips and buttons render at 12–13px. Raising the floor makes the
 * automatic pick land on dark ink wherever white would fail AA.
 */
const CONTRAST_THRESHOLD = 4.5;

/**
 * Shadcn is the only maintained base theme (owner decision 2026-07-29); the
 * other six stay compiled as unmaintained Storybook-only BYO-theme examples,
 * with Steady Frame as the showcase reference.
 * See docs/decisions/0010-shadcn-base-theme.md.
 */
export const MODES = [
  { id: 'logbook', label: 'Logbook' },
  { id: 'material', label: 'Material' },
  { id: 'quiet-studio', label: 'Quiet Studio' },
  { id: 'scoreboard', label: 'Scoreboard' },
  { id: 'shadcn', label: 'Shadcn' },
  { id: 'signal-mono', label: 'Signal Mono' },
  { id: 'steady-frame', label: 'Steady Frame' },
] as const;

type ThemeModeOption = (typeof MODES)[number];
export type ThemeMode = ThemeModeOption['id'];
export type ResolvedColorScheme = 'light' | 'dark';

/**
 * Stock Material UI look. Only the per-tenant accent carries over as the
 * primary color; h1/h2 are scaled down to page-title sizes (raw MUI h1 is a
 * 6rem display size and would break the layout), everything else is default.
 */
const createPlainTheme = (accentHue?: number): Theme =>
  createTheme({
    palette: {
      contrastThreshold: CONTRAST_THRESHOLD,
      ...(accentHue === undefined
        ? {}
        : {
            // The accent doubles as button text on white and as the AppBar fill;
            // darkened to hsl 70%/28% so both directions clear AA (5.3:1 on white).
            // contrastText is pinned white — at this darkness MUI would otherwise
            // auto-pick near-black, which fails on the accent-filled AppBar.
            primary: {
              main: `hsl(${accentHue} 70% 28%)`,
              dark: `hsl(${accentHue} 74% 22%)`,
              contrastText: '#ffffff',
            },
          }),
    },
    typography: {
      h1: { fontSize: '2.125rem', fontWeight: 400 },
      h2: { fontSize: '1.25rem', fontWeight: 500 },
      button: { textTransform: 'none' },
    },
    components: {
      MuiAlert: {
        defaultProps: {
          severity: 'error',
          variant: 'outlined',
        },
      },
      // The tenant switchers sit inline inside the primary-filled AppBar; their
      // stock dark control text is illegible on the accent, so force solid white
      // (semi-transparent whites do not reach AA on a mid-tone fill).
      MuiAppBar: {
        styleOverrides: {
          colorPrimary: {
            '& .MuiToggleButton-root': { color: '#ffffff' },
            '& .MuiToggleButton-root.Mui-selected': {
              color: '#ffffff',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
            },
            '& .MuiFormLabel-root': { color: '#ffffff' },
            '& .MuiInputBase-input': { color: '#ffffff' },
            '& .MuiSvgIcon-root': { color: '#ffffff' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.6)' },
          },
        },
      },
    },
  });

export const createThemeForMode = (
  mode: ThemeMode,
  accentHue?: number,
  scheme: ResolvedColorScheme = 'light',
): Theme => {
  if (scheme === 'dark') return createShadcnTheme('dark');
  switch (mode) {
    case 'logbook':
      return createAppTheme(accentHue);
    case 'quiet-studio':
      return createQuietStudioTheme();
    case 'scoreboard':
      return createScoreboardTheme();
    case 'shadcn':
      return createShadcnTheme('light');
    case 'signal-mono':
      return createSignalMonoTheme();
    case 'steady-frame':
      return createSteadyFrameTheme();
    case 'material':
      return createPlainTheme(accentHue);
  }
};

const SHADCN_FONT =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SHADCN_FONT_DISPLAY = `'Poppins', ${SHADCN_FONT}`;

interface ShadcnTokens {
  background: string;
  surface: string;
  overlay: string;
  muted: string;
  pressed: string;
  input: string;
  toggleSelected: string;
  ink: string;
  inkSoft: string;
  disabledText: string;
  border: string;
  borderStrong: string;
  ember: string;
  emberHover: string;
  emberActive: string;
  emberInk: string;
  primary: string;
  primaryHover: string;
  primaryActive: string;
  primaryType: string;
  primaryInk: string;
  ring: string;
  destructive: string;
  destructiveDark: string;
  destructiveContrast: string;
  success: string;
  successContrast: string;
  warning: string;
  warningText: string;
  warningContrast: string;
  info: string;
  infoContrast: string;
  shadowXs: string;
  shadowMd: string;
  shadowLg: string;
  tooltipBackground: string;
  tooltipText: string;
}

const SHADCN_LIGHT: ShadcnTokens = {
  background: '#FAFAF9',
  surface: '#FFFFFF',
  overlay: '#FFFFFF',
  muted: '#F4F4F2',
  pressed: '#ECEBE9',
  input: '#FFFFFF',
  toggleSelected: '#FFFFFF',
  ink: '#1B1A18',
  inkSoft: '#63615C',
  disabledText: '#8A8781',
  border: '#E6E5E2',
  borderStrong: '#D6D4D0',
  ember: '#E8682A',
  emberHover: '#DA5D22',
  emberActive: '#D8571F',
  emberInk: '#1C120B',
  primary: '#1B1A18',
  primaryHover: '#2F2D2A',
  primaryActive: '#3B3936',
  primaryType: '#1B1A18',
  primaryInk: '#FFFFFF',
  ring: '#E8682A',
  destructive: '#C21E1E',
  destructiveDark: '#A81A1A',
  destructiveContrast: '#FFFFFF',
  success: '#147036',
  successContrast: '#FFFFFF',
  warning: '#D97706',
  warningText: '#A34D08',
  warningContrast: '#231303',
  info: '#0E7490',
  infoContrast: '#FFFFFF',
  shadowXs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  shadowMd: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  shadowLg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  tooltipBackground: '#1B1A18',
  tooltipText: '#FFFFFF',
};

const SHADCN_DARK: ShadcnTokens = {
  background: '#101113',
  surface: '#17181B',
  overlay: '#1D1F22',
  muted: '#1B1D20',
  pressed: '#26282D',
  input: '#101113',
  toggleSelected: '#26282D',
  ink: '#EDEEF0',
  inkSoft: '#A0A3A8',
  disabledText: '#686C72',
  border: '#26282C',
  borderStrong: '#33363C',
  ember: '#E8682A',
  emberHover: '#EE7B40',
  emberActive: '#EE7B40',
  emberInk: '#1C120B',
  primary: '#EDEEF0',
  primaryHover: '#D9DBDE',
  primaryActive: '#C9CCD0',
  primaryType: '#EDEEF0',
  primaryInk: '#101113',
  ring: '#E8682A',
  destructive: '#F0857A',
  destructiveDark: '#F0857A',
  destructiveContrast: '#2A0F0B',
  success: '#55C382',
  successContrast: '#0C1F15',
  warning: '#E5A84B',
  warningText: '#E5A84B',
  warningContrast: '#231303',
  info: '#85B8DC',
  infoContrast: '#1B1815',
  shadowXs: '0 1px 2px 0 rgba(0, 0, 0, 0.45)',
  shadowMd: '0 4px 10px -2px rgba(0, 0, 0, 0.55)',
  shadowLg: '0 12px 24px -6px rgba(0, 0, 0, 0.60)',
  tooltipBackground: '#EDEEF0',
  tooltipText: '#16171A',
};

const createShadcnTheme = (scheme: ResolvedColorScheme): Theme => {
  const tokens = scheme === 'dark' ? SHADCN_DARK : SHADCN_LIGHT;
  const {
    background: SHADCN_BG,
    surface: SHADCN_SURFACE,
    overlay: SHADCN_OVERLAY,
    muted: SHADCN_MUTED,
    pressed: SHADCN_PRESSED,
    input: SHADCN_INPUT,
    toggleSelected: SHADCN_TOGGLE_SELECTED,
    ink: SHADCN_INK,
    inkSoft: SHADCN_INK_SOFT,
    disabledText: SHADCN_DISABLED_TEXT,
    border: SHADCN_BORDER,
    borderStrong: SHADCN_BORDER_STRONG,
    ember: SHADCN_EMBER,
    emberHover: SHADCN_EMBER_HOVER,
    emberActive: SHADCN_EMBER_ACTIVE,
    emberInk: SHADCN_EMBER_INK,
    primary: SHADCN_PRIMARY,
    primaryHover: SHADCN_PRIMARY_HOVER,
    primaryActive: SHADCN_PRIMARY_ACTIVE,
    primaryType: SHADCN_PRIMARY_TYPE,
    primaryInk: SHADCN_PRIMARY_INK,
    ring: SHADCN_RING,
    destructive: SHADCN_DESTRUCTIVE,
    destructiveDark: SHADCN_DESTRUCTIVE_DARK,
    destructiveContrast: SHADCN_DESTRUCTIVE_CONTRAST,
    success: SHADCN_SUCCESS,
    successContrast: SHADCN_SUCCESS_CONTRAST,
    warning: SHADCN_WARNING,
    warningText: SHADCN_WARNING_TEXT,
    warningContrast: SHADCN_WARNING_CONTRAST,
    info: SHADCN_INFO,
    infoContrast: SHADCN_INFO_CONTRAST,
    shadowXs: SHADCN_SHADOW_XS,
    shadowMd: SHADCN_SHADOW_MD,
    shadowLg: SHADCN_SHADOW_LG,
    tooltipBackground: SHADCN_TOOLTIP_BACKGROUND,
    tooltipText: SHADCN_TOOLTIP_TEXT,
  } = tokens;
  return createTheme({
    headerRule: `1px solid ${SHADCN_BORDER}`,
    focusRing: SHADCN_RING,
    primaryActive: SHADCN_PRIMARY_ACTIVE,
    emberCta: {
      main: SHADCN_EMBER,
      hover: SHADCN_EMBER_HOVER,
      active: SHADCN_EMBER_ACTIVE,
      contrastText: SHADCN_EMBER_INK,
    },
    palette: {
      mode: scheme,
      contrastThreshold: CONTRAST_THRESHOLD,
      primary: {
        main: SHADCN_PRIMARY,
        light: SHADCN_PRIMARY_HOVER,
        dark: SHADCN_PRIMARY_TYPE,
        contrastText: SHADCN_PRIMARY_INK,
      },
      secondary: {
        main: SHADCN_PRIMARY,
        light: SHADCN_PRIMARY_HOVER,
        dark: SHADCN_PRIMARY_TYPE,
        contrastText: SHADCN_PRIMARY_INK,
      },
      success: { main: SHADCN_SUCCESS, contrastText: SHADCN_SUCCESS_CONTRAST },
      error: {
        main: SHADCN_DESTRUCTIVE,
        dark: SHADCN_DESTRUCTIVE_DARK,
        contrastText: SHADCN_DESTRUCTIVE_CONTRAST,
      },
      warning: {
        main: SHADCN_WARNING,
        dark: SHADCN_WARNING_TEXT,
        contrastText: SHADCN_WARNING_CONTRAST,
      },
      info: { main: SHADCN_INFO, contrastText: SHADCN_INFO_CONTRAST },
      background: { default: SHADCN_BG, paper: SHADCN_SURFACE },
      text: {
        primary: SHADCN_INK,
        secondary: SHADCN_INK_SOFT,
        disabled: SHADCN_DISABLED_TEXT,
      },
      action: {
        disabled: SHADCN_DISABLED_TEXT,
        disabledBackground: SHADCN_PRESSED,
        hover: SHADCN_MUTED,
        selected: SHADCN_PRESSED,
      },
      divider: SHADCN_BORDER,
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: SHADCN_FONT,
      body1: { fontSize: '0.875rem', lineHeight: 1.6 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.55 },
      h1: {
        fontFamily: SHADCN_FONT_DISPLAY,
        fontSize: '1.875rem',
        fontWeight: 700,
        letterSpacing: '-0.025em',
        lineHeight: 1.2,
      },
      h2: {
        fontFamily: SHADCN_FONT_DISPLAY,
        fontSize: '1.125rem',
        fontWeight: 600,
        letterSpacing: '-0.015em',
        lineHeight: 1.4,
      },
      h3: {
        fontFamily: SHADCN_FONT_DISPLAY,
        fontSize: '1rem',
        fontWeight: 600,
        lineHeight: 1.45,
      },
      overline: {
        fontSize: '0.75rem',
        fontWeight: 500,
        letterSpacing: 0,
        lineHeight: 1.7,
        textTransform: 'none',
        color: SHADCN_INK_SOFT,
      },
      button: {
        fontSize: '0.875rem',
        fontWeight: 500,
        letterSpacing: 0,
        lineHeight: 1.45,
        textTransform: 'none',
      },
      caption: { fontSize: '0.75rem', lineHeight: 1.5, color: SHADCN_INK_SOFT },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': {
            colorScheme: scheme,
            backgroundColor: SHADCN_BG,
          },
          body: {
            backgroundColor: SHADCN_BG,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          '@keyframes settle': {
            from: { opacity: 0, transform: 'translateY(0.5rem)' },
            to: { opacity: 1, transform: 'none' },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            padding: '0.5rem 1rem',
            boxShadow: 'none',
            '&:focus-visible': {
              outline: 'none',
              boxShadow: `0 0 0 3px ${alpha(theme.focusRing ?? SHADCN_RING, 0.5)}`,
            },
          }),
          contained: ({ theme }) => ({
            backgroundColor: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
            boxShadow: SHADCN_SHADOW_XS,
            '&:hover': { backgroundColor: theme.palette.primary.light, boxShadow: SHADCN_SHADOW_XS },
            '&:active': {
              backgroundColor: theme.primaryActive ?? theme.palette.primary.light,
              boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.18)',
            },
            '&.MuiButton-colorError': {
              backgroundColor: theme.palette.error.main,
              color: theme.palette.error.contrastText,
              '&:hover': { backgroundColor: theme.palette.error.dark },
              '&:active': {
                backgroundColor: theme.palette.error.dark,
                boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.18)',
              },
            },
            '&.Mui-disabled': {
              backgroundColor: SHADCN_PRESSED,
              color: SHADCN_DISABLED_TEXT,
              boxShadow: 'none',
              cursor: 'not-allowed',
              opacity: 1,
              pointerEvents: 'auto',
            },
          }),
          outlined: {
            border: `1px solid ${SHADCN_BORDER}`,
            color: SHADCN_INK,
            backgroundColor: SHADCN_SURFACE,
            boxShadow: SHADCN_SHADOW_XS,
            '&:hover': {
              border: `1px solid ${SHADCN_BORDER_STRONG}`,
              backgroundColor: SHADCN_MUTED,
            },
            '&:active': { backgroundColor: SHADCN_PRESSED },
            '&.Mui-disabled': {
              border: `1px solid ${SHADCN_BORDER}`,
              backgroundColor: SHADCN_SURFACE,
              color: SHADCN_DISABLED_TEXT,
              boxShadow: 'none',
              cursor: 'not-allowed',
              pointerEvents: 'auto',
            },
          },
          text: {
            color: SHADCN_INK,
            '&:hover': { backgroundColor: SHADCN_MUTED },
            '&:active': { backgroundColor: SHADCN_PRESSED },
            '&.Mui-disabled': {
              color: SHADCN_DISABLED_TEXT,
              cursor: 'not-allowed',
              pointerEvents: 'auto',
            },
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            border: `1px solid ${SHADCN_BORDER}`,
            borderRadius: 12,
            backgroundImage: 'none',
            boxShadow: SHADCN_SHADOW_XS,
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none', boxShadow: 'none' },
          rounded: { borderRadius: 12 },
          outlined: {
            border: `1px solid ${SHADCN_BORDER}`,
            borderRadius: 12,
            boxShadow: SHADCN_SHADOW_XS,
          },
          elevation1: {
            border: `1px solid ${SHADCN_BORDER}`,
            borderRadius: 12,
            boxShadow: SHADCN_SHADOW_XS,
          },
          elevation8: {
            border: `1px solid ${SHADCN_BORDER}`,
            borderRadius: 8,
            backgroundColor: SHADCN_OVERLAY,
            boxShadow: SHADCN_SHADOW_MD,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            backgroundColor: SHADCN_INPUT,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: SHADCN_BORDER },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: SHADCN_BORDER_STRONG },
            '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(theme.focusRing ?? SHADCN_RING, 0.35)}` },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.focusRing ?? SHADCN_RING,
              borderWidth: 1,
            },
          }),
          input: {
            padding: '0.55rem 0.75rem',
            fontSize: '0.875rem',
            lineHeight: 1.5,
            '&[type="number"]': { fontVariantNumeric: 'tabular-nums' },
          },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            color: SHADCN_INK,
            fontSize: '0.8125rem',
            fontWeight: 500,
            lineHeight: 1.5,
            marginBottom: '0.35rem',
            '&.Mui-focused': { color: SHADCN_INK },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: { '&::placeholder': { color: SHADCN_INK_SOFT, opacity: 1 } },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'hover' },
        styleOverrides: {
          root: ({ theme }) => ({
            color: linkInk(theme),
            fontWeight: 500,
            textDecorationColor: alpha(linkInk(theme), 0.35),
            '&:hover': { textDecorationColor: linkInk(theme) },
            '&[aria-current="true"]': { fontWeight: 600 },
            '&:focus-visible': {
              outline: 'none',
              borderRadius: 4,
              boxShadow: `0 0 0 3px ${alpha(theme.focusRing ?? SHADCN_RING, 0.5)}`,
            },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            height: 'auto',
            fontSize: '0.75rem',
            fontWeight: 500,
            lineHeight: 1.45,
          },
          label: { padding: '0.16rem 0.6rem' },
          colorWarning: {
            backgroundColor: alpha(SHADCN_WARNING, 0.2),
            color: SHADCN_WARNING_TEXT,
          },
          outlined: {
            border: `1px solid ${SHADCN_BORDER}`,
            color: SHADCN_INK,
            backgroundColor: SHADCN_SURFACE,
            '&.MuiChip-colorSuccess': {
              borderColor: alpha(SHADCN_SUCCESS, 0.4),
              color: SHADCN_SUCCESS,
            },
            '&.MuiChip-colorWarning': {
              borderColor: alpha(SHADCN_WARNING, 0.4),
              color: SHADCN_WARNING_TEXT,
            },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            gap: '0.125rem',
            padding: '0.1875rem',
            borderRadius: 8,
            backgroundColor: SHADCN_MUTED,
            '& .MuiToggleButtonGroup-grouped, & .MuiToggleButtonGroup-firstButton, & .MuiToggleButtonGroup-middleButton, & .MuiToggleButtonGroup-lastButton': {
              border: 0,
              borderRadius: 6,
              marginLeft: 0,
            },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: 0,
            borderRadius: 6,
            padding: '0.35rem 0.85rem',
            color: SHADCN_INK_SOFT,
            fontFamily: SHADCN_FONT,
            fontSize: '0.8125rem',
            fontWeight: 500,
            lineHeight: 1.45,
            textTransform: 'none',
            '&:hover': { backgroundColor: 'transparent', color: SHADCN_INK },
            '&.Mui-selected': {
              backgroundColor: SHADCN_TOGGLE_SELECTED,
              color: SHADCN_INK,
              boxShadow: SHADCN_SHADOW_XS,
              '&:hover': { backgroundColor: SHADCN_TOGGLE_SELECTED },
            },
            '&:focus-visible': {
              outline: 'none',
              boxShadow: `0 0 0 3px ${alpha(theme.focusRing ?? SHADCN_RING, 0.5)}`,
            },
          }),
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 40 },
          indicator: { backgroundColor: SHADCN_INK, height: 2 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 40,
            padding: '0.5rem 0.85rem',
            color: SHADCN_INK_SOFT,
            fontSize: '0.875rem',
            fontWeight: 500,
            textTransform: 'none',
            '&.Mui-selected': { color: SHADCN_INK },
          },
        },
      },
      MuiList: {
        styleOverrides: { root: { paddingTop: 0, paddingBottom: 0 } },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            border: `1px solid ${SHADCN_BORDER}`,
            borderRadius: 10,
            marginBottom: '0.5rem',
            padding: '0.75rem 1rem',
            backgroundColor: SHADCN_SURFACE,
            transition: 'border-color 120ms ease',
            '&:hover': { borderColor: SHADCN_BORDER_STRONG },
            '&:last-of-type': { marginBottom: 0 },
            '& .MuiListItemText-primary': { fontWeight: 500 },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            color: SHADCN_INK,
            '&:hover': { backgroundColor: SHADCN_MUTED },
            '&:focus-visible': {
              boxShadow: `inset 0 0 0 2px ${alpha(theme.focusRing ?? SHADCN_RING, 0.6)}`,
            },
            '& .MuiListItemText-secondary': { color: SHADCN_INK_SOFT },
          }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:focus-visible': {
              outline: 'none',
              boxShadow: `0 0 0 3px ${alpha(theme.focusRing ?? SHADCN_RING, 0.5)}`,
            },
          }),
        },
      },
      MuiListItemText: {
        styleOverrides: { secondary: { color: SHADCN_INK_SOFT } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${SHADCN_BORDER}`,
            fontSize: '0.875rem',
            padding: '0.6rem 0.75rem',
          },
          head: {
            color: SHADCN_INK_SOFT,
            fontSize: '0.8125rem',
            fontWeight: 500,
            backgroundColor: 'transparent',
          },
          alignRight: { fontVariantNumeric: 'tabular-nums' },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: SHADCN_BORDER } },
      },
      MuiAlert: {
        defaultProps: { severity: 'error', variant: 'outlined' },
        styleOverrides: {
          root: {
            borderRadius: 10,
            backgroundColor: SHADCN_SURFACE,
            boxShadow: 'none',
            '& .MuiAlert-icon': { color: 'inherit' },
            '&.MuiAlert-colorError': {
              border: `1px solid ${alpha(SHADCN_DESTRUCTIVE, 0.5)}`,
              color: SHADCN_DESTRUCTIVE,
            },
            '&.MuiAlert-colorSuccess': {
              border: `1px solid ${alpha(SHADCN_SUCCESS, 0.5)}`,
              color: SHADCN_SUCCESS,
            },
            '&.MuiAlert-colorWarning': {
              border: `1px solid ${alpha(SHADCN_WARNING, 0.4)}`,
              color: SHADCN_WARNING_TEXT,
            },
            '&.MuiAlert-colorInfo': {
              border: `1px solid ${alpha(SHADCN_INFO, 0.5)}`,
              color: SHADCN_INFO,
            },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: SHADCN_SURFACE,
            color: SHADCN_INK,
            borderBottom: `1px solid ${SHADCN_BORDER}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: SHADCN_BG,
            backgroundImage: 'none',
            borderRight: `1px solid ${SHADCN_BORDER}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `1px solid ${SHADCN_BORDER}`,
            borderRadius: 12,
            backgroundColor: SHADCN_OVERLAY,
            boxShadow: SHADCN_SHADOW_LG,
          },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            border: `1px solid ${SHADCN_BORDER}`,
            borderRadius: 8,
            backgroundColor: SHADCN_OVERLAY,
            boxShadow: SHADCN_SHADOW_MD,
          },
          option: {
            fontSize: '0.875rem',
            borderRadius: 6,
            margin: '0 0.25rem',
            '&[aria-selected="true"]': { backgroundColor: SHADCN_MUTED },
            '&.Mui-focused': { backgroundColor: SHADCN_MUTED },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 6, borderRadius: 999, backgroundColor: SHADCN_BORDER },
          bar: {
            borderRadius: 999,
            backgroundColor: SHADCN_INK,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: SHADCN_TOOLTIP_BACKGROUND,
            color: SHADCN_TOOLTIP_TEXT,
            fontSize: '0.75rem',
            fontWeight: 500,
            borderRadius: 6,
            padding: '0.35rem 0.65rem',
          },
          arrow: { color: SHADCN_TOOLTIP_BACKGROUND },
        },
      },
    },
  });
};

const SIGNAL_FONT_UI =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SIGNAL_FONT_MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace";

const SIGNAL_BG = '#F5F5F3';
const SIGNAL_SURFACE = '#FFFFFF';
const SIGNAL_INK = '#111113';
const SIGNAL_INK_SOFT = '#5A5A5F';
const SIGNAL_ACCENT = '#FF5A36';
const SIGNAL_SUCCESS = '#1C8A5A';
const SIGNAL_ERROR = '#B3261E';
const SIGNAL_DIVIDER = '#DCDCD8';

const createSignalMonoTheme = (): Theme =>
  createTheme({
    headerRule: `1px solid ${SIGNAL_DIVIDER}`,
    linkColor: SIGNAL_INK,
    numericFontFamily: SIGNAL_FONT_MONO,
    statusAccent: SIGNAL_ACCENT,
    palette: {
      mode: 'light',
      contrastThreshold: CONTRAST_THRESHOLD,
      primary: {
        main: SIGNAL_INK,
        dark: SIGNAL_INK,
        contrastText: SIGNAL_SURFACE,
      },
      secondary: {
        main: SIGNAL_ACCENT,
        dark: SIGNAL_ACCENT,
        contrastText: SIGNAL_INK,
      },
      success: { main: SIGNAL_SUCCESS, contrastText: SIGNAL_SURFACE },
      error: { main: SIGNAL_ERROR, contrastText: SIGNAL_SURFACE },
      background: { default: SIGNAL_BG, paper: SIGNAL_SURFACE },
      text: { primary: SIGNAL_INK, secondary: SIGNAL_INK_SOFT },
      divider: SIGNAL_DIVIDER,
    },
    shape: { borderRadius: 4 },
    typography: {
      fontFamily: SIGNAL_FONT_UI,
      body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
      body2: { fontSize: '0.85rem', lineHeight: 1.5 },
      h1: {
        fontSize: '2rem',
        fontWeight: 700,
        letterSpacing: '-0.035em',
        lineHeight: 1.12,
      },
      h2: {
        fontSize: '1.125rem',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1.3,
      },
      overline: {
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.12em',
        lineHeight: 1.6,
        color: SIGNAL_INK_SOFT,
      },
      button: {
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.1em',
        lineHeight: 1.4,
        // Deliberate exception to the app-wide sentence-case default (D6):
        // uppercase microtype is core to Signal Mono's identity.
        textTransform: 'uppercase',
      },
      caption: { fontSize: '0.78rem', lineHeight: 1.5, color: SIGNAL_INK_SOFT },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: SIGNAL_BG,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          '@keyframes settle': {
            from: { opacity: 0, transform: 'translateY(0.5rem)' },
            to: { opacity: 1, transform: 'none' },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 4,
            padding: '0.62rem 1.1rem',
            boxShadow: 'none',
            '&:focus-visible': { outline: `3px solid ${theme.focusRing ?? SIGNAL_ACCENT}`, outlineOffset: 2 },
          }),
          contained: {
            backgroundColor: SIGNAL_INK,
            color: SIGNAL_SURFACE,
            '&:hover': { backgroundColor: SIGNAL_INK, boxShadow: 'none' },
            '&.MuiButton-colorSecondary': {
              backgroundColor: SIGNAL_INK,
              color: SIGNAL_SURFACE,
              '&:hover': { backgroundColor: SIGNAL_INK },
            },
            '&.Mui-disabled': {
              backgroundColor: SIGNAL_INK,
              color: SIGNAL_SURFACE,
              opacity: 0.42,
            },
          },
          outlined: {
            border: `1px solid ${SIGNAL_INK}`,
            color: SIGNAL_INK,
            '&:hover': {
              border: `1px solid ${SIGNAL_INK}`,
              backgroundColor: alpha(SIGNAL_INK, 0.05),
            },
          },
          text: {
            color: SIGNAL_INK,
            minWidth: 0,
            padding: '0.2rem 0',
            borderRadius: 0,
            borderBottom: `1px solid ${SIGNAL_DIVIDER}`,
            '&:hover': {
              backgroundColor: 'transparent',
              borderBottomColor: SIGNAL_ACCENT,
            },
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            border: `1px solid ${SIGNAL_DIVIDER}`,
            borderRadius: 4,
            backgroundImage: 'none',
            boxShadow: 'none',
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none', boxShadow: 'none' },
          rounded: { borderRadius: 4 },
          outlined: {
            border: `1px solid ${SIGNAL_DIVIDER}`,
            borderRadius: 4,
            boxShadow: 'none',
            justifySelf: 'start',
            '&:is(form)': { borderTop: `2px solid ${SIGNAL_ACCENT}` },
            '&:is(form) .MuiButton-contained': { width: '100%' },
            '&:is(form) > .MuiStack-root > .MuiTypography-h1': {
              border: `1px solid ${SIGNAL_DIVIDER}`,
              borderBottom: 0,
              padding: '0.85rem 1rem 0.35rem',
            },
            '&:is(form) > .MuiStack-root > .MuiTypography-h1 + .MuiTypography-body1': {
              borderLeft: `1px solid ${SIGNAL_DIVIDER}`,
              borderRight: `1px solid ${SIGNAL_DIVIDER}`,
              padding: '0 1rem 0.65rem',
            },
            '&:is(form) > .MuiStack-root > .MuiTypography-body1 + .MuiTypography-h2': {
              border: `1px solid ${SIGNAL_DIVIDER}`,
              borderTop: 0,
              padding: '0.65rem 1rem',
              textAlign: 'right',
              fontFamily: SIGNAL_FONT_MONO,
              fontVariantNumeric: 'tabular-nums',
            },
          },
          elevation1: {
            border: `1px solid ${SIGNAL_DIVIDER}`,
            borderTop: `2px solid ${SIGNAL_ACCENT}`,
            borderRadius: 4,
            boxShadow: 'none',
          },
          elevation8: {
            border: `1px solid ${SIGNAL_DIVIDER}`,
            borderRadius: 4,
            boxShadow: 'none',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            backgroundColor: SIGNAL_SURFACE,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: SIGNAL_DIVIDER },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: SIGNAL_INK_SOFT },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: SIGNAL_INK,
              borderWidth: 2,
            },
          },
          input: {
            padding: '0.65rem 0.8rem',
            fontSize: '0.9375rem',
            lineHeight: 1.5,
            '&[type="number"]': {
              fontFamily: SIGNAL_FONT_MONO,
              fontVariantNumeric: 'tabular-nums',
            },
          },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            color: SIGNAL_INK,
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            lineHeight: 1.5,
            textTransform: 'uppercase',
            marginBottom: '0.35rem',
            '&.Mui-focused': { color: SIGNAL_INK },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: { '&::placeholder': { color: SIGNAL_INK_SOFT, opacity: 1 } },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'none' },
        styleOverrides: {
          root: ({ theme }) => ({
            color: linkInk(theme),
            fontWeight: 600,
            borderBottom: `1px solid ${SIGNAL_DIVIDER}`,
            '&[aria-current="true"]': { borderBottom: `2px solid ${SIGNAL_ACCENT}` },
            '&:hover': { borderBottomColor: SIGNAL_ACCENT },
            '&:focus-visible': { outline: `3px solid ${theme.focusRing ?? SIGNAL_ACCENT}`, outlineOffset: 2 },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            height: 'auto',
            color: SIGNAL_INK,
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          },
          label: { padding: '0.22rem 0.55rem' },
          outlined: { border: `1px solid ${SIGNAL_DIVIDER}`, backgroundColor: SIGNAL_SURFACE },
          filled: {
            // The `root` override above outranks MUI's own colour-variant rules,
            // so a filled primary chip would paint SIGNAL_INK ink on a SIGNAL_INK
            // fill; restate the declared contrastText here.
            '&.MuiChip-colorPrimary': { color: SIGNAL_SURFACE },
            '&.MuiChip-colorSuccess': { backgroundColor: '#177049', color: SIGNAL_SURFACE },
            '&.MuiChip-colorError': { backgroundColor: SIGNAL_ERROR, color: SIGNAL_SURFACE },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            gap: '1.5rem',
            backgroundColor: SIGNAL_SURFACE,
            borderBottom: `1px solid ${SIGNAL_DIVIDER}`,
            '& .MuiToggleButtonGroup-grouped, & .MuiToggleButtonGroup-firstButton, & .MuiToggleButtonGroup-middleButton, & .MuiToggleButtonGroup-lastButton': {
              border: 0,
              borderRadius: 0,
              marginLeft: 0,
            },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: 0,
            borderRadius: 0,
            padding: '0.75rem 0 0.65rem',
            color: SIGNAL_INK_SOFT,
            fontFamily: SIGNAL_FONT_UI,
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.12em',
            lineHeight: 1.4,
            textTransform: 'uppercase',
            '&:hover': { backgroundColor: 'transparent', color: SIGNAL_INK },
            '&.Mui-selected': {
              backgroundColor: 'transparent',
              color: SIGNAL_INK,
              boxShadow: `inset 0 -2px 0 ${SIGNAL_ACCENT}`,
              '&:hover': { backgroundColor: 'transparent' },
            },
            '&:focus-visible': { outline: `3px solid ${theme.focusRing ?? SIGNAL_ACCENT}`, outlineOffset: 2 },
          }),
        },
      },
      MuiList: {
        styleOverrides: {
          root: {
            paddingTop: 0,
            paddingBottom: 0,
            '&:has(.MuiListItemText-secondary > .MuiStack-root)': {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
            },
          },
        },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${SIGNAL_DIVIDER}`,
            padding: '0.75rem 0.85rem',
            backgroundColor: SIGNAL_SURFACE,
            '&:first-of-type': { borderTop: `1px solid ${SIGNAL_DIVIDER}` },
            '&:has(.MuiListItemText-secondary > .MuiStack-root)': {
              border: `1px solid ${SIGNAL_DIVIDER}`,
              borderRadius: 4,
              marginRight: -1,
              marginBottom: -1,
            },
            '&:has(.MuiListItemText-secondary > .MuiStack-root) .MuiListItemText-primary': {
              fontWeight: 600,
            },
            '&:has(.MuiListItemText-secondary > .MuiStack-root) .MuiListItemText-secondary > .MuiStack-root > span:first-of-type': {
              fontFamily: SIGNAL_FONT_MONO,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 0,
            color: SIGNAL_INK,
            '&:hover': { backgroundColor: alpha(SIGNAL_INK, 0.04) },
            '&:focus-visible': { outline: `3px solid ${theme.focusRing ?? SIGNAL_ACCENT}`, outlineOffset: -3 },
            '& .MuiListItemText-secondary': {
              color: SIGNAL_INK_SOFT,
            },
          }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:focus-visible': { outline: `3px solid ${theme.focusRing ?? SIGNAL_ACCENT}`, outlineOffset: 2 },
          }),
        },
      },
      MuiListItemText: {
        styleOverrides: { secondary: { color: SIGNAL_INK_SOFT } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${SIGNAL_DIVIDER}`,
            fontSize: '0.8125rem',
            padding: '0.65rem 0.75rem',
          },
          head: {
            color: SIGNAL_INK,
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            backgroundColor: SIGNAL_BG,
          },
          alignRight: {
            fontFamily: SIGNAL_FONT_MONO,
            fontVariantNumeric: 'tabular-nums',
          },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: SIGNAL_DIVIDER } },
      },
      MuiAlert: {
        defaultProps: { severity: 'error', variant: 'outlined' },
        styleOverrides: {
          root: {
            border: `1px solid ${SIGNAL_ERROR}`,
            borderRadius: 4,
            backgroundColor: SIGNAL_SURFACE,
            color: SIGNAL_ERROR,
            boxShadow: 'none',
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: SIGNAL_SURFACE,
            color: SIGNAL_INK,
            borderBottom: `1px solid ${SIGNAL_DIVIDER}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: SIGNAL_SURFACE,
            backgroundImage: 'none',
            borderRight: `1px solid ${SIGNAL_DIVIDER}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `1px solid ${SIGNAL_DIVIDER}`,
            borderRadius: 4,
            boxShadow: 'none',
          },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            border: `1px solid ${SIGNAL_DIVIDER}`,
            borderRadius: 4,
            boxShadow: 'none',
          },
          option: {
            '&[aria-selected="true"]': { backgroundColor: alpha(SIGNAL_INK, 0.08) },
            '&.Mui-focused': { backgroundColor: alpha(SIGNAL_INK, 0.05) },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            height: 4,
            borderRadius: 0,
            backgroundColor: SIGNAL_DIVIDER,
          },
          bar: { borderRadius: 0, backgroundColor: SIGNAL_ACCENT },
        },
      },
    },
  });

const FRAME_FONT_UI =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FRAME_FONT_HEADING =
  "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FRAME_FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', monospace";

const FRAME_BG = '#F7F6F3';
const FRAME_SURFACE = '#FFFFFF';
const FRAME_PRIMARY = '#274C77';
const FRAME_PRIMARY_DARK = '#1F3D60';
const FRAME_ACCENT = '#A05A0C';
const FRAME_SUCCESS = '#1E7B34';
const FRAME_ERROR = '#B3261E';
const FRAME_INK = '#1C2B33';
const FRAME_INK_SOFT = '#52606D';
const FRAME_DIVIDER = '#E3E0DA';
const FRAME_SHADOW = '0 8px 24px rgba(28, 43, 51, 0.12)';
const FRAME_PRIMARY_TINT = 'rgba(39, 76, 119, 0.1)';

const createSteadyFrameTheme = (): Theme =>
  createTheme({
    headerRule: `1px solid ${FRAME_DIVIDER}`,
    linkColor: FRAME_PRIMARY,
    numericFontFamily: FRAME_FONT_HEADING,
    statusAccent: FRAME_SUCCESS,
    moneyColor: FRAME_ACCENT,
    palette: {
      mode: 'light',
      contrastThreshold: CONTRAST_THRESHOLD,
      primary: {
        main: FRAME_PRIMARY,
        dark: FRAME_PRIMARY_DARK,
        contrastText: FRAME_SURFACE,
      },
      secondary: {
        main: FRAME_PRIMARY,
        dark: FRAME_PRIMARY_DARK,
        contrastText: FRAME_SURFACE,
      },
      success: { main: FRAME_SUCCESS, contrastText: FRAME_SURFACE },
      error: { main: FRAME_ERROR, contrastText: FRAME_SURFACE },
      background: { default: FRAME_BG, paper: FRAME_SURFACE },
      text: { primary: FRAME_INK, secondary: FRAME_INK_SOFT },
      divider: FRAME_DIVIDER,
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: FRAME_FONT_UI,
      body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
      body2: { fontSize: '0.85rem', lineHeight: 1.5 },
      h1: {
        fontFamily: FRAME_FONT_HEADING,
        fontSize: '1.75rem',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        lineHeight: 1.2,
      },
      h2: {
        fontFamily: FRAME_FONT_HEADING,
        fontSize: '1.375rem',
        fontWeight: 600,
        letterSpacing: '-0.005em',
        lineHeight: 1.3,
      },
      h3: {
        fontFamily: FRAME_FONT_HEADING,
        fontSize: '1.0625rem',
        fontWeight: 600,
        lineHeight: 1.4,
      },
      overline: {
        fontSize: '0.72rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        lineHeight: 1.7,
        color: FRAME_INK_SOFT,
      },
      button: {
        fontSize: '0.9rem',
        fontWeight: 600,
        letterSpacing: 0,
        textTransform: 'none',
      },
      caption: { fontSize: '0.8125rem', lineHeight: 1.5, color: FRAME_INK_SOFT },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: FRAME_BG,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          code: { fontFamily: FRAME_FONT_MONO },
          '@keyframes settle': {
            from: { opacity: 0, transform: 'translateY(0.5rem)' },
            to: { opacity: 1, transform: 'none' },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            padding: '0.55rem 1.2rem',
            boxShadow: 'none',
            '&:hover': { boxShadow: 'none' },
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? FRAME_PRIMARY}`, outlineOffset: 2 },
          }),
          contained: {
            '&.Mui-disabled': {
              backgroundColor: FRAME_PRIMARY,
              color: FRAME_SURFACE,
              opacity: 0.42,
            },
          },
          outlined: {
            border: `1px solid ${alpha(FRAME_PRIMARY, 0.4)}`,
            color: FRAME_PRIMARY,
            '&:hover': {
              border: `1px solid ${FRAME_PRIMARY}`,
              backgroundColor: FRAME_PRIMARY_TINT,
            },
          },
          text: {
            color: FRAME_PRIMARY,
            '&:hover': { backgroundColor: alpha(FRAME_PRIMARY, 0.06) },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none', boxShadow: 'none' },
          rounded: { borderRadius: 10 },
          outlined: {
            border: `1px solid ${FRAME_DIVIDER}`,
            borderRadius: 12,
            boxShadow: 'none',
          },
          elevation1: {
            border: `1px solid ${FRAME_DIVIDER}`,
            borderRadius: 10,
            boxShadow: 'none',
          },
          elevation8: {
            border: `1px solid ${FRAME_DIVIDER}`,
            borderRadius: 10,
            boxShadow: FRAME_SHADOW,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: FRAME_SURFACE,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: FRAME_DIVIDER },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: FRAME_INK_SOFT },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: FRAME_PRIMARY,
              borderWidth: 2,
            },
          },
          input: {
            padding: '0.6rem 0.8rem',
            fontSize: '0.9375rem',
            lineHeight: 1.5,
            '&[type="number"]': { fontFamily: FRAME_FONT_HEADING, fontVariantNumeric: 'tabular-nums' },
          },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            color: FRAME_INK_SOFT,
            fontSize: '0.8125rem',
            fontWeight: 600,
            lineHeight: 1.5,
            marginBottom: '0.35rem',
            '&.Mui-focused': { color: FRAME_PRIMARY },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: { '&::placeholder': { color: FRAME_INK_SOFT, opacity: 1 } },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'hover' },
        styleOverrides: {
          root: ({ theme }) => ({
            color: linkInk(theme),
            fontWeight: 600,
            '&[aria-current="true"]': { fontWeight: 700 },
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? FRAME_PRIMARY}`, outlineOffset: 2 },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            height: 'auto',
            fontSize: '0.75rem',
            fontWeight: 600,
          },
          label: { padding: '0.22rem 0.66rem' },
          outlined: {
            border: `1px solid ${FRAME_DIVIDER}`,
            color: FRAME_INK_SOFT,
            backgroundColor: FRAME_SURFACE,
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            gap: '0.4rem',
            '& .MuiToggleButtonGroup-grouped, & .MuiToggleButtonGroup-firstButton, & .MuiToggleButtonGroup-middleButton, & .MuiToggleButtonGroup-lastButton': {
              border: 0,
              borderRadius: 8,
              marginLeft: 0,
            },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: 0,
            borderRadius: 8,
            padding: '0.5rem 1rem',
            color: FRAME_INK_SOFT,
            fontFamily: FRAME_FONT_UI,
            fontSize: '0.9rem',
            fontWeight: 600,
            lineHeight: 1.4,
            textTransform: 'none',
            '&:hover': { backgroundColor: alpha(FRAME_INK, 0.05) },
            '&.Mui-selected': {
              backgroundColor: FRAME_PRIMARY_TINT,
              color: FRAME_PRIMARY,
              '&:hover': { backgroundColor: alpha(FRAME_PRIMARY, 0.16) },
            },
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? FRAME_PRIMARY}`, outlineOffset: 2 },
          }),
        },
      },
      MuiList: {
        styleOverrides: { root: { paddingTop: 0, paddingBottom: 0 } },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            border: `1px solid ${FRAME_DIVIDER}`,
            borderRadius: 10,
            marginBottom: '0.75rem',
            padding: '0.85rem 1rem',
            backgroundColor: FRAME_SURFACE,
            transition: 'border-color 0.15s ease',
            '&:hover': { borderColor: FRAME_PRIMARY },
            '&:last-of-type': { marginBottom: 0 },
            '& .MuiListItemText-primary': { fontFamily: FRAME_FONT_HEADING, fontWeight: 600 },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 10,
            color: FRAME_INK,
            '&:hover': { backgroundColor: alpha(FRAME_PRIMARY, 0.05) },
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? FRAME_PRIMARY}`, outlineOffset: -2 },
            '& .MuiListItemText-secondary': { color: FRAME_INK_SOFT },
          }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? FRAME_PRIMARY}`, outlineOffset: 2 },
          }),
        },
      },
      MuiListItemText: {
        styleOverrides: { secondary: { color: FRAME_INK_SOFT } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${FRAME_DIVIDER}`,
            fontSize: '0.85rem',
            padding: '0.65rem 0.75rem',
          },
          head: {
            color: FRAME_INK_SOFT,
            fontWeight: 600,
            fontSize: '0.72rem',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            backgroundColor: FRAME_BG,
          },
          alignRight: { fontFamily: FRAME_FONT_HEADING, fontVariantNumeric: 'tabular-nums' },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: FRAME_DIVIDER } },
      },
      MuiAlert: {
        defaultProps: { severity: 'error', variant: 'outlined' },
        styleOverrides: {
          root: {
            border: `1px solid ${FRAME_ERROR}`,
            borderRadius: 8,
            backgroundColor: FRAME_SURFACE,
            color: FRAME_ERROR,
            boxShadow: 'none',
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: FRAME_SURFACE,
            color: FRAME_INK,
            borderBottom: `1px solid ${FRAME_DIVIDER}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: FRAME_SURFACE,
            backgroundImage: 'none',
            borderRight: `1px solid ${FRAME_DIVIDER}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `1px solid ${FRAME_DIVIDER}`,
            borderRadius: 12,
            boxShadow: FRAME_SHADOW,
          },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            border: `1px solid ${FRAME_DIVIDER}`,
            borderRadius: 10,
            boxShadow: FRAME_SHADOW,
          },
          option: {
            '&[aria-selected="true"]': { backgroundColor: FRAME_PRIMARY_TINT },
            '&.Mui-focused': { backgroundColor: alpha(FRAME_PRIMARY, 0.05) },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 4, borderRadius: 999, backgroundColor: FRAME_DIVIDER },
          bar: { borderRadius: 999, backgroundColor: FRAME_PRIMARY },
        },
      },
    },
  });

const SCORE_FONT_UI =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SCORE_FONT_DISPLAY = "'Space Grotesk', 'Inter', sans-serif";

const SCORE_BG = '#F7F5F2';
const SCORE_SURFACE = '#FFFFFF';
const SCORE_INK = '#0B0B0C';
const SCORE_INK_SOFT = '#55524C';
const SCORE_ACCENT = '#FFC42B';
const SCORE_SUCCESS = '#1B8A5A';
const SCORE_ERROR = '#B3261E';
const SCORE_DIVIDER = '#111111';
const SCORE_SHADOW = `3px 3px 0 ${SCORE_INK}`;

const createScoreboardTheme = (): Theme =>
  createTheme({
    headerRule: `2px solid ${SCORE_DIVIDER}`,
    linkColor: SCORE_INK,
    palette: {
      mode: 'light',
      contrastThreshold: CONTRAST_THRESHOLD,
      primary: {
        main: SCORE_INK,
        dark: SCORE_INK,
        contrastText: SCORE_SURFACE,
      },
      secondary: {
        main: SCORE_ACCENT,
        dark: SCORE_ACCENT,
        contrastText: SCORE_INK,
      },
      success: { main: SCORE_SUCCESS, contrastText: SCORE_INK },
      error: { main: SCORE_ERROR, contrastText: SCORE_SURFACE },
      background: { default: SCORE_BG, paper: SCORE_SURFACE },
      text: { primary: SCORE_INK, secondary: SCORE_INK_SOFT },
      divider: SCORE_DIVIDER,
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: SCORE_FONT_UI,
      body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
      body2: { fontSize: '0.85rem', lineHeight: 1.5 },
      h1: {
        fontFamily: SCORE_FONT_DISPLAY,
        fontSize: '1.875rem',
        fontWeight: 700,
        letterSpacing: '-0.025em',
        lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums',
      },
      h2: {
        fontFamily: SCORE_FONT_DISPLAY,
        fontSize: '1.125rem',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 1.3,
        fontVariantNumeric: 'tabular-nums',
      },
      overline: {
        fontFamily: SCORE_FONT_UI,
        fontSize: '0.72rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        lineHeight: 1.6,
        color: SCORE_INK_SOFT,
      },
      button: {
        fontFamily: SCORE_FONT_UI,
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        lineHeight: 1.4,
        // Deliberate exception to the app-wide sentence-case default (D6):
        // Scoreboard's sports-graphics identity depends on uppercase labels.
        textTransform: 'uppercase',
      },
      caption: { fontSize: '0.78rem', lineHeight: 1.5, color: SCORE_INK_SOFT },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: SCORE_BG,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          '@keyframes settle': {
            from: { opacity: 0, transform: 'translateY(0.5rem)' },
            to: { opacity: 1, transform: 'none' },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            padding: '0.6rem 1.15rem',
            '&:focus-visible': { outline: `3px solid ${theme.focusRing ?? SCORE_ACCENT}`, outlineOffset: 2 },
          }),
          contained: {
            backgroundColor: SCORE_INK,
            color: SCORE_SURFACE,
            fontFamily: SCORE_FONT_DISPLAY,
            fontWeight: 600,
            '&:hover': { backgroundColor: SCORE_INK },
            '&.Mui-disabled': {
              backgroundColor: SCORE_INK,
              color: SCORE_SURFACE,
              opacity: 0.42,
            },
            '&.MuiButton-colorSecondary': {
              backgroundColor: SCORE_INK,
              color: SCORE_SURFACE,
              '&:hover': { backgroundColor: SCORE_INK },
            },
          },
          outlined: {
            border: `1.5px solid ${SCORE_INK}`,
            color: SCORE_INK,
            '&:hover': {
              border: `1.5px solid ${SCORE_INK}`,
              backgroundColor: alpha(SCORE_INK, 0.05),
            },
          },
          text: {
            color: SCORE_INK,
            borderRadius: 0,
            borderBottom: `1.5px solid ${SCORE_INK}`,
            padding: '0.15rem 0',
            minWidth: 0,
            '&:hover': { backgroundColor: 'transparent', borderBottomWidth: 3 },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: 8 },
          outlined: {
            border: `2px solid ${SCORE_INK}`,
            borderRadius: 12,
            boxShadow: 'none',
          },
          elevation1: {
            border: `1.5px solid ${SCORE_INK}`,
            borderRadius: 8,
            boxShadow: 'none',
          },
          elevation8: {
            border: `2px solid ${SCORE_INK}`,
            borderRadius: 12,
            boxShadow: 'none',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            backgroundColor: SCORE_SURFACE,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: SCORE_INK,
              borderWidth: 1.5,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: SCORE_INK,
              borderWidth: 2,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: SCORE_INK,
              borderWidth: 2,
            },
          },
          input: { padding: '0.65rem 0.8rem', fontSize: '0.9375rem', lineHeight: 1.5 },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            fontSize: '0.72rem',
            fontWeight: 600,
            lineHeight: 1.5,
            color: SCORE_INK,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: '0.35rem',
            '&.Mui-focused': { color: SCORE_INK },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: { '&::placeholder': { color: SCORE_INK_SOFT, opacity: 1 } },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'none' },
        styleOverrides: {
          root: ({ theme }) => ({
            color: linkInk(theme),
            fontWeight: 600,
            borderBottom: `1.5px solid ${SCORE_INK}`,
            '&[aria-current="true"]': { borderBottomWidth: 3 },
            '&:hover': { borderBottomWidth: 3 },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            height: 'auto',
            color: SCORE_INK,
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          },
          label: { padding: '0.2rem 0.55rem' },
          outlined: { border: `1.5px solid ${SCORE_INK}`, backgroundColor: SCORE_SURFACE },
          filled: {
            '&.MuiChip-colorPrimary': { color: SCORE_SURFACE },
            '&.MuiChip-colorError': { backgroundColor: SCORE_ERROR, color: SCORE_SURFACE },
          },
          colorSecondary: {
            backgroundColor: SCORE_ACCENT,
            color: SCORE_INK,
            border: `1.5px solid ${SCORE_INK}`,
            boxShadow: SCORE_SHADOW,
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            gap: '1.25rem',
            borderBottom: `2px solid ${SCORE_INK}`,
            '& .MuiToggleButtonGroup-grouped, & .MuiToggleButtonGroup-firstButton, & .MuiToggleButtonGroup-middleButton, & .MuiToggleButtonGroup-lastButton': {
              border: 0,
              borderRadius: 0,
              marginLeft: 0,
            },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            border: 0,
            borderRadius: 0,
            padding: '0.65rem 0 0.55rem',
            color: SCORE_INK_SOFT,
            fontFamily: SCORE_FONT_UI,
            fontSize: '0.72rem',
            fontWeight: 600,
            lineHeight: 1.4,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            '&:hover': { backgroundColor: 'transparent', color: SCORE_INK },
            '&.Mui-selected': {
              backgroundColor: 'transparent',
              color: SCORE_INK,
              boxShadow: `inset 0 -3px 0 ${SCORE_INK}`,
              '&:hover': { backgroundColor: 'transparent' },
            },
          },
        },
      },
      MuiList: {
        styleOverrides: { root: { paddingTop: 0, paddingBottom: 0 } },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            border: `1.5px solid ${SCORE_INK}`,
            borderRadius: 8,
            marginBottom: '0.75rem',
            padding: '0.85rem 1rem',
            backgroundColor: SCORE_SURFACE,
            '&:hover': { boxShadow: SCORE_SHADOW, transform: 'translate(-1px, -1px)' },
            '& .MuiListItemText-primary': {
              fontFamily: SCORE_FONT_DISPLAY,
              fontWeight: 700,
            },
            '& .MuiListItemText-secondary > .MuiStack-root > span:first-of-type': {
              fontFamily: SCORE_FONT_DISPLAY,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 6,
            color: SCORE_INK,
            '&:hover': { backgroundColor: alpha(SCORE_INK, 0.05) },
            '&:focus-visible': { outline: `3px solid ${theme.focusRing ?? SCORE_ACCENT}`, outlineOffset: -3 },
          }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:focus-visible': { outline: `3px solid ${theme.focusRing ?? SCORE_ACCENT}`, outlineOffset: 2 },
          }),
        },
      },
      MuiListItemText: {
        styleOverrides: {
          secondary: { color: SCORE_INK_SOFT },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px dashed ${SCORE_INK}`,
            fontSize: '0.85rem',
          },
          head: {
            color: SCORE_INK,
            fontWeight: 600,
            fontSize: '0.72rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          },
          alignRight: {
            fontFamily: SCORE_FONT_DISPLAY,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: SCORE_INK, borderStyle: 'dashed' } },
      },
      MuiAlert: {
        defaultProps: { severity: 'error', variant: 'outlined' },
        styleOverrides: {
          root: {
            border: `1.5px solid ${SCORE_ERROR}`,
            borderRadius: 4,
            backgroundColor: SCORE_SURFACE,
            color: SCORE_ERROR,
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: SCORE_BG,
            color: SCORE_INK,
            borderBottom: `2px solid ${SCORE_INK}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: SCORE_SURFACE,
            backgroundImage: 'none',
            borderRight: `2px solid ${SCORE_INK}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `2px solid ${SCORE_INK}`,
            borderRadius: 12,
            boxShadow: 'none',
          },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            border: `1.5px solid ${SCORE_INK}`,
            borderRadius: 4,
            boxShadow: 'none',
          },
          option: {
            '&[aria-selected="true"]': { backgroundColor: alpha(SCORE_INK, 0.08) },
            '&.Mui-focused': { backgroundColor: alpha(SCORE_INK, 0.05) },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            height: 6,
            border: `1.5px solid ${SCORE_INK}`,
            borderRadius: 6,
            backgroundColor: SCORE_SURFACE,
          },
          bar: { borderRadius: 0, backgroundColor: SCORE_ACCENT },
        },
      },
    },
  });

const STUDIO_FONT_UI =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const STUDIO_FONT_EDITORIAL = "'Fraunces', 'Iowan Old Style', Georgia, serif";

const STUDIO_BG = '#FAFAF8';
const STUDIO_SURFACE = '#FFFFFF';
const STUDIO_INK = '#1C1B1A';
const STUDIO_INK_SOFT = '#59564F';
const STUDIO_PRIMARY = '#3730A3';
const STUDIO_PRIMARY_DARK = '#2A2482';
const STUDIO_ACCENT = '#C9622A';
const STUDIO_ACCENT_FILL = '#B0511E';
const STUDIO_ACCENT_FILL_DARK = '#96431A';
const STUDIO_SUCCESS = '#1F7A46';
const STUDIO_ERROR = '#B3261E';
const STUDIO_DIVIDER = '#E7E5E0';
const STUDIO_INPUT_BORDER = '#D8D5CD';
const STUDIO_SHADOW_REST = '0 1px 2px rgba(20, 18, 15, 0.04)';
const STUDIO_SHADOW_FLOAT = '0 12px 28px rgba(20, 18, 15, 0.08)';

const createQuietStudioTheme = (): Theme =>
  createTheme({
    headerRule: `1px solid ${STUDIO_DIVIDER}`,
    linkColor: STUDIO_PRIMARY,
    palette: {
      mode: 'light',
      contrastThreshold: CONTRAST_THRESHOLD,
      primary: {
        main: STUDIO_PRIMARY,
        dark: STUDIO_PRIMARY_DARK,
        contrastText: STUDIO_SURFACE,
      },
      secondary: {
        main: STUDIO_ACCENT_FILL,
        light: STUDIO_ACCENT,
        dark: STUDIO_ACCENT_FILL_DARK,
        contrastText: STUDIO_SURFACE,
      },
      success: { main: STUDIO_SUCCESS },
      error: { main: STUDIO_ERROR },
      background: { default: STUDIO_BG, paper: STUDIO_SURFACE },
      text: { primary: STUDIO_INK, secondary: STUDIO_INK_SOFT },
      divider: STUDIO_DIVIDER,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: STUDIO_FONT_UI,
      body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
      body2: { fontSize: '0.85rem', lineHeight: 1.55 },
      h1: {
        fontFamily: STUDIO_FONT_EDITORIAL,
        fontSize: '1.9rem',
        fontWeight: 500,
        letterSpacing: '-0.01em',
        lineHeight: 1.25,
      },
      h2: { fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.4 },
      overline: {
        fontSize: '0.72rem',
        fontWeight: 600,
        letterSpacing: '0.08em',
        lineHeight: 1.7,
        color: STUDIO_INK_SOFT,
      },
      button: {
        fontSize: '0.9rem',
        fontWeight: 600,
        letterSpacing: 0,
        textTransform: 'none',
      },
      caption: { fontSize: '0.78rem', lineHeight: 1.5, color: STUDIO_INK_SOFT },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: STUDIO_BG,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          '@keyframes settle': {
            from: { opacity: 0, transform: 'translateY(0.5rem)' },
            to: { opacity: 1, transform: 'none' },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 10,
            padding: '0.55rem 1.25rem',
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? STUDIO_PRIMARY}`, outlineOffset: 2 },
          }),
          contained: {
            boxShadow: STUDIO_SHADOW_REST,
            '&:hover': { boxShadow: STUDIO_SHADOW_FLOAT },
          },
          outlined: {
            borderColor: alpha(STUDIO_INK, 0.22),
            color: STUDIO_INK,
            '&:hover': {
              borderColor: alpha(STUDIO_INK, 0.38),
              backgroundColor: alpha(STUDIO_INK, 0.03),
            },
          },
          text: {
            color: STUDIO_PRIMARY,
            '&:hover': { backgroundColor: alpha(STUDIO_PRIMARY, 0.06) },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: 16 },
          outlined: {
            border: 'none',
            boxShadow: `${STUDIO_SHADOW_REST}, ${STUDIO_SHADOW_FLOAT}`,
          },
          elevation1: { boxShadow: STUDIO_SHADOW_REST },
          elevation8: { boxShadow: STUDIO_SHADOW_FLOAT },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            backgroundColor: STUDIO_SURFACE,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: STUDIO_INPUT_BORDER },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(STUDIO_INK, 0.35),
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: STUDIO_PRIMARY,
              borderWidth: 2,
            },
          },
          input: { padding: '0.65rem 0.85rem', fontSize: '0.9375rem', lineHeight: 1.55 },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            fontSize: '0.8rem',
            fontWeight: 500,
            lineHeight: 1.5,
            color: STUDIO_INK_SOFT,
            marginBottom: '0.35rem',
            '&.Mui-focused': { color: STUDIO_INK },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: {
            '&::placeholder': { color: STUDIO_INK_SOFT, opacity: 0.75 },
          },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'hover' },
        styleOverrides: {
          root: ({ theme }) => ({
            color: linkInk(theme),
            fontWeight: 500,
            '&[aria-current="true"]': { fontWeight: 600 },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 500 },
          outlined: {
            borderColor: alpha(STUDIO_PRIMARY, 0.25),
            color: STUDIO_PRIMARY,
            backgroundColor: alpha(STUDIO_PRIMARY, 0.08),
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            gap: '0.4rem',
            '& .MuiToggleButtonGroup-grouped, & .MuiToggleButtonGroup-firstButton, & .MuiToggleButtonGroup-middleButton, & .MuiToggleButtonGroup-lastButton':
              {
                border: 0,
                borderRadius: 10,
                marginLeft: 0,
              },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            border: 0,
            borderRadius: 10,
            textTransform: 'none',
            fontFamily: STUDIO_FONT_UI,
            fontSize: '0.9rem',
            fontWeight: 500,
            lineHeight: 1.4,
            padding: '0.5rem 1rem',
            color: STUDIO_INK_SOFT,
            '&:hover': { backgroundColor: alpha(STUDIO_INK, 0.05) },
            '&.Mui-selected': {
              backgroundColor: alpha(STUDIO_PRIMARY, 0.08),
              color: STUDIO_PRIMARY,
              fontWeight: 600,
              '&:hover': { backgroundColor: alpha(STUDIO_PRIMARY, 0.12) },
            },
          },
        },
      },
      MuiList: {
        styleOverrides: {
          root: { paddingTop: 0, paddingBottom: 0 },
        },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${STUDIO_DIVIDER}`,
            paddingTop: '0.75rem',
            paddingBottom: '0.75rem',
            '&:last-of-type': { borderBottom: 'none' },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 10,
            '&:hover': { backgroundColor: alpha(STUDIO_PRIMARY, 0.05) },
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? STUDIO_PRIMARY}`, outlineOffset: -2 },
          }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? STUDIO_PRIMARY}`, outlineOffset: 2 },
          }),
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${STUDIO_DIVIDER}`,
            fontSize: '0.875rem',
          },
          head: {
            color: STUDIO_INK_SOFT,
            fontWeight: 600,
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          },
        },
      },
      MuiAlert: {
        defaultProps: { severity: 'error' },
        styleOverrides: {
          root: { borderRadius: 10 },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: STUDIO_SURFACE,
            color: STUDIO_INK,
            boxShadow: STUDIO_SHADOW_REST,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: STUDIO_SURFACE,
            backgroundImage: 'none',
            borderRight: `1px solid ${STUDIO_DIVIDER}`,
            boxShadow: STUDIO_SHADOW_REST,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 16, boxShadow: STUDIO_SHADOW_FLOAT },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: { borderRadius: 12, boxShadow: STUDIO_SHADOW_FLOAT },
        },
      },
    },
  });

/**
 * Baseline grid of the logbook theme. The ruled-paper background repeats
 * every GRID px and every piece of text sits on a line box that is a
 * multiple of GRID, so row borders land exactly on the background rules
 * (same color) and content never drifts off the paper lines. When adding
 * UI in logbook mode, keep vertical paddings + borders summing to GRID
 * multiples.
 */
const GRID = 24;

const createAppTheme = (accentHue = 24): Theme => {
  const accent = `hsl(${accentHue} 62% 42%)`;
  const accentInk = `hsl(${accentHue} 70% 28%)`;
  const accentWash = `hsl(${accentHue} 55% 50% / 0.09)`;

  return createTheme({
    linkColor: INK,
    palette: {
      mode: 'light',
      contrastThreshold: CONTRAST_THRESHOLD,
      primary: { main: accent, dark: accentInk, contrastText: PAPER },
      background: { default: PAPER, paper: PAPER_RAISED },
      text: { primary: INK, secondary: INK_SOFT },
      divider: LINE,
      error: { main: '#a03123' },
    },
    shape: { borderRadius: 0 },
    typography: {
      fontFamily: FONT_MONO,
      body1: { fontSize: '15px', lineHeight: `${GRID}px` },
      body2: { fontSize: '0.8rem', lineHeight: `${GRID}px` },
      h1: {
        fontFamily: FONT_DISPLAY,
        fontSize: '1.7rem',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        lineHeight: `${GRID * 2}px`,
      },
      h2: {
        fontFamily: FONT_DISPLAY,
        fontSize: '1.05rem',
        fontStyle: 'italic',
        fontWeight: 700,
        lineHeight: `${GRID}px`,
        color: INK_SOFT,
      },
      overline: {
        fontSize: '0.72rem',
        letterSpacing: '0.1em',
        lineHeight: `${GRID}px`,
        color: INK_SOFT,
      },
      button: {
        fontSize: '0.78rem',
        letterSpacing: '0.14em',
        lineHeight: 'normal',
        fontWeight: 400,
        textTransform: 'none',
      },
      caption: { fontSize: '0.72rem', lineHeight: `${GRID}px`, color: INK_SOFT },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            // One rule per 2×GRID (one ledger row), drawn on the last pixel of
            // the row so element bottom borders (same color) overlay it
            // exactly. A GRID-sized pitch would put a rule mid-row, striking
            // through the text like a completed task.
            background: `linear-gradient(${LINE} 1px, transparent 1px) 0 -1px / 100% ${GRID * 2}px, ${PAPER}`,
          },
          '@keyframes settle': {
            from: { opacity: 0, transform: 'translateY(0.5rem)' },
            to: { opacity: 1, transform: 'none' },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, disableRipple: true },
        styleOverrides: {
          root: ({ theme }) => ({
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? accentInk}`, outlineOffset: 2 },
          }),
          contained: {
            backgroundColor: INK,
            color: PAPER,
            padding: '0.75rem 1.3rem',
            '&:hover': { backgroundColor: accentInk },
            '&.Mui-disabled': { backgroundColor: INK, color: PAPER, opacity: 0.4 },
          },
          text: {
            color: INK_SOFT,
            letterSpacing: '0.08em',
            padding: 0,
            minWidth: 0,
            borderBottom: `1px dashed ${LINE_STRONG}`,
            borderRadius: 0,
            '&:hover': { background: 'none', color: '#a03123', borderBottomColor: '#a03123' },
          },
          outlined: {
            color: accentInk,
            borderColor: alpha(accentInk, 0.5),
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 0, height: 'auto' },
          label: { padding: '0.05rem 0.5rem', lineHeight: 1.55 },
          outlined: {
            borderColor: accentInk,
            color: accentInk,
            backgroundColor: accentWash,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            fontSize: '0.72rem',
          },
          filled: {
            '&.MuiChip-colorPrimary': { backgroundColor: accentInk, color: PAPER },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          // Cards (login, tenant picker): heavy offset shadow.
          outlined: {
            border: `1.5px solid ${LINE_STRONG}`,
            boxShadow: `0.5rem 0.5rem 0 ${accentWash}, 0.5rem 0.5rem 0 1.5px ${LINE}`,
            '&[role="alert"]': {
              '& .MuiTypography-h1': { fontSize: '1.6rem' },
              '& .MuiTypography-body2': { wordBreak: 'break-word' },
            },
          },
          // Inline surfaces (inline forms/panels): lighter offset shadow. Whole-pixel
          // border so the height stays on the grid at every devicePixelRatio.
          elevation: {
            border: `1px solid ${LINE_STRONG}`,
            boxShadow: `0.35rem 0.35rem 0 ${accentWash}`,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: PAPER,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: LINE_STRONG, borderWidth: 1 },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: accent,
              borderWidth: 2,
            },
          },
          // +1px compensates the border, which sits in the layout flow in the
          // original but is an absolutely-positioned fieldset in MUI.
          input: { padding: 'calc(0.6rem + 1px) 0.7rem', fontSize: '15px', lineHeight: 1.55 },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            lineHeight: 1.55,
            color: INK_SOFT,
            marginBottom: '0.3rem',
            '&.Mui-focused': { color: INK_SOFT },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: { fontSize: '15px', lineHeight: `${GRID}px` },
          input: {
            // MUI pins inputs to 1.4375em; snap them to the baseline grid.
            height: `${GRID}px`,
            '&::placeholder': { color: INK_SOFT, fontStyle: 'italic', opacity: 1 },
          },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'none' },
        styleOverrides: {
          root: ({ theme }) => ({
            color: linkInk(theme),
            borderBottom: `1px dashed ${LINE_STRONG}`,
            paddingBottom: 1,
            '&[aria-current="true"]': {
              color: accentInk,
              fontWeight: 700,
              borderBottom: `2px solid ${accent}`,
            },
            '&:hover': { color: accentInk, borderBottomColor: accentInk },
          }),
        },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            alignItems: 'baseline',
            gap: '0.9rem',
            borderBottom: `1px solid ${LINE}`,
            // 12 + 25 (baseline-aligned mixed font sizes overflow the 24px
            // line box by 1) + 10 + 1 (border) = 2×GRID; wrapped title lines
            // add exactly one GRID each, so borders always meet a paper rule.
            paddingTop: '12px',
            paddingBottom: '10px',
            // Opaque rows: a wrapped (multi-line) entry shifts the page rules
            // by one GRID below it; rows paint over them and draw their own
            // line via the bottom border, so entries never get struck through.
            backgroundColor: PAPER,
            '&:hover': { backgroundImage: `linear-gradient(${accentWash}, ${accentWash})` },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:hover': { backgroundColor: accentWash },
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? accentInk}`, outlineOffset: -2 },
          }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&:focus-visible': { outline: `2px solid ${theme.focusRing ?? accentInk}`, outlineOffset: 2 },
          }),
        },
      },
      MuiAlert: {
        defaultProps: { severity: 'error', icon: false, variant: 'standard' },
        styleOverrides: {
          root: {
            background: 'none',
            color: '#a03123',
            padding: 0,
            fontSize: '0.8rem',
            lineHeight: 1.55,
          },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: LINE } },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            fontFamily: FONT_MONO,
            fontSize: '0.72rem',
            letterSpacing: '0.1em',
            padding: '0.2rem 0.7rem',
            color: INK_SOFT,
            borderColor: LINE_STRONG,
            backgroundColor: PAPER_RAISED,
            '&:hover': { backgroundColor: accentWash },
            '&.Mui-selected': {
              backgroundColor: INK,
              color: PAPER,
              '&:hover': { backgroundColor: INK },
            },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'transparent' },
        styleOverrides: {
          root: {
            backgroundColor: PAPER_RAISED,
            backgroundImage: 'none',
            color: INK,
            border: 'none',
            borderBottom: `1.5px solid ${LINE_STRONG}`,
            boxShadow: 'none',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: PAPER_RAISED,
            backgroundImage: 'none',
            borderRight: `1.5px solid ${LINE_STRONG}`,
            boxShadow: 'none',
          },
        },
      },
    },
  });
};

export type AsElement = { component?: ElementType };

export const CardTitle = styled(Typography)<AsElement>({ fontSize: '1.6rem' });

export const Wordmark = styled(CardTitle)({ letterSpacing: 'normal' });

export const ShellWordmark = styled(Wordmark)<AsElement>(({ theme }) => ({
  fontSize: '1.25rem',
  [theme.breakpoints.up('md')]: { fontSize: '1.6rem' },
}));

export const CompactWordmark = styled(Wordmark)(({ theme }) => ({
  color: theme.palette.text.primary,
  fontSize: '0.95rem',
  fontWeight: 600,
}));

export const CheckoutPrice = styled(Typography)<AsElement>(({ theme }) => ({
  color: theme.palette.text.primary,
  fontSize: '1.375rem',
  fontWeight: 650,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.3,
}));

export const CheckoutPriceOption = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'selected',
})<{ selected: boolean }>(({ selected, theme }) => ({
  ...(selected
    ? {
        borderColor: theme.palette.text.primary,
        backgroundColor: theme.palette.action.selected,
      }
    : {}),
}));

export const CheckoutDisclosureButton = styled(Button)(({ theme }) => ({
  color: theme.palette.text.primary,
}));

export const PostToolbarButton = styled(Button)({ whiteSpace: 'nowrap' });

export const PostMetaButton = styled(Button)(({ theme }) => ({
  whiteSpace: 'nowrap',
  padding: 0,
  minWidth: 0,
  fontWeight: 500,
  fontSize: 'inherit',
  lineHeight: 'inherit',
  color: linkInk(theme),
  textUnderlineOffset: '0.15em',
  '&:hover': { backgroundColor: 'transparent', textDecoration: 'underline' },
}));

export const EmberCtaButton = styled(Button)(({ theme }) => {
  const surface = theme.emberCta?.main ?? theme.palette.primary.main;
  const hover = theme.emberCta?.hover ?? theme.palette.primary.light;
  const active = theme.emberCta?.active ?? theme.palette.primary.dark;
  const ink = theme.emberCta?.contrastText ?? theme.palette.primary.contrastText;
  const fill = {
    backgroundColor: surface,
    color: ink,
    boxShadow: 'none',
    '&:hover': { backgroundColor: hover, color: ink, boxShadow: 'none' },
    '&:active': { backgroundColor: active, color: ink },
  };
  return {
    ...fill,
    // At equal specificity emotion's insertion order decides between this wrapper and
    // the contained styleOverride, so the ember fill is pinned on the variant class too.
    '&.MuiButton-contained': fill,
    '&.Mui-disabled, &.MuiButton-contained.Mui-disabled': {
      backgroundColor: theme.palette.action.disabledBackground,
      color: theme.palette.action.disabled,
      boxShadow: 'none',
    },
  };
});

export const EmberCtaLink = styled(EmberCtaButton)<{ component?: ElementType; to?: string }>({});

export const QuietNotice = styled(Paper)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.6rem',
  padding: '0.6rem 0.9rem',
  backgroundColor: theme.palette.action.hover,
  color: theme.palette.text.secondary,
  ...theme.typography.body2,
  '& a': { marginLeft: 'auto', whiteSpace: 'nowrap' },
}));

export const Eyebrow = styled(Typography)<AsElement>({ fontSize: '0.78rem' });

export const ProgressPercentText = styled(Typography)<AsElement>(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontSize: '0.6875rem',
  fontVariantNumeric: 'tabular-nums',
}));

export const LessonLinkButton = styled(Button)<AsElement & { href?: string; target?: string; rel?: string }>({
  maxWidth: '100%',
  whiteSpace: 'normal',
  textAlign: 'left',
  overflowWrap: 'anywhere',
  '& .MuiButton-startIcon': { flexShrink: 0 },
});

export const LedgerBreadcrumbs = styled(Breadcrumbs)({
  '& .MuiBreadcrumbs-li:first-of-type': {
    minWidth: 0,
    '& > *': {
      display: 'block',
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  },
});

export const LedgerTitle = styled(Typography, {
  shouldForwardProp: (prop) => prop !== 'dense',
})<AsElement & { dense?: boolean }>(({ theme, dense }) =>
  dense === true ? { [theme.breakpoints.down('md')]: { fontSize: '1.375rem' } } : {},
);

export const FinePrint = styled(Typography)<AsElement>({ fontSize: '0.75rem' });


export const EntryDate = styled(Typography)<AsElement & { dateTime?: string }>(({ theme }) => ({
  whiteSpace: 'nowrap',
  fontSize: 'inherit',
  fontFamily: theme.numericFontFamily,
  fontVariantNumeric: theme.numericFontFamily === undefined ? undefined : 'tabular-nums',
}));

export const DataValue = styled('span')(({ theme }) => ({
  fontFamily: theme.numericFontFamily,
  fontVariantNumeric: theme.numericFontFamily === undefined ? undefined : 'tabular-nums',
  color: theme.moneyColor,
}));

export const MemberProductLink = styled(Box)<AsElement & { to?: string }>(({ theme }) => ({
  fontWeight: 700,
  color: theme.palette.text.primary,
  textDecorationColor: alpha(theme.palette.text.primary, 0.4),
}));

export const PublishedStatus = styled('span')(({ theme }) => ({
  ...(theme.statusAccent === undefined
    ? {}
    : {
        '&::before': {
          display: 'inline-block',
          width: 7,
          height: 7,
          marginRight: 8,
          borderRadius: '50%',
          backgroundColor: theme.statusAccent,
          content: '""',
          verticalAlign: 'middle',
        },
      }),
}));

export const ChecklistDoneLabel = styled('span')(({ theme }) => ({
  textDecoration: 'line-through',
  textDecorationColor: alpha(theme.palette.text.primary, 0.4),
  color: theme.palette.text.secondary,
}));

export const DemoValue = styled('code')(({ theme }) => ({ color: theme.palette.text.primary }));

export const LedgerHeader = styled(Box)<AsElement>(({ theme }) => ({
  borderBottom: theme.headerRule ?? `3px double ${alpha(theme.palette.text.primary, 0.55)}`,
}));

export const MemberLedgerHeader = styled(LedgerHeader)<AsElement>(({ theme }) => ({
  borderBottomColor: theme.palette.mode === 'dark' ? '#33363C' : '#D6D4D0',
}));

/** Live accent preview in the branding settings; transparent until a valid color is typed. */
export const BrandSwatch = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'swatchColor',
})<{ swatchColor: string | null }>(({ theme, swatchColor }) => ({
  width: '2.1rem',
  height: '2.1rem',
  flexShrink: 0,
  borderRadius: '0.4rem',
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: swatchColor ?? 'transparent',
}));

export const AppBarTitle = styled(Typography)<AsElement>({
  fontSize: '1.05rem',
  fontWeight: 700,
  lineHeight: 1.2,
});

export const AppBarWordmark = styled('img')({
  display: 'block',
  height: 20,
  width: 'auto',
  alignSelf: 'flex-start',
  opacity: 0.62,
});

export const TenantListItemText = styled(ListItemText)({
  '& .MuiListItemText-primary': { fontWeight: 700 },
});

export const BreakAllText = styled(Typography)<AsElement>({ wordBreak: 'break-all' });

export const PanelNavItem = styled(ListItemButton)(({ theme }) => ({
  borderRadius: theme.shape.borderRadius,
  marginBottom: 2,
  paddingTop: 8,
  paddingBottom: 8,
  color: theme.palette.text.secondary,
  '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 34 },
  '&:hover': { backgroundColor: theme.palette.action.hover },
  '&.Mui-selected': {
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.action.selected,
    '& .MuiListItemIcon-root': { color: theme.palette.text.primary },
    '&:hover': { backgroundColor: theme.palette.action.hover },
  },
}));

export const NotificationMenuItem = styled(MenuItem)({
  whiteSpace: 'normal',
  alignItems: 'flex-start',
});

export const NotificationTitle = styled(Typography, {
  shouldForwardProp: (prop) => prop !== 'unread',
})<AsElement & { unread?: boolean }>(({ unread }) => ({
  fontSize: '0.9rem',
  fontWeight: unread === true ? 700 : 500,
}));

export const NotificationSnippet = styled(Typography)<AsElement>(({ theme }) => ({
  fontSize: '0.8rem',
  color: theme.palette.text.secondary,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
}));

export const NotificationRowButton = styled(ButtonBase)({
  display: 'flex',
  width: '100%',
  textAlign: 'left',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
});

export const CountBadge = styled('span')(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 18,
  minWidth: 18,
  padding: '0 6px',
  borderRadius: 999,
  backgroundColor: theme.palette.text.primary,
  color: theme.palette.background.default,
  fontSize: '0.6875rem',
  fontWeight: 600,
  flexShrink: 0,
}));

export const LockedSpaceMark = styled(Box)(({ theme }) => ({
  width: 36,
  height: 36,
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  borderRadius: '8px',
  backgroundColor: theme.palette.action.hover,
}));

export const UnreadDot = styled('span')(({ theme }) => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  marginTop: 6,
  borderRadius: '50%',
  backgroundColor: theme.palette.text.primary,
  flexShrink: 0,
}));

export const NotificationBellIcon = styled(SvgIcon)({
  fontSize: '1.25rem',
});

/** The member shell keeps its identity block in the bottom-left corner, where a default snackbar would land. */
export const SHELL_SNACKBAR_ANCHOR = { vertical: 'bottom', horizontal: 'right' } as const;

export const AccessLockIcon = styled(SvgIcon)(({ theme }) => ({
  fontSize: '1.05rem',
  color: theme.palette.text.disabled,
}));

export const AccessLockOpenIcon = styled(SvgIcon)(({ theme }) => ({
  fontSize: '1.05rem',
  color: theme.palette.text.secondary,
}));

export const CompletionCheckIcon = styled(SvgIcon)(({ theme }) => ({
  fontSize: '1.15rem',
  color: theme.palette.success.main,
}));

export const CompletionPartialIcon = styled(SvgIcon)(({ theme }) => ({
  fontSize: '1.15rem',
  color: theme.palette.success.main,
}));

export const SearchHighlight = styled('mark')(({ theme }) => ({
  backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.22 : 0.14),
  color: 'inherit',
  borderRadius: 2,
  padding: '0 1px',
}));

export const TreeModuleTitle = styled(Typography)<AsElement>({
  fontSize: '0.8125rem',
  fontWeight: 600,
  lineHeight: 1.3,
});

export const TreeChapterTitle = styled(Typography)<AsElement>(({ theme }) => ({
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: theme.palette.text.secondary,
}));

export const TreeLessonTitle = styled(Typography)<AsElement>({ fontSize: '0.8125rem' });

export const TreeProgressCount = styled(Typography)<AsElement>(({ theme }) => ({
  fontSize: '0.6875rem',
  color: theme.palette.text.secondary,
  fontFamily: theme.numericFontFamily,
  fontVariantNumeric: theme.numericFontFamily === undefined ? undefined : 'tabular-nums',
}));

export const ReorderCard = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'dropTarget',
})<{ dropTarget?: boolean }>(({ theme, dropTarget }) => ({
  backgroundColor: dropTarget === true ? alpha(theme.palette.text.primary, 0.08) : undefined,
}));

export const ReorderRow = styled(ListItem, {
  shouldForwardProp: (prop) => prop !== 'dropTarget',
})<{ dropTarget?: boolean }>(({ theme, dropTarget }) => ({
  borderRadius: theme.shape.borderRadius,
  backgroundColor: dropTarget === true ? alpha(theme.palette.text.primary, 0.08) : undefined,
}));

export const ReorderDragHandle = styled('span', {
  shouldForwardProp: (prop) => prop !== 'pending',
})<{ pending?: boolean }>(({ theme, pending }) => ({
  alignItems: 'center',
  color: theme.palette.text.secondary,
  cursor: pending === true ? 'default' : 'grab',
  display: 'inline-flex',
  justifyContent: 'center',
  minHeight: '2rem',
  minWidth: '2rem',
  opacity: pending === true ? 0.38 : 1,
  userSelect: 'none',
}));

export const TreeCaret = styled(SvgIcon)(({ theme }) => ({
  fontSize: '1.15rem',
  color: theme.palette.text.secondary,
}));

export const CourseCardRoot = styled(Box)<AsElement & { to?: string }>(({ theme }) => ({
  display: 'block',
  height: '100%',
  overflow: 'hidden',
  textDecoration: 'none',
  color: 'inherit',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  '&:hover': {
    borderColor: theme.palette.text.primary,
    boxShadow: `0 1px 0 ${alpha(theme.palette.text.primary, 0.12)}`,
  },
  '&:focus-visible': {
    outline: 'none',
    boxShadow: `0 0 0 3px ${alpha(theme.focusRing ?? theme.palette.primary.main, 0.5)}`,
  },
}));

export const VisuallyHidden = styled('span')({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
});

export const CourseCardCover = styled('img')(({ theme }) => ({
  display: 'block',
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

export const CourseCardCoverFallback = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  aspectRatio: '16 / 9',
  backgroundColor: alpha(theme.palette.text.primary, 0.06),
  color: theme.palette.text.primary,
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

export const CourseCardInitials = styled(Typography)<AsElement>({
  fontSize: '2.1rem',
  fontWeight: 700,
  letterSpacing: '0.12em',
});

export const CourseCoverImage = styled('img')(({ theme }) => ({
  display: 'block',
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
}));

export const CoverPreviewSurface = styled(Box)(({ theme }) => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  maxWidth: '30rem',
  aspectRatio: '16 / 9',
  overflow: 'hidden',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.action.hover,
  color: theme.palette.text.secondary,
}));

export const CoverPreviewIcon = styled(SvgIcon)({
  fontSize: '2.5rem',
});

export const CoverPreviewImage = styled('img')({
  position: 'absolute',
  inset: 0,
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'cover',
});

export const StatTile = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.8rem 1rem',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.paper,
}));

export const CourseStatTile = styled(StatTile)(({ theme }) => ({
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.4rem',
  padding: '0.75rem',
  [theme.breakpoints.up('sm')]: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '1rem',
  },
}));

export const StatTileButton = styled(ButtonBase)(({ theme }) => ({
  display: 'flex',
  alignItems: 'stretch',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  gap: '0.2rem',
  height: '100%',
  minHeight: '7rem',
  padding: '0.9rem 1rem',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.paper,
  textAlign: 'left',
  fontFamily: theme.typography.fontFamily,
  transition: 'border-color 120ms ease',
  '&:hover': { borderColor: theme.palette.text.primary },
  '&:focus-visible': {
    outline: `2px solid ${theme.focusRing ?? theme.palette.primary.main}`,
    outlineOffset: 2,
  },
}));

export const StatTileIcon = styled(SvgIcon)(({ theme }) => ({
  fontSize: '1.3rem',
  color: theme.palette.text.primary,
}));

export const StatTileValue = styled(Typography)<AsElement>(({ theme }) => ({
  fontSize: '1.02rem',
  fontWeight: 700,
  lineHeight: 1.25,
  fontFamily: theme.numericFontFamily,
  fontVariantNumeric: theme.numericFontFamily === undefined ? undefined : 'tabular-nums',
}));

export const StatTileLabel = styled(Typography)<AsElement>(({ theme }) => ({
  fontSize: '0.75rem',
  letterSpacing: '0.02em',
  textTransform: 'none',
  color: theme.palette.text.secondary,
}));

export const ResponsiveTableRoot = styled(Box)(({ theme }) => ({
  overflowX: 'auto',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: 12,
  '& th:first-of-type, & td:first-of-type': {
    position: 'sticky',
    left: 0,
    zIndex: 1,
    backgroundColor: theme.palette.background.paper,
    boxShadow: `2px 0 0 ${alpha(theme.palette.common.black, 0.08)}`,
    [theme.breakpoints.up('sm')]: {
      position: 'static',
      boxShadow: 'none',
      backgroundColor: 'inherit',
    },
  },
  '& th:first-of-type': { zIndex: 2 },
}));

export const RailProgressBar = styled(LinearProgress)(({ theme }) => ({
  height: 6,
  borderRadius: 999,
  backgroundColor: theme.palette.divider,
  '& .MuiLinearProgress-bar': {
    borderRadius: 999,
    backgroundColor: theme.palette.text.primary,
  },
}));

export const LessonDurationText = styled('span')(({ theme }) => ({
  whiteSpace: 'nowrap',
  flexShrink: 0,
  fontSize: '0.6875rem',
  color: theme.palette.text.disabled,
  fontFamily: theme.numericFontFamily,
  fontVariantNumeric: theme.numericFontFamily === undefined ? undefined : 'tabular-nums',
}));

export const SidebarProgressPercent = styled(Typography)<AsElement>(({ theme }) => ({
  fontSize: '0.6875rem',
  color: theme.palette.text.secondary,
  fontFamily: theme.numericFontFamily,
  fontVariantNumeric: theme.numericFontFamily === undefined ? undefined : 'tabular-nums',
}));

export const CourseCompletedNote = styled(Typography)<AsElement>(({ theme }) => ({
  fontWeight: 600,
  color: theme.palette.success.main,
}));

export const EmptyStateIcon = styled(SvgIcon)(({ theme }) => ({
  fontSize: '1.15rem',
  color: theme.palette.text.secondary,
}));

export const EmptyStateContent = styled(Stack)({
  alignItems: 'center',
  textAlign: 'center',
});

export const LessonMediaFrame = styled(Box)(({ theme }) => ({
  position: 'relative',
  width: '100%',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.default,
}));

export const LessonMediaClip = styled(Box)(({ theme }) => ({
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  borderRadius: theme.shape.borderRadius,
}));

export const LessonMediaIframe = styled('iframe')({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  border: 0,
  display: 'block',
});

export const LessonPlaceholder = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  minHeight: '9rem',
  padding: '2rem',
  border: `1px dashed ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  color: theme.palette.text.secondary,
  backgroundColor: theme.palette.background.default,
}));

export const LessonHtmlContent = styled(Box)(({ theme }) => ({
  overflowWrap: 'anywhere',
  '& img': { maxWidth: '100%', height: 'auto' },
  '& iframe': { maxWidth: '100%' },
  '& a': { color: theme.palette.text.primary },
  '& pre': {
    overflowX: 'auto',
    padding: '0.75rem',
    borderRadius: theme.shape.borderRadius,
    backgroundColor: alpha(theme.palette.text.primary, 0.05),
  },
}));

export const LessonFooterBar = styled(Box)<AsElement>(({ theme }) => ({
  borderTop: `1px solid ${theme.palette.divider}`,
}));

export const LessonBlockIcon = styled(SvgIcon)(({ theme }) => ({
  fontSize: '1.1rem',
  color: theme.palette.text.secondary,
}));

export const LockedStateIcon = styled(SvgIcon)(({ theme }) => ({
  fontSize: '3rem',
  color: theme.palette.text.disabled,
}));

export const DiscussionThread = styled(Box)(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.paper,
}));

export const ConversationCard = styled(Box)<AsElement & { to?: string }>(({ theme }) => ({
  display: 'block',
  padding: '0.9rem 1.1rem',
  textDecoration: 'none',
  color: 'inherit',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.paper,
  transition: 'border-color 120ms ease, background-color 120ms ease',
  '&:hover': {
    borderColor: theme.palette.text.primary,
    backgroundColor: theme.palette.action.hover,
  },
  '&:focus-visible': {
    outline: 'none',
    boxShadow: `0 0 0 3px ${alpha(theme.focusRing ?? theme.palette.primary.main, 0.5)}`,
  },
}));

export const MessageBubble = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'own',
})<{ own?: boolean }>(({ theme, own }) => ({
  maxWidth: 'min(36rem, 82%)',
  alignSelf: own === true ? 'flex-end' : 'flex-start',
  padding: '0.6rem 0.85rem',
  borderRadius: theme.shape.borderRadius,
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: own === true ? theme.palette.action.selected : theme.palette.background.paper,
}));

export const ReplyIndent = styled(Box)(({ theme }) => ({
  borderLeft: `2px solid ${alpha(theme.palette.text.primary, 0.2)}`,
  paddingLeft: '1rem',
  marginLeft: '0.35rem',
}));

export const AuthorChip = styled('span')(({ theme }) => ({
  display: 'inline-block',
  padding: '0.05rem 0.5rem',
  borderRadius: 999,
  fontSize: '0.68rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: theme.palette.text.primary,
  backgroundColor: alpha(theme.palette.text.primary, 0.08),
  border: `1px solid ${alpha(theme.palette.text.primary, 0.25)}`,
}));

export const PostAuthorName = styled(Typography)<AsElement>({
  fontSize: '0.9rem',
  fontWeight: 700,
});

export const PostMetaText = styled(Typography)<AsElement & { dateTime?: string }>(({ theme }) => ({
  fontSize: '0.75rem',
  color: theme.palette.text.secondary,
  fontFamily: theme.numericFontFamily,
}));

export const PostBody = styled(Typography)<AsElement>({
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

export const DeletedPostText = styled(Typography)<AsElement>(({ theme }) => ({
  fontStyle: 'italic',
  color: theme.palette.text.secondary,
}));

export const NotificationDot = styled('span', {
  shouldForwardProp: (prop) => prop !== 'active',
})<{ active?: boolean }>(({ theme, active }) => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor:
    active === true ? theme.palette.success.main : alpha(theme.palette.text.primary, 0.25),
  flexShrink: 0,
}));

export const PendingPostBox = styled(Box)({ opacity: 0.55 });

export const DiscussionHitSnippet = styled(Typography)<AsElement>(({ theme }) => ({
  fontSize: '0.85rem',
  color: theme.palette.text.secondary,
  overflowWrap: 'anywhere',
}));

export const ThreadHeadline = styled('span')({
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
