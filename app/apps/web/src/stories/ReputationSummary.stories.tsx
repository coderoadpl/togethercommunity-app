import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '@mui/material';

import { ReputationSummary } from '../features/home/integrations/ReputationSummary.js';

const meta = {
  title: 'Marketing/Reputation summary',
  component: ReputationSummary,
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '75rem', mx: 'auto' }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    reputation: {
      windowStart: '2026-07-20T12:00:00.000Z',
      windowEnd: '2026-07-27T12:00:00.000Z',
      hardBounce: { count: 58, sends: 1_000, rate: 0.058, status: 'warn' },
      complaint: { count: 3, sends: 1_000, rate: 0.003, status: 'critical' },
      overallStatus: 'critical',
    },
  },
} satisfies Meta<typeof ReputationSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: { viewport: { defaultViewport: 'desktop' } },
};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile' } },
};
