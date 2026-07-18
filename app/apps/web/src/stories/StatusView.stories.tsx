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
    state: { kind: 'loading', label: 'Wczytywanie kursantów…' },
  },
};

export const ErrorWithRetry: Story = {
  args: {
    state: {
      kind: 'error',
      message: 'Nie udało się wczytać danych. Sprawdź połączenie i spróbuj ponownie.',
      retry: { label: 'Spróbuj ponownie', onRetry: () => undefined },
    },
  },
};

export const Empty: Story = {
  args: {
    state: {
      kind: 'empty',
      title: 'Nie masz jeszcze kursów',
      body: 'Utwórz pierwszy kurs, aby zacząć uczyć.',
      action: <Button variant="contained">Utwórz kurs</Button>,
    },
  },
};

export const NotFound: Story = {
  args: {
    state: {
      kind: 'not-found',
      title: 'Nie znaleziono kursu',
      body: 'Ten kurs mógł zostać usunięty lub nie masz do niego dostępu.',
      action: <Button variant="outlined">Wróć do moich kursów</Button>,
    },
  },
};
