import { Box, Chip, Stack } from '@mui/material';
import { styled } from '@mui/material/styles';
import { Link } from '@tanstack/react-router';

import type { SchedulerRunStatus } from '#core/domain/index.js';

import { StatTile, StatTileLabel, StatTileValue } from '../../../theme.js';

interface SummaryValue {
  label: string;
  value: string;
  count?: number;
  to?: string;
}

interface LastRunValue extends SummaryValue {
  status?: SchedulerRunStatus;
  statusLabel?: string;
}

const ErrorSummaryTile = styled(StatTile)(({ theme }) => ({
  color: theme.palette.error.dark,
  borderColor: theme.palette.error.main,
  textDecoration: 'none',
  '&:hover': {
    borderColor: theme.palette.error.dark,
    backgroundColor: 'rgba(211, 47, 47, 0.08)',
  },
  '&:focus-visible': {
    outline: `2px solid ${theme.palette.error.main}`,
    outlineOffset: 2,
  },
}));

export const SchedulerRunStatusChip = ({
  status,
  label,
}: {
  status: SchedulerRunStatus;
  label: string;
}) => (
  <Chip
    size="small"
    color={status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'warning'}
    label={label}
  />
);

const SummaryTile = ({ item, tone }: { item: SummaryValue; tone?: 'error' }) => {
  const clickable = item.to !== undefined && item.count !== undefined && item.count > 0;
  const highlighted = tone === 'error' && item.count !== undefined && item.count > 0;
  const Tile = highlighted ? ErrorSummaryTile : StatTile;
  return (
    <Tile
      {...(clickable ? { component: Link, to: item.to } : {})}
    >
      <Box sx={{ minWidth: 0 }}>
        <StatTileValue component="p">{item.value}</StatTileValue>
        <StatTileLabel component="p">{item.label}</StatTileLabel>
      </Box>
    </Tile>
  );
};

export const SchedulerActivitySummary = ({
  runs,
  sent,
  failed,
  lastRun,
}: {
  runs: SummaryValue;
  sent: SummaryValue;
  failed: SummaryValue;
  lastRun: LastRunValue;
}) => (
  <Box
    data-testid="scheduler-activity-summary"
    sx={{
      display: 'grid',
      gap: '0.9rem',
      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
    }}
  >
    <SummaryTile item={runs} />
    <SummaryTile item={sent} />
    <SummaryTile item={failed} tone="error" />
    <StatTile>
      <Stack useFlexGap spacing="0.35rem" sx={{ minWidth: 0 }}>
        <StatTileValue component="p">{lastRun.value}</StatTileValue>
        <StatTileLabel component="p">{lastRun.label}</StatTileLabel>
        {lastRun.status === undefined || lastRun.statusLabel === undefined
          ? null
          : <SchedulerRunStatusChip status={lastRun.status} label={lastRun.statusLabel} />}
      </Stack>
    </StatTile>
  </Box>
);
