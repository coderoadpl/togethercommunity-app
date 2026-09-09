import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Button, Stack } from '@mui/material';

import { PanelPage } from '../components/layout/PanelPage.js';
import { SectionCard } from '../components/layout/SectionCard.js';

const meta = {
  title: 'Layout/PanelPage',
  component: PanelPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem' }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof PanelPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithAction: Story = {
  args: {
    title: 'Products',
    description: 'Manage your course offers and checkout links.',
    action: (
      <Button variant="contained">+ Add</Button>
    ),
    children: (
      <Stack useFlexGap spacing="1.5rem">
        <SectionCard title="Together Course 101" description="Published · 12 sales">
          <Box>Starter package with access to every lesson in the first module.</Box>
        </SectionCard>
        <SectionCard title="Advanced package" description="Draft · 0 sales">
          <Box>Extra resources and mentoring sessions for advanced learners.</Box>
        </SectionCard>
      </Stack>
    ),
  },
};

export const WithBackLink: Story = {
  args: {
    title: 'New product',
    backTo: <a href="#">← Back to products</a>,
    children: (
      <SectionCard
        title="Basic information"
        actions={<Button variant="contained">Save</Button>}
      >
        <Box>Product creation form.</Box>
      </SectionCard>
    ),
  },
};

export const EmptyState: Story = {
  args: {
    title: 'Sales',
    description: "Your school's transaction history.",
    state: {
      kind: 'empty',
      title: 'No sales yet',
      body: 'When someone buys your course, the transaction appears here.',
    },
  },
};
