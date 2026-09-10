import { ChevronDownIcon } from './account-icons.js';
import type { ReactNode } from 'react';
import { Typography } from '@mui/material';
import { AccountDisclosure } from '../../theme.js';

export const AccountHelp = ({ title, children, testId, inline = false }: { title: string; children: ReactNode; testId?: string; inline?: boolean }) => (
  inline ? <>{children}</> : <AccountDisclosure component="details">
    <Typography component="summary" variant="body2" data-testid={testId}>{title}<ChevronDownIcon /></Typography>
    {children}
  </AccountDisclosure>
);
