import type { Meta, StoryObj } from '@storybook/react-vite';
import { Typography } from '@mui/material';

import { ConfirmDialog } from '../components/layout/ConfirmDialog.js';

const meta = {
  title: 'Layout/ConfirmDialog',
  component: ConfirmDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    onConfirm: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    title: 'Delete lesson?',
    body: (
      <Typography variant="body1">
        The "Variables and types" lesson will be permanently deleted along with the full discussion.
        This cannot be undone.
      </Typography>
    ),
    confirmLabel: 'Delete lesson',
    cancelLabel: 'Cancel',
  },
};

export const Pending: Story = {
  args: {
    title: 'Delete lesson?',
    body: (
      <Typography variant="body1">
        Deleting — please wait a moment.
      </Typography>
    ),
    confirmLabel: 'Deleting…',
    cancelLabel: 'Cancel',
    pending: true,
  },
};
