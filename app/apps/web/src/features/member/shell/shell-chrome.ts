import type { ElementType } from 'react';
import { Box } from '@mui/material';
import { styled } from '@mui/material/styles';

import { PanelNavItem } from '../../../theme.js';

export type ShellLinkProps = { component?: ElementType; to?: string };

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
