import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '@mui/material';

import { SchedulerActivitySummary } from '../features/home/marketing/SchedulerActivitySummary.js';

const meta = {
  title: 'Marketing/Scheduler activity summary',
  component: SchedulerActivitySummary,
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '75rem', mx: 'auto' }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    runs: { label: 'Runs — last 24 hours', value: '12' },
    sent: { label: 'Sent — last 24 hours', value: '438' },
    failed: { label: 'Failures — last 24 hours', value: '3' },
    lastRun: {
      label: 'Last run',
      value: '26 Jul 2026, 10:00',
      status: 'completed',
      statusLabel: 'completed',
    },
  },
} satisfies Meta<typeof SchedulerActivitySummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: { viewport: { defaultViewport: 'responsive' } },
};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
