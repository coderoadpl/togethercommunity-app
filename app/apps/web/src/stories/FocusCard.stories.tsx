import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, FormControl, FormLabel, OutlinedInput, Stack, Typography } from '@mui/material';

import { FocusCard } from '../components/layout/FocusCard.js';
import { CardTitle } from '../theme.js';

const meta = {
  title: 'Layout/FocusCard',
  component: FocusCard,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FocusCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {
  args: {
    eyebrow: 'Sign in to the panel',
    children: (
      <Stack useFlexGap spacing="1rem">
        <FormControl fullWidth>
          <FormLabel htmlFor="focus-email">Email address</FormLabel>
          <OutlinedInput id="focus-email" type="email" autoComplete="email" />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="focus-password">Password</FormLabel>
          <OutlinedInput id="focus-password" type="password" autoComplete="current-password" />
        </FormControl>
        <Button variant="contained" fullWidth>
          Sign in
        </Button>
      </Stack>
    ),
  },
};

export const WideWithFooter: Story = {
  args: {
    eyebrow: 'Course creator · Together',
    width: 'wide',
    children: (
      <Stack useFlexGap spacing="1rem">
        <CardTitle variant="h1">Create a creator account</CardTitle>
        <Typography variant="body1">
          Launch your own online school in minutes — no credit card required to start.
        </Typography>
        <FormControl fullWidth>
          <FormLabel htmlFor="focus-signup-email">Email address</FormLabel>
          <OutlinedInput id="focus-signup-email" type="email" autoComplete="email" />
        </FormControl>
        <Button variant="contained" color="secondary" fullWidth>
          Create account
        </Button>
      </Stack>
    ),
    footer: (
      <Typography variant="body2" color="text.secondary">
        Already have an account? Sign in.
      </Typography>
    ),
  },
};
