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
    title: 'Usunąć lekcję?',
    body: (
      <Typography variant="body1">
        Lekcja „Zmienne i typy” zostanie trwale usunięta wraz z całą dyskusją. Tej operacji nie
        można cofnąć.
      </Typography>
    ),
    confirmLabel: 'Usuń lekcję',
    cancelLabel: 'Anuluj',
  },
};

export const Pending: Story = {
  args: {
    title: 'Usunąć lekcję?',
    body: (
      <Typography variant="body1">
        Trwa usuwanie — poczekaj chwilę.
      </Typography>
    ),
    confirmLabel: 'Usuwanie…',
    cancelLabel: 'Anuluj',
    pending: true,
  },
};
