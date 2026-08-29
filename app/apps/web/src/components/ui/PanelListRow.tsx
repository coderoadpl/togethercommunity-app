import type { ReactNode } from 'react';
import { Paper, Stack, Typography } from '@mui/material';

import { PanelRowMeta } from '../../theme.js';

export interface PanelListRowProps {
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}

export const PanelListRow = ({
  title,
  badges,
  meta,
  actions,
  children,
  'data-testid': testId,
}: PanelListRowProps) => (
  <Paper elevation={1} sx={{ p: '1rem', display: 'grid', gap: '0.75rem' }} data-testid={testId}>
    <Stack
      useFlexGap
      sx={{
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'flex-start' },
        gap: '0.5rem',
      }}
    >
      <Stack
        direction="row"
        useFlexGap
        sx={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', flex: 1, minWidth: 0 }}
      >
        <Typography variant="h2" component="h2">
          {title}
        </Typography>
        {badges}
      </Stack>
      {actions === undefined ? null : (
        <Stack
          direction="row"
          useFlexGap
          sx={{
            flexWrap: 'wrap',
            gap: '0.25rem',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}
        >
          {actions}
        </Stack>
      )}
    </Stack>
    {meta === undefined ? null : (
      <PanelRowMeta useFlexGap spacing="0.2rem">
        {meta}
      </PanelRowMeta>
    )}
    {children}
  </Paper>
);
