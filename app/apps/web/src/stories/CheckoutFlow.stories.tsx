import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  OutlinedInput,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';

import { FocusCard } from '../components/layout/FocusCard.js';
import { CardTitle, DataValue, FinePrint } from '../theme.js';

const meta = {
  title: 'Composites/Checkout flow',
  component: FocusCard,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FocusCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PriceSelection: Story = {
  name: 'Wybór ceny',
  args: {
    eyebrow: 'Kasa · Studio Anny',
    width: 'wide',
    children: (
      <Stack useFlexGap spacing="1rem">
        <CardTitle variant="h1">Kurs Together 101</CardTitle>
        <Typography variant="body1">
          Kompletny kurs wprowadzający do programowania od podstaw — dożywotni dostęp do wszystkich
          lekcji i materiałów.
        </Typography>
        <FormControl>
          <FormLabel id="checkout-price">Wybierz plan</FormLabel>
          <RadioGroup aria-labelledby="checkout-price" defaultValue="one-time">
            <Paper variant="outlined" sx={{ px: '0.75rem', my: '0.3rem' }}>
              <FormControlLabel value="one-time" control={<Radio />} label="Jednorazowo — 299,00 zł" />
            </Paper>
            <Paper variant="outlined" sx={{ px: '0.75rem', my: '0.3rem' }}>
              <FormControlLabel value="yearly" control={<Radio />} label="Rocznie — 199,00 zł / rok" />
            </Paper>
          </RadioGroup>
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="checkout-email">Adres e-mail</FormLabel>
          <OutlinedInput id="checkout-email" type="email" autoComplete="email" />
        </FormControl>
        <Button type="submit" variant="contained" color="secondary">
          Kup i zapłać
        </Button>
      </Stack>
    ),
  },
};

export const Success: Story = {
  name: 'Sukces',
  args: {
    eyebrow: 'Płatność potwierdzona',
    children: (
      <Stack useFlexGap spacing="1rem">
        <CardTitle variant="h1">Dostęp przyznany</CardTitle>
        <Typography variant="body1">Kurs Together 101</Typography>
        <Typography variant="h2" component="p">
          <DataValue>299,00 zł</DataValue>
        </Typography>
        <Button variant="contained" fullWidth>
          Przejdź do kursu
        </Button>
        <FinePrint variant="caption" component="p">
          Na produkcji wysłalibyśmy magiczny link na Twój adres e-mail.
        </FinePrint>
      </Stack>
    ),
  },
};
