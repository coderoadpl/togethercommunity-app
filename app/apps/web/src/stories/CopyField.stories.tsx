import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '@mui/material';

import { CopyField } from '../components/ui/CopyField.js';

const meta = {
  title: 'Forms/CopyField',
  component: CopyField,
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '36rem' }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof CopyField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadOnly: Story = {
  args: {
    value: 'https://acme.togethercommunity.app/checkout/javascript-basics',
    label: 'Checkout URL',
  },
};

export const Mono: Story = {
  args: {
    value: 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ',
    label: 'Value',
    hint: 'Add this CNAME record at your DNS provider.',
    mono: true,
  },
};

export const Small: Story = {
  args: {
    value: 'ik_live_7d2c41f0a9',
    label: 'Key secret',
    mono: true,
    size: 'small',
  },
};

export const Editable: Story = {
  args: {
    value: 'https://example.test/webhooks/together',
    label: 'Endpoint',
    editable: true,
    onChange: () => undefined,
  },
};
