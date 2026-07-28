import type { ReactNode } from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';

import type { CampaignStatus } from '#core/domain/index.js';

import { EntryDate } from '../../../theme.js';

const statusColor: Record<CampaignStatus, 'default' | 'info' | 'primary' | 'warning' | 'error' | 'success'> = {
  draft: 'default',
  scheduled: 'info',
  running: 'primary',
  paused: 'warning',
  cancelled: 'error',
  finished: 'success',
};

export const CampaignStatusChip = ({ status, label }: { status: CampaignStatus; label: string }) => (
  <Chip size="small" color={statusColor[status]} variant="outlined" label={label} />
);

export const MarketingSummaryRow = ({
  title,
  chips,
  summary,
  date,
  actions,
  children,
  testId,
}: {
  title: ReactNode;
  chips?: ReactNode;
  summary?: ReactNode;
  date?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) => (
  <Paper elevation={1} sx={{ p: '1rem' }} data-testid={testId}>
    <Stack useFlexGap spacing="0.75rem">
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: { sm: 'center' } }}>
        <Typography variant="h2" component="h2">{title}</Typography>
        {chips}
        {actions === undefined ? null : (
          <Box sx={{ ml: { sm: 'auto' }, '& .MuiButtonBase-root': { minHeight: '44px' } }}>{actions}</Box>
        )}
      </Stack>
      {summary === undefined ? null : <Typography variant="body2">{summary}</Typography>}
      {date === undefined ? null : <EntryDate component="div">{date}</EntryDate>}
      {children}
    </Stack>
  </Paper>
);
