import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Paper, Typography } from '@mui/material';

import type { EmailEvent } from '#core/domain/index.js';

import { EmailEventTimeline } from '../features/home/email/index.js';

const events: EmailEvent[] = [
  {
    id: 'queued',
    tenantId: 'tenant-1',
    mailKind: 'marketing',
    refId: 'send-1',
    type: 'queued',
    occurredAt: '2026-07-25T10:00:00.000Z',
    meta: { source: 'broadcast' },
    createdAt: '2026-07-25T10:00:00.000Z',
  },
  {
    id: 'accepted',
    tenantId: 'tenant-1',
    mailKind: 'marketing',
    refId: 'send-1',
    type: 'accepted',
    occurredAt: '2026-07-25T10:00:03.000Z',
    meta: { sesMessageId: '0102019a-message-42', region: 'eu-central-1' },
    createdAt: '2026-07-25T10:00:03.000Z',
  },
  {
    id: 'bounced',
    tenantId: 'tenant-1',
    mailKind: 'marketing',
    refId: 'send-1',
    type: 'bounced',
    occurredAt: '2026-07-25T10:02:00.000Z',
    meta: {
      classification: 'hard',
      rawProviderPayload: { bounceType: 'Permanent', diagnosticCode: 'smtp; 550 mailbox unavailable' },
    },
    createdAt: '2026-07-25T10:02:00.000Z',
  },
];

const meta = {
  title: 'Marketing/Email event timeline',
  component: EmailEventTimeline,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '48rem', mx: 'auto' }}>
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <Typography variant="h2" sx={{ mb: '1rem' }}>Event history</Typography>
          <Story />
        </Paper>
      </Box>
    ),
  ],
} satisfies Meta<typeof EmailEventTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  args: { events },
  globals: { viewport: { value: 'desktop' } },
};

export const Mobile: Story = {
  args: { events },
  globals: { viewport: { value: 'mobile' } },
};
