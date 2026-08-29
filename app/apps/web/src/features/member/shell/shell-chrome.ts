import type { ElementType } from 'react';
import { Box, ButtonBase, Drawer, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';

import { PanelNavItem, type AsElement } from '../../../theme.js';

export type ShellLinkProps = {
  component?: ElementType;
  to?: string;
  activeOptions?: { exact?: boolean };
};

export type ShellVariant = 'drawer' | 'sheet';

export const NavRow = styled(PanelNavItem)<ShellLinkProps>({});

export const SubNavRow = styled(NavRow)({
  paddingLeft: 34,
  '& .MuiListItemIcon-root': { minWidth: 24 },
  '& .MuiSvgIcon-root': { fontSize: '1rem' },
  '& .MuiListItemText-primary': { fontSize: '0.8125rem' },
});

export const UnreadRowText = styled('span')({ fontWeight: 600 });

export const SubUnreadRowText = styled(UnreadRowText)({ fontWeight: 500 });

export const BrandLink = styled(Box)<ShellLinkProps>(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  overflow: 'hidden',
  color: 'inherit',
  textDecoration: 'none',
  borderRadius: theme.shape.borderRadius,
}));

export const SectionHeadingLink = styled(Box)<ShellLinkProps>(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  color: 'inherit',
  textDecoration: 'none',
  borderRadius: theme.shape.borderRadius,
  '&:hover': { textDecoration: 'underline' },
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

export const SidebarColumn = styled(Box)<{ component?: ElementType }>(({ theme }) => ({
  width: '248px',
  flexShrink: 0,
  alignSelf: 'flex-start',
  position: 'sticky',
  top: 0,
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: theme.palette.background.default,
  borderRight: `1px solid ${theme.palette.divider}`,
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
  padding: '12px 10px 8px',
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

export const SheetTitle = styled(Typography)<AsElement>({ fontWeight: 600 });
