import type { ReactNode } from 'react';
import { Stack, Typography } from '@mui/material';

export interface AccountSectionProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  headerActions?: ReactNode;
  children?: ReactNode;
}

export const AccountSection = ({ icon, title, description, headerActions, children }: AccountSectionProps) => (
  <Stack useFlexGap spacing="1rem">
    <Stack direction="row" spacing="0.5rem" sx={{ alignItems: 'center' }}>
      {icon}
      <Typography component="h3" variant="subtitle2">{title}</Typography>
    </Stack>
    {description ? <Typography variant="body2">{description}</Typography> : null}
    {headerActions}
    {children}
  </Stack>
);
