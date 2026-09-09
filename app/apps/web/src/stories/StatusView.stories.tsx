import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Button } from '@mui/material';

import { StatusView } from '../components/layout/StatusView.js';

const meta = {
  title: 'Layout/StatusView',
  component: StatusView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '44rem', mx: 'auto' }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof StatusView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: {
    state: { kind: 'loading', label: 'Loading learners…' },
  },
};

export const ErrorWithRetry: Story = {
  args: {
    state: {
      kind: 'error',
      message: 'Could not load the data. Check your connection and try again.',
      retry: { label: 'Try again', onRetry: () => undefined },
    },
  },
};

export const Empty: Story = {
  args: {
    state: {
      kind: 'empty',
      title: 'You have no courses yet',
      body: 'Create your first course to start teaching.',
      action: <Button variant="contained">Create course</Button>,
    },
  },
};

export const NotFound: Story = {
  args: {
    state: {
      kind: 'not-found',
      title: 'Course not found',
      body: 'This course may have been removed or you may not have access.',
      action: <Button variant="outlined">Back to my courses</Button>,
    },
  },
};
