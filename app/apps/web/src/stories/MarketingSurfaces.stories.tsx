import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Button, Chip, Stack } from '@mui/material';

import { MarketingReadiness } from '../features/home/integrations/MarketingReadiness.js';
import { CampaignStatusChip, MarketingSummaryRow } from '../features/home/marketing/MarketingSummaryRow.js';

const meta = {
  title: 'Marketing/Creator surfaces',
  component: MarketingReadiness,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '60rem', mx: 'auto' }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof MarketingReadiness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SendingReadiness: Story = {
  args: {
    title: 'Sending readiness',
    readyLabel: 'ready',
    blockedLabel: 'action needed',
    enabled: false,
    enabledMessage: 'Campaigns are ready to send.',
    disabledMessage: 'Campaigns remain disabled until the checklist is complete.',
    items: [
      { label: 'SES credentials', ready: true },
      { label: 'Identity and DKIM', ready: true },
      { label: 'SNS webhook test', ready: false },
      { label: 'Footer details', ready: true },
    ],
  },
};

export const CampaignRows: Story = {
  args: {
    title: 'Sending readiness',
    readyLabel: 'ready',
    blockedLabel: 'action needed',
    enabled: true,
    enabledMessage: 'Campaigns are ready to send.',
    disabledMessage: 'Campaigns remain disabled until the checklist is complete.',
    items: [],
  },
  render: () => (
    <Stack useFlexGap spacing="1rem">
      <MarketingSummaryRow
        title="July newsletter"
        chips={
          <>
            <CampaignStatusChip status="running" label="running" />
            <Chip size="small" variant="outlined" label="newsletter" />
          </>
        }
        summary="to send: 240 · sent: 126 · failed: 2"
        date="22 July 2026, 10:30"
        actions={<Button>Open</Button>}
      />
      <MarketingSummaryRow
        title="Course launch"
        chips={<CampaignStatusChip status="paused" label="paused" />}
        summary="to send: 84 · sent: 20 · failed: 5"
        date="21 July 2026, 16:00"
      />
    </Stack>
  ),
};
