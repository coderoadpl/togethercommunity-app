import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link,
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

const marketingConsents = [{
  definitionId: 'newsletter',
  label: 'I want to receive email tips and updates about new courses.',
  documentUrl: '/legal/newsletter/v/3',
}];

export const PriceSelection: Story = {
  name: 'Price selection',
  args: {
    eyebrow: "Checkout · Anna's Studio",
    width: 'wide',
    children: (
      <Stack useFlexGap spacing="1rem">
        <CardTitle variant="h1">Together Course 101</CardTitle>
        <Typography variant="body1">
          A complete introduction to programming from scratch — lifetime access to every lesson
          and resource.
        </Typography>
        <FormControl>
          <FormLabel id="checkout-price">Choose a plan</FormLabel>
          <RadioGroup aria-labelledby="checkout-price" defaultValue="one-time">
            <Paper variant="outlined" sx={{ px: '0.75rem', my: '0.3rem' }}>
              <FormControlLabel value="one-time" control={<Radio />} label="One-time — $299.00" />
            </Paper>
            <Paper variant="outlined" sx={{ px: '0.75rem', my: '0.3rem' }}>
              <FormControlLabel value="yearly" control={<Radio />} label="Yearly — $199.00 / year" />
            </Paper>
          </RadioGroup>
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="checkout-email">Email address</FormLabel>
          <OutlinedInput id="checkout-email" type="email" autoComplete="email" />
        </FormControl>
        <FormControl component="fieldset">
          <FormLabel component="legend">Marketing consents</FormLabel>
          {marketingConsents.map((consent) => (
            <FormControlLabel
              key={consent.definitionId}
              control={<Checkbox />}
              label={(
                <Typography variant="body2">
                  {consent.label}{' '}
                  <Link href={consent.documentUrl} target="_blank" rel="noreferrer">
                    Read the terms
                  </Link>
                </Typography>
              )}
            />
          ))}
        </FormControl>
        <Button type="submit" variant="contained" color="secondary">
          Buy and pay
        </Button>
      </Stack>
    ),
  },
};

export const Success: Story = {
  name: 'Success',
  args: {
    eyebrow: 'Payment confirmed',
    children: (
      <Stack useFlexGap spacing="1rem">
        <CardTitle variant="h1">Access granted</CardTitle>
        <Typography variant="body1">Together Course 101</Typography>
        <Typography variant="h2" component="p">
          <DataValue>$299.00</DataValue>
        </Typography>
        <Button variant="contained" fullWidth>
          Go to course
        </Button>
        <FinePrint variant="caption" component="p">
          In production we would email a magic link to your address.
        </FinePrint>
      </Stack>
    ),
  },
};
