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
    title: 'Dostęp do kursu',
    description: 'Kursanci z aktywnym dostępem widzą wszystkie opublikowane lekcje.',
    children: (
      <Box>
        Ten produkt otwiera dostęp do 3 kursów i 24 lekcji. Zmiany w zawartości są widoczne
        natychmiast dla wszystkich kupujących.
      </Box>
    ),
  },
};

export const FormWithActions: Story = {
  args: {
    title: 'Integracja płatności',
    description: 'Podłącz Stripe, aby przyjmować płatności kartą.',
    children: (
      <>
        <FormControl fullWidth>
          <FormLabel htmlFor="section-stripe-key">Klucz publiczny</FormLabel>
          <OutlinedInput id="section-stripe-key" placeholder="pk_live_…" />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="section-stripe-secret">Klucz tajny</FormLabel>
          <OutlinedInput id="section-stripe-secret" type="password" placeholder="sk_live_…" />
        </FormControl>
      </>
    ),
    actions: (
      <>
        <Button variant="text">Testuj połączenie</Button>
        <Button variant="contained">Zapisz</Button>
      </>
    ),
  },
};
