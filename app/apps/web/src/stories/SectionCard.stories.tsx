import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Button, FormControl, FormLabel, OutlinedInput } from '@mui/material';

import { SectionCard } from '../components/layout/SectionCard.js';

const meta = {
  title: 'Layout/SectionCard',
  component: SectionCard,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '44rem', mx: 'auto' }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof SectionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Informational: Story = {
  args: {
    title: 'Course access',
    description: 'Learners with active access can see every published lesson.',
    children: (
      <Box>
        This product unlocks access to 3 courses and 24 lessons. Content changes become visible
        immediately for every buyer.
      </Box>
    ),
  },
};

export const FormWithActions: Story = {
  args: {
    title: 'Payment integration',
    description: 'Connect Stripe to accept card payments.',
    children: (
      <>
        <FormControl fullWidth>
          <FormLabel htmlFor="section-stripe-key">Publishable key</FormLabel>
          <OutlinedInput id="section-stripe-key" placeholder="pk_live_…" />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="section-stripe-secret">Secret key</FormLabel>
          <OutlinedInput id="section-stripe-secret" type="password" placeholder="sk_live_…" />
        </FormControl>
      </>
    ),
    actions: (
      <>
        <Button variant="text">Test connection</Button>
        <Button variant="contained">Save</Button>
      </>
    ),
  },
};

export const AccountMobilePadding: Story = { args: { title: 'Account task', description: 'Compact spacing for account settings.', mobilePadding: true, children: <Button variant="outlined">Manage</Button> }, globals: { viewport: { value: 'mobile' } } };
