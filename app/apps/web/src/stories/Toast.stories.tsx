import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '@mui/material';

import { LanguageProvider } from '../i18n/index.js';
import { pl } from '../i18n/pl.js';
import { ToastProvider, useToast } from '../components/ui/Toast.js';

const ToastStory = ({ kind }: { kind: 'success' | 'error' | 'info' }) => {
  const toast = useToast();

  useEffect(() => {
    if (kind === 'success') toast.success(pl.common.saved);
    else if (kind === 'error') toast.error(pl.errors.detailGeneric);
    else toast.info(pl.tenantDomains.checking);
  }, [kind, toast]);

  return <Box sx={{ minHeight: '12rem' }} />;
};

const meta = {
  title: 'Feedback/Toast',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <LanguageProvider>
        <ToastProvider>
          <Box sx={{ p: '1.5rem', minHeight: '16rem' }}>
            <Story />
          </Box>
        </ToastProvider>
      </LanguageProvider>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  render: () => <ToastStory kind="success" />,
};

export const Error: Story = {
  render: () => <ToastStory kind="error" />,
};

export const Info: Story = {
  render: () => <ToastStory kind="info" />,
};
