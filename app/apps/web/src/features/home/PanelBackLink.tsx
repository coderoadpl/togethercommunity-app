import type { MouseEvent, ReactNode } from 'react';
import { Link as MuiLink } from '@mui/material';
import { Link } from '@tanstack/react-router';

export const PanelBackLink = ({
  to,
  children,
  onClick,
}: {
  to: string;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) => <MuiLink component={Link} to={to} onClick={onClick}>{children}</MuiLink>;
