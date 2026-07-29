import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '@mui/material';

import { SecretField } from '../components/ui/SecretField.js';

const labels = {
  configured: 'Configured',
  notConfigured: 'Not configured',
  placeholder: 'Paste a new value',
  save: 'Save',
  saving: 'Saving…',
  remove: 'Remove',
  removing: 'Removing…',
  saved: 'Saved',
};

const meta = {
  title: 'Forms/SecretField',
  component: SecretField,
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '36rem' }}>
        <Story />
      </Box>
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
    value: '',
    labels,
    onValueChange: () => undefined,
    onSave: () => undefined,
    onRemove: () => undefined,
  },
};

export const Configured: Story = {
  args: {
    secretKey: 'ksef.token',
    label: 'Token KSeF',
    maskedPreview: '••••8a91',
    value: '',
    labels,
    onValueChange: () => undefined,
    onSave: () => undefined,
    onRemove: () => undefined,
  },
};
