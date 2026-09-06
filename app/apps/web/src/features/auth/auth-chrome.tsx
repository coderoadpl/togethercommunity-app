import type { ElementType } from 'react';
import { Box, Button, ButtonBase, Link as MuiLink, OutlinedInput, Typography } from '@mui/material';
import { alpha, styled, type CSSObject, type PaletteMode, type Theme } from '@mui/material/styles';

import { accentOnSurface } from '../../theme-branding.js';

/**
 * Auth-local tokens: the surface raises its own borders and rings to the
 * non-text minimum without moving global theme tokens, so nothing here can
 * regress the signed-in app.
 */
export const AUTH_BACKGROUND: Record<PaletteMode, string> = { light: '#F7F4EF', dark: '#0F1012' };
export const AUTH_BORDER: Record<PaletteMode, string> = { light: '#8C8A85', dark: '#666B73' };
const GLOW_OPACITY: Record<PaletteMode, number> = { light: 0.5, dark: 0.22 };

const AUTH_TEXT_MIN = 4.5;

export const authRing = (accent: string, mode: PaletteMode): string =>
  accentOnSurface(accent, AUTH_BACKGROUND[mode]);

export const authLinkInk = (accent: string, mode: PaletteMode): string =>
  accentOnSurface(accent, AUTH_BACKGROUND[mode], AUTH_TEXT_MIN);

const authFocusRing = (theme: Theme): CSSObject => ({
  outlineWidth: 3,
  outlineStyle: 'solid',
  outlineColor: authRing(theme.palette.primary.main, theme.palette.mode),
  outlineOffset: 2,
  boxShadow: 'none',
});

export const authFocusScope = (theme: Theme): CSSObject => ({
  '& .Mui-focusVisible': authFocusRing(theme),
  '& .MuiButtonBase-root:focus-visible': authFocusRing(theme),
  '& .MuiLink-root:focus-visible': authFocusRing(theme),
});

export const AuthPage = styled(Box)<{ component?: ElementType }>(({ theme }) => ({
  position: 'relative',
  isolation: 'isolate',
  overflowX: 'clip',
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: AUTH_BACKGROUND[theme.palette.mode],
  color: theme.palette.text.primary,
  ...authFocusScope(theme),
}));

export const AuthGlow = styled('span', {
  shouldForwardProp: (prop) => prop !== 'accent',
})<{ accent: string }>(({ theme, accent }) => ({
  position: 'absolute',
  zIndex: -1,
  pointerEvents: 'none',
  top: '-22vw',
  right: '-18vw',
  width: 'min(58vw, 760px)',
  aspectRatio: '1',
  filter: 'blur(72px)',
  opacity: GLOW_OPACITY[theme.palette.mode],
  background: `radial-gradient(closest-side, ${alpha(accent, 0.55)} 0%, ${alpha(accent, 0.55)} 40%, ${alpha(accent, 0.42)} 62%, ${alpha(accent, 0.16)} 82%, ${alpha(accent, 0)} 100%)`,
  [theme.breakpoints.down('sm')]: { top: '-46vw', right: '-38vw', width: '110vw' },
}));

export const AuthHeader = styled(Box)<{ component?: ElementType }>(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '1rem 1.25rem',
  [theme.breakpoints.up('sm')]: { padding: '1.5rem clamp(1.5rem, 4vw, 3rem)' },
}));

export const AuthBrandRow = styled(Box)<{ component?: ElementType; to?: string }>({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.6rem',
  minWidth: 0,
  color: 'inherit',
  textDecoration: 'none',
});

export const AuthControls = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flex: 'none',
});

export const AuthStage = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  padding: '0.5rem 1.25rem calc(3rem + env(safe-area-inset-bottom))',
  [theme.breakpoints.up('sm')]: {
    justifyContent: 'center',
    padding: '2rem clamp(1.5rem, 4vw, 3rem) 4rem',
  },
}));

export const AuthColumn = styled(Box)({
  width: '100%',
  maxWidth: '28rem',
  '@media (prefers-reduced-motion: no-preference)': {
    animation: 'settle 0.4s ease-out both',
  },
});

export const AuthMain = styled(Box)<{ component?: ElementType }>({ display: 'block' });

export const AuthTitle = styled(Typography)<{ component?: ElementType }>(({ theme }) => ({
  fontSize: '1.75rem',
  fontWeight: 700,
  lineHeight: 1.14,
  letterSpacing: '-0.03em',
  margin: 0,
  [theme.breakpoints.up('sm')]: { fontSize: '2.5rem' },
}));

export const AuthLead = styled(Typography)<{ component?: ElementType }>(({ theme }) => ({
  marginTop: '0.5rem',
  fontSize: '1rem',
  color: theme.palette.text.secondary,
  '& strong': { color: theme.palette.text.primary, fontWeight: 600 },
}));

