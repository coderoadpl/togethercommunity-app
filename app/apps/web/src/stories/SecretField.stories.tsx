import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SecretField } from '../components/ui/SecretField.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const meta = {
  title: 'Forms/SecretField',
  component: SecretField,
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <Box sx={{ p: '1.5rem', maxWidth: '36rem' }}>
          <Story />
        </Box>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof SecretField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    secretKey: 'ksef.token',
    label: 'Token KSeF',
    maskedPreview: null,
  },
};

export const Configured: Story = {
  args: {
    secretKey: 'ksef.token',
    label: 'Token KSeF',
    maskedPreview: '••••8a91',
  },
};
