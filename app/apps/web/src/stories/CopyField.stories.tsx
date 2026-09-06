import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Stack } from '@mui/material';

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

export const DnsRecord: Story = {
  args: {
    value: 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ',
    label: 'Value',
    hint: 'Add this CNAME record at your DNS provider.',
  },
};

export const Small: Story = {
  args: {
    value: 'ik_live_7d2c41f0a9',
    label: 'Key secret',
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

export const Variants: Story = {
  args: {
    value: 'https://example.test/webhooks/together/abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789',
  },
  parameters: { controls: { disable: true } },
  render: function VariantsStory(args) {
    const [value, setValue] = useState(args.value);
    return (
      <Stack spacing={2}>
        <CopyField
          value={args.value}
          label="Read-only URL"
          hint="Select the text or use the copy button."
        />
        <CopyField value={value} label="Editable URL" editable onChange={setValue} />
      </Stack>
    );
  },
};
