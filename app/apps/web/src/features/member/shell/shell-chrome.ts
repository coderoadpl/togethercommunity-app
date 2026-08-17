import type { ElementType } from 'react';
import { Box, ButtonBase, Drawer } from '@mui/material';
import { styled } from '@mui/material/styles';

import { PanelNavItem } from '../../../theme.js';

export type ShellLinkProps = {
  component?: ElementType;
  to?: string;
  activeOptions?: { exact?: boolean };
};

export type ShellVariant = 'drawer' | 'sheet';

export const NavRow = styled(PanelNavItem)<ShellLinkProps>({});

export const BrandLink = styled(Box)<ShellLinkProps>(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  color: 'inherit',
  textDecoration: 'none',
  borderRadius: theme.shape.borderRadius,
}));

export const IdentityRow = styled(Box)<ShellLinkProps>(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.6rem',
  minWidth: 0,
  color: 'inherit',
  textDecoration: 'none',
  borderRadius: theme.shape.borderRadius,
  '&:hover': { backgroundColor: theme.palette.action.hover },
}));

export const TabBar = styled('nav')(({ theme }) => ({
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: theme.zIndex.appBar,
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  backgroundColor: theme.palette.background.paper,
  borderTop: `1px solid ${theme.palette.divider}`,
  paddingTop: '6px',
  paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
}));

export const TabButton = styled(ButtonBase)<ShellLinkProps>(({ theme }) => ({
  minWidth: 0,
  minHeight: '44px',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
  padding: '0.35rem 0.25rem',
  borderRadius: theme.shape.borderRadius,
  color: theme.palette.text.secondary,
  '&:hover': { backgroundColor: theme.palette.action.hover },
  '&[aria-current="page"]': { color: theme.palette.text.primary },
}));

export const SheetDrawer = styled(Drawer)(({ theme }) => ({
  '& .MuiDrawer-paper': {
    backgroundColor: theme.palette.background.paper,
    borderRight: 'none',
    borderTop: `1px solid ${theme.palette.divider}`,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: '80vh',
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
}));

export const SheetHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.6rem 0.6rem 0.6rem 1rem',
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

export const IdentityAvatar = styled('span')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '2rem',
  height: '2rem',
  borderRadius: '999px',
  backgroundColor: theme.palette.action.selected,
  color: theme.palette.text.primary,
  fontSize: '0.75rem',
  fontWeight: 600,
}));