export const AuthHelp = styled(Typography)<{ component?: ElementType }>(({ theme }) => ({
  fontSize: '0.875rem',
  color: theme.palette.text.secondary,
}));

export const AuthInput = styled(OutlinedInput)(({ theme }) => ({
  backgroundColor: theme.palette.background.paper,
  '& .MuiOutlinedInput-input': { fontSize: '1rem', padding: '0.7rem 0.9rem', minHeight: '1.6rem' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: AUTH_BORDER[theme.palette.mode] },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.text.secondary },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderWidth: 2,
    borderColor: authRing(theme.palette.primary.main, theme.palette.mode),
  },
}));

export const AuthButton = styled(Button)<{
  component?: ElementType;
  href?: string;
  to?: string;
}>({ minHeight: 48 });

export const AuthDivider = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  margin: '1.5rem 0 1rem',
  fontSize: '0.8125rem',
  color: theme.palette.text.secondary,
  '&::before, &::after': {
    content: '""',
    flex: 1,
    height: '1px',
    backgroundColor: theme.palette.divider,
  },
}));

export const AuthIdentityChip = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  width: 'fit-content',
  maxWidth: '100%',
  marginBottom: '1.25rem',
  padding: '0.15rem 0.9rem 0.15rem 0.5rem',
  fontSize: '0.9375rem',
  borderRadius: '999px',
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.action.hover,
}));

export const AuthIdentityAvatar = styled('span')(({ theme }) => ({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  width: 28,
  height: 28,
  borderRadius: '50%',
  fontSize: '0.75rem',
  fontWeight: 700,
  backgroundColor: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
}));

export const AuthIdentityEmail = styled('span')({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const AuthMethodList = styled('ul')({
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'grid',
  gap: '0.75rem',
});

export const AuthMethodCard = styled('li', {
  shouldForwardProp: (prop) => prop !== 'featured',
})<{ featured?: boolean }>(({ theme, featured }) => ({
  borderRadius: 14,
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${featured === true ? authRing(theme.palette.primary.main, theme.palette.mode) : AUTH_BORDER[theme.palette.mode]}`,
}));

const methodHead: CSSObject = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: '0.85rem',
  width: '100%',
  minHeight: 64,
  padding: '0.9rem 1rem',
  textAlign: 'left',
  borderRadius: 14,
  color: 'inherit',
};

export const AuthMethodHead = styled(Box)(methodHead);

export const AuthMethodButton = styled(ButtonBase)(({ theme }) => ({
  ...methodHead,
  '&:hover': { backgroundColor: theme.palette.action.hover },
}));

export const AuthMethodIcon = styled('span')(({ theme }) => ({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  width: 40,
  height: 40,
  borderRadius: 10,
  backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.14),
  color: authRing(theme.palette.primary.main, theme.palette.mode),
  '& .MuiSvgIcon-root': { fontSize: '1.375rem' },
}));

export const AuthMethodTitle = styled('span')({ display: 'block', fontWeight: 600 });

export const AuthMethodChevron = styled('span')(({ theme }) => ({
  display: 'inline-flex',
  marginLeft: 'auto',
  flex: 'none',
  color: theme.palette.text.disabled,
}));

export const AuthMethodBody = styled('span')(({ theme }) => ({
  display: 'block',
  fontSize: '0.875rem',
  color: theme.palette.text.secondary,
}));

export const AuthMethodPanel = styled(Box)(({ theme }) => ({
  padding: '1rem',
  borderTop: `1px solid ${theme.palette.divider}`,
}));

export const AuthFooter = styled(Box)<{ component?: ElementType }>(({ theme }) => ({
  display: 'grid',
  gap: '0.6rem',
  marginTop: '2.25rem',
  paddingTop: '1.25rem',
  borderTop: `1px solid ${theme.palette.divider}`,
  fontSize: '0.875rem',
  color: theme.palette.text.secondary,
}));

export const AuthFooterRow = styled(Box)({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.25rem 1rem',
});

export const AuthFooterLink = styled(MuiLink)<{ component?: ElementType; to?: string }>(({ theme }) => ({
  color: theme.palette.text.secondary,
  textDecorationLine: 'underline',
  textDecorationColor: alpha(theme.palette.text.secondary, 0.45),
  textUnderlineOffset: '0.15em',
  '&:hover': { textDecorationColor: 'currentColor' },
}));

export const AuthPoweredBy = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: '0.8125rem',
  color: theme.palette.text.secondary,
}));

export const AuthPoweredByLogo = styled('img')({
  display: 'block',
  width: 'auto',
  height: '1.5rem',
  maxWidth: '100%',
});
