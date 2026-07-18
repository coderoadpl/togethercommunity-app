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
    eyebrow: 'Zaloguj się do panelu',
    children: (
      <Stack useFlexGap spacing="1rem">
        <FormControl fullWidth>
          <FormLabel htmlFor="focus-email">Adres e-mail</FormLabel>
          <OutlinedInput id="focus-email" type="email" autoComplete="email" />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="focus-password">Hasło</FormLabel>
          <OutlinedInput id="focus-password" type="password" autoComplete="current-password" />
        </FormControl>
        <Button variant="contained" fullWidth>
          Zaloguj się
        </Button>
      </Stack>
    ),
  },
};

export const WideWithFooter: Story = {
  args: {
    eyebrow: 'Twórca kursów · Together',
    width: 'wide',
    children: (
      <Stack useFlexGap spacing="1rem">
        <CardTitle variant="h1">Załóż konto twórcy</CardTitle>
        <Typography variant="body1">
          Uruchom własną szkołę online w kilka minut — bez kart kredytowych na start.
        </Typography>
        <FormControl fullWidth>
          <FormLabel htmlFor="focus-signup-email">Adres e-mail</FormLabel>
          <OutlinedInput id="focus-signup-email" type="email" autoComplete="email" />
        </FormControl>
        <Button variant="contained" color="secondary" fullWidth>
          Utwórz konto
        </Button>
      </Stack>
    ),
    footer: (
      <Typography variant="body2" color="text.secondary">
        Masz już konto? Zaloguj się.
      </Typography>
    ),
  },
};
