import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';

import { FocusCard } from '../components/layout/FocusCard.js';
import { CheckoutDisclosureRow, CheckoutPayBar, CheckoutSteps, CheckoutSummaryRow } from '../components/ui/CheckoutStepParts.js';
import { CardTitle, CheckoutPriceOption, CheckoutRowGroup, DataValue, FinePrint } from '../theme.js';

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
    onSubmit: (event) => event.preventDefault(),
    children: (
      <Stack useFlexGap spacing="1.25rem">
        <CheckoutSteps label="Checkout steps" steps={['Your order', 'Details and payment']} current={0} />
        <Stack useFlexGap spacing="0.75rem">
          <CardTitle variant="h1">Together Course 101</CardTitle>
          <CheckoutSummaryRow items="1 item" total="$299.00" detailsLabel="Details and VAT">
            <Typography variant="body1">
              A complete introduction to programming from scratch, with lifetime access to every
              lesson and resource.
            </Typography>
          </CheckoutSummaryRow>
        </Stack>
        <FormControl>
          <FormLabel id="checkout-price">Choose a plan</FormLabel>
          <RadioGroup aria-labelledby="checkout-price" defaultValue="one-time">
            <CheckoutPriceOption variant="outlined" selected sx={{ px: '0.75rem', my: '0.3rem' }}>
              <FormControlLabel value="one-time" control={<Radio />} label="One-time · $299.00" />
            </CheckoutPriceOption>
            <CheckoutPriceOption variant="outlined" selected={false} sx={{ px: '0.75rem', my: '0.3rem' }}>
              <FormControlLabel value="yearly" control={<Radio />} label="Yearly · $199.00 / year" />
            </CheckoutPriceOption>
          </RadioGroup>
        </FormControl>
        <CheckoutRowGroup>
          <CheckoutDisclosureRow label="I need an invoice" open={false} onToggle={() => undefined}>{null}</CheckoutDisclosureRow>
          <CheckoutDisclosureRow label="I have a discount code" open={false} onToggle={() => undefined}>{null}</CheckoutDisclosureRow>
        </CheckoutRowGroup>
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
        <CheckoutPayBar
          label="Go to payment · $299.00"
          disabled={false}
          note="Next step, on the Stripe page: email, terms and payment."
        />
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
