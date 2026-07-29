import { Box, Chip, Stack } from '@mui/material';

import type { SchedulerRunStatus } from '#core/domain/index.js';

import { StatTile, StatTileLabel, StatTileValue } from '../../../theme.js';

interface SummaryValue {
  label: string;
  value: string;
}

interface LastRunValue extends SummaryValue {
  status?: SchedulerRunStatus;
  statusLabel?: string;
}

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

const SummaryTile = ({ item }: { item: SummaryValue }) => (
  <StatTile>
    <Box sx={{ minWidth: 0 }}>
      <StatTileValue component="p">{item.value}</StatTileValue>
      <StatTileLabel component="p">{item.label}</StatTileLabel>
    </Box>
  </StatTile>
);

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
    <SummaryTile item={failed} />
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
